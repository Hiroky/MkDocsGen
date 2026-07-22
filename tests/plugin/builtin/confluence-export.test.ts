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

/** buildEnd(context)に渡す最小のBuildContextを作る */
function createContext(): BuildContext
{
  return {
    config: {} as BuildContext["config"],
    nav: [{ title: "Home", url: "/index.html", children: [] }],
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
});
