import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildError, buildSite, runBuild } from "../../src/build/pipeline.js";
import { Logger } from "../../src/logger.js";

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
 * pydoc付きの一時プロジェクトを作る
 */
function createPydocProject(options: {
  markdown: string;
  pythonFiles?: Record<string, string>;
  sourceDirs?: string[];
}): { root: string; configPath: string }
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-int-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));

  const sourceDirs = options.sourceDirs ?? ["./python"];
  const yml = [
    "site:",
    "  title: PyDoc Integration",
    "docs_dir: docs",
    "output_dir: site",
    "pydoc:",
    "  source_dirs:",
    ...sourceDirs.map((d) => `    - ${d}`)
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(root, "mkdocsgen.yml"), yml, "utf-8");

  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "api.md"), options.markdown, "utf-8");

  // フィクスチャをコピー、またはインラインPythonを書く
  if (options.pythonFiles) {
    for (const [rel, content] of Object.entries(options.pythonFiles)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
    }
  } else {
    const dest = path.join(root, "python", "mypackage");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "tests/fixtures/pydoc/mypackage/mymodule.py"),
      path.join(dest, "mymodule.py")
    );
  }

  return { root, configPath: path.join(root, "mkdocsgen.yml") };
}

describe("pydoc integration", () => {
  it("::: pydoc を含むページでクラス・関数がHTML化される", async () => {
    // 仕様7.3: フィクスチャPythonソースがHTML化される
    const { root, configPath } = createPydocProject({
      markdown: [
        "# API",
        "",
        "::: pydoc mypackage.mymodule",
        "    members: Greeter, greet",
        ""
      ].join("\n")
    });

    const output = await buildSite(
      (await import("../../src/config/load.js")).loadConfig(configPath),
      silentLogger(),
      { strict: false, silentSummary: true }
    );

    const htmlPath = path.join(root, "site", "api.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, "utf-8");
    expect(html).toContain("Greeter");
    expect(html).toContain("greet");
    expect(html).toContain("shout");
    expect(html).toContain(
      'href="#mypackage.mymodule.greet" data-toc-link data-anchor="mypackage.mymodule.greet">greet</a>'
    );
    expect(html).not.toContain(
      'href="#mypackage.mymodule.greet" data-toc-link data-anchor="mypackage.mymodule.greet">greet(name: str)</a>'
    );
    // 仕様アンカーIDがHTMLに載ること
    expect(html).toContain('id="mypackage.mymodule.Greeter"');
    expect(html).toContain('id="mypackage.mymodule.greet"');

    const page = output.pages.find((p) => p.sourcePath === "api.md");
    expect(page?.anchorIds).toContain("mypackage.mymodule.Greeter");
  });

  it("パッケージ指定ではモジュールごとにページを分けて階層化する", async () => {
    const { root, configPath } = createPydocProject({
      markdown: "# API\n\n::: pydoc mypackage\n",
      pythonFiles: {
        "python/mypackage/__init__.py": '"""Package API."""\n',
        "python/mypackage/first.py": '"""First API."""\n\ndef first() -> None:\n    """First function."""\n',
        "python/mypackage/nested/__init__.py": '"""Nested API."""\n',
        "python/mypackage/nested/second.py": '"""Second API."""\n\ndef second() -> None:\n    """Second function."""\n'
      }
    });

    const output = await buildSite(
      (await import("../../src/config/load.js")).loadConfig(configPath),
      silentLogger(),
      { strict: false, silentSummary: true }
    );

    expect(output.pages.map((page) => page.outputPath).sort()).toEqual([
      "api.html",
      "api/mypackage/first.html",
      "api/mypackage/index.html",
      "api/mypackage/nested/index.html",
      "api/mypackage/nested/second.html"
    ]);
    expect(fs.existsSync(path.join(root, "site/api/mypackage/first.html"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "site/api.html"), "utf-8")).toContain(
      "api/mypackage/index.html"
    );
    expect(fs.readFileSync(path.join(root, "site/api/mypackage/first.html"), "utf-8")).toContain(
      "First function."
    );

    // 生成ページは独立したapiセクションではなく、生成元のAPIページ配下へ表示する
    const apiNode = output.nav.find((node) => node.url === "api.html");
    expect(apiNode?.title).toBe("API");
    expect(apiNode?.children.map((node) => node.title)).toEqual(["mypackage"]);
    expect(output.nav.some((node) => node.title === "api")).toBe(false);
  });

  it("モジュール解決失敗はビルドエラーになる", async () => {
    const { configPath } = createPydocProject({
      markdown: "::: pydoc missing.mod\n",
      pythonFiles: {}
    });

    await expect(
      runBuild({ configPath, strict: false, clean: false, verbose: false }, silentLogger())
    ).rejects.toThrow(BuildError);
  });

  it("構文エラーは警告になり、strictで失敗する", async () => {
    const { configPath } = createPydocProject({
      markdown: "::: pydoc broken\n",
      pythonFiles: { "python/broken.py": "def broken(\n" }
    });

    // 通常ビルドは成功し、警告が出る
    const logger = new Logger(false, { stdout: () => {}, stderr: () => {} });
    const result = await runBuild(
      { configPath, strict: false, clean: false, verbose: false },
      logger
    );
    expect(result.warnCount).toBeGreaterThan(0);

    // strict では警告があるため失敗する
    await expect(
      runBuild({ configPath, strict: true, clean: false, verbose: false }, silentLogger())
    ).rejects.toThrow(BuildError);
  });
});
