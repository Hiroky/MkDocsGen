import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { Logger } from "../logger.js";
import { createConverter } from "../markdown/convert.js";
import { copyAssets } from "../render/assets.js";
import { Renderer } from "../render/renderer.js";
import { assignPrevNext, buildNav } from "../scanner/nav.js";
import { scanPages } from "../scanner/scan.js";
import type { BuildContext, Page } from "../types.js";
import { validateLinks } from "./validate-links.js";

/** buildコマンドのオプション */
export interface BuildOptions {
  configPath: string;
  strict: boolean;
  clean: boolean;
  verbose: boolean;
}

/** ビルド結果サマリ */
export interface BuildResult {
  pageCount: number;
  warnCount: number;
  durationMs: number;
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
 * ビルド全体を実行する。CLIから呼ばれる唯一の入口
 */
export async function runBuild(options: BuildOptions, logger: Logger): Promise<BuildResult>
{
  const startedAt = Date.now();

  // 1. 設定を読み込む（失敗時はConfigErrorがそのまま上へ伝播しCLIが表示する）
  const config = loadConfig(options.configPath);
  logger.debug(`設定を読み込みました: ${config.configPath}`);

  // 2. --clean指定時は出力ディレクトリを空にする
  if (options.clean) {
    // 誤爆防止のため、危険な出力パスは削除前に拒否する
    assertOutputDirSafe(config.configDir, config.outputDirAbs, config.docsDirAbs);
    fs.rmSync(config.outputDirAbs, { recursive: true, force: true });
    logger.debug(`出力ディレクトリを削除しました: ${config.outputDirAbs}`);
  }

  // 3. ページ走査 → ナビ構築 → prev/next割り当て
  const sources = scanPages(config, logger);
  logger.debug(`走査ページ数: ${sources.length}`);
  const navResult = buildNav(sources, config, logger);
  const relations = assignPrevNext(navResult.orderedPages);

  // 4. 各ページをMarkdown変換してPage[]を完成させる
  const converter = await createConverter(config, logger);
  const pages: Page[] = navResult.orderedPages.map((source) => {
    const converted = converter.convert(source.markdown, source.sourcePath);
    const relation = relations.get(source.sourcePath) ?? { prev: null, next: null };
    return {
      sourcePath: source.sourcePath,
      outputPath: source.outputPath,
      url: source.url,
      title: source.title,
      description: source.description,
      frontmatter: source.frontmatter,
      headings: converted.headings,
      anchorIds: converted.anchorIds,
      links: converted.links,
      contentHtml: converted.html,
      plainText: converted.plainText,
      prev: relation.prev,
      next: relation.next,
      breadcrumbs: navResult.breadcrumbsMap.get(source.sourcePath) ?? []
    };
  });

  // 4.5 内部リンク検証（切れは警告。strictはサマリ後に判定）
  validateLinks(pages, logger);

  // 5. アセットをコピーし、全ページをレンダリングして書き出す
  fs.mkdirSync(config.outputDirAbs, { recursive: true });
  copyAssets(config);
  const renderer = new Renderer(config);
  const context: BuildContext = { config, pages, nav: navResult.nav };
  for (const page of pages) {
    const html = renderer.renderPage(page, context);
    const outFile = path.join(config.outputDirAbs, page.outputPath);
    // ネストした出力パスのため親ディレクトリを先に作る
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html, "utf-8");
    logger.debug(`出力: ${page.outputPath}`);
  }

  // 6. サマリを表示し、strict判定を行う
  const result: BuildResult = {
    pageCount: pages.length,
    warnCount: logger.getWarnCount(),
    durationMs: Date.now() - startedAt
  };
  const durationSec = (result.durationMs / 1000).toFixed(2);
  logger.info(`${result.pageCount}ページを出力 (警告${result.warnCount}件, ${durationSec}秒)`);

  if (options.strict && result.warnCount > 0) {
    throw new BuildError("strictモード: 警告があるためビルドを失敗させます");
  }

  return result;
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
