import { describe, expect, it } from "vitest";
import { validateLinks } from "../../src/build/validate-links.js";
import type { Page } from "../../src/types.js";
import { createCapturingLogger } from "../scanner/helpers.js";

/**
 * 検証テスト用の最小Pageを組み立てる
 */
function page(partial: Partial<Page> & Pick<Page, "sourcePath">): Page
{
  return {
    outputPath: partial.sourcePath.replace(/\.md$/, ".html"),
    url: `/${partial.sourcePath.replace(/\.md$/, ".html")}`,
    title: "T",
    description: "",
    frontmatter: {},
    headings: [],
    contentHtml: "",
    plainText: "",
    prev: null,
    next: null,
    breadcrumbs: [],
    links: [],
    anchorIds: [],
    ...partial
  };
}

describe("validateLinks", () => {
  it("存在する相対.mdリンクは警告しない", () => {
    // 正常なページ間リンクは検証を通過する
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "index.md", links: ["./guide.md"] }),
      page({ sourcePath: "guide.md", links: [], anchorIds: [] })
    ], logger);

    expect(warnings).toEqual([]);
    expect(logger.getWarnCount()).toBe(0);
  });

  it("存在しない.mdリンクはリンク切れ警告を出す", () => {
    // 仕様書7.3の代表例: ./missing.md
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "index.md", links: ["./missing.md"] })
    ], logger);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("リンク切れ");
    expect(warnings[0]).toContain("index.md");
    expect(warnings[0]).toContain("./missing.md");
    expect(logger.getWarnCount()).toBe(1);
  });

  it("存在するページの不正アンカーはアンカー切れ警告を出す", () => {
    // ページはあるが見出しidが無い場合
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "a.md", links: ["./b.md#no-such"] }),
      page({ sourcePath: "b.md", links: [], anchorIds: ["intro"] })
    ], logger);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("アンカー切れ");
    expect(warnings[0]).toContain("./b.md#no-such");
  });

  it("存在するアンカー付きリンクは警告しない", () => {
    // 相対パス解決とアンカー照合の両方を確認する
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "b/c.md", links: ["../a.md#page-a"] }),
      page({ sourcePath: "a.md", links: [], anchorIds: ["page-a", "title"] })
    ], logger);

    expect(warnings).toEqual([]);
  });

  it("同ページの#アンカーを検証する", () => {
    // #始まりは書き換え対象外だが検証対象
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({
        sourcePath: "index.md",
        links: ["#setup", "#missing"],
        anchorIds: ["title", "setup"]
      })
    ], logger);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("アンカー切れ");
    expect(warnings[0]).toContain("#missing");
  });

  it("空アンカー#はページ先頭として有効", () => {
    // # のみはページ先頭へのリンクとして通す
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "index.md", links: ["#"], anchorIds: [] })
    ], logger);

    expect(warnings).toEqual([]);
  });

  it("h1のアンカーも有効として扱う", () => {
    // headingsはh2+だが、実HTMLのh1 idはanchorIdsに含まれる
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "index.md", links: ["#title"], anchorIds: ["title"] })
    ], logger);

    expect(warnings).toEqual([]);
  });

  it("外部URL・サイト絶対パス・非ページ相対はスキップする", () => {
    // 仕様どおり外部死活チェックはせず、画像等も対象外
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({
        sourcePath: "index.md",
        links: [
          "https://example.com",
          "http://example.com/a",
          "mailto:a@b.com",
          "//cdn.example.com/x",
          "/absolute.html",
          "./image.png",
          "../assets/logo.svg"
        ]
      })
    ], logger);

    expect(warnings).toEqual([]);
  });

  it(".html相対リンクも.mdページとして解決する", () => {
    // 書き換え後の記法で書かれたリンクも検証する
    const { logger, warnings } = createCapturingLogger();
    validateLinks([
      page({ sourcePath: "index.md", links: ["./guide.html#intro"] }),
      page({ sourcePath: "guide.md", links: [], anchorIds: ["intro"] })
    ], logger);

    expect(warnings).toEqual([]);
  });
});
