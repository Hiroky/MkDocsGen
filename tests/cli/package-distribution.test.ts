import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * npm pack の出力ファイルエントリー構造
 */
interface PackTarballFile {
  path: string;
  size: number;
  mode?: number;
}

/**
 * npm pack --dry-run --json の結果オブジェクト
 */
interface PackResult {
  name: string;
  version: string;
  filename: string;
  files: PackTarballFile[];
}

describe("npmパッケージ配布物検証", () =>
{
  const rootDir = path.resolve(__dirname, "../..");

  beforeAll(() =>
  {
    // 古い成果物による偽陽性を防ぐため、配布物検証の前に必ず最新のコードでビルドを実行する
    execSync("npm run build", { cwd: rootDir, encoding: "utf-8" });
  }, 30000);

  /**
   * npm packのdry-runで含まれるファイル一覧を検証する
   */
  it("npm pack配布物に必須ファイルが含まれ、不要なソースやテストが含まれない", () =>
  {
    // 他テストとの並列実行時の競合・多重ビルドを防ぐため --ignore-scripts を付与
    const packOutput = execSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: rootDir,
      encoding: "utf-8"
    });

    // Windows等でstdoutにnpmライフサイクル等のログが混入しても安全にパースできるようJSON配列部分を抽出
    const jsonStart = packOutput.indexOf("[");
    const jsonEnd = packOutput.lastIndexOf("]");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    expect(jsonEnd).toBeGreaterThan(jsonStart);

    const jsonStr = packOutput.slice(jsonStart, jsonEnd + 1);
    const parsedResults: PackResult[] = JSON.parse(jsonStr);
    expect(parsedResults.length).toBeGreaterThan(0);

    const packResult = parsedResults[0]!;
    expect(packResult.name).toBe("mkdocsgen");

    // 含まれるファイルパスの一覧（スラッシュ正規化）
    const packedPaths = packResult.files.map((file) => file.path.replace(/\\/g, "/"));

    // 1. 必須ファイルの存在確認
    expect(packedPaths).toContain("package.json");
    expect(packedPaths).toContain("README.md");
    expect(packedPaths).toContain("LICENSE");
    expect(packedPaths).toContain("dist/cli/index.js");
    expect(packedPaths).toContain("build-theme/main.js");
    expect(packedPaths).toContain("build-theme/main.css");
    expect(packedPaths).toContain("vendor/tree-sitter-python.wasm");
    expect(packedPaths).toContain("templates/base.njk");

    // 2. 不要な開発ファイルが除外されていることの確認
    const hasSrc = packedPaths.some((p) => p.startsWith("src/"));
    const hasTests = packedPaths.some((p) => p.startsWith("tests/"));
    const hasGithub = packedPaths.some((p) => p.startsWith(".github/"));
    const hasTsConfig = packedPaths.includes("tsconfig.json");

    expect(hasSrc).toBe(false);
    expect(hasTests).toBe(false);
    expect(hasGithub).toBe(false);
    expect(hasTsConfig).toBe(false);

    // 3. package.json exports で指定されたファイルが全て配布物に含まれていること
    expect(packedPaths).toContain("dist/index.js");
    expect(packedPaths).toContain("dist/index.d.ts");
    expect(packedPaths).toContain("dist/plugin/api.js");
    expect(packedPaths).toContain("dist/plugin/api.d.ts");
    expect(packedPaths).toContain("dist/logger.js");
    expect(packedPaths).toContain("dist/logger.d.ts");
  }, 20000);

  /**
   * package.jsonのbinファイルが存在し、実行可能であることを検証する
   */
  it("package.jsonのbinファイルが存在し、先頭にシバンを持つ", () =>
  {
    const packageJsonPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.mkdocsgen).toBeDefined();

    const binFilePath = path.join(rootDir, pkg.bin.mkdocsgen);
    expect(fs.existsSync(binFilePath)).toBe(true);

    // 先頭行がシバンであることを確認（LF改行で終わること）
    const content = fs.readFileSync(binFilePath, "utf-8");
    const firstLine = content.split(/\r?\n/)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
    // Windowsビルドでもシバン行末に\rが混入しないこと
    expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
