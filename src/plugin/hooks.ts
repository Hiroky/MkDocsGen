import type { ResolvedConfig } from "../config/schema.js";
import type { BuildContext, Page } from "../types.js";
import { PluginError } from "./load.js";
import type { PageMeta, Plugin } from "./types.js";

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
 * configResolvedフックを列挙順に直列実行する
 */
export async function runConfigResolved(
  plugins: Plugin[],
  config: ResolvedConfig
): Promise<void>
{
  for (const plugin of plugins) {
    // 未実装フックはスキップする
    if (!plugin.configResolved) {
      continue;
    }
    try {
      // 前のプラグイン完了を待ってから次へ進む（直列）
      await plugin.configResolved(config);
    } catch (error) {
      throw wrapHookError(plugin.name, "configResolved", error);
    }
  }
}

/**
 * transformMarkdownフックを列挙順にパイプし、最終文字列を返す
 */
export async function runTransformMarkdown(
  plugins: Plugin[],
  source: string,
  page: PageMeta
): Promise<string>
{
  let current = source;
  for (const plugin of plugins) {
    if (!plugin.transformMarkdown) {
      continue;
    }
    try {
      // 前段の返り値を次段の入力にする
      current = await plugin.transformMarkdown(current, page);
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
  plugins: Plugin[],
  html: string,
  page: Page
): Promise<string>
{
  let current = html;
  for (const plugin of plugins) {
    if (!plugin.transformHtml) {
      continue;
    }
    try {
      // 前段の返り値を次段の入力にする
      current = await plugin.transformHtml(current, page);
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
  plugins: Plugin[],
  context: BuildContext
): Promise<void>
{
  for (const plugin of plugins) {
    if (!plugin.buildEnd) {
      continue;
    }
    try {
      await plugin.buildEnd(context);
    } catch (error) {
      throw wrapHookError(plugin.name, "buildEnd", error);
    }
  }
}
