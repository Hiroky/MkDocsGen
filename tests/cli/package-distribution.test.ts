import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  /**
   * npm packのdry-runで含まれるファイル一覧を検証する
   */
  it("npm pack配布物に必須ファイルが含まれ、不要なソースやテストが含まれない", () =>
  {
    // プロジェクトルートパスを取得
    const rootDir = path.resolve(__dirname, "../..");

    // 事前にビルドが完了していることを確認（prepack相当）
    const buildResult = execSync("npm run build", {
      cwd: rootDir,
      encoding: "utf-8"
    });
    expect(buildResult).toBeDefined();

    // npm pack --dry-run --json を実行
    const packOutput = execSync("npm pack --dry-run --json", {
      cwd: rootDir,
      encoding: "utf-8"
    });

    const parsedResults: PackResult[] = JSON.parse(packOutput);
    expect(parsedResults.length).toBeGreaterThan(0);

    const packResult = parsedResults[0];
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
  });

  /**
   * package.jsonのbinファイルが存在し、実行可能であることを検証する
   */
  it("package.jsonのbinファイルが存在し、先頭にシバンを持つ", () =>
  {
    const rootDir = path.resolve(__dirname, "../..");
    const packageJsonPath = path.join(rootDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.mkdocsgen).toBeDefined();

    const binFilePath = path.join(rootDir, pkg.bin.mkdocsgen);
    expect(fs.existsSync(binFilePath)).toBe(true);

    // 先頭行がシバンであることを確認
    const content = fs.readFileSync(binFilePath, "utf-8");
    const firstLine = content.split(/\r?\n/)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });
});
