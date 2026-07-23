import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  // enabledPluginsに自プラグイン名があることは既存テストが同期経路を直接検証するための前提
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
    }],
    enabledPlugins: ["confluence-export"]
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
    ],
    enabledPlugins: ["confluence-export"]
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
    ],
    enabledPlugins: ["confluence-export"]
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
    ],
    enabledPlugins: ["confluence-export"]
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

  it("enabledPluginsに自プラグイン名が無いとfetchせずスキップし、ログを出す", async () => {
    // mkdocsgen build（--enable無し）ではローカル検証のみで上げない
    const { fetchMock } = stubFetchSuccess();
    const infoLines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      infoLines.push(line);
    });
    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    // enabledPluginsを付けない＝通常のbuild相当
    const context = createContext();
    delete context.enabledPlugins;
    await expect(plugin.buildEnd?.(context)).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoLines.some((line) => line.includes("--enable confluence-export"))).toBe(true);
  });

  it("enabledPluginsに他プラグイン名だけだとスキップする", async () => {
    const { fetchMock } = stubFetchSuccess();
    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    const context = createContext();
    context.enabledPlugins = ["other-plugin"];
    await expect(plugin.buildEnd?.(context)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("Confluence側の本文と一致するページは更新APIを呼ばない", async () => {
    const putUrls: string[] = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (requestUrl.includes("/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:index.html" }), { status: 200 });
      }
      if (requestUrl.includes("/property/mkdocsgen-body-hash")) {
        return new Response("", { status: 404 });
      }
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(JSON.stringify({
          results: [{
            id: "999",
            version: { number: 4 },
            body: { storage: { value: "<h2>Hello</h2>" } }
          }]
        }), { status: 200 });
      }
      if (method === "PUT") {
        putUrls.push(requestUrl);
        return new Response(JSON.stringify({ id: "999", version: { number: 5 } }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "body-hash-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    const context = createContext();
    context.pages[0]!.contentHtml = '<h2 id="hello">Hello</h2>';
    await expect(plugin.buildEnd?.(context)).resolves.toBeUndefined();
    expect(putUrls).toHaveLength(0);
  });

  it("Confluence側の本文と異なるページは1回だけ更新する", async () => {
    const putBodies: string[] = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (requestUrl.includes("/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:index.html" }), { status: 200 });
      }
      if (requestUrl.includes("/property/mkdocsgen-body-hash")) {
        return new Response("", { status: 404 });
      }
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(JSON.stringify({
          results: [{
            id: "999",
            version: { number: 4 },
            body: { storage: { value: "<p>Old</p>" } }
          }]
        }), { status: 200 });
      }
      if (method === "PUT") {
        putBodies.push(String(init!.body));
        return new Response(JSON.stringify({ id: "999", version: { number: 5 } }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "body-hash-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(createContext())).resolves.toBeUndefined();
    expect(putBodies).toHaveLength(1);
    expect(JSON.parse(putBodies[0]!).body.storage.value).toBe("<p>Hello</p>");
  });

  it("本文とtocの相対リンクをConfluenceページURLへ変換する", async () => {
    const updatedBodies: string[] = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        const payload = JSON.parse(String(init!.body)) as { title: string };
        const id = payload.title === "Guide" ? "guide-1" : "setup-1";
        return new Response(JSON.stringify({ id, version: { number: 1 } }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "prop-1" }), { status: 200 });
      }
      if (method === "PUT") {
        const payload = JSON.parse(String(init!.body)) as { body: { storage: { value: string } } };
        updatedBodies.push(payload.body.storage.value);
        return new Response(JSON.stringify({ id: "updated", version: { number: 2 } }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = createNestedContext();
    context.pages[0]!.contentHtml =
      '<p><a href="setup.html#setup">本文リンク</a></p>' +
      '<nav class="toctree"><a href="setup.html">tocリンク</a></nav>';
    context.pages[1]!.contentHtml = '<p><a href="index.html">戻る</a></p>';

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(context)).resolves.toBeUndefined();

    expect(updatedBodies).toContain(
      '<p><a href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=setup-1#setup">本文リンク</a></p>' +
      '<nav class="toctree"><a href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=setup-1">tocリンク</a></nav>'
    );
    expect(updatedBodies).toContain(
      '<p><a href="https://example.atlassian.net/wiki/pages/viewpage.action?pageId=guide-1">戻る</a></p>'
    );
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

  it("rootPageTitleを指定するとConfluenceエクスポート時のルートページ名だけを上書きする", async () => {
    const infoLines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => {
      infoLines.push(line);
    });
    const plugin = createConfluenceExportPlugin({
      space: "DOCS",
      dryRun: true,
      rootPageTitle: "エディタ ドキュメント"
    });

    await expect(plugin.buildEnd?.(createSiteContext())).resolves.toBeUndefined();

    expect(infoLines.some((line) => line.includes("title=エディタ ドキュメント"))).toBe(true);
    expect(infoLines.some((line) => line.includes("title=Home"))).toBe(false);
    expect(infoLines.some((line) => line.includes("title=Guide"))).toBe(true);
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

  it("本文中のimg/br/hrタグがXHTML準拠の自己終了タグに変換されて送信される", async () => {
    // markdown-itは<img ...>や<br>を非自己終了で出力するが、
    // Confluence Storage FormatはXHTML準拠のため自己終了でないとパースエラーになる回帰
    const capturedBodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init === undefined || init.method === undefined) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      capturedBodies.push(String(init.body));
      return new Response(JSON.stringify({ id: "999" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = createContext();
    // 外部URLの画像は添付ファイル変換の対象外（ローカル画像変換は別テストで検証）
    context.pages[0]!.contentHtml =
      '<p>line1<br>line2</p><hr>' +
      '<img src="https://example.com/a.png" alt="Alt"><img src="https://example.com/b.png"/>';

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await plugin.buildEnd?.(context);

    const payload = JSON.parse(capturedBodies[0]!) as { body: { storage: { value: string } } };
    expect(payload.body.storage.value).toBe(
      '<p>line1<br />line2</p><hr />' +
      '<img src="https://example.com/a.png" alt="Alt" /><img src="https://example.com/b.png"/>'
    );
  });

  it("本文中のローカル画像はConfluence添付ファイル参照(ac:image)に変換され、添付アップロードされる", async () => {
    // 画像ファイルが実際に存在するテスト用ディレクトリを用意する
    const docsDirAbs = mkdtempSync(path.join(tmpdir(), "mkdocsgen-test-"));
    const imgDir = path.join(docsDirAbs, "img");
    mkdirSync(imgDir);
    writeFileSync(path.join(imgDir, "photo.png"), Buffer.from([0, 1, 2, 3]));

    try {
      const attachmentUploads: Array<{ url: string; filename: string }> = [];
      const pageCreatePayloads: string[] = [];
      const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
        const requestUrl = String(urlArg);
        const method = init?.method;
        if (requestUrl.includes("/child/attachment?filename=")) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        if (method === "POST" && requestUrl.includes("/child/attachment")) {
          const form = init!.body as FormData;
          const file = form.get("file") as File;
          attachmentUploads.push({ url: requestUrl, filename: file.name });
          return new Response(JSON.stringify({ id: "att-1" }), { status: 200 });
        }
        if (method === "POST" && requestUrl.includes("/property")) {
          return new Response(JSON.stringify({ id: "prop-1" }), { status: 200 });
        }
        if (method === undefined && requestUrl.includes("/rest/api/content?")) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
          pageCreatePayloads.push(String(init!.body));
          return new Response(JSON.stringify({ id: "999" }), { status: 200 });
        }
        throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const context = createContext();
      context.config = { docsDirAbs } as BuildContext["config"];
      context.pages[0]!.contentHtml = '<p><img src="img/photo.png" alt="写真"></p>';

      const plugin = createConfluenceExportPlugin({
        url: "https://example.atlassian.net/wiki",
        username: "alice",
        space: "DOCS"
      });
      process.env.CONFLUENCE_PASSWORD = "s3cr3t";

      await plugin.buildEnd?.(context);

      const payload = JSON.parse(pageCreatePayloads[0]!) as { body: { storage: { value: string } } };
      const imageHash = createHash("sha256").update(Buffer.from([0, 1, 2, 3])).digest("hex");
      const filenameHex = Buffer.from("img_photo.png", "utf8").toString("hex");
      expect(payload.body.storage.value).toBe(
        `<p><!-- mkdocsgen-image-meta:${filenameHex}:${imageHash} -->` +
        '<ac:image ac:alt="写真"><ri:attachment ri:filename="img_photo.png" /></ac:image></p>'
      );
      expect(attachmentUploads).toEqual([
        { url: expect.stringContaining("/content/999/child/attachment"), filename: "img_photo.png" }
      ]);
    } finally {
      rmSync(docsDirAbs, { recursive: true, force: true });
    }
  });

  it("本文に埋め込まれた画像ハッシュが一致する添付は再アップロードしない", async () => {
    const docsDirAbs = mkdtempSync(path.join(tmpdir(), "mkdocsgen-test-"));
    const imgDir = path.join(docsDirAbs, "img");
    mkdirSync(imgDir);
    writeFileSync(path.join(imgDir, "photo.png"), Buffer.from([0, 1, 2, 3]));

    try {
      const imageHash = createHash("sha256").update(Buffer.from([0, 1, 2, 3])).digest("hex");
      const filenameHex = Buffer.from("img_photo.png", "utf8").toString("hex");
      const imageMetadata = `<!-- mkdocsgen-image-meta:${filenameHex}:${imageHash} -->`;
      const attachmentUploads: string[] = [];
      const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
        const requestUrl = String(urlArg);
        const method = init?.method;
      if (requestUrl.includes("/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:index.html" }), { status: 200 });
      }
      if (requestUrl.includes("/property/mkdocsgen-body-hash")) {
        return new Response("", { status: 404 });
      }
        if (requestUrl.includes("/property/mkdocsgen-image-hashes")) {
          return new Response(JSON.stringify({
            id: "image-hashes-1",
            version: { number: 1 },
            value: { "img_photo.png": imageHash }
          }), { status: 200 });
        }
        if (requestUrl.includes("/property/mkdocsgen-body-hash")) {
          return new Response("", { status: 404 });
        }
        if (method === undefined && requestUrl.includes("/rest/api/content?")) {
          return new Response(JSON.stringify({
            results: [{
              id: "999",
              version: { number: 4 },
              body: {
                storage: {
                  value: `<p>${imageMetadata}<ac:image ac:alt="写真"><ri:attachment ri:filename="img_photo.png" /></ac:image></p>`
                }
              }
            }]
          }), { status: 200 });
        }
        if (method === "POST" && requestUrl.includes("/child/attachment")) {
          attachmentUploads.push(requestUrl);
          return new Response(JSON.stringify({ id: "att-1" }), { status: 200 });
        }
        if (method === "POST" && requestUrl.endsWith("/property")) {
          return new Response(JSON.stringify({ id: "body-hash-1" }), { status: 200 });
        }
        throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const context = createContext();
      context.config = { docsDirAbs } as BuildContext["config"];
      context.pages[0]!.contentHtml = '<p><img src="img/photo.png" alt="写真"></p>';

      const plugin = createConfluenceExportPlugin({
        url: "https://example.atlassian.net/wiki",
        username: "alice",
        space: "DOCS"
      });
      process.env.CONFLUENCE_PASSWORD = "s3cr3t";

      await plugin.buildEnd?.(context);

      expect(attachmentUploads).toHaveLength(0);
    } finally {
      rmSync(docsDirAbs, { recursive: true, force: true });
    }
  });

  it("不正なHTML属性構文のタグはConfluence用本文で文字列としてエスケープする", async () => {
    let createdBody = "";
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        const payload = JSON.parse(String(init!.body)) as { body: { storage: { value: string } } };
        createdBody = payload.body.storage.value;
        return new Response(JSON.stringify({ id: "999", version: { number: 1 } }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "property-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = createContext();
    context.pages[0]!.contentHtml = "<p><strong 値>文字</strong><icon OK/></p>";
    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(context)).resolves.toBeUndefined();
    expect(createdBody).toContain("&lt;strong 値&gt;");
    expect(createdBody).toContain("&lt;icon OK/&gt;");
  });

  it("AdmonitionのasideはConfluenceのstructured-macroへ変換する", async () => {
    // サイト用のaside.admonitionをStorage Formatのinfo/tip/note/warningマクロへ直す
    let createdBody = "";
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        const payload = JSON.parse(String(init!.body)) as { body: { storage: { value: string } } };
        createdBody = payload.body.storage.value;
        return new Response(JSON.stringify({ id: "999", version: { number: 1 } }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "property-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = createContext();
    // 実際のadmonitionプラグイン出力と同じ構造で、全タイプとカスタムタイトルを混ぜる
    context.pages[0]!.contentHtml = [
      '<aside class="admonition admonition-note"><p class="admonition-title">NOTE</p><div class="admonition-body">\n<p>note body</p>\n</div></aside>',
      '<aside class="admonition admonition-info"><p class="admonition-title">INFO</p><div class="admonition-body">\n<p>info body</p>\n</div></aside>',
      '<aside class="admonition admonition-tip"><p class="admonition-title">ヒント</p><div class="admonition-body">\n<p>tip body</p>\n</div></aside>',
      '<aside class="admonition admonition-warning"><p class="admonition-title">WARNING</p><div class="admonition-body">\n<p>warning body</p>\n</div></aside>',
      '<aside class="admonition admonition-danger"><p class="admonition-title">危険</p><div class="admonition-body">\n<p>danger body</p>\n</div></aside>'
    ].join("\n");
    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(context)).resolves.toBeUndefined();
    // 名前優先マッピング: note/info/tip/warningはそのまま、dangerはwarningへ
    expect(createdBody).toContain('<ac:structured-macro ac:name="note">');
    expect(createdBody).toContain('<ac:structured-macro ac:name="info">');
    expect(createdBody).toContain('<ac:structured-macro ac:name="tip">');
    expect(createdBody).toContain('<ac:parameter ac:name="title">ヒント</ac:parameter>');
    expect(createdBody).toContain("<p>tip body</p>");
    expect(createdBody).toContain('<ac:structured-macro ac:name="warning">');
    expect(createdBody).toContain('<ac:parameter ac:name="title">危険</ac:parameter>');
    expect(createdBody).toContain("<p>danger body</p>");
    // サイト用のasideラッパーは残さない
    expect(createdBody).not.toContain('class="admonition');
    expect(createdBody).not.toContain("<aside");
  });

  it("同名でも別ソースから作られたページしか無ければ既存ページを上書きせず新規作成する", async () => {
    // 同名ページが別ソースのものしか無い場合、タイトルではなくsourceKeyで新規ページを作る
    const createdBodies: string[] = [];
    const updatedUrls: string[] = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (requestUrl.includes("/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:other.html" }), { status: 200 });
      }
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(
          JSON.stringify({ results: [{ id: "111", version: { number: 3 } }] }),
          { status: 200 }
        );
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        createdBodies.push(String(init!.body));
        return new Response(JSON.stringify({ id: "222" }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "prop-1" }), { status: 200 });
      }
      if (method === "PUT") {
        updatedUrls.push(requestUrl);
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(createContext())).resolves.toBeUndefined();
    expect(createdBodies).toHaveLength(1);
    expect(updatedUrls).toHaveLength(0);
  });

  it("同名ページはあるがプロパティ未設定なら既存ページを上書きせず新規作成する", async () => {
    const createdBodies: string[] = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (requestUrl.includes("/property/mkdocsgen-source-key")) {
        return new Response("", { status: 404 });
      }
      if (method === "POST" && requestUrl.includes("/property")) {
        return new Response(JSON.stringify({ id: "prop-1" }), { status: 200 });
      }
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(
          JSON.stringify({ results: [{ id: "111", version: { number: 3 } }] }),
          { status: 200 }
        );
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        createdBodies.push(String(init!.body));
        return new Response(JSON.stringify({ id: "222" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(createContext())).resolves.toBeUndefined();
    expect(createdBodies).toHaveLength(1);
  });

  it("同名ページが複数ある場合は全件からsourceKey一致ページを探して更新する", async () => {
    const updatedUrls: string[] = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        return new Response(JSON.stringify({
          results: [
            { id: "111", version: { number: 3 } },
            { id: "222", version: { number: 7 } }
          ]
        }), { status: 200 });
      }
      if (requestUrl.includes("/content/111/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:other.html" }), { status: 200 });
      }
      if (requestUrl.includes("/content/222/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:index.html" }), { status: 200 });
      }
      if (requestUrl.includes("/content/222/property/mkdocsgen-body-hash")) {
        return new Response("", { status: 404 });
      }
      if (method === undefined && requestUrl.includes("/rest/api/content/222?expand=")) {
        return new Response(JSON.stringify({
          id: "222",
          version: { number: 7 },
          body: { storage: { value: "<p>old</p>" } }
        }), { status: 200 });
      }
      if (method === "PUT") {
        updatedUrls.push(requestUrl);
        return new Response(JSON.stringify({ id: "222" }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "body-hash-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(createContext())).resolves.toBeUndefined();
    expect(updatedUrls).toEqual(["https://example.atlassian.net/wiki/rest/api/content/222"]);
  });

  it("同名ページがある場合は親階層を付けたタイトルで新規作成する", async () => {
    const createdPayloads: Array<{ title: string }> = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      const parsedUrl = new URL(requestUrl);
      const searchedTitle = parsedUrl.searchParams.get("title");
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        if (searchedTitle === "Setup") {
          return new Response(JSON.stringify({
            results: [{ id: "111", version: { number: 3 } }]
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (requestUrl.includes("/content/111/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:other.html" }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        createdPayloads.push(JSON.parse(String(init!.body)) as { title: string });
        return new Response(JSON.stringify({ id: String(200 + createdPayloads.length) }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "prop-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(createNestedContext())).resolves.toBeUndefined();
    expect(createdPayloads.find((payload) => payload.title.startsWith("Setup"))?.title)
      .toBe("Setup（Guide）");
  });

  it("親階層付きタイトルで作成済みのページはsourceKey一致時に更新する", async () => {
    const updatedPayloads: Array<{ title: string }> = [];
    const fetchMock = vi.fn(async (urlArg: string | URL, init?: RequestInit) => {
      const requestUrl = String(urlArg);
      const method = init?.method;
      const searchedTitle = new URL(requestUrl).searchParams.get("title");
      if (method === undefined && requestUrl.includes("/rest/api/content?")) {
        if (searchedTitle === "Setup") {
          return new Response(JSON.stringify({ results: [{ id: "111", version: { number: 3 } }] }), { status: 200 });
        }
        if (searchedTitle === "Setup（Guide）") {
          return new Response(JSON.stringify({ results: [{ id: "222", version: { number: 7 } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (requestUrl.includes("/content/111/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:other.html" }), { status: 200 });
      }
      if (requestUrl.includes("/content/222/property/mkdocsgen-source-key")) {
        return new Response(JSON.stringify({ value: "page:guide/setup.html" }), { status: 200 });
      }
      if (requestUrl.includes("/content/222/property/mkdocsgen-body-hash")) {
        return new Response("", { status: 404 });
      }
      if (method === undefined && requestUrl.includes("/rest/api/content/222?expand=")) {
        return new Response(JSON.stringify({
          id: "222",
          version: { number: 7 },
          body: { storage: { value: "<p>old</p>" } }
        }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/rest/api/content")) {
        return new Response(JSON.stringify({ id: "201" }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "prop-1" }), { status: 200 });
      }
      if (method === "PUT" && requestUrl.endsWith("/rest/api/content/222")) {
        updatedPayloads.push(JSON.parse(String(init!.body)) as { title: string });
        return new Response(JSON.stringify({ id: "222" }), { status: 200 });
      }
      if (method === "POST" && requestUrl.endsWith("/property")) {
        return new Response(JSON.stringify({ id: "body-hash-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch call: ${method ?? "GET"} ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const plugin = createConfluenceExportPlugin({
      url: "https://example.atlassian.net/wiki",
      username: "alice",
      space: "DOCS"
    });
    process.env.CONFLUENCE_PASSWORD = "s3cr3t";

    await expect(plugin.buildEnd?.(createNestedContext())).resolves.toBeUndefined();
    expect(updatedPayloads.map((payload) => payload.title)).toEqual(["Setup（Guide）"]);
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
