/**
 * Sphinx風 ::: toctree ディレクティブの検出・プレースホルダ置換・HTML解決
 */
import path from "node:path";
import { Logger } from "../logger.js";
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

/** 明示列挙1件。pathはパース時点の生文字列 */
export interface ToctreeEntry {
  path: string;
  /** Title <path> の表示名。無しはnull */
  title: string | null;
}

/** 1ページ内のtoctree1件分のメタ */
export interface ToctreeMeta {
  /** プレースホルダ番号（@@MKDOCSGEN_TOCTREE_N@@ の N） */
  index: number;
  options: ToctreeOptions;
  /** 空配列なら現在ページのナビ子を自動列挙する */
  entries: ToctreeEntry[];
}

/** パース結果（Markdown上の範囲付き） */
export interface ToctreeDirective {
  options: ToctreeOptions;
  entries: ToctreeEntry[];
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
 * CRLF/CRをLFへ正規化する（行末\\rがディレクティブ検出を壊さないようにする）
 */
function normalizeNewlines(markdown: string): string
{
  // 先に\\r\\nを潰し、残った単独\\rもLFにする
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Markdown全文から ::: toctree ディレクティブをすべて見つける
 *
 * 返却する start/end は改行正規化後の文字列に対するオフセットである
 */
export function findToctreeDirectives(markdown: string): ToctreeDirective[]
{
  // Windows等のCRLFでも行末\\rが正規表現に残らないよう先に正規化する
  const source = normalizeNewlines(markdown);
  const directives: ToctreeDirective[] = [];
  const lines = source.split("\n");
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
    const entryLines: string[] = [];
    let endLine = i;
    // 一度エントリ行を見たら以降はオプションに戻さない（Sphinx同様オプションは先）
    let entriesStarted = false;

    // 閉じ ::: までをオプション／エントリ行として取り込む
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (/^:::[\t ]*$/.test(next)) {
        endLine = j;
        j += 1;
        break;
      }
      // 空行はスキップして続行する（閉じ前の余白を許容）
      if (next.trim().length === 0) {
        endLine = j;
        j += 1;
        continue;
      }
      // エントリ開始前の key: value だけをオプションとする（インデント可）
      if (!entriesStarted && /^[ \t]*[\w-]+:/.test(next)) {
        optionLines.push(next);
        endLine = j;
        j += 1;
        continue;
      }
      // それ以外は明示エントリ行
      entriesStarted = true;
      entryLines.push(next);
      endLine = j;
      j += 1;
    }

    // end は endLine の行末（最終行でなければ改行も含む）
    const end = endLine < lines.length - 1
      ? lineStarts[endLine]! + lines[endLine]!.length + 1
      : lineStarts[endLine]! + lines[endLine]!.length;

    directives.push({
      options: parseOptions(optionLines),
      entries: parseEntries(entryLines),
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
  // find側と同じ正規化済み文字列で置換し、オフセットがずれないようにする
  const source = normalizeNewlines(markdown);
  const directives = findToctreeDirectives(source);
  if (directives.length === 0) {
    return { markdown: source, toctrees: [] };
  }

  // 後ろから置換してオフセットがずれないようにする
  let result = source;
  const toctrees: ToctreeMeta[] = [];
  for (let i = directives.length - 1; i >= 0; i--) {
    const directive = directives[i]!;
    const placeholder = `@@MKDOCSGEN_TOCTREE_${i}@@`;
    result = result.slice(0, directive.start) + placeholder + result.slice(directive.end);
    // 後ろから処理しているため前方へ積む
    toctrees.unshift({ index: i, options: directive.options, entries: directive.entries });
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
  const pagesBySource = new Map<string, Page>();
  for (const p of pages) {
    pagesByUrl.set(p.outputPath, p);
    pagesBySource.set(p.sourcePath, p);
  }

  const byIndex = new Map(page.toctrees.map((meta) => [meta.index, meta]));

  return contentHtml.replace(TOCTREE_PLACEHOLDER_RE, (_match, indexText: string) => {
    const index = Number.parseInt(indexText, 10);
    const meta = byIndex.get(index);
    if (meta === undefined) {
      // メタが無いプレースホルダは痕跡を残さない
      return "";
    }

    // 明示エントリがあればそれを使い、空ならナビ子の自動列挙にフォールバックする
    const roots = meta.entries.length > 0
      ? resolveEntriesToNavNodes(meta.entries, page, nav, pagesBySource, logger)
      : findToctreeRootNodes(page, nav);
    if (roots.length === 0) {
      // 葉ページ等で子が無い場合／全エントリ解決失敗は警告して空にする
      logger.warn(`toctree: 列挙対象の子ページがありません (${page.sourcePath})`);
      return "";
    }

    return renderToctreeHtml(roots, meta.options, page.outputPath, pagesByUrl);
  });
}

/**
 * toctreeを持つページが、変更された出力パスのいずれかに依存するかを判定する
 */
export function toctreeDependsOnChangedUrls(
  page: Page,
  nav: NavNode[],
  changedUrls: Set<string>,
  pages: Page[]
): boolean
{
  if (page.toctrees.length === 0 || changedUrls.size === 0) {
    return false;
  }

  // 依存判定では警告を出さない（再ビルド判定の副作用を避ける）
  const silentLogger = new Logger(false, { stdout: () => {}, stderr: () => {} });
  const pagesBySource = new Map(pages.map((p) => [p.sourcePath, p]));
  const deps = new Set<string>();

  for (const meta of page.toctrees) {
    const roots = meta.entries.length > 0
      ? resolveEntriesToNavNodes(meta.entries, page, nav, pagesBySource, silentLogger)
      : findToctreeRootNodes(page, nav);
    collectUrlsRecursive(roots, deps);
  }

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
 * エントリ行を ToctreeEntry 配列へ変換する
 */
function parseEntries(entryLines: string[]): ToctreeEntry[]
{
  const entries: ToctreeEntry[] = [];
  for (const rawLine of entryLines) {
    // 行末コメントを落とし、インデントも除去する
    const line = rawLine.replace(/[ \t]+#.*$/, "").trim();
    if (line.length === 0) {
      continue;
    }
    // Sphinx風 Title <path>。パス側が空ならタイトル無し扱いへフォールバックする
    const titled = line.match(/^(.+?)\s*<([^<>]+)>\s*$/);
    if (titled !== null) {
      const title = titled[1]!.trim();
      const entryPath = titled[2]!.trim();
      if (entryPath.length > 0) {
        entries.push({ path: entryPath, title: title.length > 0 ? title : null });
        continue;
      }
    }
    entries.push({ path: line, title: null });
  }
  return entries;
}

/**
 * エントリの生パスを docs 相対の sourcePath（.md）へ正規化する。不正ならnull
 */
function normalizeToctreePath(raw: string): string | null
{
  // 区切りをPOSIXに揃え、先頭の ./ を落とす
  let normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.length === 0) {
    return null;
  }
  // docs外への脱出や絶対パスは拒否する
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../") || normalized === ".." || normalized.endsWith("/..")) {
    return null;
  }
  // .html指定は.mdへ、拡張子無しは.mdを付与する
  if (normalized.endsWith(".html")) {
    normalized = normalized.slice(0, -5) + ".md";
  } else if (!normalized.endsWith(".md")) {
    normalized = normalized + ".md";
  }
  return normalized;
}

/**
 * 明示エントリをナビノード列へ解決する（列挙順を維持）
 */
function resolveEntriesToNavNodes(
  entries: ToctreeEntry[],
  page: Page,
  nav: NavNode[],
  pagesBySource: Map<string, Page>,
  logger: Logger
): NavNode[]
{
  const roots: NavNode[] = [];
  for (const entry of entries) {
    const sourcePath = normalizeToctreePath(entry.path);
    if (sourcePath === null) {
      logger.warn(`toctree: 不正なエントリパスです (${page.sourcePath}): ${entry.path}`);
      continue;
    }
    const target = pagesBySource.get(sourcePath);
    if (target === undefined) {
      logger.warn(`toctree: エントリ先ページが見つかりません (${page.sourcePath}): ${entry.path}`);
      continue;
    }
    // ナビにあれば子付きノードを使い、無ければ葉として合成する
    const fromNav = findNavNodeByUrl(nav, target.outputPath);
    let node: NavNode = fromNav !== null
      ? fromNav
      : { title: target.title, url: target.outputPath, children: [] };
    // タイトル上書きは子を維持したまま差し替える
    if (entry.title !== null) {
      node = { ...node, title: entry.title };
    }
    roots.push(node);
  }
  return roots;
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
