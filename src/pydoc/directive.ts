/**
 * Markdown内の ::: pydoc ディレクティブを検出・パースする
 */
import type { PydocDirective, PydocDirectiveOptions } from "./types.js";

/** デフォルトオプション */
const DEFAULT_OPTIONS: PydocDirectiveOptions = {
  members: null,
  showPrivate: false,
  headingLevel: 2
};

/** pydoc解析で使う改行をLFへ正規化する */
export function normalizePydocNewlines(markdown: string): string
{
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Markdown全文から ::: pydoc ディレクティブをすべて見つける
 */
export function findPydocDirectives(markdown: string): PydocDirective[]
{
  const directives: PydocDirective[] = [];
  // CRLF/CRを先にLFへ揃え、行末の\rがディレクティブ判定と置換範囲を壊さないようにする
  const source = normalizePydocNewlines(markdown);
  const lines = source.split("\n");
  // 各行の開始文字オフセットを事前計算する（置換範囲の算出に使う）
  const lineStarts: number[] = [];
  let running = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(running);
    running += lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
  }

  // コードフェンス内の ::: pydoc はドキュメント例なので検出しない（Admonitionと同じ方針）
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

    // フェンス開始行なら、閉じるまで ::: pydoc を見ない
    const fenceOpen = matchFenceOpen(trimmed);
    if (fenceOpen !== null) {
      openFence = fenceOpen;
      i += 1;
      continue;
    }

    const openMatch = line.match(/^:::[\t ]+pydoc[\t ]+(\S+)[\t ]*$/);
    if (!openMatch) {
      i += 1;
      continue;
    }

    const start = lineStarts[i]!;
    const modulePath = openMatch[1]!;
    const optionLines: string[] = [];
    let endLine = i;

    // 続くインデント行をオプションとして取り込む
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      // 閉じ ::: だけで終わっている場合はディレクティブ範囲に含めて消費する
      if (/^:::[\t ]*$/.test(next)) {
        endLine = j;
        j += 1;
        break;
      }
      // インデントされた key: value 行だけをオプションとする
      if (/^[ \t]+\S/.test(next)) {
        optionLines.push(next);
        endLine = j;
        j += 1;
        continue;
      }
      break;
    }

    // end は endLine の行末（最終行でなければ改行も含む）
    const end = endLine < lines.length - 1
      ? lineStarts[endLine]! + lines[endLine]!.length + 1
      : lineStarts[endLine]! + lines[endLine]!.length;

    directives.push({
      modulePath,
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
 * 単一ブロック文字列をパースする（テスト・単体利用向け）
 */
export function parsePydocDirectiveBlock(block: string): PydocDirective | null
{
  const found = findPydocDirectives(block);
  return found[0] ?? null;
}

/**
 * インデント行のオプションを構造化する
 */
function parseOptions(optionLines: string[]): PydocDirectiveOptions
{
  const options: PydocDirectiveOptions = { ...DEFAULT_OPTIONS };

  for (const rawLine of optionLines) {
    // 行末コメントを落とし、インデントも除去する
    const line = rawLine.replace(/[ \t]+#.*$/, "").trim();
    const match = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1]!;
    const value = match[2]!.trim();

    if (key === "members") {
      // カンマ区切りのメンバー名一覧。空なら空配列（何も出さない）
      options.members = value.length === 0
        ? []
        : value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
    } else if (key === "show-private") {
      options.showPrivate = value.toLowerCase() === "true";
    } else if (key === "heading-level") {
      const level = Number.parseInt(value, 10);
      // 1〜6の範囲に収める（不正値はデフォルト維持）
      if (Number.isFinite(level) && level >= 1 && level <= 6) {
        options.headingLevel = level;
      }
    }
  }

  return options;
}

/**
 * コードフェンス開始行ならマーカー文字と長さを返す
 */
function matchFenceOpen(line: string): { marker: string; length: number } | null
{
  // CommonMark: 行頭の3つ以上の ` または ~
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
  // 閉じは同じ文字がminLength以上で、その後は空白のみ
  const re = marker === "`"
    ? new RegExp(`^\`{${minLength},}\\s*$`)
    : new RegExp(`^~{${minLength},}\\s*$`);
  return re.test(line);
}
