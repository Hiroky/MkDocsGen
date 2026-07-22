import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfluenceExportPlugin } from "../../../src/plugin/builtin/confluence-export.js";
import type { BuildContext } from "../../../src/types.js";

/** テストで設定したCONFLUENCE_*環境変数を確実に消す */
const CONFLUENCE_ENV_KEYS = [
  "CONFLUENCE_URL",
  "CONFLUENCE_USERNAME",
  "CONFLUENCE_PASSWORD",
  "CONFLUENCE_SPACE",
  "CONFLUENCE_PARENT_PAGE_ID"
];

afterEach(() => {
  for (const key of CONFLUENCE_ENV_KEYS) {
    delete process.env[key];
  }
  vi.unstubAllGlobals();
});

/** buildEnd(context)に渡す最小のBuildContextを作る（1ページのみ） */
function createContext(): BuildContext
{
  // NavNode.url はoutputPath形式（base_url無し・先頭スラッシュ無し）、
  // Page.url はbase_url込みで先頭スラッシュ付き。両者は文字列として異なる点に注意
  return {
    config: {} as BuildContext["config"],
    nav: [{ title: "Home", url: "index.html", children: [] }],
    pages: [{
      sourcePath: "index.md",
      outputPath: "index.html",
      url: "/index.html",
      title: "Home",
      description: "",
      frontmatter: {},
      headings: [],
      anchorIds: [],
      links: [],
      contentHtml: "<p>Hello</p>"
    }]
  };
}

/** ネストしたセクション+子ページを持つBuildContextを作る（階層バグの回帰テスト用） */
function createNestedContext(): BuildContext
{
  return {
    config: {} as BuildContext["config"],
    nav: [{
      title: "Guide",
      url: "guide/index.html",
      children: [
        { title: "Setup", url: "guide/setup.html", children: [] }
      ]
    }],
    pages: [
      {
        sourcePath: "guide/index.md",
        outputPath: "guide/index.html",
        url: "/guide/index.html",
        title: "Guide",
        description: "",
        frontmatter: {},
        headings: [],
        anchorIds: [],
        links: [],
        contentHtml: "<p>Guide home</p>"
      },
      {
        sourcePath: "guide/setup.md",
        outputPath: "guide/setup.html",
        url: "/guide/setup.html",
        title: "Setup",
        description: "",
        frontmatter: {},
        headings: [],
        anchorIds: [],
        links: [],
        contentHtml: "<p>Setup content</p>"
      }
    ]
  };
}

/** トップレベルにHome(index.html)と他の項目が並ぶBuildContextを作る（homeAsRoot検証用） */
function createSiteContext(): BuildContext
{
  return {
    config: {} as BuildContext["config"],
    nav: [
      { title: "Home", url: "index.html", children: [] },
      { title: "Guide", url: "guide/index.html", children: [] },
      { title: "API", url: "api/index.html", children: [] }
    ],
    pages: [
      {
        sourcePath: "index.md",
        outputPath: "index.html",
        url: "/index.html",
        title: "Home",
        description: "",
        frontmatter: {},
        headings: [],
        anchorIds: [],
        links: [],
        contentHtml: "<p>Home</p>"
      },
      {
        sourcePath: "guide/index.md",
        outputPath: "guide/index.html",
        url: "/guide/index.html",
        title: "Guide",
        description: "",
        frontmatter: {},
        headings: [],
        anchorIds: [],
        links: [],
        contentHtml: "<p>Guide</p>"
      },
      {
        sourcePath: "api/index.md",
        outputPath: "api/index.html",
        url: "/api/index.html",
        title: "API",
        description: "",
        frontmatter: {},
        headings: [],
        anchorIds: [],
        links: [],
        contentHtml: "<p>API</p>"
      }
    ]
  };
}

/** Home(index.html)を含まないBuildContextを作る（homeAsRootのフォールバック検証用） */
function createContextWithoutHome(): BuildContext
{
  return {
    config: {} as BuildContext["config"],
    nav: [
      { title: "Guide", url: "guide/index.html", children: [] }
    ],
    pages: [
      {
        sourcePath: "guide/index.md",
        outputPath: "guide/index.html",
        url: "/guide/index.html",
        title: "Guide",
        description: "",
        frontmatter: {},
        headings: [],
        anchorIds: [],
        links: [],
        contentHtml: "<p>Guide</p>"
      }
    ]
  };
}

/** Confluence検索は空結果、作成はダミーIDを返すfetchスタブを設定する */
function stubFetchSuccess()
{
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init === undefined || init.method === undefined) {
      // 検索GET: 既存ページなしを返す
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    // 作成POST: ダミーページIDを返す
    return new Response(JSON.stringify({ id: "999" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
}

describe("confluence-export ビルトインプラグイン", () => {
  it("options.password が指定されるとfactory呼び出し時点でエラーになる", () => {
    expect(() => createConfluenceExportPlugin({ space: "DOCS", password: "secret" }))
      .toThrow(/password/);
  });

  it("url/username/spaceは環境変数とoptionsの両方に値があれば環境変数を優先する", async () => {
    process.env.CONFLUENCE_URL = "https://env.example.atlassian.net/wiki";
    process.env.CONFLUENCE_USERNAME = "env-user";
    process.env.CONFLUENCE_PASSWORD = "env-pass";
    process.env.CONFLUENCE_SPACE = "ENVSPACE";
    const { fetchMock } = stubFetchSuccess();

    const plugin = createConfluenceExportPlugin({
      url: "https://option.example.atlassian.net/wiki",
      username: "option-user",
      space: "OPTIONSPACE"
    });
    await plugin.buildEnd?.(createContext());

    const firstCall = fetchMock.mock.calls[0]!;
    const requestUrl = String(firstCall[0]);
    expect(requestUrl).toContain("https://env.example.atlassian.net/wiki");
    const requestInit = firstCall[1] as { headers: Record<string, string> };
    const expectedAuth = "Basic " + Buffer.from("env-user:env-pass").toString("base64");
    expect(requestInit.headers.Authorization).toBe(expectedAuth);
  });

  it("username/passwordが揃わずdryRun:falseだとfetchを呼ばずにエラーになる", async () => {
    const { fetchMock } = stubFetchSuccess();
    const plugin = createConfluenceExportPlugin({ space: "DOCS", dryRun: false });

    await expect(plugin.buildEnd?.(createContext())).rejects.toThrow(/不足/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("url/username/password/space/parentPageIdが揃えばBasic認証headerでfetchする", async () => {
    const { fetchMock } = stubFetchSuccess();
    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS",
      parentPageId: "123456"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await plugin.buildEnd?.(createContext());

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    const expectedAuth = "Basic " + Buffer.from("alice:s3cr3t").toString("base64");
    expect(init.headers.Authorization).toBe(expectedAuth);
  });

  it("dryRun:trueなら認証情報が無くてもfetchせず計画だけ返す", async () => {
    const { fetchMock } = stubFetchSuccess();
    const plugin = createConfluenceExportPlugin({ space: "DOCS", dryRun: true });

    await expect(plugin.buildEnd?.(createContext())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ネストしたページがoutputPathで正しく紐付き、孤立扱いで重複しない", async () => {
    // NavNode.url(outputPath形式)とPage.url(base_url付き)の型違いで
    // 全ページが孤立扱いされ、parent=(root)で重複登録されていた回帰
    const infoLines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      infoLines.push(line);
    });
    const plugin = createConfluenceExportPlugin({ space: "DOCS", dryRun: true });

    await plugin.buildEnd?.(createNestedContext());

    const setupLines = infoLines.filter((line) => line.includes("title=Setup"));
    expect(setupLines).toHaveLength(1);
    expect(setupLines[0]).toContain("parent=Guide");
    expect(setupLines[0]).not.toMatch(/parent=\(root\)/);
    expect(setupLines[0]).not.toMatch(/parent=n\d/);
  });

  it("ネストしたページの実データ同期時、本文はcontentHtmlが使われる（タイトルのみのスタブにならない）", async () => {
    const capturedBodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init === undefined || init.method === undefined) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      capturedBodies.push(String(init.body));
      return new Response(JSON.stringify({ id: "999" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await plugin.buildEnd?.(createNestedContext());

    const setupPayload = capturedBodies
      .map((body) => JSON.parse(body) as { title: string; body: { storage: { value: string } } })
      .find((payload) => payload.title === "Setup");
    expect(setupPayload?.body.storage.value).toBe("<p>Setup content</p>");
  });

  it("homeAsRoot:trueならHome以外のトップレベル項目がHomeの子になる", async () => {
    const infoLines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      infoLines.push(line);
    });
    const plugin = createConfluenceExportPlugin({ space: "DOCS", dryRun: true, homeAsRoot: true });

    await plugin.buildEnd?.(createSiteContext());

    const guideLine = infoLines.find((line) => line.includes("title=Guide"));
    const apiLine = infoLines.find((line) => line.includes("title=API"));
    const homeLine = infoLines.find((line) => line.includes("title=Home"));
    expect(guideLine).toContain("parent=Home");
    expect(apiLine).toContain("parent=Home");
    expect(homeLine).toContain("parent=(root)");
  });

  it("homeAsRootを指定しない場合は従来どおりトップレベル項目が全てparent=(root)になる", async () => {
    const infoLines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      infoLines.push(line);
    });
    const plugin = createConfluenceExportPlugin({ space: "DOCS", dryRun: true });

    await plugin.buildEnd?.(createSiteContext());

    const guideLine = infoLines.find((line) => line.includes("title=Guide"));
    const apiLine = infoLines.find((line) => line.includes("title=API"));
    expect(guideLine).toContain("parent=(root)");
    expect(apiLine).toContain("parent=(root)");
  });

  it("homeAsRoot:trueでもHome(index.html)が無ければ例外にならずフラットな計画にフォールバックする", async () => {
    const infoLines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      infoLines.push(line);
    });
    const plugin = createConfluenceExportPlugin({ space: "DOCS", dryRun: true, homeAsRoot: true });

    await expect(plugin.buildEnd?.(createContextWithoutHome())).resolves.toBeUndefined();

    const guideLine = infoLines.find((line) => line.includes("title=Guide"));
    expect(guideLine).toContain("parent=(root)");
  });
});
