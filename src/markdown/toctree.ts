/**
 * Sphinx風 ::: toctree ディレクティブの検出・プレースホルダ置換・HTML解決
 */
import path from "node:path";
import type { Logger } from "../logger.js";
import type { Heading, NavNode, Page } from "../types.js";

/** toctreeディレクティブのオプション */
export interface ToctreeOptions {
  /** 最大深さ。nullは無制限 */
  maxdepth: number | null;
  /** 一覧上のキャプション。nullは非表示 */
  caption: string | null;
  /** trueならページ／セクションタイトルのみ（見出しを出さない） */
  titlesonly: boolean;
}

/** 1ページ内のtoctree1件分のメタ */
export interface ToctreeMeta {
  /** プレースホルダ番号（@@MKDOCSGEN_TOCTREE_N@@ の N） */
  index: number;
  options: ToctreeOptions;
}

/** パース結果（Markdown上の範囲付き） */
export interface ToctreeDirective {
  options: ToctreeOptions;
  start: number;
  end: number;
}

/** プレースホルダ置換の戻り値 */
export interface ExtractToctreeResult {
  markdown: string;
  toctrees: ToctreeMeta[];
}

/** デフォルトオプション */
const DEFAULT_OPTIONS: ToctreeOptions = {
  maxdepth: null,
  caption: null,
  titlesonly: false
};

/** convert後HTML内のプレースホルダ（段落ラップ含む） */
export const TOCTREE_PLACEHOLDER_RE = /(?:<p>\s*)?@@MKDOCSGEN_TOCTREE_(\d+)@@(?:\s*<\/p>)?/g;

/**
 * Markdown全文から ::: toctree ディレクティブをすべて見つける
 */
export function findToctreeDirectives(markdown: string): ToctreeDirective[]
{
  const directives: ToctreeDirective[] = [];
  const lines = markdown.split("\n");
  // 各行の開始文字オフセットを事前計算する（置換範囲の算出に使う）
  const lineStarts: number[] = [];
  let running = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(running);
    running += lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
  }

  // コードフェンス内の ::: toctree はドキュメント例なので検出しない
  let openFence: { marker: string; length: number } | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (openFence !== null) {
      // 開いているフェンスの閉じ行ならフェンス外へ戻る
      if (isFenceClose(trimmed, openFence.marker, openFence.length)) {
        openFence = null;
      }
      i += 1;
      continue;
    }

    // フェンス開始行なら、閉じるまで ::: toctree を見ない
    const fenceOpen = matchFenceOpen(trimmed);
    if (fenceOpen !== null) {
      openFence = fenceOpen;
      i += 1;
      continue;
    }

    // 行頭が ::: toctree のときだけ対象（後ろに余計な語があれば対象外）
    if (!/^:::[\t ]+toctree[\t ]*$/.test(line)) {
      i += 1;
      continue;
    }

    const start = lineStarts[i]!;
    const optionLines: string[] = [];
    let endLine = i;

    // 閉じ ::: までをオプション行として取り込む
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (/^:::[\t ]*$/.test(next)) {
        endLine = j;
        j += 1;
        break;
      }
      // key: value 形式の行だけをオプションとする（インデント可）
      if (/^[ \t]*[\w-]+:/.test(next)) {
        optionLines.push(next);
        endLine = j;
        j += 1;
        continue;
      }
      // 空行はスキップして続行する（閉じ前の余白を許容）
      if (next.trim().length === 0) {
        endLine = j;
        j += 1;
        continue;
      }
      // 想定外の行が来たら閉じ無し扱いで打ち切る
      break;
    }

    // end は endLine の行末（最終行でなければ改行も含む）
    const end = endLine < lines.length - 1
      ? lineStarts[endLine]! + lines[endLine]!.length + 1
      : lineStarts[endLine]! + lines[endLine]!.length;

    directives.push({
      options: parseOptions(optionLines),
      start,
      end
    });

    // 消費した行の次から再開する
    i = endLine + 1;
  }

  return directives;
}

/**
 * ::: toctree をプレースホルダ行へ置換し、メタ配列を返す
 */
export function extractToctreePlaceholders(markdown: string): ExtractToctreeResult
{
  const directives = findToctreeDirectives(markdown);
  if (directives.length === 0) {
    return { markdown, toctrees: [] };
  }

  // 後ろから置換してオフセットがずれないようにする
  let result = markdown;
  const toctrees: ToctreeMeta[] = [];
  for (let i = directives.length - 1; i >= 0; i--) {
    const directive = directives[i]!;
    const placeholder = `@@MKDOCSGEN_TOCTREE_${i}@@`;
    result = result.slice(0, directive.start) + placeholder + result.slice(directive.end);
    // 後ろから処理しているため前方へ積む
    toctrees.unshift({ index: i, options: directive.options });
  }

  return { markdown: result, toctrees };
}

/**
 * 現在ページのtoctree列挙ルート（ナビ子）を求める
 */
export function findToctreeRootNodes(page: Page, nav: NavNode[]): NavNode[]
{
  const found = findNavNodeByUrl(nav, page.outputPath);
  if (found !== null && found.children.length > 0) {
    // セクションindexなど、子を持つノードはそのchildrenを列挙する
    return found.children;
  }

  // サイト直下indexは自身のchildrenが空なので、ルートnavから自分以外を取る
  if (page.sourcePath === "index.md") {
    return nav.filter((node) => node.url !== page.outputPath);
  }

  // 葉ページ等は列挙対象なし
  return [];
}

/**
 * ナビサブツリーに含まれる全urlを集める（増分ビルドの依存判定用）
 */
export function collectToctreeDescendantUrls(roots: NavNode[]): Set<string>
{
  const urls = new Set<string>();
  collectUrlsRecursive(roots, urls);
  return urls;
}

/**
 * プレースホルダをtoctree HTMLへ解決する
 */
export function resolveToctreePlaceholders(
  contentHtml: string,
  page: Page,
  nav: NavNode[],
  pages: Page[],
  logger: Logger
): string
{
  if (page.toctrees.length === 0) {
    return contentHtml;
  }

  // 出力パス→Pageの辞書を1回だけ作る
  const pagesByUrl = new Map<string, Page>();
  for (const p of pages) {
    pagesByUrl.set(p.outputPath, p);
  }

  const byIndex = new Map(page.toctrees.map((meta) => [meta.index, meta]));

  return contentHtml.replace(TOCTREE_PLACEHOLDER_RE, (_match, indexText: string) => {
    const index = Number.parseInt(indexText, 10);
    const meta = byIndex.get(index);
    if (meta === undefined) {
      // メタが無いプレースホルダは痕跡を残さない
      return "";
    }

    const roots = findToctreeRootNodes(page, nav);
    if (roots.length === 0) {
      // 葉ページ等で子が無い場合は警告して空にする
      logger.warn(`toctree: 列挙対象の子ページがありません (${page.sourcePath})`);
      return "";
    }

    return renderToctreeHtml(roots, meta.options, page.outputPath, pagesByUrl);
  });
}

/**
 * toctreeを持つページが、変更された出力パスのいずれかに依存するかを判定する
 */
export function toctreeDependsOnChangedUrls(page: Page, nav: NavNode[], changedUrls: Set<string>): boolean
{
  if (page.toctrees.length === 0 || changedUrls.size === 0) {
    return false;
  }
  const roots = findToctreeRootNodes(page, nav);
  const deps = collectToctreeDescendantUrls(roots);
  for (const url of changedUrls) {
    if (deps.has(url)) {
      return true;
    }
  }
  return false;
}

/**
 * プレースホルダ解決済みのPageコピーを作る（検索・書き出し用。元のPageはプレースホルダのまま）
 */
export function resolvePageToctrees(page: Page, nav: NavNode[], pages: Page[], logger: Logger): Page
{
  if (page.toctrees.length === 0) {
    return page;
  }
  const contentHtml = resolveToctreePlaceholders(page.contentHtml, page, nav, pages, logger);
  // 検索用テキストも解決後HTMLから取り直す
  const plainText = htmlToPlainText(contentHtml);
  return { ...page, contentHtml, plainText };
}

/**
 * ナビノード配列からtoctree HTMLを組み立てる
 */
function renderToctreeHtml(
  roots: NavNode[],
  options: ToctreeOptions,
  fromOutputPath: string,
  pagesByUrl: Map<string, Page>
): string
{
  const list = renderNavNodes(roots, options.maxdepth, options.titlesonly, fromOutputPath, pagesByUrl);
  if (list.length === 0) {
    return "";
  }

  const aria = options.caption ?? "目次";
  const captionHtml = options.caption !== null
    ? `<p class="toctree-caption">${escapeHtml(options.caption)}</p>\n`
    : "";
  return `<nav class="toctree" aria-label="${escapeHtml(aria)}">\n${captionHtml}${list}</nav>\n`;
}

/**
 * ナビノード列を深さ制限付きで<ul>化する
 */
function renderNavNodes(
  nodes: NavNode[],
  depthLeft: number | null,
  titlesonly: boolean,
  fromOutputPath: string,
  pagesByUrl: Map<string, Page>
): string
{
  // depthLeft === 0 はこれ以上出さない（呼び出し側で弾くが防御的に）
  if (depthLeft === 0 || nodes.length === 0) {
    return "";
  }

  const items: string[] = [];
  for (const node of nodes) {
    // このノード自体が深さ1を消費する
    const nextDepth = depthLeft === null ? null : depthLeft - 1;
    const label = escapeHtml(node.title);
    let titleHtml: string;
    if (node.url !== null) {
      const href = escapeHtml(relativeHref(fromOutputPath, node.url));
      titleHtml = `<a href="${href}">${label}</a>`;
    } else {
      // indexの無いセクションはリンクなしテキスト
      titleHtml = `<span class="toctree-section">${label}</span>`;
    }

    // 残り深さがあるときだけネストを掘る
    let nested = "";
    if (nextDepth === null || nextDepth > 0) {
      if (node.children.length > 0) {
        // セクションはナビ子のみ掘る（index本文見出しは出さない）
        nested = renderNavNodes(node.children, nextDepth, titlesonly, fromOutputPath, pagesByUrl);
      } else if (!titlesonly && node.url !== null) {
        // 葉ページは見出しを残り深さだけ出す
        const target = pagesByUrl.get(node.url);
        if (target !== undefined) {
          nested = renderHeadings(target.headings, nextDepth, fromOutputPath, node.url);
        }
      }
    }

    items.push(`<li class="toctree-item">${titleHtml}${nested}</li>`);
  }

  return `<ul class="toctree-list">${items.join("")}</ul>`;
}

/**
 * ページ見出しを相対深さ制限付きで<ul>化する（h2=相対1）
 */
function renderHeadings(
  headings: Heading[],
  depthLeft: number | null,
  fromOutputPath: string,
  pageUrl: string
): string
{
  const items: string[] = [];
  for (const heading of headings) {
    // h2 → 相対深さ1、h3 → 2、…
    const rel = heading.level - 1;
    if (depthLeft !== null && rel > depthLeft) {
      continue;
    }
    const href = escapeHtml(relativeHref(fromOutputPath, pageUrl) + "#" + heading.anchorId);
    items.push(
      `<li class="toctree-item toctree-item--heading toctree-item--level-${heading.level}">` +
      `<a href="${href}">${escapeHtml(heading.text)}</a></li>`
    );
  }
  if (items.length === 0) {
    return "";
  }
  return `<ul class="toctree-list">${items.join("")}</ul>`;
}

/**
 * url一致のNavNodeを深さ優先で探す
 */
function findNavNodeByUrl(nodes: NavNode[], url: string): NavNode | null
{
  for (const node of nodes) {
    if (node.url === url) {
      return node;
    }
    const nested = findNavNodeByUrl(node.children, url);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

/**
 * ノード列のurlを再帰的にSetへ追加する
 */
function collectUrlsRecursive(nodes: NavNode[], urls: Set<string>): void
{
  for (const node of nodes) {
    if (node.url !== null) {
      urls.add(node.url);
    }
    collectUrlsRecursive(node.children, urls);
  }
}

/**
 * fromページからtoページへの相対hrefを作る
 */
function relativeHref(fromOutputPath: string, toOutputPath: string): string
{
  // path.posix.relative はディレクトリ基準なので、fromの親ディレクトリを基準にする
  const fromDir = path.posix.dirname(fromOutputPath);
  let rel = path.posix.relative(fromDir === "." ? "" : fromDir, toOutputPath);
  // 同ディレクトリは "setup.html" のようにそのまま
  if (rel.length === 0) {
    rel = path.posix.basename(toOutputPath);
  }
  return rel;
}

/**
 * インデント行のオプションを構造化する
 */
function parseOptions(optionLines: string[]): ToctreeOptions
{
  const options: ToctreeOptions = { ...DEFAULT_OPTIONS };

  for (const rawLine of optionLines) {
    // 行末コメントを落とし、インデントも除去する
    const line = rawLine.replace(/[ \t]+#.*$/, "").trim();
    const match = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1]!;
    const value = match[2]!.trim();

    if (key === "maxdepth") {
      const depth = Number.parseInt(value, 10);
      // 正の整数のみ採用（不正値はデフォルト維持）
      if (Number.isFinite(depth) && depth >= 1) {
        options.maxdepth = depth;
      }
    } else if (key === "caption") {
      options.caption = value.length > 0 ? value : null;
    } else if (key === "titlesonly") {
      options.titlesonly = value.toLowerCase() === "true";
    }
  }

  return options;
}

/**
 * コードフェンス開始行ならマーカー文字と長さを返す
 */
function matchFenceOpen(line: string): { marker: string; length: number } | null
{
  const match = line.match(/^(`{3,}|~{3,})/);
  if (!match) {
    return null;
  }
  const fence = match[1]!;
  return { marker: fence[0]!, length: fence.length };
}

/**
 * 開いているフェンスに対応する閉じ行かどうかを判定する
 */
function isFenceClose(line: string, marker: string, minLength: number): boolean
{
  const re = marker === "`"
    ? new RegExp(`^\`{${minLength},}\\s*$`)
    : new RegExp(`^~{${minLength},}\\s*$`);
  return re.test(line);
}

/**
 * HTML特殊文字をエスケープする
 */
function escapeHtml(text: string): string
{
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTMLから検索用プレーンテキストを抽出する（convert.tsと同方針）
 */
function htmlToPlainText(html: string): string
{
  let text = html.replace(/<button\b[^>]*\bdata-code-copy\b[^>]*>[\s\S]*?<\/button>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim();
}
