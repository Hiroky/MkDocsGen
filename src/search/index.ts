import fs from "node:fs";
import path from "node:path";
import type { Page } from "../types.js";

/**
 * 検索インデックス1件分のドキュメント
 */
export interface SearchDocument {
  id: string;
  title: string;
  section: string;
  headings: string[];
  text: string;
}

/**
 * 検索インデックス全体（search-index.jsonの形）
 */
export interface SearchIndex {
  documents: SearchDocument[];
}

/**
 * Page配列から検索インデックスを組み立てる
 */
export function buildSearchIndex(pages: Page[]): SearchIndex
{
  // 各ページのメタと本文テキストを仕様のdocuments形式へ写す
  const documents: SearchDocument[] = pages.map((page) => ({
    // 遷移先として使う出力相対パスをidにする
    id: page.outputPath,
    title: page.title,
    // パンくず末尾は自身なので、親セクションは1つ手前を使う（無ければ空）
    section: page.breadcrumbs.length >= 2 ? (page.breadcrumbs[page.breadcrumbs.length - 2]?.title ?? "") : "",
    headings: page.headings.map((h) => h.text),
    text: page.plainText
  }));

  return { documents };
}

/**
 * 検索インデックスを出力ディレクトリのassetsへ書き出す
 */
export function writeSearchIndex(outputDirAbs: string, index: SearchIndex): void
{
  // assetsディレクトリが無い場合に備えて先に作る
  const assetsDir = path.join(outputDirAbs, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const json = JSON.stringify(index);
  // 人が確認しやすいようJSONも残す（仕様の形式）
  fs.writeFileSync(path.join(assetsDir, "search-index.json"), json, "utf-8");
  // file://でも読めるよう、scriptタグで読み込むJSも出す（fetchは使わない）
  fs.writeFileSync(
    path.join(assetsDir, "search-index.js"),
    `globalThis.__MKDOCSGEN_SEARCH_INDEX__=${json};\n`,
    "utf-8"
  );
}
