import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedConfig } from "../config/schema.js";
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
    // 設定ファイル基準で相対パスを絶対パスへ解決する
    const absPath = path.resolve(config.configDir, entry.path);

    // ファイルが無い場合はimport前に分かりやすいエラーにする
    if (!fs.existsSync(absPath)) {
      throw new PluginError(`プラグインファイルが見つかりません: ${absPath}`);
    }

    // ESMとして動的importする（file:// URLが必要）
    let mod: { default?: unknown };
    try {
      mod = await import(pathToFileURL(absPath).href);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PluginError(
        `プラグインの読み込みに失敗しました (${entry.path}): ${detail}`,
        { cause: error }
      );
    }

    // default exportはPluginFactory（関数）である必要がある
    if (typeof mod.default !== "function") {
      throw new PluginError(
        `プラグインのdefault exportはPluginFactory（関数）である必要があります: ${entry.path}`
      );
    }

    // YAMLのoptionsを渡してPluginインスタンスを得る
    const factory = mod.default as PluginFactory;
    let plugin: Plugin;
    try {
      plugin = factory(entry.options ?? {});
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PluginError(
        `プラグインファクトリの実行に失敗しました (${entry.path}): ${detail}`,
        { cause: error }
      );
    }

    // 例外メッセージに使うためnameは必須
    if (typeof plugin?.name !== "string" || plugin.name.trim() === "") {
      throw new PluginError(
        `プラグインは非空のnameプロパティを返す必要があります: ${entry.path}`
      );
    }

    plugins.push(plugin);
  }

  return plugins;
}
