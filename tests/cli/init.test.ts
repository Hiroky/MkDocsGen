import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInit } from "../../src/cli/init.js";
import { Logger } from "../../src/logger.js";

/**
 * 警告・infoを収集するロガーを作る
 */
function capturingLogger(): { logger: Logger; infos: string[]; warnings: string[] }
{
  const infos: string[] = [];
  const warnings: string[] = [];
  const logger = new Logger(false, {
    stdout: (line) => infos.push(line),
    stderr: (line) => warnings.push(line.replace(/^.*?warn:\s*/, ""))
  });
  return { logger, infos, warnings };
}

describe("runInit", () => {
  it("雛形3ファイルを生成する", () => {
    // 仕様書2.2.1の3ファイルが揃うこと
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-init-"));
    const { logger, infos, warnings } = capturingLogger();

    try {
      const result = runInit(root, logger);

      expect(result.created).toEqual([
        "mkdocsgen.yml",
        "docs/index.md",
        "docs/guide/getting-started.md"
      ]);
      expect(result.skipped).toEqual([]);
      expect(warnings).toEqual([]);
      expect(infos.length).toBe(3);

      expect(fs.existsSync(path.join(root, "mkdocsgen.yml"))).toBe(true);
      expect(fs.existsSync(path.join(root, "docs/index.md"))).toBe(true);
      expect(fs.existsSync(path.join(root, "docs/guide/getting-started.md"))).toBe(true);

      // コメント付きサンプル設定になっていること
      const yml = fs.readFileSync(path.join(root, "mkdocsgen.yml"), "utf-8");
      expect(yml).toContain("site:");
      expect(yml).toContain("title:");
      expect(yml).toContain("#");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("既存ファイルは上書きせず警告してスキップする", () => {
    // 再実行でユーザー編集を壊さない
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-init-"));
    const { logger, warnings } = capturingLogger();

    try {
      fs.writeFileSync(path.join(root, "mkdocsgen.yml"), "site:\n  title: Existing\n", "utf-8");
      fs.mkdirSync(path.join(root, "docs"), { recursive: true });
      fs.writeFileSync(path.join(root, "docs/index.md"), "# Existing\n", "utf-8");

      const result = runInit(root, logger);

      expect(result.created).toEqual(["docs/guide/getting-started.md"]);
      expect(result.skipped).toEqual(["mkdocsgen.yml", "docs/index.md"]);
      expect(warnings).toHaveLength(2);
      expect(warnings.every((w) => w.includes("スキップ"))).toBe(true);

      // 既存内容が保持される
      expect(fs.readFileSync(path.join(root, "mkdocsgen.yml"), "utf-8")).toContain("Existing");
      expect(fs.readFileSync(path.join(root, "docs/index.md"), "utf-8")).toContain("Existing");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("init後のプロジェクトをbuildできる", async () => {
    // 完了条件: init → build の一連の流れ
    const { runBuild } = await import("../../src/build/pipeline.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-init-build-"));
    const silent = new Logger(false, { stdout: () => {}, stderr: () => {} });

    try {
      runInit(root, silent);
      const result = await runBuild({
        configPath: path.join(root, "mkdocsgen.yml"),
        strict: true,
        clean: false,
        verbose: false
      }, silent);

      expect(result.pageCount).toBeGreaterThanOrEqual(2);
      expect(result.warnCount).toBe(0);
      expect(fs.existsSync(path.join(root, "site/index.html"))).toBe(true);
      expect(fs.existsSync(path.join(root, "site/guide/getting-started.html"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
