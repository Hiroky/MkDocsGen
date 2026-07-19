import fs from "node:fs";
import path from "node:path";
import {
  buildSite,
  computeNavSignature,
  convertSourcesToPages,
  writeFullSite,
  writePageHtml
} from "../build/pipeline.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import type { createConverter } from "../markdown/convert.js";
import type { Plugin } from "../plugin/types.js";
import { Renderer } from "../render/renderer.js";
import { buildNav } from "../scanner/nav.js";
import { scanPages } from "../scanner/scan.js";
import { buildSearchIndex, writeSearchIndex } from "../search/index.js";
import type { BuildContext, NavNode, Page } from "../types.js";

/** Markdown変換器の型（createConverterの戻り値） */
type MarkdownConverter = Awaited<ReturnType<typeof createConverter>>;

/** serve中に保持するビルド状態 */
export interface DevBuildState {
  config: ResolvedConfig;
  pages: Page[];
  nav: NavNode[];
  navSignature: string;
  /** 増分ビルドで再利用する変換器（Shiki初期化済み） */
  converter: MarkdownConverter;
  /** 増分ビルドで再利用するプラグイン */
  plugins: Plugin[];
}

/** docs変更後の再ビルド結果 */
export interface DocsRebuildResult {
  state: DevBuildState;
  mode: "full" | "partial";
  rebuiltPaths: string[];
}

/** 監視対象の種別 */
export type WatchCategory = "config" | "docs" | "theme" | "pydoc" | "ignore";

/**
 * 変更ファイルの絶対パスを監視カテゴリへ分類する
 */
export function classifyPath(absPath: string, config: ResolvedConfig): WatchCategory
{
  const normalized = path.resolve(absPath);

  // 設定ファイルそのもの
  if (normalized === path.resolve(config.configPath)) {
    return "config";
  }

  // 出力ディレクトリ配下は自分自身の書き込みなので無視する
  if (isInsideDir(normalized, config.outputDirAbs)) {
    return "ignore";
  }

  // ドキュメントソース
  if (isInsideDir(normalized, config.docsDirAbs)) {
    return "docs";
  }

  // テーマオーバーライド
  if (isInsideDir(normalized, config.overridesDirAbs)) {
    return "theme";
  }

  // pydoc対象ソース（フェーズ9前でも監視パスとして扱う）
  for (const rel of config.pydoc.source_dirs) {
    const absDir = path.resolve(config.configDir, rel);
    if (isInsideDir(normalized, absDir)) {
      return "pydoc";
    }
  }

  return "ignore";
}

/**
 * フルビルドを実行してDevBuildStateを返す
 */
export async function fullBuild(
  config: ResolvedConfig,
  logger: Logger,
  existingConverter?: MarkdownConverter,
  existingPlugins?: Plugin[]
): Promise<DevBuildState>
{
  // 既存コンバータ・プラグインがあれば渡し、再初期化を避ける
  // 設定再読込時はpluginsを渡さず、buildSite側で再ロード＋configResolvedする
  // serve経路ではbuildEndをスキップし、Confluence等の副作用をmkdocsgen buildに限定する
  const output = await buildSite(config, logger, {
    strict: false,
    skipBuildEnd: true,
    ...(existingConverter ? { converter: existingConverter } : {}),
    ...(existingPlugins ? { plugins: existingPlugins, skipConfigResolved: true } : {})
  });
  return {
    config,
    pages: output.pages,
    nav: output.nav,
    navSignature: output.navSignature,
    converter: output.converter,
    plugins: output.plugins
  };
}

/**
 * docs配下の変更を受けて増分またはフル再ビルドする
 */
export async function rebuildDocs(
  state: DevBuildState,
  changedSourcePaths: string[],
  logger: Logger
): Promise<DocsRebuildResult>
{
  const { config, converter, plugins } = state;
  const previousOutputs = new Map(state.pages.map((page) => [page.sourcePath, page.outputPath]));

  // 最新のソースを走査してナビを組み直す
  const sources = scanPages(config, logger);
  const navResult = buildNav(sources, config, logger);
  const nextSignature = computeNavSignature(navResult.orderedPages);

  // navに影響する変更（追加・削除・title/order）は全ページのサイドバーが変わるためフル再ビルド
  if (nextSignature !== state.navSignature) {
    logger.info("ナビ影響の変更を検出したためフル再ビルドします");
    const converted = await convertSourcesToPages(
      config, logger, navResult.orderedPages, navResult, converter, plugins
    );
    await writeFullSite(config, converted.pages, navResult.nav, logger, plugins);
    // 削除されたページの出力HTMLを取り除く
    removeStaleOutputs(config, previousOutputs, converted.pages);
    // serve経路の再ビルドではbuildEndを呼ばない（副作用プラグインの連打同期を防ぐ）
    // buildEndはCLIのrunBuild（mkdocsgen build）でのみ実行する
    return {
      mode: "full",
      rebuiltPaths: converted.pages.map((page) => page.sourcePath),
      state: {
        config,
        pages: converted.pages,
        nav: navResult.nav,
        navSignature: nextSignature,
        converter: converted.converter,
        plugins
      }
    };
  }

  // navが不変なら、変更されたページだけ再変換・再レンダリングする
  const changedSet = new Set(
    changedSourcePaths.map((p) => p.split(path.sep).join("/")).filter((p) => p.endsWith(".md"))
  );
  const previousPages = new Map(state.pages.map((page) => [page.sourcePath, page]));
  // 変換コスト（Shiki等）も差分にするため、変更ページだけconvertする
  const converted = await convertSourcesToPages(
    config, logger, navResult.orderedPages, navResult, converter, plugins,
    { onlySourcePaths: changedSet, previousPages }
  );
  const rebuiltPaths: string[] = [];
  const renderer = new Renderer(config);
  const context: BuildContext = { config, pages: converted.pages, nav: navResult.nav };

  for (const page of converted.pages) {
    if (!changedSet.has(page.sourcePath)) {
      continue;
    }
    // 変更ページだけHTMLを書き直す
    await writePageHtml(config, page, context, renderer, logger, plugins);
    rebuiltPaths.push(page.sourcePath);
  }

  // 検索インデックスは全文から作り直す（ページ数が少なくコストが小さい）
  writeSearchIndex(config.outputDirAbs, buildSearchIndex(converted.pages));
  // 増分ではbuildEndを呼ばない（serve保存連打で副作用プラグインが毎回同期されないようにする）
  logger.info(`増分ビルド: ${rebuiltPaths.length}ページを更新`);

  return {
    mode: "partial",
    rebuiltPaths,
    state: {
      config,
      pages: converted.pages,
      nav: navResult.nav,
      navSignature: nextSignature,
      converter: converted.converter,
      plugins
    }
  };
}

/**
 * 削除されたページの出力ファイルを取り除く
 */
function removeStaleOutputs(
  config: ResolvedConfig,
  previousOutputs: Map<string, string>,
  currentPages: Page[]
): void
{
  const currentSources = new Set(currentPages.map((page) => page.sourcePath));
  for (const [sourcePath, outputPath] of previousOutputs) {
    if (currentSources.has(sourcePath)) {
      continue;
    }
    const abs = path.join(config.outputDirAbs, outputPath);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
    }
  }
}

/**
 * targetがdir配下（dir自身含む）かどうかを判定する
 */
function isInsideDir(target: string, dir: string): boolean
{
  const normalizedTarget = path.resolve(target);
  const normalizedDir = path.resolve(dir);
  if (normalizedTarget === normalizedDir) {
    return true;
  }
  const relative = path.relative(normalizedDir, normalizedTarget);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
