import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedConfig } from "../config/schema.js";
import { builtinPlugins } from "./builtin/index.js";
import type { Plugin, PluginFactory } from "./types.js";

/**
 * プラグイン読込・実行で発生するエラー。CLIはこのメッセージを表示して終了コード1にする
 */
export class PluginError extends Error
{
  /**
   * PluginErrorを生成する
   */
  constructor(message: string, options?: { cause?: unknown })
  {
    // causeがある場合は元例外のスタックも辿れるようにする
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PluginError";
  }
}

/**
 * 設定のplugins一覧からローカルESMを読み込み、Plugin配列を列挙順で返す
 */
export async function loadPlugins(config: ResolvedConfig): Promise<Plugin[]>
{
  // 未設定なら何もしない（空配列）
  if (config.plugins.length === 0) {
    return [];
  }

  const plugins: Plugin[] = [];
  for (const entry of config.plugins) {
    const { factory, sourceLabel } = typeof entry.builtin === "string"
      ? resolveBuiltinFactory(entry.builtin)
      : await resolvePathFactory(config.configDir, entry.path ?? "");

    // YAMLのoptionsを渡してPluginインスタンスを得る
    let plugin: Plugin;
    try {
      plugin = factory(entry.options ?? {});
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PluginError(
        `プラグインファクトリの実行に失敗しました (${sourceLabel}): ${detail}`,
        { cause: error }
      );
    }

    // 例外メッセージに使うためnameは必須
    if (typeof plugin?.name !== "string" || plugin.name.trim() === "") {
      throw new PluginError(
        `プラグインは非空のnameプロパティを返す必要があります: ${sourceLabel}`
      );
    }

    plugins.push(plugin);
  }

  return plugins;
}

/**
 * 組み込みプラグイン名からPluginFactoryを解決する
 */
function resolveBuiltinFactory(name: string): { factory: PluginFactory; sourceLabel: string }
{
  const factory = builtinPlugins[name];
  if (!factory) {
    const available = Object.keys(builtinPlugins).join(", ");
    throw new PluginError(`未知の組み込みプラグインです: ${name}（利用可能: ${available}）`);
  }
  return { factory, sourceLabel: `builtin:${name}` };
}

/**
 * ローカルファイルパスからPluginFactoryを動的importで解決する
 */
async function resolvePathFactory(
  configDir: string,
  entryPath: string
): Promise<{ factory: PluginFactory; sourceLabel: string }>
{
  // 設定ファイル基準で相対パスを絶対パスへ解決する
  const absPath = path.resolve(configDir, entryPath);

  // ファイルが無い場合はimport前に分かりやすいエラーにする
  if (!fs.existsSync(absPath)) {
    throw new PluginError(`プラグインファイルが見つかりません: ${absPath}`);
  }

  // ESMとして動的importする（file:// URLが必要）
  // Nodeのモジュールキャッシュ回避のため、mtimeをクエリに付けて同一serve内の書き換えに追従する
  let mod: { default?: unknown };
  try {
    const mtimeMs = fs.statSync(absPath).mtimeMs;
    const importUrl = `${pathToFileURL(absPath).href}?t=${mtimeMs}`;
    mod = await import(importUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PluginError(
      `プラグインの読み込みに失敗しました (${entryPath}): ${detail}`,
      { cause: error }
    );
  }

  // default exportはPluginFactory（関数）である必要がある
  if (typeof mod.default !== "function") {
    throw new PluginError(
      `プラグインのdefault exportはPluginFactory（関数）である必要があります: ${entryPath}`
    );
  }

  return { factory: mod.default as PluginFactory, sourceLabel: entryPath };
}
