import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectEnv, parseEnvFile } from "../../src/config/env.js";

/** テストで process.env に足したキーを確実に消すための掃除用 */
const envCleanups: Array<() => void> = [];
/** テストで作った一時ディレクトリの掃除用 */
const dirCleanups: Array<() => void> = [];

afterEach(() => {
  while (envCleanups.length > 0) {
    envCleanups.pop()?.();
  }
  while (dirCleanups.length > 0) {
    dirCleanups.pop()?.();
  }
});

/**
 * 一時ディレクトリに .env を書き出し、そのディレクトリの絶対パスを返す
 */
function createDirWithEnv(content: string): string
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-env-"));
  dirCleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, ".env"), content, "utf-8");
  return dir;
}

describe("parseEnvFile", () => {
  it("KEY=VALUE形式を解析する", () => {
    const result = parseEnvFile("FOO=bar\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("空行とコメント行を無視する", () => {
    const result = parseEnvFile("\n# comment\nFOO=bar\n  \n# another\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("前後のクォートを取り除く", () => {
    const result = parseEnvFile('FOO="bar baz"\nQUX=\'quux\'\n');
    expect(result).toEqual({ FOO: "bar baz", QUX: "quux" });
  });

  it("=を含まない行は無視する", () => {
    const result = parseEnvFile("FOO=bar\nnotanassignment\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("値の前後の空白を取り除く", () => {
    const result = parseEnvFile("FOO =  bar  \n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("shellスクリプトからコピーした export 付きの行も認識する", () => {
    // READMEのシェル手順（export KEY=value）をそのまま.envに貼り付けても動くようにする
    const result = parseEnvFile('export FOO=bar\nexport BAZ="qux quux"\n');
    expect(result).toEqual({ FOO: "bar", BAZ: "qux quux" });
  });

  it("ファイル先頭のBOMを無視する", () => {
    // Windowsのエディタ等でUTF-8 BOM付き保存された.envでも1行目のキーが壊れないようにする
    const result = parseEnvFile("﻿FOO=bar\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});

describe("loadProjectEnv", () => {
  it(".envが存在しなければ何もせず空配列を返す", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-env-none-"));
    dirCleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));

    expect(() => loadProjectEnv(dir)).not.toThrow();
    expect(loadProjectEnv(dir)).toEqual([]);
  });

  it(".envの値をprocess.envへ反映する", () => {
    const dir = createDirWithEnv("MKDOCSGEN_TEST_FOO=hello\n");
    envCleanups.push(() => { delete process.env.MKDOCSGEN_TEST_FOO; });

    const applied = loadProjectEnv(dir);

    expect(applied).toEqual(["MKDOCSGEN_TEST_FOO"]);
    expect(process.env.MKDOCSGEN_TEST_FOO).toBe("hello");
  });

  it("既にprocess.envに設定済みのキーは上書きしない", () => {
    process.env.MKDOCSGEN_TEST_BAR = "from-shell";
    envCleanups.push(() => { delete process.env.MKDOCSGEN_TEST_BAR; });
    const dir = createDirWithEnv("MKDOCSGEN_TEST_BAR=from-dotenv\n");

    const applied = loadProjectEnv(dir);

    expect(applied).toEqual([]);
    expect(process.env.MKDOCSGEN_TEST_BAR).toBe("from-shell");
  });
});
