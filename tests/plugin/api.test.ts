import { describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "../../src/config/schema.js";
import {
  runBuildEnd,
  runConfigResolved,
  runTransformHtml,
  runTransformMarkdown
} from "../../src/plugin/hooks.js";
import type { MkDocsGenPlugin } from "../../src/plugin/api.js";
import type { BuildContext, Page } from "../../src/types.js";
import type { PageMeta, Plugin } from "../../src/plugin/types.js";

/**
 * テスト用の最小限ResolvedConfigを生成するヘルパー
 */
function createMockConfig(): ResolvedConfig
{
  return {
    configPath: "/workspace/mkdocsgen.yml",
    configDir: "/workspace",
    docsDir: "docs",
    docsDirAbs: "/workspace/docs",
    outputDir: "site",
    outputDirAbs: "/workspace/site",
    site: {
      title: "Test Site",
      description: "Test Site Description",
      base_url: "/test/",
      copyright: "Copyright (c) 2026"
    },
    nav: [],
    exclude: [],
    theme: {
      overrides_dir: "theme_overrides",
      default_mode: "auto",
      custom_css: []
    },
    markdown: {
      allow_html: true,
      breaks: true
    },
    pydoc: {
      source_dirs: ["src"]
    },
    plugins: [],
    serve: {
      port: 8000
    },
    overridesDirAbs: "/workspace/theme_overrides"
  };
}

/**
 * テスト用の最小限Pageオブジェクトを生成するヘルパー
 */
function createMockPage(): Page
{
  return {
    sourcePath: "guide/test.md",
    outputPath: "guide/test.html",
    url: "/test/guide/test.html",
    title: "Guide Title",
    description: "Guide Description",
    frontmatter: { category: "tech" },
    headings: [{ level: 2, text: "Section 1", anchorId: "section-1" }],
    anchorIds: ["guide-title", "section-1"],
    links: ["other.html"],
    contentHtml: "<p>Hello</p>",
    plainText: "Hello",
    prev: null,
    next: null,
    breadcrumbs: [],
    toctrees: []
  };
}

describe("公開Plugin API (apiVersion: 1)", () =>
{
  /**
   * configResolvedフックが公開コンテキストを受け取ることを検証
   */
  it("configResolvedでPluginConfigContextを受け取る", async () =>
  {
    let receivedContext: any = null;

    const plugin: MkDocsGenPlugin = {
      name: "test-modern-plugin",
      apiVersion: 1,
      configResolved(ctx)
      {
        receivedContext = ctx;
      }
    };

    const config = createMockConfig();
    await runConfigResolved([plugin as any], config);

    expect(receivedContext).not.toBeNull();
    expect(receivedContext.siteTitle).toBe("Test Site");
    expect(receivedContext.docsDir).toBe("/workspace/docs");
    expect(receivedContext.outputDir).toBe("/workspace/site");
    expect(receivedContext.baseUrl).toBe("/test/");
    expect(receivedContext.copyright).toBe("Copyright (c) 2026");
  });

  /**
   * transformMarkdownフックが公開コンテキストを受け取り、変換後テキストを返すことを検証
   */
  it("transformMarkdownでPluginMarkdownContextを受け取りMarkdownを変換する", async () =>
  {
    let receivedContext: any = null;

    const plugin: MkDocsGenPlugin = {
      name: "test-modern-plugin",
      apiVersion: 1,
      transformMarkdown(source, ctx)
      {
        receivedContext = ctx;
        return source.replace("foo", "bar");
      }
    };

    const pageMeta: PageMeta = {
      sourcePath: "guide/test.md",
      outputPath: "guide/test.html",
      url: "/test/guide/test.html",
      title: "Guide Title",
      description: "Guide Description",
      frontmatter: { category: "tech" }
    };

    const result = await runTransformMarkdown([plugin as any], "Hello foo!", pageMeta);

    expect(result).toBe("Hello bar!");
    expect(receivedContext.sourcePath).toBe("guide/test.md");
    expect(receivedContext.outputPath).toBe("guide/test.html");
    expect(receivedContext.url).toBe("/test/guide/test.html");
    expect(receivedContext.frontmatter).toEqual({ category: "tech" });
  });

  /**
   * transformHtmlフックが公開コンテキストを受け取り、HTMLを変換することを検証
   */
  it("transformHtmlでPluginHtmlContextを受け取りHTMLを変換する", async () =>
  {
    let receivedContext: any = null;

    const plugin: MkDocsGenPlugin = {
      name: "test-modern-plugin",
      apiVersion: 1,
      transformHtml(html, ctx)
      {
        receivedContext = ctx;
        return html.replace("<p>Hello</p>", "<p>World</p>");
      }
    };

    const page = createMockPage();
    const result = await runTransformHtml([plugin as any], "<html><p>Hello</p></html>", page);

    expect(result).toBe("<html><p>World</p></html>");
    expect(receivedContext.sourcePath).toBe("guide/test.md");
    expect(receivedContext.title).toBe("Guide Title");
    expect(receivedContext.headings).toEqual([
      { level: 2, text: "Section 1", anchorId: "section-1" }
    ]);
  });

  /**
   * buildEndフックが公開コンテキストを受け取ることを検証
   */
  it("buildEndでPluginBuildContextを受け取る", async () =>
  {
    let receivedContext: any = null;

    const plugin: MkDocsGenPlugin = {
      name: "test-modern-plugin",
      apiVersion: 1,
      buildEnd(ctx)
      {
        receivedContext = ctx;
      }
    };

    const page = createMockPage();
    const context: BuildContext = {
      config: createMockConfig(),
      pages: [page],
      nav: [],
      enabledPlugins: ["test-modern-plugin"]
    };

    await runBuildEnd([plugin as any], context);

    expect(receivedContext).not.toBeNull();
    expect(receivedContext.outputDir).toBe("/workspace/site");
    expect(receivedContext.pages.length).toBe(1);
    expect(receivedContext.pages[0].sourcePath).toBe("guide/test.md");
    expect(receivedContext.pages[0].contentHtml).toBe("<p>Hello</p>");
    expect(receivedContext.enabledPlugins).toEqual(["test-modern-plugin"]);
  });

  /**
   * apiVersionを持たないレガシープラグインも引き続き正しく動作することを検証
   */
  it("apiVersionのないレガシープラグインも後方互換として動作する", async () =>
  {
    let legacyConfig: any = null;
    let legacyPage: any = null;

    const legacyPlugin: Plugin = {
      name: "test-legacy-plugin",
      configResolved(config)
      {
        legacyConfig = config;
      },
      transformHtml(html, page)
      {
        legacyPage = page;
        return html;
      }
    };

    const config = createMockConfig();
    const page = createMockPage();

    await runConfigResolved([legacyPlugin], config);
    await runTransformHtml([legacyPlugin], "<p>Test</p>", page);

    // 内部オブジェクトがそのまま渡されていることを検証
    expect(legacyConfig).toBe(config);
    expect(legacyPage).toBe(page);
  });
});
