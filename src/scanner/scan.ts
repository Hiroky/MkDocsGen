import fs from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import matter from "gray-matter";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";

/**
 * 走査直後のページ素材。Markdown変換前のメタ情報のみ持つ
 */
export interface PageSource {
  /** docs_dirからの相対パス（POSIX区切りに正規化） */
  sourcePath: string;
  /** ファイルの絶対パス */
  absPath: string;
  /** frontmatter除去後の本文 */
  markdown: string;
  /** 解析済みfrontmatter */
  frontmatter: Record<string, unknown>;
  /** 決定済みタイトル */
  title: string;
  /** frontmatterのorder（数値以外はnull） */
  order: number | null;
  /** ページ説明（無ければ空文字） */
  description: string;
  /** 出力相対パス（guide/setup.md → guide/setup.html） */
  outputPath: string;
  /** base_url込みのURL */
  url: string;
}

/**
 * 本文先頭のh1見出しテキストを取り出す。無ければnull
 */
function extractFirstH1(markdown: string): string | null
{
  // 行頭の "# 見出し" だけを対象にする（## 以降はタイトル候補にしない）
  const match = markdown.match(/^#\s+(.+)$/m);
  if (!match || match[1] === undefined) {
    return null;
  }
  // 見出し末尾の空白を落として返す
  return match[1].trim();
}

/**
 * base_urlと出力パスを結合して公開URLを作る
 */
function joinBaseUrl(baseUrl: string, outputPath: string): string
{
  // 末尾スラッシュの有無で結合結果がぶれないよう正規化する
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${outputPath}`;
}

/**
 * frontmatterのorderを数値へ正規化する。不正値はnull
 */
function parseOrder(raw: unknown): number | null
{
  // 数値がそのまま入っている場合はそのまま使う
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  // YAMLで文字列として書かれた数値も許容する
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

/**
 * docs_dir配下を走査し、draft除外・タイトル決定済みのPageSource一覧を返す
 */
export function scanPages(config: ResolvedConfig, logger: Logger): PageSource[]
{
  // fast-globで走査する。excludeはignoreオプションでglobのまま渡す
  const files = fastGlob.sync("**/*.md", {
    cwd: config.docsDirAbs,
    // Windowsでも相対パスをPOSIX区切りに揃える
    onlyFiles: true,
    ignore: config.exclude
  });

  const sources: PageSource[] = [];
  for (const file of files) {
    // fast-globは既に/区切りだが、念のため正規化する
    const sourcePath = file.split(path.sep).join("/");
    const absPath = path.join(config.docsDirAbs, sourcePath);
    const raw = fs.readFileSync(absPath, "utf-8");

    // gray-matterでfrontmatterと本文を分離する
    const parsed = matter(raw);
    const frontmatter = parsed.data as Record<string, unknown>;

    // draft: true はビルド対象から除外する（仕様書2.3.1）
    if (frontmatter.draft === true) {
      continue;
    }

    // タイトル決定の優先順位: frontmatter.title → 先頭の "# 見出し" → 拡張子なしファイル名
    let title: string;
    if (typeof frontmatter.title === "string" && frontmatter.title.length > 0) {
      title = frontmatter.title;
    } else {
      title = extractFirstH1(parsed.content) ?? path.basename(sourcePath, ".md");
    }

    // descriptionは文字列のみ採用し、無ければ空文字にする
    const description = typeof frontmatter.description === "string" ? frontmatter.description : "";

    // orderは数値以外を弾き、不正値は警告してnullにする
    let order: number | null = null;
    if (frontmatter.order !== undefined) {
      order = parseOrder(frontmatter.order);
      if (order === null) {
        logger.warn(`orderが数値ではありません: ${sourcePath}`);
      }
    }

    // 出力パスと公開URLを算出する（B-6）
    const outputPath = sourcePath.replace(/\.md$/, ".html");
    const url = joinBaseUrl(config.site.base_url, outputPath);

    sources.push({
      sourcePath,
      absPath,
      markdown: parsed.content,
      frontmatter,
      title,
      order,
      description,
      outputPath,
      url
    });
  }

  return sources;
}
