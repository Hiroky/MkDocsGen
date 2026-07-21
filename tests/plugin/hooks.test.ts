import { describe, expect, it, vi } from "vitest";
import {
  runBuildEnd,
  runConfigResolved,
  runTransformHtml,
  runTransformMarkdown
} from "../../src/plugin/hooks.js";
import { PluginError } from "../../src/plugin/load.js";
import type { Plugin } from "../../src/plugin/types.js";
import type { BuildContext, Page } from "../../src/types.js";
import type { ResolvedConfig } from "../../src/config/schema.js";
import type { PageMeta } from "../../src/plugin/types.js";

/**
 * フック検証用の最小ResolvedConfigを作る
 */
function fakeConfig(): ResolvedConfig
{
  return {
    site: { title: "T", description: "", base_url: "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: [],
    exclude: [],
    theme: { overrides_dir: "theme_overrides", default_mode: "auto", custom_css: [] },
    markdown: { allow_html: true, breaks: true },
    pydoc: { source_dirs: [] },
    plugins: [],
    serve: { port: 3000 },
    configPath: "/tmp/mkdocsgen.yml",
    configDir: "/tmp",
    docsDirAbs: "/tmp/docs",
    outputDirAbs: "/tmp/site",
    overridesDirAbs: "/tmp/theme_overrides"
  };
}

/**
 * フック検証用の最小PageMetaを作る
 */
function fakePageMeta(): PageMeta
{
  return {
    sourcePath: "index.md",
    outputPath: "index.html",
    url: "/index.html",
    title: "Home",
    description: "",
    frontmatter: {}
  };
}

/**
 * フック検証用の最小Pageを作る
 */
function fakePage(): Page
{
  return {
    ...fakePageMeta(),
    headings: [],
    anchorIds: [],
    links: [],
    contentHtml: "<p>hi</p>",
    plainText: "hi",
    prev: null,
    next: null,
    breadcrumbs: [],
    toctrees: []
  };
}

describe("plugin hooks", () => {
  it("configResolvedを列挙順に直列実行する", async () => {
    // 前のフック完了後に次が走ることを順序ログで確認する
    const order: string[] = [];
    const plugins: Plugin[] = [
      {
        name: "first",
        configResolved: async () => {
          order.push("first-start");
          await Promise.resolve();
          order.push("first-end");
        }
      },
      {
        name: "second",
        configResolved: () => {
          order.push("second");
        }
      }
    ];

    await runConfigResolved(plugins, fakeConfig());
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("transformMarkdownを列挙順にパイプし、返り値を次へ渡す", async () => {
    // Aの出力がBの入力になる（直列パイプ）
    const plugins: Plugin[] = [
      {
        name: "a",
        transformMarkdown: (source) => `${source}-A`
      },
      {
        name: "b",
        transformMarkdown: async (source) => `${source}-B`
      }
    ];

    const result = await runTransformMarkdown(plugins, "raw", fakePageMeta());
    expect(result).toBe("raw-A-B");
  });

  it("transformHtmlを列挙順にパイプし、返り値を次へ渡す", async () => {
    // HTML加工もMarkdown同様に直列パイプする
    const plugins: Plugin[] = [
      {
        name: "a",
        transformHtml: (html) => html.replace("</body>", "<!--A--></body>")
      },
      {
        name: "b",
        transformHtml: (html) => html.replace("</body>", "<!--B--></body>")
      }
    ];

    const result = await runTransformHtml(plugins, "<html><body></body></html>", fakePage());
    expect(result).toBe("<html><body><!--A--><!--B--></body></html>");
  });

  it("buildEndを列挙順に直列実行する", async () => {
    // 全ページ出力後の後処理も列挙順
    const order: string[] = [];
    const plugins: Plugin[] = [
      { name: "a", buildEnd: () => { order.push("a"); } },
      { name: "b", buildEnd: async () => { order.push("b"); } }
    ];
    const context: BuildContext = {
      config: fakeConfig(),
      pages: [fakePage()],
      nav: []
    };

    await runBuildEnd(plugins, context);
    expect(order).toEqual(["a", "b"]);
  });

  it("未実装フックはスキップする", async () => {
    // 一部フックだけのプラグインでも落ちない
    const plugins: Plugin[] = [{ name: "noop" }];
    await expect(runConfigResolved(plugins, fakeConfig())).resolves.toBeUndefined();
    await expect(runTransformMarkdown(plugins, "x", fakePageMeta())).resolves.toBe("x");
    await expect(runTransformHtml(plugins, "h", fakePage())).resolves.toBe("h");
    await expect(runBuildEnd(plugins, {
      config: fakeConfig(),
      pages: [],
      nav: []
    })).resolves.toBeUndefined();
  });

  it("フック内例外はプラグイン名とスタック付きPluginErrorにする", async () => {
    // 仕様2.8: プラグイン名とスタックトレースを表示してエラー終了
    const plugins: Plugin[] = [
      {
        name: "boom",
        configResolved: () => {
          throw new Error("kaboom");
        }
      }
    ];

    try {
      await runConfigResolved(plugins, fakeConfig());
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PluginError);
      expect((error as Error).message).toContain("boom");
      expect((error as Error).message).toContain("kaboom");
      expect((error as Error).stack).toContain("kaboom");
    }
  });

  it("transformMarkdownがstring以外を返すとPluginErrorになる", async () => {
    // return忘れのundefinedで後段変換が壊れないよう検証する
    const plugins: Plugin[] = [{
      name: "bad-md",
      // 意図的に不正な戻り値を返す
      transformMarkdown: (() => undefined) as unknown as Plugin["transformMarkdown"]
    }];
    await expect(runTransformMarkdown(plugins, "x", fakePageMeta())).rejects.toBeInstanceOf(PluginError);
    await expect(runTransformMarkdown(plugins, "x", fakePageMeta())).rejects.toThrow(/string/);
  });

  it("transformHtmlがstring以外を返すとPluginErrorになる", async () => {
    // return忘れのundefinedで最終HTMLが壊れないよう検証する
    const plugins: Plugin[] = [{
      name: "bad-html",
      transformHtml: (() => undefined) as unknown as Plugin["transformHtml"]
    }];
    await expect(runTransformHtml(plugins, "h", fakePage())).rejects.toBeInstanceOf(PluginError);
    await expect(runTransformHtml(plugins, "h", fakePage())).rejects.toThrow(/string/);
  });

  it("フックへ渡すpage / config参照が正しい", async () => {
    // options受け渡しはload側、ここではページ・設定の引数を検証する
    const config = fakeConfig();
    const meta = fakePageMeta();
    const page = fakePage();
    const configSpy = vi.fn();
    const mdSpy = vi.fn((source: string) => source);
    const htmlSpy = vi.fn((html: string) => html);
    const endSpy = vi.fn();
    const plugins: Plugin[] = [{
      name: "spy",
      configResolved: configSpy,
      transformMarkdown: mdSpy,
      transformHtml: htmlSpy,
      buildEnd: endSpy
    }];

    await runConfigResolved(plugins, config);
    await runTransformMarkdown(plugins, "md", meta);
    await runTransformHtml(plugins, "html", page);
    const context: BuildContext = { config, pages: [page], nav: [] };
    await runBuildEnd(plugins, context);

    expect(configSpy).toHaveBeenCalledWith(config);
    expect(mdSpy).toHaveBeenCalledWith("md", meta);
    expect(htmlSpy).toHaveBeenCalledWith("html", page);
    expect(endSpy).toHaveBeenCalledWith(context);
  });
});
