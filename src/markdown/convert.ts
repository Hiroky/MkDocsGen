import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import type { Heading } from "../types.js";
import { admonitionPlugin } from "./admonition.js";
import { createCodeHighlighter, highlightCode } from "./highlight.js";
import { slugify } from "./slugify.js";
import { taskListPlugin } from "./task-list.js";

/** 変換結果 */
export interface ConvertResult {
  html: string;
  headings: Heading[];
  /** h1を含む全見出しのid（リンク検証用） */
  anchorIds: string[];
  /** Markdown内の生href一覧（リンク検証用・書き換え前） */
  links: string[];
  plainText: string;
}

/**
 * Markdown変換器。markdown-itインスタンスを1回だけ構築し全ページで使い回す
 */
export async function createConverter(config: ResolvedConfig, logger: Logger)
{
  // Shikiは非同期初期化のため、変換器生成時に1回だけ用意する
  const highlighter = await createCodeHighlighter();

  // 設定に応じて生HTML許可を切り替え、GFM相当のlinkifyを有効にする
  const md = new MarkdownIt({
    html: config.markdown.allow_html,
    linkify: true
  });
  // タスクリストはmarkdown-it標準に無いため自前プラグインで補う
  md.use(taskListPlugin);
  // Admonition（::: note 等）をブロック拡張として登録する
  md.use(admonitionPlugin, { logger });

  // 見出しアンカー付与はcoreの後処理として差し込む
  md.core.ruler.push("heading_anchors", (state) => {
    applyHeadingAnchors(
      state.tokens,
      state.env.headings as Heading[],
      state.env.anchorIds as string[]
    );
  });

  // リンク検証用に、書き換え前の生hrefを収集する（#始まりも含む）
  md.core.ruler.push("collect_internal_links", (state) => {
    collectInternalLinks(state.tokens, state.env.links as string[]);
  });

  // 内部リンク書き換えも同じトークン列を後処理する
  md.core.ruler.push("rewrite_internal_links", (state) => {
    rewriteInternalLinks(state.tokens);
  });

  // フェンス（```）をMermaid / Shiki / プレーン + コピーボタンへ振り分ける
  md.renderer.rules.fence = (tokens, idx) => {
    return renderFence(md, tokens[idx]!, highlighter);
  };

  return {
    /**
     * 1ページ分のMarkdownをHTML・見出し一覧・プレーンテキストへ変換する
     */
    convert(markdown: string, sourcePath: string): ConvertResult
    {
      // env経由でheadings等を渡し、ruler / Admonition側で参照・蓄積する
      const headings: Heading[] = [];
      const anchorIds: string[] = [];
      const links: string[] = [];
      const html = md.render(markdown, { headings, anchorIds, links, sourcePath });
      // 生HTMLのidもリンク検証対象に含める（見出し由来と重複し得るため一意化する）
      for (const id of collectHtmlIds(html)) {
        if (!anchorIds.includes(id)) {
          anchorIds.push(id);
        }
      }
      // 検索インデックス用にタグ除去済みテキストも返す
      const plainText = htmlToPlainText(html);
      return {
        html,
        headings,
        anchorIds,
        links,
        plainText
      };
    }
  };
}

/**
 * フェンス1つをMermaid / Shiki / プレーンへ振り分けてHTML化する
 */
function renderFence(md: MarkdownIt, token: Token, highlighter: Awaited<ReturnType<typeof createCodeHighlighter>>): string
{
  // infoは "ts" や "js title=..." のような形式なので先頭の言語だけ取る
  const info = token.info.trim();
  const lang = info.split(/\s+/)[0]?.toLowerCase() ?? "";
  const code = token.content;

  // Mermaidはクライアント描画のため生テキストを pre.mermaid に残す
  if (lang === "mermaid") {
    return `<pre class="mermaid">${md.utils.escapeHtml(code.replace(/\n$/, ""))}</pre>\n`;
  }

  // 言語なしはプレーンテキストとして描画する（Shikiを通さない）
  if (lang.length === 0) {
    const plain = `<pre><code>${md.utils.escapeHtml(code)}</code></pre>\n`;
    return wrapCodeBlock(md, plain, code);
  }

  // 言語ありはShiki dual theme HTMLへ変換する
  const highlighted = highlightCode(highlighter, code, lang);
  return wrapCodeBlock(md, highlighted + "\n", code);
}

/**
 * コードブロックをコピーボタン付きラッパで囲む
 */
function wrapCodeBlock(md: MarkdownIt, innerHtml: string, rawCode: string): string
{
  // 末尾改行はクリップボード用データから除く
  const forCopy = rawCode.replace(/\n$/, "");
  const escaped = md.utils.escapeHtml(forCopy);
  return `<div class="code-block"><button type="button" class="code-copy" data-code-copy data-code="${escaped}">Copy</button>${innerHtml}</div>\n`;
}

/**
 * 見出しトークンにidを付与し、h2以上をheadingsへ、全レベルをanchorIdsへ抽出する
 */
function applyHeadingAnchors(tokens: Token[], headings: Heading[], anchorIds: string[]): void
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
    // リンク検証ではh1も含めて照合するため全idを残す
    anchorIds.push(slug);

    // h1はページタイトル扱いのため目次データには含めない
    const level = Number(token.tag.slice(1));
    if (level >= 2) {
      headings.push({ level, text, anchorId: slug });
    }
  }
}

/**
 * link_openトークンから生hrefを収集する（書き換え前に呼ぶ）
 */
function collectInternalLinks(tokens: Token[], links: string[]): void
{
  for (const token of tokens) {
    // ブロック側とインライン子の両方を走査する
    if (token.type === "inline" && token.children) {
      collectInternalLinks(token.children, links);
      continue;
    }
    if (token.type !== "link_open") {
      continue;
    }
    const href = token.attrGet("href");
    if (href === null) {
      continue;
    }
    links.push(href);
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
  // コピーボタン文言が検索ノイズになるため、先に除去する
  let text = html.replace(/<button\b[^>]*\bdata-code-copy\b[^>]*>[\s\S]*?<\/button>/gi, " ");
  // タグを除去する
  text = text.replace(/<[^>]+>/g, " ");
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

/**
 * 変換後HTMLからid属性値を収集する
 */
function collectHtmlIds(html: string): string[]
{
  const ids: string[] = [];
  // 見出し・生HTMLどちらも id="..." / id='...' を拾う
  const re = /\sid=["']([^"']+)["']/gi;
  let match = re.exec(html);
  while (match !== null) {
    const id = match[1];
    if (id !== undefined && id.length > 0) {
      ids.push(id);
    }
    match = re.exec(html);
  }
  return ids;
}
