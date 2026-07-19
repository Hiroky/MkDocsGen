import path from "node:path";
import type { Logger } from "../logger.js";
import type { Page } from "../types.js";

/**
 * 全ページの内部リンク（相対ページリンク・アンカー）を検証し、切れがあれば警告する
 */
export function validateLinks(pages: Page[], logger: Logger): void
{
  // sourcePath（posix正規化）からPageを引けるようにする
  const bySource = new Map<string, Page>();
  for (const page of pages) {
    bySource.set(normalizeSourcePath(page.sourcePath), page);
  }

  for (const page of pages) {
    for (const href of page.links) {
      // 外部・絶対・非ページは仕様どおり検証しない
      if (!isValidatableInternalLink(href)) {
        continue;
      }

      // 相対パスとアンカーを、リンク元ページ基準で解決する
      const resolved = resolveInternalLink(page.sourcePath, href);
      if (resolved === null) {
        continue;
      }

      const target = bySource.get(resolved.targetPath);
      if (target === undefined) {
        // リンク先ページが存在しない
        logger.warn(`リンク切れ: ${page.sourcePath} -> ${href}`);
        continue;
      }

      // 空アンカー（#のみ）はページ先頭として有効
      if (resolved.anchor.length === 0) {
        continue;
      }

      // 見出しid（h1含む）に含まれなければアンカー切れ
      if (!target.anchorIds.includes(resolved.anchor)) {
        logger.warn(`アンカー切れ: ${page.sourcePath} -> ${href}`);
      }
    }
  }
}

/**
 * 検証対象の内部リンクかどうかを判定する
 */
function isValidatableInternalLink(href: string): boolean
{
  // プロトコル付き（http / mailto 等）は対象外
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return false;
  }
  // プロトコル相対・サイト絶対は対象外
  if (href.startsWith("//") || href.startsWith("/")) {
    return false;
  }
  // 同ページアンカー（#...）は検証対象
  if (href.startsWith("#")) {
    return true;
  }

  // パス部分を取り出し、ページリンク（.md / .html）だけを対象にする
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  return pathPart.endsWith(".md") || pathPart.endsWith(".html");
}

/**
 * リンク元sourcePath基準で、検証用のターゲットパスとアンカーを解決する
 */
function resolveInternalLink(sourcePath: string, href: string): { targetPath: string; anchor: string } | null
{
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  // #のみ / #anchor / path#anchor のアンカー部分（#自体は含めない）
  const anchor = hashIndex === -1 ? "" : href.slice(hashIndex + 1);

  // 同ページアンカーのみの場合はリンク元自身がターゲット
  if (pathPart.length === 0) {
    return {
      targetPath: normalizeSourcePath(sourcePath),
      anchor
    };
  }

  // リンク元ディレクトリからの相対パスを posix で解決する
  const sourceDir = path.posix.dirname(normalizeSourcePath(sourcePath));
  const joined = path.posix.normalize(path.posix.join(sourceDir, pathPart));
  // docs外へはみ出した相対パスはリンク切れとして扱うため、正規化したパスを返す
  const asMarkdown = joined.endsWith(".html") ? joined.replace(/\.html$/, ".md") : joined;
  return {
    targetPath: normalizeSourcePath(asMarkdown),
    anchor
  };
}

/**
 * sourcePathを比較用に正規化する（バックスラッシュをposixへ）
 */
function normalizeSourcePath(sourcePath: string): string
{
  return sourcePath.split(path.sep).join("/");
}
