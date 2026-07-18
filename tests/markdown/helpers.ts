import path from "node:path";
import type { ResolvedConfig } from "../../src/config/schema.js";
import { Logger } from "../../src/logger.js";

/**
 * Markdown変換テスト用の最小ResolvedConfigを組み立てる
 */
export function createMarkdownConfig(options: { allowHtml?: boolean } = {}): ResolvedConfig
{
  // ファイルI/Oは使わないのでパスはダミーでよい
  const root = "/tmp/mkdocsgen-markdown-test";
  return {
    site: { title: "Test", description: "", base_url: "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: [],
    exclude: [],
    theme: { overrides_dir: "theme_overrides", default_mode: "auto", custom_css: [] },
    markdown: { allow_html: options.allowHtml ?? true },
    pydoc: { source_dirs: [] },
    plugins: [],
    serve: { port: 3000 },
    configPath: path.join(root, "mkdocsgen.yml"),
    configDir: root,
    docsDirAbs: path.join(root, "docs"),
    outputDirAbs: path.join(root, "site"),
    overridesDirAbs: path.join(root, "theme_overrides")
  };
}

/**
 * 出力を捨てるテスト用ロガーを作る
 */
export function createSilentLogger(verbose = false): Logger
{
  return new Logger(verbose, {
    stdout: () => {},
    stderr: () => {}
  });
}
