import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/load.js";
import { assignPrevNext, buildNav } from "../../src/scanner/nav.js";
import { scanPages } from "../../src/scanner/scan.js";
import { createDocsFixture, createSilentLogger } from "./helpers.js";

/** 各テストで作った一時ディレクトリの後始末用 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("buildNav", () => {
  it("ディレクトリ構造からナビツリーを自動構築する", () => {
    // a.md と b/ セクション（index + c）が期待どおりの木になる
    const fixture = createDocsFixture({
      "a.md": "# A\n",
      "b/index.md": "# B Section\n",
      "b/c.md": "# C\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { nav, orderedPages } = buildNav(sources, fixture.config, logger);

    expect(nav).toEqual([
      { title: "A", url: "a.html", children: [] },
      {
        title: "B Section",
        url: "b/index.html",
        children: [{ title: "C", url: "b/c.html", children: [] }]
      }
    ]);
    // 深さ優先: セクションのindexが子ページより先
    expect(orderedPages.map((p) => p.sourcePath)).toEqual(["a.md", "b/index.md", "b/c.md"]);
  });

  it("セクション内の並びもorderと辞書順に従う", () => {
    // 同階層でorder付きが先、残りは名前順
    const fixture = createDocsFixture({
      "guide/index.md": "# Guide\n",
      "guide/z.md": "# Z\n",
      "guide/a.md": "---\norder: 5\n---\n# A\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { orderedPages } = buildNav(sources, fixture.config, logger);

    expect(orderedPages.map((p) => p.sourcePath)).toEqual([
      "guide/index.md",
      "guide/a.md",
      "guide/z.md"
    ]);
  });

  it("order指定のページは辞書順より優先され先頭に来る", () => {
    // order: 1 の z.md が a.md より前になる
    const fixture = createDocsFixture({
      "a.md": "# A\n",
      "z.md": "---\norder: 1\n---\n# Z\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { nav } = buildNav(sources, fixture.config, logger);

    expect(nav.map((n) => n.title)).toEqual(["Z", "A"]);
  });

  it("同階層ではindex.mdが常に先頭になる", () => {
    // ルートのindex.mdは他ページより先に並ぶ
    const fixture = createDocsFixture({
      "b.md": "# B\n",
      "index.md": "# Home\n",
      "a.md": "# A\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { orderedPages } = buildNav(sources, fixture.config, logger);

    expect(orderedPages.map((p) => p.sourcePath)).toEqual(["index.md", "a.md", "b.md"]);
  });

  it("セクション名はindex.mdのtitle、無ければディレクトリ名になる", () => {
    // index有りはtitle、無しはディレクトリ名
    const fixture = createDocsFixture({
      "named/index.md": "---\ntitle: Named Section\n---\n# Ignored\n",
      "named/a.md": "# A\n",
      "plain/x.md": "# X\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { nav } = buildNav(sources, fixture.config, logger);

    const named = nav.find((n) => n.children.some((c) => c.url === "named/a.html"));
    const plain = nav.find((n) => n.children.some((c) => c.url === "plain/x.html"));
    expect(named?.title).toBe("Named Section");
    expect(named?.url).toBe("named/index.html");
    expect(plain?.title).toBe("plain");
    expect(plain?.url).toBeNull();
  });

  it("navで一部のみ列挙すると列挙分が先頭、残りは自動順で末尾になる", () => {
    // ハイブリッドマージ: 明示順 → 未列挙の自動順
    const fixture = createDocsFixture(
      {
        "a.md": "# A\n",
        "b.md": "# B\n",
        "c.md": "# C\n"
      },
      {
        nav: [{ title: "シー", path: "c.md" }]
      }
    );
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { nav } = buildNav(sources, fixture.config, logger);

    expect(nav.map((n) => n.title)).toEqual(["シー", "A", "B"]);
  });

  it("navのディレクトリ指定は配下を自動展開する", () => {
    // guide/ を指定すると子ページごとツリーに載る
    const fixture = createDocsFixture(
      {
        "index.md": "# Home\n",
        "guide/index.md": "# Guide\n",
        "guide/setup.md": "# Setup\n"
      },
      {
        nav: [
          { title: "はじめに", path: "index.md" },
          { title: "ガイド", path: "guide/" }
        ]
      }
    );
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { nav } = buildNav(sources, fixture.config, logger);

    expect(nav).toEqual([
      { title: "はじめに", url: "index.html", children: [] },
      {
        title: "ガイド",
        url: "guide/index.html",
        children: [{ title: "Setup", url: "guide/setup.html", children: [] }]
      }
    ]);
  });

  it("navに存在しないパスはエラーになる", () => {
    // タイポ検知のため該当パスをメッセージに含める
    const fixture = createDocsFixture(
      { "index.md": "# Home\n" },
      { nav: [{ path: "missing.md" }] }
    );
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);

    expect(() => buildNav(sources, fixture.config, logger)).toThrow(ConfigError);
    expect(() => buildNav(sources, fixture.config, logger)).toThrow(/missing\.md/);
  });

  it("ネストページのbreadcrumbsはルートから自身までの順になる", () => {
    // トップは空、セクションindexは自分だけ、子はセクション+自分
    const fixture = createDocsFixture({
      "index.md": "# Home\n",
      "b/index.md": "# B\n",
      "b/c.md": "# C\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { breadcrumbsMap } = buildNav(sources, fixture.config, logger);

    expect(breadcrumbsMap.get("index.md")).toEqual([]);
    expect(breadcrumbsMap.get("b/index.md")).toEqual([
      { title: "B", url: "b/index.html" }
    ]);
    expect(breadcrumbsMap.get("b/c.md")).toEqual([
      { title: "B", url: "b/index.html" },
      { title: "C", url: "b/c.html" }
    ]);
  });

  it("indexの無いセクションもパンくずに含める", () => {
    // urlが無いセクションは空文字のurlで階層を残す
    const fixture = createDocsFixture({
      "guide/setup.md": "# Setup\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { breadcrumbsMap } = buildNav(sources, fixture.config, logger);

    expect(breadcrumbsMap.get("guide/setup.md")).toEqual([
      { title: "guide", url: "" },
      { title: "Setup", url: "guide/setup.html" }
    ]);
  });
});

describe("assignPrevNext", () => {
  it("ナビ順の先頭と末尾は片側がnullになる", () => {
    // 中間ページだけprev/next両方が埋まる
    const fixture = createDocsFixture({
      "a.md": "# A\n",
      "b.md": "# B\n",
      "c.md": "# C\n"
    });
    cleanups.push(fixture.cleanup);
    const logger = createSilentLogger();
    const sources = scanPages(fixture.config, logger);
    const { orderedPages } = buildNav(sources, fixture.config, logger);
    const relations = assignPrevNext(orderedPages);

    expect(relations.get("a.md")).toEqual({
      prev: null,
      next: { title: "B", url: "b.html" }
    });
    expect(relations.get("b.md")).toEqual({
      prev: { title: "A", url: "a.html" },
      next: { title: "C", url: "c.html" }
    });
    expect(relations.get("c.md")).toEqual({
      prev: { title: "B", url: "b.html" },
      next: null
    });
  });
});
