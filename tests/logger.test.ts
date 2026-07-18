import { describe, expect, it } from "vitest";
import { Logger } from "../src/logger.js";

describe("Logger", () => {
  it("infoは標準出力相当のライターへメッセージを書き出す", () => {
    // テスト用に出力先を差し替え、実際のconsoleを汚さない
    const stdout: string[] = [];
    const stderr: string[] = [];
    const logger = new Logger(false, {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line)
    });

    logger.info("ビルド開始");

    expect(stdout).toEqual(["ビルド開始"]);
    expect(stderr).toEqual([]);
  });

  it("debugはverbose時のみ出力する", () => {
    // verbose=falseではdebugを捨て、trueではstdoutへ出す
    const quietOut: string[] = [];
    const quiet = new Logger(false, { stdout: (line) => quietOut.push(line) });
    quiet.debug("詳細ログ");
    expect(quietOut).toEqual([]);

    const verboseOut: string[] = [];
    const verbose = new Logger(true, { stdout: (line) => verboseOut.push(line) });
    verbose.debug("詳細ログ");
    expect(verboseOut).toEqual(["詳細ログ"]);
  });

  it("warnはstderrへwarn:プレフィックス付きで書き、警告数を加算する", () => {
    // strict判定とサマリ表示のために警告数を正確に数える必要がある
    const stderr: string[] = [];
    const logger = new Logger(false, { stderr: (line) => stderr.push(line) });

    logger.warn("リンク切れ");
    logger.warn("別の警告");

    expect(stderr).toHaveLength(2);
    expect(stderr[0]).toContain("warn:");
    expect(stderr[0]).toContain("リンク切れ");
    expect(logger.getWarnCount()).toBe(2);
  });

  it("errorはstderrへerror:プレフィックス付きで書くが警告数は増やさない", () => {
    // errorは致命的失敗用なのでwarnCountとは独立させる
    const stderr: string[] = [];
    const logger = new Logger(false, { stderr: (line) => stderr.push(line) });

    logger.error("致命的エラー");

    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("error:");
    expect(stderr[0]).toContain("致命的エラー");
    expect(logger.getWarnCount()).toBe(0);
  });
});
