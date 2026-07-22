import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandPydocPackagePages } from "../../src/pydoc/pages.js";
import type { ResolvedConfig } from "../../src/config/schema.js";
import { Logger } from "../../src/logger.js";
import type { PageSource } from "../../src/scanner/scan.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * 出力を捨てるテスト用ロガーを作る
 */
function silentLogger(): Logger
{
  return new Logger(false, { stdout: () => {}, stderr: () => {} });
}

/**
 * pages展開用の最小ResolvedConfigを作る
 */
function createConfig(root: string): ResolvedConfig
{
  return {
    site: { title: "Test", description: "", base_url: "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: [],
    exclude: [],
    theme: { overrides_dir: "theme_overrides", default_mode: "auto", custom_css: [] },
    markdown: { allow_html: true, breaks: true },
    pydoc: { source_dirs: ["./python"] },
    plugins: [],
    serve: { port: 3000 },
    configPath: path.join(root, "mkdocsgen.yml"),
    configDir: root,
    docsDirAbs: path.join(root, "docs"),
    outputDirAbs: path.join(root, "site"),
    overridesDirAbs: path.join(root, "theme_overrides")
  };
}

/**
 * ページ展開処理が受け取る親ページ素材を作る
 */
function createSource(sourcePath: string, markdown: string): PageSource
{
  return {
    sourcePath,
    absPath: path.join("/tmp", sourcePath),
    markdown,
    frontmatter: {},
    title: "API",
    order: null,
    description: "",
    outputPath: sourcePath.replace(/\.md$/u, ".html"),
    url: `/${sourcePath.replace(/\.md$/u, ".html")}`
  };
}

/**
 * パッケージ階層のPythonソースをテスト用一時ディレクトリへ作る
 */
function createPackageSources(root: string): void
{
  const packageRoot = path.join(root, "python", "mypackage");
  fs.mkdirSync(path.join(packageRoot, "nested"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "__init__.py"), '"""Package API."""\n', "utf-8");
  fs.writeFileSync(path.join(packageRoot, "first.py"), '"""First API."""\n', "utf-8");
  fs.writeFileSync(path.join(packageRoot, "nested", "__init__.py"), '"""Nested API."""\n', "utf-8");
  fs.writeFileSync(path.join(packageRoot, "nested", "second.py"), '"""Second API."""\n', "utf-8");
}

describe("expandPydocPackagePages", () => {
  it("パッケージ指定をモジュール別PageSourceとtoctreeへ分解する", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-pages-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    createPackageSources(root);

    const parent = createSource("api.md", "Before\n\n::: pydoc mypackage\n\nAfter\n");
    const result = expandPydocPackagePages([parent], createConfig(root), silentLogger());
    const parentResult = result.sources.find((source) => source.sourcePath === "api.md");
    const generated = result.sources.filter((source) => source.generatedPydoc !== undefined);

    expect(parentResult?.markdown).toContain("::: toctree");
    expect(parentResult?.markdown).toContain("api/mypackage/index.md");
    expect(parentResult?.markdown).not.toContain("::: pydoc mypackage");
    expect(generated.map((source) => source.sourcePath).sort()).toEqual([
      "api/mypackage/first.md",
      "api/mypackage/index.md",
      "api/mypackage/nested/index.md",
      "api/mypackage/nested/second.md"
    ]);
    expect(generated.every((source) => source.generatedPydoc?.generatedFrom === "api.md")).toBe(true);
  });

  it("単一モジュール指定はページ分割せず従来のインライン展開へ残す", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-pages-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const packageRoot = path.join(root, "python", "mypackage");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "__init__.py"), '"""Package API."""\n', "utf-8");
    fs.writeFileSync(path.join(packageRoot, "only.py"), '"""Module API."""\n', "utf-8");

    const parent = createSource("api.md", "::: pydoc mypackage.only\n");
    const result = expandPydocPackagePages([parent], createConfig(root), silentLogger());

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.markdown).toBe(parent.markdown);
    expect(result.sources[0]?.generatedPydoc).toBeUndefined();
  });
});
