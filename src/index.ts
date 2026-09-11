/**
 * MkDocsGen 公開APIエントリポイント
 *
 * 外部ツールやプラグイン開発者が参照できる公開型およびAPIを提供します。
 */

export * from "./plugin/api.js";
export { runBuild, type BuildOptions, type BuildResult } from "./build/pipeline.js";
export { loadConfig } from "./config/load.js";
export type { ResolvedConfig } from "./config/schema.js";
export { Logger, type BuildLogger, type LoggerWriters, type LogLevel } from "./logger.js";

