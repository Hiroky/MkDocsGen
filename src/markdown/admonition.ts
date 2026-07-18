import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type { Logger } from "../logger.js";

/** 仕様で定義されたAdmonitionタイプ */
export const ADMONITION_TYPES = ["note", "tip", "warning", "danger", "info"] as const;

/** Admonitionタイプのユニオン */
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

/** プラグインへ渡すオプション */
export interface AdmonitionPluginOptions {
  logger: Logger;
}

/**
 * 既知のAdmonitionタイプかどうかを判定する
 */
export function isAdmonitionType(value: string): value is AdmonitionType
{
  return (ADMONITION_TYPES as readonly string[]).includes(value);
}

/**
 * ::: type [title] ... ::: 形式の注記ブロックを変換するプラグイン
 */
export function admonitionPlugin(md: MarkdownIt, options: AdmonitionPluginOptions): void
{
  // ブロックルールとして登録し、フェンスより前に評価できるようにする
  md.block.ruler.before("fence", "admonition", (state, startLine, endLine, silent) => {
    return parseAdmonition(state, startLine, endLine, silent, options.logger);
  });

  // 開始・終了トークンのHTML描画を登録する
  md.renderer.rules.admonition_open = (tokens, idx) => {
    const token = tokens[idx]!;
    const type = token.attrGet("data-type") ?? "note";
    const title = token.attrGet("data-title") ?? type.toUpperCase();
    // asideで意味的に補足情報であることを示し、タイプ別クラスでスタイルを分ける
    return `<aside class="admonition admonition-${type}"><p class="admonition-title">${md.utils.escapeHtml(title)}</p><div class="admonition-body">\n`;
  };

  md.renderer.rules.admonition_close = () => {
    return "</div></aside>\n";
  };
}

/**
 * 1つのAdmonitionブロックをパースしてトークン列へ変換する
 */
function parseAdmonition(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
  logger: Logger
): boolean
{
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  const lineText = state.src.slice(start, max);

  // 行頭が ::: type [title] の形でなければ対象外
  const openMatch = lineText.match(/^:::[\t ]+([A-Za-z0-9_-]+)(?:[\t ]+(.*))?[\t ]*$/);
  if (!openMatch) {
    return false;
  }

  const rawType = openMatch[1]!;
  const rawTitle = (openMatch[2] ?? "").trim();

  // 閉じ ::: を探す（ネストはサポートしない）
  let nextLine = startLine + 1;
  let foundClose = false;
  while (nextLine < endLine) {
    const lineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!;
    const lineMax = state.eMarks[nextLine]!;
    const text = state.src.slice(lineStart, lineMax).trim();
    if (text === ":::") {
      foundClose = true;
      break;
    }
    nextLine += 1;
  }
  // 閉じがない場合は通常の段落として扱う
  if (!foundClose) {
    return false;
  }

  // 検証モードではマッチするかどうかだけ返す
  if (silent) {
    return true;
  }

  // 未知タイプは警告して note にフォールバックする
  let type: AdmonitionType = "note";
  if (isAdmonitionType(rawType)) {
    type = rawType;
  } else {
    // ソースパスは convert 側で env に載せる
    const sourcePath = (state.env.sourcePath as string | undefined) ?? "(unknown)";
    logger.warn(`未知のAdmonitionタイプ "${rawType}" を note として描画します: ${sourcePath}`);
  }

  // タイトル省略時はタイプ名を大文字化する（未知タイプも note → NOTE）
  const title = rawTitle.length > 0 ? rawTitle : type.toUpperCase();

  const oldParentType = state.parentType;
  const oldLineMax = state.lineMax;
  // 入れ子ブロックの終端を閉じ行の直前までに制限する
  state.parentType = "admonition" as typeof state.parentType;
  state.lineMax = nextLine;

  // 開始トークンにタイプとタイトルを載せる
  const openToken = state.push("admonition_open", "aside", 1);
  openToken.markup = ":::";
  openToken.block = true;
  openToken.attrSet("data-type", type);
  openToken.attrSet("data-title", title);
  openToken.map = [startLine, nextLine + 1];

  // 開始行の次から閉じ行の直前までを本文として再帰パースする
  state.md.block.tokenize(state, startLine + 1, nextLine);

  const closeToken = state.push("admonition_close", "aside", -1);
  closeToken.markup = ":::";
  closeToken.block = true;

  // 状態を元に戻し、閉じ行の次から続きをパースさせる
  state.parentType = oldParentType;
  state.lineMax = oldLineMax;
  state.line = nextLine + 1;
  return true;
}
