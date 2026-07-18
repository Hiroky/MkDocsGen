import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import type { Heading } from "../types.js";
import { slugify } from "./slugify.js";
import { taskListPlugin } from "./task-list.js";

/** 変換結果 */
export interface ConvertResult {
  html: string;
  headings: Heading[];
  plainText: string;
}

/**
 * Markdown変換器。markdown-itインスタンスを1回だけ構築し全ページで使い回す
 */
export function createConverter(config: ResolvedConfig, _logger: Logger)
{
  // 設定に応じて生HTML許可を切り替え、GFM相当のlinkifyを有効にする
  const md = new MarkdownIt({
    html: config.markdown.allow_html,
    linkify: true
  });
  // タスクリストはmarkdown-it標準に無いため自前プラグインで補う
  md.use(taskListPlugin);

  // 見出しアンカー付与はcoreの後処理として差し込む
  md.core.ruler.push("heading_anchors", (state) => {
    applyHeadingAnchors(state.tokens, state.env.headings as Heading[]);
  });

  // 内部リンク書き換えも同じトークン列を後処理する
  md.core.ruler.push("rewrite_internal_links", (state) => {
    rewriteInternalLinks(state.tokens);
  });

  return {
    /**
     * 1ページ分のMarkdownをHTML・見出し一覧・プレーンテキストへ変換する
     */
    convert(markdown: string, _sourcePath: string): ConvertResult
    {
      // env経由でheadings配列を渡し、ruler側で埋めてもらう
      const headings: Heading[] = [];
      const html = md.render(markdown, { headings });
      // 検索インデックス用にタグ除去済みテキストも返す
      const plainText = htmlToPlainText(html);
      return {
        html,
        headings,
        plainText
      };
    }
  };
}

/**
 * 見出しトークンにidを付与し、h2以上をheadingsへ抽出する
 */
function applyHeadingAnchors(tokens: Token[], headings: Heading[]): void
{
  const used = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // heading_open の直後に inline（見出し本文）が続く想定
    if (token?.type !== "heading_open") {
      continue;
    }
    const inline = tokens[i + 1];
    if (inline?.type !== "inline") {
      continue;
    }

    // インライン子トークンからタグ無しテキストを連結する
    const text = collectInlineText(inline);
    const base = slugify(text);
    // 重複時は -2, -3 ... を付けて一意化する
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);

    // HTMLのid属性として書き出す
    token.attrSet("id", slug);

    // h1はページタイトル扱いのため目次データには含めない
    const level = Number(token.tag.slice(1));
    if (level >= 2) {
      headings.push({ level, text, anchorId: slug });
    }
  }
}

/**
 * inlineトークンの子から表示テキストだけを連結する
 */
function collectInlineText(inline: Token): string
{
  if (!inline.children) {
    return inline.content;
  }
  let text = "";
  for (const child of inline.children) {
    // text / code_inline など content を持つものだけ拾う
    if (child.type === "text" || child.type === "code_inline") {
      text += child.content;
    }
  }
  return text;
}

/**
 * 相対.mdリンクのhrefを.htmlへ書き換える
 */
function rewriteInternalLinks(tokens: Token[]): void
{
  for (const token of tokens) {
    // ブロック側とインライン子の両方を走査する
    if (token.type === "inline" && token.children) {
      rewriteInternalLinks(token.children);
      continue;
    }
    if (token.type !== "link_open") {
      continue;
    }
    const href = token.attrGet("href");
    if (href === null) {
      continue;
    }
    token.attrSet("href", rewriteInternalLink(href));
  }
}

/**
 * 1つのhrefを必要なら.md→.htmlに書き換える
 */
function rewriteInternalLink(href: string): string
{
  // 外部・絶対・ページ内アンカーのみは対象外
  if (isExternalOrAbsolute(href)) {
    return href;
  }
  // "target.md" / "../a/b.md#section" のような相対.mdリンクだけを書き換える
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  if (!pathPart.endsWith(".md")) {
    return href;
  }
  const rewritten = pathPart.replace(/\.md$/, ".html");
  return anchor ? `${rewritten}#${anchor}` : rewritten;
}

/**
 * 外部URL・サイト絶対パス・mailto・ページ内アンカーのみかを判定する
 */
function isExternalOrAbsolute(href: string): boolean
{
  // プロトコル付き / プロトコル相対 / サイト絶対 / アンカーのみ
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return true;
  }
  if (href.startsWith("//") || href.startsWith("/") || href.startsWith("#")) {
    return true;
  }
  return false;
}

/**
 * HTMLから検索用プレーンテキストを抽出する
 */
function htmlToPlainText(html: string): string
{
  // タグを除去する
  let text = html.replace(/<[^>]+>/g, " ");
  // 主要エンティティを復元する
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // 連続空白を1つに正規化し前後を整える
  return text.replace(/\s+/g, " ").trim();
}
