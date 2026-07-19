import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/logger.js";
import { expandPydocDirectives, mergePydocHeadings } from "../../src/pydoc/expand.js";
import { ModuleResolveError } from "../../src/pydoc/resolve.js";
import { createPythonParser } from "../../src/pydoc/tree-sitter.js";
import type { ResolvedConfig } from "../../src/config/schema.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * 出力を捨てるロガーを作る
 */
function silentLogger(): Logger
{
  return new Logger(false, { stdout: () => {}, stderr: () => {} });
}

/**
 * expand 用の最小 ResolvedConfig を作る
 */
function createConfig(root: string, sourceDirs: string[]): ResolvedConfig
{
  return {
    site: { title: "T", description: "", base_url: "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: [],
    exclude: [],
    theme: { overrides_dir: "theme_overrides", default_mode: "auto", custom_css: [] },
    markdown: { allow_html: true },
    pydoc: { source_dirs: sourceDirs },
    plugins: [],
    serve: { port: 3000 },
    configPath: path.join(root, "mkdocsgen.yml"),
    configDir: root,
    docsDirAbs: path.join(root, "docs"),
    outputDirAbs: path.join(root, "site"),
    overridesDirAbs: path.join(root, "theme_overrides")
  };
}

describe("expandPydocDirectives", () => {
  it("解決できるモジュールをMarkdownへ展開する", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-expand-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const src = path.join(root, "src");
    fs.mkdirSync(path.join(src, "mypackage"), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "tests/fixtures/pydoc/mypackage/mymodule.py"),
      path.join(src, "mypackage", "mymodule.py")
    );

    const parser = await createPythonParser();
    const logger = silentLogger();
    const { markdown, extraHeadings } = expandPydocDirectives(
      "# API\n\n::: pydoc mypackage.mymodule\n    members: Greeter, greet\n",
      createConfig(root, ["./src"]),
      logger,
      parser
    );

    expect(markdown).toContain("### Greeter");
    expect(markdown).toContain("#### greet");
    expect(extraHeadings.some((h) => h.anchorId === "mypackage.mymodule.Greeter")).toBe(true);
  });

  it("モジュール解決失敗時は ModuleResolveError を投げる", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-expand-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    const parser = await createPythonParser();
    expect(() =>
      expandPydocDirectives(
        "::: pydoc missing.mod\n",
        createConfig(root, ["./src"]),
        silentLogger(),
        parser
      )
    ).toThrow(ModuleResolveError);
  });

  it("構文エラー時は警告しページ上にエラーを差し込む", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-expand-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const src = path.join(root, "src");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "broken.py"), "def broken(\n", "utf-8");

    const warnings: string[] = [];
    const logger = new Logger(false, {
      stdout: () => {},
      stderr: (line) => warnings.push(line)
    });
    const parser = await createPythonParser();
    const { markdown } = expandPydocDirectives(
      "::: pydoc broken\n",
      createConfig(root, ["./src"]),
      logger,
      parser
    );

    expect(logger.getWarnCount()).toBe(1);
    expect(warnings.some((w) => w.includes("構文エラー"))).toBe(true);
    expect(markdown).toContain("::: danger");
    expect(markdown).toContain("broken");
  });
});

describe("mergePydocHeadings", () => {
  it("見出しのanchorIdとHTMLのidを仕様IDへ差し替える", () => {
    const html = '<h2 id="greeter">Greeter</h2>\n<h3 id="shout">shout</h3>\n';
    const merged = mergePydocHeadings(
      html,
      [
        { level: 2, text: "Greeter", anchorId: "greeter" },
        { level: 3, text: "shout", anchorId: "shout" }
      ],
      ["greeter", "shout"],
      [
        { level: 2, text: "Greeter", anchorId: "mypackage.mymodule.Greeter" },
        { level: 3, text: "shout", anchorId: "mypackage.mymodule.Greeter.shout" }
      ]
    );

    expect(merged.html).toContain('id="mypackage.mymodule.Greeter"');
    expect(merged.html).toContain('id="mypackage.mymodule.Greeter.shout"');
    expect(merged.headings[0]!.anchorId).toBe("mypackage.mymodule.Greeter");
    expect(merged.anchorIds).toEqual([
      "mypackage.mymodule.Greeter",
      "mypackage.mymodule.Greeter.shout"
    ]);
  });
});
