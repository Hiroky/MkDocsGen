import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../../src/build/pipeline.js";
import { createLargeProject, silentLogger } from "./helpers.js";

/** TEST_PERF=1 のときだけ厳密な時間アサーションを行う（CIフレーク回避） */
const runPerf = process.env.TEST_PERF === "1";

describe.runIf(runPerf)("build performance", () => {
  it("100ページのクリーンビルドが10秒以内に完了する", async () => {
    // 仕様5.1: 100ページ・Shiki込み・クリーンビルド10秒以内
    const root = createLargeProject({ pageCount: 100 });
    const logger = silentLogger();

    try {
      const started = performance.now();
      const result = await runBuild({
        configPath: path.join(root, "mkdocsgen.yml"),
        strict: false,
        clean: true,
        verbose: false
      }, logger);
      const elapsed = performance.now() - started;

      expect(result.pageCount).toBe(100);
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("1ページ変更の増分ビルドが1秒以内に完了する", async () => {
    // 仕様5.1: serve時の増分は変更ページのみ再変換し1秒以内
    const { fullBuild, rebuildDocs } = await import("../../src/server/rebuild.js");
    const { loadConfig } = await import("../../src/config/load.js");
    const root = createLargeProject({ pageCount: 100 });
    const logger = silentLogger();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      // 初回フルビルドで変換器・状態を温める（計測対象外）
      const state = await fullBuild(config, logger);

      // タイトルは変えず本文だけ更新し、partial経路にする
      fs.writeFileSync(
        path.join(root, "docs/page-001.md"),
        [
          "---",
          "title: Page 1",
          "---",
          "",
          "# Page 1",
          "",
          "Incremental update body.",
          "",
          "```typescript",
          "export const updated = 1;",
          "```",
          ""
        ].join("\n"),
        "utf-8"
      );

      const started = performance.now();
      const result = await rebuildDocs(state, ["page-001.md"], logger);
      const elapsed = performance.now() - started;

      expect(result.mode).toBe("partial");
      expect(result.rebuiltPaths).toEqual(["page-001.md"]);
      expect(elapsed).toBeLessThan(1_000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(runPerf)("build performance (skipped without TEST_PERF=1)", () => {
  it("プレースホルダ（通常のnpm testではスキップされる）", () => {
    expect(true).toBe(true);
  });
});
