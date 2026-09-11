import type { ResolvedConfig } from "../config/schema.js";
import type { BuildContext, NavNode, Page } from "../types.js";
import type {
  MkDocsGenPlugin,
  PluginBuildContext,
  PluginConfigContext,
  PluginHtmlContext,
  PluginMarkdownContext,
  PluginNavNode
} from "./api.js";
import { PluginError } from "./load.js";
import type { AnyPlugin, PageMeta, Plugin } from "./types.js";

/**
 * フック実行中の例外をプラグイン名付きPluginErrorへ包む
 */
function wrapHookError(pluginName: string, hookName: string, error: unknown): PluginError
{
  // 元例外のメッセージとスタックを残し、どのプラグインのどのフックか分かるようにする
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const wrapped = new PluginError(
    `プラグイン "${pluginName}" の ${hookName} でエラーが発生しました: ${message}`,
    { cause: error }
  );
  // CLIが表示しやすいよう、元スタックがあれば連結する
  if (stack) {
    wrapped.stack = `${wrapped.message}\n${stack}`;
  }
  return wrapped;
}

/**
 * ResolvedConfigからPluginConfigContext（公開読み取り専用コンテキスト）を生成する
 */
function createPluginConfigContext(config: ResolvedConfig): PluginConfigContext
{
  return Object.freeze({
    siteTitle: config.site.title,
    siteDescription: config.site.description,
    docsDir: config.docsDirAbs,
    outputDir: config.outputDirAbs,
    baseUrl: config.site.base_url,
    copyright: config.site.copyright
  });
}

/**
 * PageMetaからPluginMarkdownContext（公開読み取り専用コンテキスト）を生成する
 */
function createPluginMarkdownContext(page: PageMeta): PluginMarkdownContext
{
  return Object.freeze({
    sourcePath: page.sourcePath,
    outputPath: page.outputPath,
    url: page.url,
    title: page.title,
    description: page.description,
    frontmatter: Object.freeze({ ...page.frontmatter })
  });
}

/**
 * PageからPluginHtmlContext（公開読み取り専用コンテキスト）を生成する
 */
function createPluginHtmlContext(page: Page): PluginHtmlContext
{
  return Object.freeze({
    sourcePath: page.sourcePath,
    outputPath: page.outputPath,
    url: page.url,
    title: page.title,
    description: page.description,
    frontmatter: Object.freeze({ ...page.frontmatter }),
    headings: Object.freeze(page.headings.map((h) => Object.freeze({
      level: h.level,
      text: h.text,
      anchorId: h.anchorId
    })))
  });
}

/**
 * 内部NavNodeツリーから公開PluginNavNode（イミュータブル）を生成する
 */
function convertNavNode(node: NavNode): PluginNavNode
{
  return Object.freeze({
    title: node.title,
    url: node.url,
    children: Object.freeze(node.children.map(convertNavNode))
  });
}

/**
 * BuildContextからPluginBuildContext（公開読み取り専用コンテキスト）を生成する
 */
function createPluginBuildContext(context: BuildContext): PluginBuildContext
{
  return Object.freeze({
    docsDir: context.config.docsDirAbs,
    outputDir: context.config.outputDirAbs,
    pages: Object.freeze(context.pages.map((p) => Object.freeze({
      sourcePath: p.sourcePath,
      outputPath: p.outputPath,
      url: p.url,
      title: p.title,
      description: p.description,
      frontmatter: Object.freeze({ ...p.frontmatter }),
      headings: Object.freeze(p.headings.map((h) => Object.freeze({
        level: h.level,
        text: h.text,
        anchorId: h.anchorId
      }))),
      contentHtml: p.contentHtml
    }))),
    nav: Object.freeze(context.nav.map(convertNavNode)),
    enabledPlugins: Object.freeze([...(context.enabledPlugins ?? [])])
  });
}

/**
 * configResolvedフックを列挙順に直列実行する
 */
export async function runConfigResolved(
  plugins: AnyPlugin[],
  config: ResolvedConfig
): Promise<void>
{
  // 公開コンテキストは必要な場合に1度だけ生成してキャッシュする
  let modernContext: PluginConfigContext | undefined;

  for (const plugin of plugins) {
    if (!plugin.configResolved) {
      continue;
    }
    try {
      if (plugin.apiVersion === 1) {
        if (!modernContext) {
          modernContext = createPluginConfigContext(config);
        }
        await (plugin as MkDocsGenPlugin).configResolved?.(modernContext);
      } else {
        await (plugin as Plugin).configResolved?.(config);
      }
    } catch (error) {
      throw wrapHookError(plugin.name, "configResolved", error);
    }
  }
}

/**
 * transformMarkdownフックを列挙順にパイプし、最終文字列を返す
 */
export async function runTransformMarkdown(
  plugins: AnyPlugin[],
  source: string,
  page: PageMeta
): Promise<string>
{
  let current = source;
  let modernContext: PluginMarkdownContext | undefined;

  for (const plugin of plugins) {
    if (!plugin.transformMarkdown) {
      continue;
    }
    try {
      let next: unknown;
      if (plugin.apiVersion === 1) {
        if (!modernContext) {
          modernContext = createPluginMarkdownContext(page);
        }
        next = await (plugin as MkDocsGenPlugin).transformMarkdown?.(current, modernContext);
      } else {
        next = await (plugin as Plugin).transformMarkdown?.(current, page);
      }

      // return忘れ等でundefinedになると後段変換が壊れるため型を検証する
      if (typeof next !== "string") {
        throw new Error(`transformMarkdownはstringを返す必要があります（実際: ${typeof next}）`);
      }
      current = next;
    } catch (error) {
      throw wrapHookError(plugin.name, "transformMarkdown", error);
    }
  }
  return current;
}

/**
 * transformHtmlフックを列挙順にパイプし、最終HTMLを返す
 */
export async function runTransformHtml(
  plugins: AnyPlugin[],
  html: string,
  page: Page
): Promise<string>
{
  let current = html;
  let modernContext: PluginHtmlContext | undefined;

  for (const plugin of plugins) {
    if (!plugin.transformHtml) {
      continue;
    }
    try {
      let next: unknown;
      if (plugin.apiVersion === 1) {
        if (!modernContext) {
          modernContext = createPluginHtmlContext(page);
        }
        next = await (plugin as MkDocsGenPlugin).transformHtml?.(current, modernContext);
      } else {
        next = await (plugin as Plugin).transformHtml?.(current, page);
      }

      // return忘れ等でundefinedになると最終HTMLが壊れるため型を検証する
      if (typeof next !== "string") {
        throw new Error(`transformHtmlはstringを返す必要があります（実際: ${typeof next}）`);
      }
      current = next;
    } catch (error) {
      throw wrapHookError(plugin.name, "transformHtml", error);
    }
  }
  return current;
}

/**
 * buildEndフックを列挙順に直列実行する
 */
export async function runBuildEnd(
  plugins: AnyPlugin[],
  context: BuildContext
): Promise<void>
{
  let modernContext: PluginBuildContext | undefined;

  for (const plugin of plugins) {
    if (!plugin.buildEnd) {
      continue;
    }
    try {
      if (plugin.apiVersion === 1) {
        if (!modernContext) {
          modernContext = createPluginBuildContext(context);
        }
        await (plugin as MkDocsGenPlugin).buildEnd?.(modernContext);
      } else {
        await (plugin as Plugin).buildEnd?.(context);
      }
    } catch (error) {
      throw wrapHookError(plugin.name, "buildEnd", error);
    }
  }
}
