import { createConfluenceExportPlugin } from "./confluence-export.js";
import type { PluginFactory } from "../types.js";

/**
 * 組み込みプラグインのレジストリ。mkdocsgen.ymlの plugins[].builtin で名前指定して使う
 */
export const builtinPlugins: Record<string, PluginFactory> = {
  "confluence-export": createConfluenceExportPlugin
};
