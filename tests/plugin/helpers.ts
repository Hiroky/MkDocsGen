import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedConfig } from "../../src/config/schema.js";

/**
 * プラグイン用の一時ディレクトリと最小ResolvedConfigを作る
 */
export function createPluginFixture(options: {
  plugins?: Array<{ path: string; options?: Record<string, unknown> }>;
  pluginFiles?: Record<string, string>;
} = {}): { root: string; config: ResolvedConfig; cleanup: () => void }
{
  // OS一時領域にユニークな作業ディレクトリを作る
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-plugin-"));

  // プラグインファイルを書き出す（pathはconfigDir相対）
  for (const [relPath, content] of Object.entries(options.pluginFiles ?? {})) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
  }

  // テスト用の最小ResolvedConfigを組み立てる
  const config: ResolvedConfig = {
    site: { title: "Plugin Test", description: "", base_url: "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: [],
    exclude: [],
    theme: { overrides_dir: "theme_overrides", default_mode: "auto", custom_css: [] },
    markdown: { allow_html: true, breaks: true },
    pydoc: { source_dirs: [] },
    plugins: (options.plugins ?? []).map((entry) => ({
      path: entry.path,
      options: entry.options ?? {}
    })),
    serve: { port: 3000 },
    configPath: path.join(root, "mkdocsgen.yml"),
    configDir: root,
    docsDirAbs: path.join(root, "docs"),
    outputDirAbs: path.join(root, "site"),
    overridesDirAbs: path.join(root, "theme_overrides")
  };

  return {
    root,
    config,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}
