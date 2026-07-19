import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "../../src/logger.js";

/** リポジトリ直下のtmp/（gitignore済み）。サンドボックスでもFS監視が届くようにos.tmpdirを避ける */
const REPO_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tmp");

/**
 * 一時プロジェクトディレクトリと最小のmkdocsgen構成を作る
 */
export function createTempProject(options: {
  title?: string;
  pages?: Record<string, string>;
  port?: number;
} = {}): string
{
  fs.mkdirSync(REPO_TMP, { recursive: true });
  const root = fs.mkdtempSync(path.join(REPO_TMP, "mkdocsgen-serve-"));
  const title = options.title ?? "Serve Demo";
  const port = options.port ?? 0;
  const pages = options.pages ?? {
    "index.md": "---\ntitle: Home\n---\n\n# Home\n\nHello serve.\n",
    "guide/a.md": "---\ntitle: Page A\n---\n\n# Page A\n\nContent A.\n"
  };

  // 設定ファイルを書き出す（port:0はテストでエフェメラルポートを使うため）
  fs.writeFileSync(path.join(root, "mkdocsgen.yml"), [
    "site:",
    `  title: ${title}`,
    "docs_dir: docs",
    "output_dir: site",
    "serve:",
    `  port: ${port === 0 ? 3000 : port}`
  ].join("\n") + "\n", "utf-8");

  // 指定されたMarkdownページをdocs配下へ作成する
  for (const [rel, body] of Object.entries(pages)) {
    const abs = path.join(root, "docs", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf-8");
  }

  return root;
}

/**
 * 出力を握りつぶすロガーを作る
 */
export function silentLogger(verbose = false): Logger
{
  return new Logger(verbose, { stdout: () => {}, stderr: () => {} });
}

/**
 * 指定msだけ待つ
 */
export function sleep(ms: number): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, ms));
}
