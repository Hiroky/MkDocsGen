import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import type { Heading } from "../types.js";
import { findPydocDirectives, normalizePydocNewlines } from "./directive.js";
import { parsePythonModule } from "./parser.js";
import { renderModuleDoc, renderSyntaxError } from "./render.js";
import { resolvePythonModules } from "./resolve.js";
import type { PythonParser } from "./tree-sitter.js";

/** expand の戻り値 */
export interface ExpandPydocResult {
  markdown: string;
  extraHeadings: Heading[];
  /** ::: pydoc を1つ以上含んでいたか */
  hasPydoc: boolean;
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
  const normalizedMarkdown = normalizePydocNewlines(markdown);
  const directives = findPydocDirectives(normalizedMarkdown);
  if (directives.length === 0) {
    return { markdown, extraHeadings: [], hasPydoc: false };
  }

  // source_dirs を設定ファイル基準の絶対パスへ解決する
  const sourceDirsAbs = config.pydoc.source_dirs.map((dir) =>
    path.isAbsolute(dir) ? dir : path.resolve(config.configDir, dir)
  );

  // 後ろから置換してオフセットがずれないようにする
  let result = normalizedMarkdown;
  const extraHeadings: Heading[] = [];
  for (let i = directives.length - 1; i >= 0; i--) {
    const directive = directives[i]!;
    // モジュール指定なら1件、パッケージ指定なら配下を再帰的に解決する
    const modules = resolvePythonModules(directive.modulePath, sourceDirsAbs);
    const replacements: string[] = [];
    const directiveHeadings: Heading[] = [];
    for (const module of modules) {
      const source = fs.readFileSync(module.filePath, "utf-8");
      const parsed = parsePythonModule(source, module.modulePath, pythonParser);
      if (!parsed.ok) {
        // 構文エラーは警告してページ上にエラー表示する（strictは警告数で判定）
        logger.warn(`${parsed.message} (${module.filePath})`);
        const rendered = renderSyntaxError(module.modulePath, parsed.message);
        replacements.push(rendered.markdown);
        directiveHeadings.push(...rendered.extraHeadings);
        continue;
      }

      const rendered = renderModuleDoc(parsed.module, directive.options);
      replacements.push(rendered.markdown);
      directiveHeadings.push(...rendered.extraHeadings);
    }

    const replacement = replacements.join("\n");
    // 後ろから処理しているため、見出しは前方へ積む
    extraHeadings.unshift(...directiveHeadings);
    result = result.slice(0, directive.start) + replacement + result.slice(directive.end);
  }

  return { markdown: result, extraHeadings, hasPydoc: true };
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
    // 同一テキスト・レベルの見出しを出現順に対応付ける
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

    // レベル不一致（クランプ前後など）でもテキスト一致でフォールバックする
    if (matchedIndex < 0) {
      for (let i = 0; i < nextHeadings.length; i++) {
        if (used.has(i)) {
          continue;
        }
        if (nextHeadings[i]!.text === extra.text) {
          matchedIndex = i;
          break;
        }
      }
    }

    if (matchedIndex >= 0) {
      const oldId = nextHeadings[matchedIndex]!.anchorId;
      const mergedHeading: Heading = {
        ...nextHeadings[matchedIndex]!,
        anchorId: extra.anchorId
      };
      if (extra.tocText !== undefined) {
        mergedHeading.tocText = extra.tocText;
      }
      nextHeadings[matchedIndex] = mergedHeading;
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
    } else {
      // headings 配列に無い場合（h1 など）でも、同名見出しの id を仕様IDへ差し替える
      const replaced = replaceHeadingIdByText(nextHtml, extra.text, extra.anchorId);
      if (replaced !== null) {
        nextHtml = replaced.html;
        // 旧slugを検証一覧から落とし、仕様IDへ置き換える
        if (replaced.oldId) {
          const oldPos = nextAnchorIds.indexOf(replaced.oldId);
          if (oldPos >= 0) {
            nextAnchorIds[oldPos] = extra.anchorId;
          } else if (!nextAnchorIds.includes(extra.anchorId)) {
            nextAnchorIds.push(extra.anchorId);
          }
        } else if (!nextAnchorIds.includes(extra.anchorId)) {
          nextAnchorIds.push(extra.anchorId);
        }
      } else if (!htmlHasId(nextHtml, extra.anchorId)) {
        // どうしても見つからないときだけ空アンカーを末尾に足す
        nextHtml += `\n<a id="${escapeHtmlAttr(extra.anchorId)}"></a>\n`;
        if (!nextAnchorIds.includes(extra.anchorId)) {
          nextAnchorIds.push(extra.anchorId);
        }
      } else if (!nextAnchorIds.includes(extra.anchorId)) {
        nextAnchorIds.push(extra.anchorId);
      }
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
  return html.replace(pattern, `id="${escapeHtmlAttr(newId)}"`);
}

/**
 * 見出しテキストが一致する最初の h1〜h6 の id を仕様IDへ差し替える
 */
function replaceHeadingIdByText(
  html: string,
  text: string,
  newId: string
): { html: string; oldId: string | null } | null
{
  // convert が h1 を headings に入れないケースでも実アンカーを直す
  const pattern = new RegExp(
    `<(h[1-6])(\\s[^>]*)?>${escapeRegExp(text)}</\\1>`,
    "u"
  );
  const match = pattern.exec(html);
  if (!match) {
    return null;
  }
  const tag = match[1]!;
  const attrs = match[2] ?? "";
  const safeId = escapeHtmlAttr(newId);
  const oldIdMatch = attrs.match(/\sid="([^"]*)"/u);
  const oldId = oldIdMatch?.[1] ?? null;
  let nextAttrs: string;
  if (oldIdMatch) {
    // 既存 id を上書きする
    nextAttrs = attrs.replace(/\sid="[^"]*"/u, ` id="${safeId}"`);
  } else {
    nextAttrs = `${attrs} id="${safeId}"`;
  }
  const replacement = `<${tag}${nextAttrs}>${text}</${tag}>`;
  return {
    html: html.slice(0, match.index) + replacement + html.slice(match.index + match[0].length),
    oldId
  };
}

/**
 * HTMLに指定 id が既にあるか判定する
 */
function htmlHasId(html: string, id: string): boolean
{
  return new RegExp(`id="${escapeRegExp(id)}"`, "u").test(html);
}

/**
 * HTML属性値用に最低限エスケープする
 */
function escapeHtmlAttr(value: string): string
{
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * 正規表現用に特殊文字をエスケープする
 */
function escapeRegExp(value: string): string
{
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
