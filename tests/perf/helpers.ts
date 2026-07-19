import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "../../src/logger.js";

/** リポジトリ直下のtmp/（gitignore済み） */
const REPO_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tmp");

/**
 * ベンチ用の大規模プロジェクト（既定100ページ、コードフェンス付き）を作成する
 */
export function createLargeProject(options: {
  pageCount?: number;
  title?: string;
} = {}): string
{
  const pageCount = options.pageCount ?? 100;
  const title = options.title ?? "Perf Bench";

  fs.mkdirSync(REPO_TMP, { recursive: true });
  const root = fs.mkdtempSync(path.join(REPO_TMP, "mkdocsgen-perf-"));

  // 最小設定を書き出す（Shikiが走るよう通常どおり変換する）
  fs.writeFileSync(path.join(root, "mkdocsgen.yml"), [
    "site:",
    `  title: ${title}`,
    "docs_dir: docs",
    "output_dir: site"
  ].join("\n") + "\n", "utf-8");

  // indexを1ページ目として作り、残りは page-NNN.md にする
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });

  for (let i = 0; i < pageCount; i++) {
    const rel = i === 0 ? "index.md" : `page-${String(i).padStart(3, "0")}.md`;
    const pageTitle = i === 0 ? "Home" : `Page ${i}`;
    // 各ページに複数言語のコードフェンスを入れ、Shikiコストを現実的にする
    const body = [
      "---",
      `title: ${pageTitle}`,
      "---",
      "",
      `# ${pageTitle}`,
      "",
      `これはベンチ用ページ ${i + 1}/${pageCount} です。`,
      "",
      "```typescript",
      `export function page${i}(x: number): number {`,
      "  return x * 2;",
      "}",
      "```",
      "",
      "```python",
      `def page_${i}(value: int) -> int:`,
      "    return value + 1",
      "```",
      "",
      "```js",
      `const n${i} = ${i};`,
      `console.log(n${i});`,
      "```",
      ""
    ].join("\n");
    fs.writeFileSync(path.join(docsDir, rel), body, "utf-8");
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
