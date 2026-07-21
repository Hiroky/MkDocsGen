import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedConfig } from "../../src/config/schema.js";
import { Logger } from "../../src/logger.js";

/**
 * 一時ディレクトリにdocs一式を作り、ResolvedConfigを返す
 */
export function createDocsFixture(
  files: Record<string, string>,
  options: {
    exclude?: string[];
    nav?: Array<{ title?: string; path: string }>;
    baseUrl?: string;
  } = {}
): { docsDir: string; config: ResolvedConfig; cleanup: () => void }
{
  // OSの一時領域にユニークな作業ディレクトリを作る
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-scan-"));
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });

  // 相対パスをキーにしたMarkdownファイルを書き出す
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(docsDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
  }

  // テスト用の最小ResolvedConfigを組み立てる（loadConfigを経由しない）
  const config: ResolvedConfig = {
    site: { title: "Test", description: "", base_url: options.baseUrl ?? "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: options.nav ?? [],
    exclude: options.exclude ?? [],
    theme: { overrides_dir: "theme_overrides", default_mode: "auto", custom_css: [] },
    markdown: { allow_html: true, breaks: true },
    pydoc: { source_dirs: [] },
    plugins: [],
    serve: { port: 3000 },
    configPath: path.join(root, "mkdocsgen.yml"),
    configDir: root,
    docsDirAbs: docsDir,
    outputDirAbs: path.join(root, "site"),
    overridesDirAbs: path.join(root, "theme_overrides")
  };

  return {
    docsDir,
    config,
    cleanup: () => {
      // 一時ディレクトリごと削除して後始末する
      fs.rmSync(root, { recursive: true, force: true });
    }
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

/**
 * 警告メッセージを収集するテスト用ロガーを作る
 */
export function createCapturingLogger(): { logger: Logger; warnings: string[] }
{
  const warnings: string[] = [];
  const logger = new Logger(false, {
    stdout: () => {},
    stderr: (line) => {
      // warn: プレフィックス付きの行からメッセージ本体だけ抜き出す
      warnings.push(line.replace(/^.*?warn:\s*/, ""));
    }
  });
  return { logger, warnings };
}
