import fs from "node:fs";
import path from "node:path";
import { loadProjectEnv } from "../config/env.js";
import { loadConfig } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import { createConverter } from "../markdown/convert.js";
import { extractToctreePlaceholders, resolvePageToctrees, type ExtractToctreeResult } from "../markdown/toctree.js";
import {
  runBuildEnd,
  runConfigResolved,
  runTransformHtml,
  runTransformMarkdown
} from "../plugin/hooks.js";
import { loadPlugins } from "../plugin/load.js";
import type { PageMeta, Plugin } from "../plugin/types.js";
import { expandPydocDirectives, mergePydocHeadings } from "../pydoc/expand.js";
import { expandPydocPackagePages } from "../pydoc/pages.js";
import { ModuleResolveError } from "../pydoc/resolve.js";
import { parsePythonModule } from "../pydoc/parser.js";
import { renderModuleDoc, renderSyntaxError } from "../pydoc/render.js";
import { createPythonParser, type PythonParser } from "../pydoc/tree-sitter.js";
import { copyAssets } from "../render/assets.js";
import { Renderer } from "../render/renderer.js";
import { assignPrevNext, buildNav } from "../scanner/nav.js";
import { scanPages, type PageSource } from "../scanner/scan.js";
import { buildSearchIndex, writeSearchIndex } from "../search/index.js";
import type { BuildContext, Heading, NavNode, Page } from "../types.js";
import { copyStaticDocs } from "./static-docs.js";
import { validateLinks } from "./validate-links.js";

/** buildコマンドのオプション */
export interface BuildOptions {
  configPath: string;
  strict: boolean;
  clean: boolean;
  verbose: boolean;
  /** CLIの --enable で指定されたプラグイン名一覧 */
  enabledPlugins?: readonly string[];
}

/** ビルド結果サマリ */
export interface BuildResult {
  pageCount: number;
  warnCount: number;
  durationMs: number;
}

/** サイト生成の詳細結果（serveの増分ビルドが状態を引き継ぐために使う） */
export interface SiteBuildOutput {
  result: BuildResult;
  pages: Page[];
  nav: NavNode[];
  /** nav影響判定用。sourcePath/title/orderの一覧シグネチャ */
  navSignature: string;
  /** 再利用可能なMarkdown変換器 */
  converter: Awaited<ReturnType<typeof createConverter>>;
  /** 読み込み済みプラグイン（増分ビルドで再利用する） */
  plugins: Plugin[];
  /** 再利用可能なPythonパーサ（tree-sitter WASM初期化済み） */
  pythonParser: PythonParser;
}

/**
 * ビルド処理で発生するエラー。CLIはこのメッセージを表示して終了コード1にする
 */
export class BuildError extends Error
{
  /**
   * BuildErrorを生成する
   */
  constructor(message: string)
  {
    super(message);
    this.name = "BuildError";
  }
}

/**
 * ビルド全体を実行する。CLIから呼ばれる入口
 */
export async function runBuild(options: BuildOptions, logger: Logger): Promise<BuildResult>
{
  // 設定を読み込む（失敗時はConfigErrorがそのまま上へ伝播しCLIが表示する）
  const config = loadConfig(options.configPath);
  logger.debug(`設定を読み込みました: ${config.configPath}`);

  // mkdocsgen.ymlと同じフォルダの.envがあれば読み込む（プラグインより前・シェルのenvは上書きしない）
  const loadedEnvKeys = loadProjectEnv(config.configDir);
  if (loadedEnvKeys.length > 0) {
    logger.debug(`.envから環境変数を読み込みました: ${loadedEnvKeys.join(", ")}`);
  }

  // --clean指定時は出力ディレクトリを空にする
  if (options.clean) {
    // 誤爆防止のため、危険な出力パスは削除前に拒否する
    assertOutputDirSafe(config.configDir, config.outputDirAbs, config.docsDirAbs);
    fs.rmSync(config.outputDirAbs, { recursive: true, force: true });
    logger.debug(`出力ディレクトリを削除しました: ${config.outputDirAbs}`);
  }

  // 実体のサイト生成へ委譲する
  const output = await buildSite(config, logger, {
    strict: options.strict,
    // --enable で指定されたプラグイン名をBuildContext経由で渡す（コアは中身を解釈しない）
    enabledPlugins: options.enabledPlugins ?? []
  });
  return output.result;
}

/**
 * 解決済み設定からサイトをフル生成する（serveからも再利用する）
 */
export async function buildSite(
  config: ResolvedConfig,
  logger: Logger,
  options: {
    strict: boolean;
    silentSummary?: boolean;
    converter?: Awaited<ReturnType<typeof createConverter>>;
    /** 呼び出し側で既にロード済みのプラグイン（あれば再利用） */
    plugins?: Plugin[];
    /** 呼び出し側で既に初期化済みのPythonパーサ（あれば再利用） */
    pythonParser?: PythonParser;
    /** trueならconfigResolvedをスキップする */
    skipConfigResolved?: boolean;
    /** trueならbuildEndをスキップする（serve経路用。副作用プラグインの連打を防ぐ） */
    skipBuildEnd?: boolean;
    /** CLIの --enable で指定されたプラグイン名（BuildContext経由で渡す） */
    enabledPlugins?: BuildContext["enabledPlugins"];
  } = { strict: false }
): Promise<SiteBuildOutput>
{
  const startedAt = Date.now();

  // プラグインをロードし、設定確定直後フックを実行する
  const plugins = options.plugins ?? await loadPlugins(config);
  if (!options.skipConfigResolved) {
    await runConfigResolved(plugins, config);
  }
  if (plugins.length > 0) {
    logger.debug(`プラグインを${plugins.length}件ロードしました`);
  }

  // ページ走査 → ナビ構築 → prev/next割り当て
  const scannedSources = scanPages(config, logger);
  let sources: PageSource[];
  try {
    sources = expandPydocPackagePages(scannedSources, config, logger).sources;
  } catch (error) {
    // パッケージディレクティブの事前解決失敗も通常のpydoc解決失敗と同じCLIエラーへ統一する
    if (error instanceof ModuleResolveError) {
      throw new BuildError(error.message);
    }
    throw error;
  }
  logger.debug(`走査ページ数: ${sources.length}`);
  const navResult = buildNav(sources, config, logger);
  // tree-sitter WASMは初回だけ初期化し、serve増分で再利用する
  const pythonParser = options.pythonParser ?? await createPythonParser();
  let converted: { pages: Page[]; converter: Awaited<ReturnType<typeof createConverter>> };
  try {
    converted = await convertSourcesToPages(
      config, logger, navResult.orderedPages, navResult, options.converter, plugins, undefined, pythonParser
    );
  } catch (error) {
    // pydocモジュール解決失敗はビルドエラーとしてメッセージをそのまま出す
    if (error instanceof ModuleResolveError) {
      throw new BuildError(error.message);
    }
    throw error;
  }
  const pages = converted.pages;

  // 内部リンク検証（切れは警告。strictはサマリ後に判定）
  validateLinks(pages, logger);

  // アセット・検索インデックス・全ページHTMLを書き出す
  const context = await writeFullSite(
    config, pages, navResult.nav, logger, plugins, options.enabledPlugins
  );

  // buildEndはCLIのrunBuild経路でのみ実行する（serveのfullBuild/増分ではスキップ）
  if (!options.skipBuildEnd) {
    await runBuildEnd(plugins, context);
  }

  // サマリを表示し、strict判定を行う
  const result: BuildResult = {
    pageCount: pages.length,
    warnCount: logger.getWarnCount(),
    durationMs: Date.now() - startedAt
  };
  if (!options.silentSummary) {
    const durationSec = (result.durationMs / 1000).toFixed(2);
    logger.info(`${result.pageCount}ページを出力 (警告${result.warnCount}件, ${durationSec}秒)`);
  }

  if (options.strict && result.warnCount > 0) {
    throw new BuildError("strictモード: 警告があるためビルドを失敗させます");
  }

  return {
    result,
    pages,
    nav: navResult.nav,
    navSignature: computeNavSignature(navResult.orderedPages),
    converter: converted.converter,
    plugins,
    pythonParser
  };
}

/**
 * PageSource列をMarkdown変換してPage[]にする
 */
export async function convertSourcesToPages(
  config: ResolvedConfig,
  logger: Logger,
  orderedPages: PageSource[],
  navResult: { breadcrumbsMap: Map<string, Page["breadcrumbs"]>; nav: NavNode[] },
  existingConverter?: Awaited<ReturnType<typeof createConverter>>,
  plugins: Plugin[] = [],
  reuse?: {
    /** 再変換するsourcePath集合。未指定なら全ページを変換する */
    onlySourcePaths: Set<string>;
    /** 再利用する前回ビルドのPage一覧 */
    previousPages: Map<string, Page>;
  },
  existingPythonParser?: PythonParser
): Promise<{ pages: Page[]; converter: Awaited<ReturnType<typeof createConverter>>; pythonParser: PythonParser }>
{
  const relations = assignPrevNext(orderedPages);
  // serveの増分ではShiki初期化済みコンバータを再利用し、毎回の起動コストを避ける
  const converter = existingConverter ?? await createConverter(config, logger);
  // pydoc展開用のPythonパーサも同様に再利用する
  const pythonParser = existingPythonParser ?? await createPythonParser();
  const pages: Page[] = [];
  for (const source of orderedPages) {
    const relation = relations.get(source.sourcePath) ?? { prev: null, next: null };
    const breadcrumbs = navResult.breadcrumbsMap.get(source.sourcePath) ?? [];

    // 増分ビルド: 変更されていないページは変換をスキップし前回結果を流用する
    if (reuse && !reuse.onlySourcePaths.has(source.sourcePath)) {
      const previous = reuse.previousPages.get(source.sourcePath);
      if (previous) {
        // prev/next/breadcrumbsだけ最新ナビに合わせて更新する
        pages.push({
          ...previous,
          prev: relation.prev,
          next: relation.next,
          breadcrumbs
        });
        continue;
      }
      // 前回に無い場合はフォールバックで変換する（防御的）
      logger.debug(`増分ビルド: 前回ページが無いため再変換します: ${source.sourcePath}`);
    }

    let toctreeExtracted: ExtractToctreeResult;
    let expanded: { markdown: string; extraHeadings: Heading[]; hasPydoc: boolean };
    if (source.generatedPydoc) {
      // 自動生成ページは解決済みの1ファイルだけを直接解析し、パッケージ全体を再展開しない
      const pythonSource = fs.readFileSync(source.generatedPydoc.filePath, "utf-8");
      const parsed = parsePythonModule(pythonSource, source.generatedPydoc.modulePath, pythonParser);
      if (parsed.ok) {
        const rendered = renderModuleDoc(parsed.module, source.generatedPydoc.options);
        expanded = { ...rendered, hasPydoc: true };
      } else {
        logger.warn(`${parsed.message} (${source.generatedPydoc.filePath})`);
        expanded = {
          ...renderSyntaxError(source.generatedPydoc.modulePath, parsed.message),
          hasPydoc: true
        };
      }
      toctreeExtracted = { markdown: "", toctrees: [] };
    } else {
      // Markdown変換前にプラグインでソースを加工する
      const markdown = await runTransformMarkdown(
        plugins,
        source.markdown,
        toPageMeta(source)
      );
      // ::: toctree をプレースホルダへ置換（Admonitionが拾わないようにconvert前に除去する）
      toctreeExtracted = extractToctreePlaceholders(markdown);
      // ::: pydoc をAPIドキュメントMarkdownへ展開してから通常変換する
      expanded = expandPydocDirectives(toctreeExtracted.markdown, config, logger, pythonParser);
    }
    const converted = converter.convert(expanded.markdown, source.sourcePath);
    // 仕様どおりのドット区切りアンカーIDを見出し・HTML・検証用一覧へマージする
    const merged = mergePydocHeadings(
      converted.html,
      converted.headings,
      converted.anchorIds,
      expanded.extraHeadings
    );
    pages.push({
      sourcePath: source.sourcePath,
      outputPath: source.outputPath,
      url: source.url,
      title: source.title,
      description: source.description,
      frontmatter: source.frontmatter,
      headings: merged.headings,
      anchorIds: merged.anchorIds,
      links: converted.links,
      contentHtml: merged.html,
      plainText: converted.plainText,
      prev: relation.prev,
      next: relation.next,
      breadcrumbs,
      toctrees: toctreeExtracted.toctrees,
      isPydoc: source.generatedPydoc !== undefined || expanded.hasPydoc
    });
  }
  return { pages, converter, pythonParser };
}

/**
 * アセット・検索インデックス・全ページHTMLを出力する
 */
export async function writeFullSite(
  config: ResolvedConfig,
  pages: Page[],
  nav: NavNode[],
  logger: Logger,
  plugins: Plugin[] = [],
  enabledPlugins?: BuildContext["enabledPlugins"]
): Promise<BuildContext>
{
  fs.mkdirSync(config.outputDirAbs, { recursive: true });
  // テーマ資産の前に docs の画像等を同じ相対パスでコピーする
  copyStaticDocs(config);
  copyAssets(config);
  // toctreeプレースホルダを解決したコピーで検索・HTML出力する（元Pageはプレースホルダのまま保持）
  const resolvedPages = pages.map((page) => resolvePageToctrees(page, nav, pages, logger));
  writeSearchIndex(config.outputDirAbs, buildSearchIndex(resolvedPages));
  const renderer = new Renderer(config);
  // enabledPluginsはbuildEndプラグインが自身のnameで参照する（コアは解釈しない）
  const context: BuildContext = {
    config,
    pages: resolvedPages,
    nav,
    ...(enabledPlugins !== undefined ? { enabledPlugins } : {})
  };
  for (const page of resolvedPages) {
    await writePageHtml(config, page, context, renderer, logger, plugins);
  }
  return context;
}

/**
 * 1ページ分のHTMLを出力ファイルへ書き出す
 */
export async function writePageHtml(
  config: ResolvedConfig,
  page: Page,
  context: BuildContext,
  renderer: Renderer,
  logger: Logger,
  plugins: Plugin[] = []
): Promise<void>
{
  // テンプレートでHTMLを生成し、プラグインで最終加工する
  let html = renderer.renderPage(page, context);
  html = await runTransformHtml(plugins, html, page);
  const outFile = path.join(config.outputDirAbs, page.outputPath);
  // ネストした出力パスのため親ディレクトリを先に作る
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, "utf-8");
  logger.debug(`出力: ${page.outputPath}`);
}

/**
 * PageSourceからプラグイン向けPageMetaを作る
 */
function toPageMeta(source: PageSource): PageMeta
{
  return {
    sourcePath: source.sourcePath,
    outputPath: source.outputPath,
    url: source.url,
    title: source.title,
    description: source.description,
    frontmatter: source.frontmatter
  };
}

/**
 * nav影響判定用にページ一覧のシグネチャ文字列を作る
 */
export function computeNavSignature(sources: PageSource[]): string
{
  // sourcePath / title / order が変わるとサイドバー全体が変わる
  return sources
    .map((source) => `${source.sourcePath}\0${source.title}\0${source.order ?? ""}`)
    .join("\n");
}

/**
 * --cleanの誤爆を防ぐため、出力ディレクトリが安全な範囲にあることを確認する
 */
function assertOutputDirSafe(configDir: string, outputDirAbs: string, docsDirAbs: string): void
{
  const normalizedConfigDir = path.resolve(configDir);
  const normalizedOutputDir = path.resolve(outputDirAbs);
  const normalizedDocsDir = path.resolve(docsDirAbs);

  // 設定ディレクトリ配下でない場合は拒否する
  const relative = path.relative(normalizedConfigDir, normalizedOutputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BuildError(
      `安全のため、--clean は設定ファイル配下の出力ディレクトリにのみ使えます: ${normalizedOutputDir}`
    );
  }

  // output_dir: . のようにプロジェクトルートそのものは拒否する（設定・ソースごと消える）
  if (relative === "") {
    throw new BuildError(
      `安全のため、--clean はプロジェクトルートを出力先にできません: ${normalizedOutputDir}`
    );
  }

  // docs_dirと同じ、またはdocs_dirを包含する出力先も拒否する（ソース消失を防ぐ）
  if (isSameOrAncestorDir(normalizedOutputDir, normalizedDocsDir)) {
    throw new BuildError(
      `安全のため、--clean は docs_dir と同じかそれを含むパスを出力先にできません: ${normalizedOutputDir}`
    );
  }
}

/**
 * candidateがtargetと同じか、その祖先ディレクトリかどうかを判定する
 */
function isSameOrAncestorDir(candidate: string, target: string): boolean
{
  if (candidate === target) {
    return true;
  }
  // targetがcandidate配下なら、candidateを消すとtargetも消える
  const relative = path.relative(candidate, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
