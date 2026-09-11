import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Logger,
  runBuild,
  type BuildLogger,
  type BuildOptions,
  type BuildResult
} from "../../src/index.js";

describe("公開 runBuild および Logger API", () =>
{
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  /**
   * テスト用の一時プロジェクトを作成するヘルパー
   */
  function createTestProject(): { configPath: string }
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-public-api-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));

    const yml = [
      "site:",
      "  title: Public API Test",
      "docs_dir: docs",
      "output_dir: site"
    ].join("\n") + "\n";

    fs.writeFileSync(path.join(root, "mkdocsgen.yml"), yml, "utf-8");

    const docsDir = path.join(root, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "index.md"), "# Home\n\nPublic API test.\n", "utf-8");

    return { configPath: path.join(root, "mkdocsgen.yml") };
  }

  /**
   * Loggerクラスがインスタンス化でき、LoggerWritersが機能することを検証
   */
  it("公開されたLoggerクラスがインスタンス化でき、各ログレベルで正しく出力される", () =>
  {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const logger = new Logger(true, {
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line)
    });

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    expect(stdoutLines).toContain("debug message");
    expect(stdoutLines).toContain("info message");
    expect(stderrLines.some((l) => l.includes("warn message"))).toBe(true);
    expect(stderrLines.some((l) => l.includes("error message"))).toBe(true);
    expect(logger.getWarnCount()).toBe(1);
  });

  /**
   * runBuildの第2引数を省略した場合でも、デフォルトロガーで正常にビルドできることを検証
   */
  it("logger引数を省略してrunBuildを実行できる", async () =>
  {
    const { configPath } = createTestProject();
    const options: BuildOptions = {
      configPath,
      strict: false,
      clean: false,
      verbose: false
    };

    const result: BuildResult = await runBuild(options);
    expect(result).toBeDefined();
    expect(result.pageCount).toBe(1);
    expect(typeof result.durationMs).toBe("number");
  });

  /**
   * 公開インターフェースBuildLoggerを満たすカスタムオブジェクトを渡してrunBuildを実行できることを検証
   */
  it("カスタムBuildLogger（プレーンオブジェクト）を渡してrunBuildを実行できる", async () =>
  {
    const { configPath } = createTestProject();
    const customLogs: string[] = [];

    const customLogger: BuildLogger = {
      debug: vi.fn((msg: string) => customLogs.push(`DEBUG: ${msg}`)),
      info: vi.fn((msg: string) => customLogs.push(`INFO: ${msg}`)),
      warn: vi.fn((msg: string) => customLogs.push(`WARN: ${msg}`)),
      error: vi.fn((msg: string) => customLogs.push(`ERROR: ${msg}`))
    };

    const options: BuildOptions = {
      configPath,
      strict: false,
      clean: false,
      verbose: true
    };

    const result = await runBuild(options, customLogger);
    expect(result).toBeDefined();
    expect(customLogger.info).toHaveBeenCalled();
    expect(customLogs.length).toBeGreaterThan(0);
  });

  /**
   * new Loggerインスタンスを渡してrunBuildを実行できることを検証
   */
  it("Loggerインスタンスを明示的に渡してrunBuildを実行できる", async () =>
  {
    const { configPath } = createTestProject();
    const stdoutLines: string[] = [];
    const logger = new Logger(false, {
      stdout: (line) => stdoutLines.push(line)
    });

    const options: BuildOptions = {
      configPath,
      strict: false,
      clean: false,
      verbose: false
    };

    const result = await runBuild(options, logger);
    expect(result).toBeDefined();
    expect(stdoutLines.length).toBeGreaterThan(0);
  });
});
