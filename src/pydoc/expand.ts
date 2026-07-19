import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import type { Heading } from "../types.js";
import { findPydocDirectives } from "./directive.js";
import { parsePythonModule } from "./parser.js";
import { renderModuleDoc, renderSyntaxError } from "./render.js";
import { resolvePythonModule } from "./resolve.js";
import type { PythonParser } from "./tree-sitter.js";

/** expand の戻り値 */
export interface ExpandPydocResult {
  markdown: string;
  extraHeadings: Heading[];
}

/**
 * Markdown内の ::: pydoc を展開し、extraHeadings も返す
 */
export function expandPydocDirectives(
  markdown: string,
  config: ResolvedConfig,
  logger: Logger,
  pythonParser: PythonParser
): ExpandPydocResult
{
  const directives = findPydocDirectives(markdown);
  if (directives.length === 0) {
    return { markdown, extraHeadings: [] };
  }

  // source_dirs を設定ファイル基準の絶対パスへ解決する
  const sourceDirsAbs = config.pydoc.source_dirs.map((dir) =>
    path.isAbsolute(dir) ? dir : path.resolve(config.configDir, dir)
  );

  // 後ろから置換してオフセットがずれないようにする
  let result = markdown;
  const extraHeadings: Heading[] = [];
  for (let i = directives.length - 1; i >= 0; i--) {
    const directive = directives[i]!;
    // モジュール解決失敗は resolvePythonModule が ModuleResolveError を投げる
    const filePath = resolvePythonModule(directive.modulePath, sourceDirsAbs);
    const source = fs.readFileSync(filePath, "utf-8");
    const parsed = parsePythonModule(source, directive.modulePath, pythonParser);
    let replacement: string;
    if (!parsed.ok) {
      // 構文エラーは警告してページ上にエラー表示する（strictは警告数で判定）
      logger.warn(`${parsed.message} (${filePath})`);
      const rendered = renderSyntaxError(directive.modulePath, parsed.message);
      replacement = rendered.markdown;
      // 後ろから処理しているため、見出しは前方へ積む
      extraHeadings.unshift(...rendered.extraHeadings);
    } else {
      const rendered = renderModuleDoc(parsed.module, directive.options);
      replacement = rendered.markdown;
      extraHeadings.unshift(...rendered.extraHeadings);
    }

    result = result.slice(0, directive.start) + replacement + result.slice(directive.end);
  }

  return { markdown: result, extraHeadings };
}

/**
 * convert 後の headings / anchorIds / html に pydoc の仕様アンカーをマージする
 */
export function mergePydocHeadings(
  html: string,
  headings: Heading[],
  anchorIds: string[],
  extraHeadings: Heading[]
): { html: string; headings: Heading[]; anchorIds: string[] }
{
  if (extraHeadings.length === 0) {
    return { html, headings, anchorIds };
  }

  let nextHtml = html;
  const nextHeadings = headings.map((h) => ({ ...h }));
  const nextAnchorIds = [...anchorIds];
  // 同一テキスト・レベルの見出しを出現順に対応付ける
  const used = new Set<number>();

  for (const extra of extraHeadings) {
    // 目次対象外の h1 も HTML 上の id 置換対象になり得るが、convert は h1 を headings に入れない
    // そのため headings マッチに加え、HTML の id を直接書き換える
    let matchedIndex = -1;
    for (let i = 0; i < nextHeadings.length; i++) {
      if (used.has(i)) {
        continue;
      }
      const heading = nextHeadings[i]!;
      if (heading.text === extra.text && heading.level === extra.level) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex >= 0) {
      const oldId = nextHeadings[matchedIndex]!.anchorId;
      nextHeadings[matchedIndex] = {
        ...nextHeadings[matchedIndex]!,
        anchorId: extra.anchorId
      };
      used.add(matchedIndex);
      // 本文HTMLの id も仕様どおりに差し替える（目次クリックとページ内リンクのため）
      nextHtml = replaceHeadingId(nextHtml, oldId, extra.anchorId);
      // anchorIds の旧IDを新IDへ置換（無ければ追加）
      const oldPos = nextAnchorIds.indexOf(oldId);
      if (oldPos >= 0) {
        nextAnchorIds[oldPos] = extra.anchorId;
      } else if (!nextAnchorIds.includes(extra.anchorId)) {
        nextAnchorIds.push(extra.anchorId);
      }
    } else if (!nextAnchorIds.includes(extra.anchorId)) {
      // 見出しマッチできなくてもリンク検証用に仕様IDは残す
      nextAnchorIds.push(extra.anchorId);
    }
  }

  return { html: nextHtml, headings: nextHeadings, anchorIds: nextAnchorIds };
}

/**
 * HTML内の最初の id="oldId" を新IDへ置換する
 */
function replaceHeadingId(html: string, oldId: string, newId: string): string
{
  // 属性値の完全一致だけを1回置換する（他要素の誤爆を避ける）
  const pattern = new RegExp(`id="${escapeRegExp(oldId)}"`, "u");
  return html.replace(pattern, `id="${newId}"`);
}

/**
 * 正規表現用に特殊文字をエスケープする
 */
function escapeRegExp(value: string): string
{
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
