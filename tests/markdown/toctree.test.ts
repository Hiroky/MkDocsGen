import { describe, expect, it, vi } from "vitest";
import { Logger } from "../../src/logger.js";
import {
  findToctreeDirectives,
  extractToctreePlaceholders,
  resolveToctreePlaceholders,
  findToctreeRootNodes,
  collectToctreeDescendantUrls,
  toctreeDependsOnChangedUrls,
  TOCTREE_PLACEHOLDER_RE
} from "../../src/markdown/toctree.js";
import type { Heading, NavNode, Page } from "../../src/types.js";

/**
 * テスト用の最小Pageを組み立てる
 */
function makePage(partial: Partial<Page> & Pick<Page, "sourcePath" | "outputPath" | "title">): Page
{
  return {
    url: "/" + partial.outputPath,
    description: "",
    frontmatter: {},
    headings: [],
    anchorIds: [],
    links: [],
    contentHtml: "",
    plainText: "",
    prev: null,
    next: null,
    breadcrumbs: [],
    toctrees: [],
    ...partial
  };
}

describe("findToctreeDirectives", () => {
  it("オプション付きディレクティブをパースする", () => {
    const md = [
      "Intro",
      "",
      "::: toctree",
      "maxdepth: 2",
      "caption: このセクション",
      "titlesonly: true",
      ":::",
      "",
      "After"
    ].join("\n");

    const found = findToctreeDirectives(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.options).toEqual({
      maxdepth: 2,
      caption: "このセクション",
      titlesonly: true
    });
    expect(found[0]!.entries).toEqual([]);
    expect(md.slice(found[0]!.start, found[0]!.end)).toContain("::: toctree");
    expect(md.slice(found[0]!.start, found[0]!.end)).toContain(":::");
  });

  it("オプション省略時はデフォルトになる", () => {
    const md = "::: toctree\n:::\n";
    const found = findToctreeDirectives(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.options).toEqual({
      maxdepth: null,
      caption: null,
      titlesonly: false
    });
    expect(found[0]!.entries).toEqual([]);
  });

  it("明示エントリとTitle上書きをパースする", () => {
    const md = [
      "::: toctree",
      "maxdepth: 2",
      "",
      "guide/setup.md",
      "guide/markdown",
      "API リファレンス <reference/cli.md>",
      ":::"
    ].join("\n");
    const found = findToctreeDirectives(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.options.maxdepth).toBe(2);
    expect(found[0]!.entries).toEqual([
      { path: "guide/setup.md", title: null },
      { path: "guide/markdown", title: null },
      { path: "reference/cli.md", title: "API リファレンス" }
    ]);
  });

  it("エントリ開始後のkey:value行はエントリとして扱う", () => {
    const md = [
      "::: toctree",
      "maxdepth: 1",
      "guide/setup.md",
      "caption: これはエントリ扱い",
      ":::"
    ].join("\n");
    const found = findToctreeDirectives(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.options.maxdepth).toBe(1);
    expect(found[0]!.options.caption).toBeNull();
    expect(found[0]!.entries).toEqual([
      { path: "guide/setup.md", title: null },
      { path: "caption: これはエントリ扱い", title: null }
    ]);
  });

  it("CRLF改行でも::: toctreeを検出する", () => {
    // Windows由来のCRLFだと行末\\rが残り、LF前提の正規表現に落ちていた
    const md = "Intro\r\n\r\n::: toctree\r\nmaxdepth: 1\r\n:::\r\n\r\nAfter\r\n";
    const found = findToctreeDirectives(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.options.maxdepth).toBe(1);
  });

  it("コードフェンス内の::: toctreeは検出しない", () => {
    const md = [
      "```",
      "::: toctree",
      "maxdepth: 1",
      ":::",
      "```",
      "",
      "::: toctree",
      ":::"
    ].join("\n");
    const found = findToctreeDirectives(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.options.maxdepth).toBeNull();
  });
});

describe("extractToctreePlaceholders", () => {
  it("ディレクティブをプレースホルダに置換する", () => {
    const md = "Before\n\n::: toctree\nmaxdepth: 1\n:::\n\nAfter";
    const { markdown, toctrees } = extractToctreePlaceholders(md);
    expect(toctrees).toHaveLength(1);
    expect(toctrees[0]!.options.maxdepth).toBe(1);
    expect(markdown).toContain(`@@MKDOCSGEN_TOCTREE_0@@`);
    expect(markdown).not.toContain("::: toctree");
    expect(markdown).toContain("Before");
    expect(markdown).toContain("After");
  });

  it("CRLFの::: toctreeを置換し、Admonitionに渡さない", () => {
    // 置換漏れだとconvert時に未知Admonitionタイプ "toctree" になる
    const md = "Before\r\n\r\n::: toctree\r\nmaxdepth: 2\r\ncaption: 目次\r\n:::\r\n\r\nAfter";
    const { markdown, toctrees } = extractToctreePlaceholders(md);
    expect(toctrees).toHaveLength(1);
    expect(toctrees[0]!.options).toEqual({
      maxdepth: 2,
      caption: "目次",
      titlesonly: false
    });
    expect(toctrees[0]!.entries).toEqual([]);
    expect(markdown).toContain("@@MKDOCSGEN_TOCTREE_0@@");
    expect(markdown).not.toContain("::: toctree");
  });

  it("明示エントリ付きディレクティブをメタへ残す", () => {
    const md = "::: toctree\nguide/setup.md\nセットアップ <guide/setup.md>\n:::";
    const { toctrees } = extractToctreePlaceholders(md);
    expect(toctrees).toHaveLength(1);
    expect(toctrees[0]!.entries).toEqual([
      { path: "guide/setup.md", title: null },
      { path: "guide/setup.md", title: "セットアップ" }
    ]);
  });
});

describe("findToctreeRootNodes", () => {
  const nav: NavNode[] = [
    { title: "Home", url: "index.html", children: [] },
    {
      title: "Guide",
      url: "guide/index.html",
      children: [
        { title: "Setup", url: "guide/setup.html", children: [] },
        { title: "Markdown", url: "guide/markdown.html", children: [] }
      ]
    }
  ];

  it("セクションindexではそのchildrenを返す", () => {
    const page = makePage({ sourcePath: "guide/index.md", outputPath: "guide/index.html", title: "Guide" });
    const roots = findToctreeRootNodes(page, nav);
    expect(roots.map((n) => n.title)).toEqual(["Setup", "Markdown"]);
  });

  it("サイト直下indexでは自分以外のルートnavを返す", () => {
    const page = makePage({ sourcePath: "index.md", outputPath: "index.html", title: "Home" });
    const roots = findToctreeRootNodes(page, nav);
    expect(roots.map((n) => n.title)).toEqual(["Guide"]);
  });

  it("葉ページでは空配列を返す", () => {
    const page = makePage({ sourcePath: "guide/setup.md", outputPath: "guide/setup.html", title: "Setup" });
    const roots = findToctreeRootNodes(page, nav);
    expect(roots).toEqual([]);
  });
});

describe("resolveToctreePlaceholders", () => {
  const setupHeadings: Heading[] = [
    { level: 2, text: "Install", anchorId: "install" },
    { level: 3, text: "Detail", anchorId: "detail" }
  ];
  const markdownHeadings: Heading[] = [
    { level: 2, text: "Syntax", anchorId: "syntax" }
  ];

  const nav: NavNode[] = [
    { title: "Home", url: "index.html", children: [] },
    {
      title: "Guide",
      url: "guide/index.html",
      children: [
        { title: "Setup", url: "guide/setup.html", children: [] },
        { title: "Markdown", url: "guide/markdown.html", children: [] }
      ]
    }
  ];

  const pages: Page[] = [
    makePage({ sourcePath: "index.md", outputPath: "index.html", title: "Home" }),
    makePage({
      sourcePath: "guide/index.md",
      outputPath: "guide/index.html",
      title: "Guide",
      toctrees: [{ index: 0, options: { maxdepth: 2, caption: "目次", titlesonly: false }, entries: [] }],
      contentHtml: "<p>Intro</p>\n<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n"
    }),
    makePage({
      sourcePath: "guide/setup.md",
      outputPath: "guide/setup.html",
      title: "Setup",
      headings: setupHeadings
    }),
    makePage({
      sourcePath: "guide/markdown.md",
      outputPath: "guide/markdown.html",
      title: "Markdown",
      headings: markdownHeadings
    }),
    makePage({
      sourcePath: "reference/cli.md",
      outputPath: "reference/cli.html",
      title: "CLI"
    })
  ];

  it("maxdepth:2で子ページのh2まで出す", () => {
    const logger = new Logger(false, { stdout: () => {}, stderr: () => {} });
    const guide = pages[1]!;
    const html = resolveToctreePlaceholders(guide.contentHtml, guide, nav, pages, logger);
    expect(html).toContain('class="toctree"');
    expect(html).toContain('class="toctree-caption"');
    expect(html).toContain("目次");
    expect(html).toContain("Setup");
    expect(html).toContain("Install");
    expect(html).not.toContain("Detail");
    expect(html).toContain('href="setup.html"');
    expect(html).toContain('href="setup.html#install"');
    expect(html).not.toContain("@@MKDOCSGEN_TOCTREE_");
  });

  it("maxdepth:1では見出しを出さない", () => {
    const logger = new Logger(false, { stdout: () => {}, stderr: () => {} });
    const guide = {
      ...pages[1]!,
      toctrees: [{ index: 0, options: { maxdepth: 1, caption: null, titlesonly: false }, entries: [] }]
    };
    const html = resolveToctreePlaceholders(guide.contentHtml, guide, nav, pages, logger);
    expect(html).toContain("Setup");
    expect(html).toContain("Markdown");
    expect(html).not.toContain("Install");
    expect(html).not.toContain("Syntax");
  });

  it("titlesonly:trueではナビ階層のみ出す", () => {
    const logger = new Logger(false, { stdout: () => {}, stderr: () => {} });
    const guide = {
      ...pages[1]!,
      toctrees: [{ index: 0, options: { maxdepth: null, caption: null, titlesonly: true }, entries: [] }]
    };
    const html = resolveToctreePlaceholders(guide.contentHtml, guide, nav, pages, logger);
    expect(html).toContain("Setup");
    expect(html).not.toContain("Install");
  });

  it("葉ページのtoctreeは警告してプレースホルダを除去する", () => {
    const warn = vi.fn();
    const logger = new Logger(false, { stdout: () => {}, stderr: warn });
    const leaf = makePage({
      sourcePath: "guide/setup.md",
      outputPath: "guide/setup.html",
      title: "Setup",
      toctrees: [{ index: 0, options: { maxdepth: null, caption: null, titlesonly: false }, entries: [] }],
      contentHtml: "<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n"
    });
    const html = resolveToctreePlaceholders(leaf.contentHtml, leaf, nav, pages, logger);
    expect(html).not.toContain("toctree");
    expect(html).not.toContain("@@MKDOCSGEN_TOCTREE_");
    expect(logger.getWarnCount()).toBe(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/toctree/);
  });

  it("明示エントリは列挙順で出し未指定の兄弟は出さない", () => {
    const logger = new Logger(false, { stdout: () => {}, stderr: () => {} });
    const home = makePage({
      sourcePath: "index.md",
      outputPath: "index.html",
      title: "Home",
      toctrees: [{
        index: 0,
        options: { maxdepth: 1, caption: null, titlesonly: false },
        entries: [
          { path: "guide/markdown", title: null },
          { path: "guide/setup.html", title: null }
        ]
      }],
      contentHtml: "<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n"
    });
    const html = resolveToctreePlaceholders(home.contentHtml, home, nav, pages, logger);
    // Markdownが先、Setupが後（列挙順）。Guideセクション自体は出ない
    expect(html).toContain("Markdown");
    expect(html).toContain("Setup");
    expect(html).not.toContain(">Guide<");
    expect(html.indexOf("Markdown")).toBeLessThan(html.indexOf("Setup"));
  });

  it("Title上書きとmaxdepthが明示ルートでも効く", () => {
    const logger = new Logger(false, { stdout: () => {}, stderr: () => {} });
    const home = makePage({
      sourcePath: "index.md",
      outputPath: "index.html",
      title: "Home",
      toctrees: [{
        index: 0,
        options: { maxdepth: 2, caption: null, titlesonly: false },
        entries: [{ path: "guide/setup.md", title: "導入手順" }]
      }],
      contentHtml: "<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n"
    });
    const html = resolveToctreePlaceholders(home.contentHtml, home, nav, pages, logger);
    expect(html).toContain("導入手順");
    expect(html).not.toContain(">Setup<");
    expect(html).toContain("Install");
    expect(html).not.toContain("Detail");
    expect(html).not.toContain("Markdown");
  });

  it("存在しないパスは警告してスキップする", () => {
    const warn = vi.fn();
    const logger = new Logger(false, { stdout: () => {}, stderr: warn });
    const home = makePage({
      sourcePath: "index.md",
      outputPath: "index.html",
      title: "Home",
      toctrees: [{
        index: 0,
        options: { maxdepth: 1, caption: null, titlesonly: false },
        entries: [
          { path: "missing/page.md", title: null },
          { path: "guide/setup.md", title: null }
        ]
      }],
      contentHtml: "<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n"
    });
    const html = resolveToctreePlaceholders(home.contentHtml, home, nav, pages, logger);
    expect(html).toContain("Setup");
    expect(html).not.toContain("missing");
    expect(logger.getWarnCount()).toBe(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/toctree/);
  });

  it("不正パスは警告してスキップする", () => {
    const warn = vi.fn();
    const logger = new Logger(false, { stdout: () => {}, stderr: warn });
    const home = makePage({
      sourcePath: "index.md",
      outputPath: "index.html",
      title: "Home",
      toctrees: [{
        index: 0,
        options: { maxdepth: 1, caption: null, titlesonly: false },
        entries: [
          { path: "../outside.md", title: null },
          { path: "/abs.md", title: null },
          { path: "guide/setup.md", title: null }
        ]
      }],
      contentHtml: "<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n"
    });
    const html = resolveToctreePlaceholders(home.contentHtml, home, nav, pages, logger);
    expect(html).toContain("Setup");
    expect(logger.getWarnCount()).toBe(2);
  });
});

describe("toctreeDependsOnChangedUrls", () => {
  const nav: NavNode[] = [
    { title: "Home", url: "index.html", children: [] },
    {
      title: "Guide",
      url: "guide/index.html",
      children: [
        { title: "Setup", url: "guide/setup.html", children: [] },
        { title: "Markdown", url: "guide/markdown.html", children: [] }
      ]
    }
  ];

  const pages: Page[] = [
    makePage({ sourcePath: "index.md", outputPath: "index.html", title: "Home" }),
    makePage({ sourcePath: "guide/index.md", outputPath: "guide/index.html", title: "Guide" }),
    makePage({ sourcePath: "guide/setup.md", outputPath: "guide/setup.html", title: "Setup" }),
    makePage({ sourcePath: "guide/markdown.md", outputPath: "guide/markdown.html", title: "Markdown" })
  ];

  it("明示エントリの子孫変更を検知する", () => {
    const page = makePage({
      sourcePath: "index.md",
      outputPath: "index.html",
      title: "Home",
      toctrees: [{
        index: 0,
        options: { maxdepth: null, caption: null, titlesonly: false },
        entries: [{ path: "guide/setup.md", title: null }]
      }]
    });
    expect(toctreeDependsOnChangedUrls(page, nav, new Set(["guide/setup.html"]), pages)).toBe(true);
    expect(toctreeDependsOnChangedUrls(page, nav, new Set(["guide/markdown.html"]), pages)).toBe(false);
  });

  it("自動列挙はナビ子の変更を検知する", () => {
    const page = makePage({
      sourcePath: "guide/index.md",
      outputPath: "guide/index.html",
      title: "Guide",
      toctrees: [{ index: 0, options: { maxdepth: null, caption: null, titlesonly: false }, entries: [] }]
    });
    expect(toctreeDependsOnChangedUrls(page, nav, new Set(["guide/markdown.html"]), pages)).toBe(true);
    expect(toctreeDependsOnChangedUrls(page, nav, new Set(["index.html"]), pages)).toBe(false);
  });
});

describe("collectToctreeDescendantUrls", () => {
  it("サブツリーのurlを集める", () => {
    const roots: NavNode[] = [
      {
        title: "Guide",
        url: "guide/index.html",
        children: [
          { title: "Setup", url: "guide/setup.html", children: [] }
        ]
      }
    ];
    const urls = collectToctreeDescendantUrls(roots);
    expect(urls.has("guide/index.html")).toBe(true);
    expect(urls.has("guide/setup.html")).toBe(true);
  });
});

describe("TOCTREE_PLACEHOLDER_RE", () => {
  it("段落でラップされたプレースホルダにマッチする", () => {
    const html = "<p>@@MKDOCSGEN_TOCTREE_0@@</p>\n";
    expect(html.match(TOCTREE_PLACEHOLDER_RE)).not.toBeNull();
  });
});
