/**
 * 100ページ規模のクリーンビルド／増分ビルド所要時間を計測して表示する
 */
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../src/build/pipeline.js";
import { loadConfig } from "../src/config/load.js";
import { Logger } from "../src/logger.js";
import { fullBuild, rebuildDocs } from "../src/server/rebuild.js";
import { createLargeProject } from "../tests/perf/helpers.js";

/**
 * ベンチ本体を実行する
 */
async function main(): Promise<void>
{
  const pageCount = 100;
  const root = createLargeProject({ pageCount, title: "Perf Bench" });
  const logger = new Logger(false);
  const configPath = path.join(root, "mkdocsgen.yml");

  try {
    console.log(`ベンチ用プロジェクト: ${root} (${pageCount} pages)`);

    // クリーンビルドを計測する
    const cleanStarted = performance.now();
    const cleanResult = await runBuild({
      configPath,
      strict: false,
      clean: true,
      verbose: false
    }, logger);
    const cleanMs = performance.now() - cleanStarted;
    console.log(`クリーンビルド: ${cleanMs.toFixed(0)} ms (pages=${cleanResult.pageCount}, warns=${cleanResult.warnCount})`);
    console.log(cleanMs <= 10_000 ? "  OK (<= 10000 ms)" : "  NG (> 10000 ms)");

    // 増分ビルドを計測する（フルビルドで状態を温めてから1ページだけ更新）
    const config = loadConfig(configPath);
    const state = await fullBuild(config, logger);
    fs.writeFileSync(
      path.join(root, "docs/page-001.md"),
      [
        "---",
        "title: Page 1",
        "---",
        "",
        "# Page 1",
        "",
        "Bench incremental body.",
        "",
        "```typescript",
        "export const bench = true;",
        "```",
        ""
      ].join("\n"),
      "utf-8"
    );

    const incrStarted = performance.now();
    const incrResult = await rebuildDocs(state, ["page-001.md"], logger);
    const incrMs = performance.now() - incrStarted;
    console.log(`増分ビルド (${incrResult.mode}): ${incrMs.toFixed(0)} ms (paths=${incrResult.rebuiltPaths.join(",")})`);
    console.log(incrMs <= 1_000 ? "  OK (<= 1000 ms)" : "  NG (> 1000 ms)");

    // しきい値超過なら終了コード1にする
    if (cleanMs > 10_000 || incrMs > 1_000) {
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
