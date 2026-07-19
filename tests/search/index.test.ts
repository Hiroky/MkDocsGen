import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSearchIndex, writeSearchIndex } from "../../src/search/index.js";
import { createTestPage } from "../render/helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("buildSearchIndex", () => {
  it("Page配列から仕様どおりのdocumentsを生成する", () => {
    // title / headings / text / section がインデックスに入ること
    const pages = [
      createTestPage({
        sourcePath: "guide/setup.md",
        outputPath: "guide/setup.html",
        title: "セットアップ",
        headings: [
          { level: 2, text: "インストール", anchorId: "インストール" },
          { level: 2, text: "初期設定", anchorId: "初期設定" }
        ],
        plainText: "本文のプレーンテキスト",
        // パンくず末尾は自身、その手前が親セクション
        breadcrumbs: [
          { title: "ガイド", url: "guide/index.html" },
          { title: "セットアップ", url: "guide/setup.html" }
        ]
      }),
      createTestPage({
        sourcePath: "index.md",
        outputPath: "index.html",
        title: "Home",
        plainText: "Welcome",
        breadcrumbs: []
      })
    ];

    const index = buildSearchIndex(pages);

    expect(index.documents).toEqual([
      {
        id: "guide/setup.html",
        title: "セットアップ",
        section: "ガイド",
        headings: ["インストール", "初期設定"],
        text: "本文のプレーンテキスト"
      },
      {
        id: "index.html",
        title: "Home",
        section: "",
        headings: [],
        text: "Welcome"
      }
    ]);
  });

  it("トップレベルページのsectionは空文字になる", () => {
    // 自身だけのパンくずでは親セクション無し
    const index = buildSearchIndex([
      createTestPage({
        breadcrumbs: [{ title: "About", url: "about.html" }]
      })
    ]);
    expect(index.documents[0].section).toBe("");
  });
});

describe("writeSearchIndex", () => {
  it("assetsへJSONとJSの両方を書き出す", () => {
    // JSONは確認用、JSはfile://でもscript読込できる形
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-search-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const outputDir = path.join(root, "site");
    fs.mkdirSync(path.join(outputDir, "assets"), { recursive: true });

    const index = buildSearchIndex([
      createTestPage({ title: "Home", plainText: "Hello" })
    ]);
    writeSearchIndex(outputDir, index);

    const jsonPath = path.join(outputDir, "assets", "search-index.json");
    const jsPath = path.join(outputDir, "assets", "search-index.js");
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(jsPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0].title).toBe("Home");
    expect(parsed.documents[0].text).toBe("Hello");

    const js = fs.readFileSync(jsPath, "utf-8");
    expect(js.startsWith("globalThis.__MKDOCSGEN_SEARCH_INDEX__=")).toBe(true);
    expect(js).toContain('"title":"Home"');
  });
});
