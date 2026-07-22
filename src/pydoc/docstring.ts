import type { ParsedDocstring } from "./types.js";

/** Googleスタイルのセクション見出し */
const SECTION_HEADERS = [
  "Args",
  "Arguments",
  "Parameters",
  "Returns",
  "Return",
  "Yields",
  "Yield",
  "Raises",
  "Raise",
  "Examples",
  "Example",
  "Note",
  "Notes",
  "Warning",
  "Warnings"
] as const;

type SectionName = (typeof SECTION_HEADERS)[number];

/**
 * Googleスタイルdocstringを構造化する。解釈不能部分は body / プレーンとして残す
 */
export function parseGoogleDocstring(raw: string): ParsedDocstring
{
  // 行ごとに分割し、共通インデントを落としてから解析する
  const lines = dedentDocstring(raw).split("\n");
  const result: ParsedDocstring = {
    summary: "",
    body: "",
    args: [],
    returns: null,
    raises: [],
    examples: [],
    notes: []
  };

  // 冒頭の空行を飛ばす
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === "") {
    index += 1;
  }

  // 概要: 最初の空行まで（またはセクション開始まで）
  const summaryLines: string[] = [];
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "" || matchSectionHeader(line)) {
      break;
    }
    summaryLines.push(line);
    index += 1;
  }
  result.summary = summaryLines.join("\n").trim();

  // 概要と次のセクションの間の空行を飛ばす
  while (index < lines.length && lines[index]!.trim() === "") {
    index += 1;
  }

  // セクション外本文と各セクションを順に読む
  const bodyLines: string[] = [];
  while (index < lines.length) {
    const header = matchSectionHeader(lines[index]!);
    if (!header) {
      // セクションに該当しない行は本文へ（解釈不能も含めてプレーン許容）
      bodyLines.push(lines[index]!);
      index += 1;
      continue;
    }
    index += 1;
    // セクション本文は次のセクション開始または終端まで
    const sectionLines: string[] = [];
    while (index < lines.length && !matchSectionHeader(lines[index]!)) {
      sectionLines.push(lines[index]!);
      index += 1;
    }
    applySection(result, header, sectionLines);
  }

  result.body = trimBlankEdges(normalizeRestBodyLines(bodyLines).join("\n"));
  return result;
}

/**
 * シグネチャの型注釈を優先して Args の型をマージする
 */
export function mergeArgTypes(
  docstring: ParsedDocstring | null,
  signatureTypes: Map<string, string | null>
): ParsedDocstring | null
{
  if (!docstring) {
    return null;
  }
  // 新しい配列を作り、注釈がある引数は型を上書きする
  const args = docstring.args.map((arg) => {
    if (signatureTypes.has(arg.name)) {
      const annotated = signatureTypes.get(arg.name) ?? null;
      // 両方ある場合はアノテーションを優先（仕様 2.5.4）
      return { ...arg, type: annotated ?? arg.type };
    }
    return arg;
  });
  return { ...docstring, args };
}

/**
 * セクション名に応じて ParsedDocstring へ書き込む
 */
function applySection(result: ParsedDocstring, header: SectionName, lines: string[]): void
{
  const content = trimBlankEdges(lines.join("\n"));
  switch (header) {
    case "Args":
    case "Arguments":
    case "Parameters":
      result.args = parseArgsSection(lines);
      break;
    case "Returns":
    case "Return":
    case "Yields":
    case "Yield":
      // Yields も戻り値説明として returns に載せる（構造上の専用フィールドが無い）
      // セクション内インデントを落として読みやすくする
      result.returns = dedentDocstring(content).trim();
      break;
    case "Raises":
    case "Raise":
      result.raises = parseRaisesSection(lines);
      break;
    case "Examples":
    case "Example":
      result.examples = parseExamplesSection(lines);
      break;
    case "Note":
    case "Notes":
      if (content.length > 0) {
        result.notes.push({ kind: "note", text: dedentDocstring(content).trim() });
      }
      break;
    case "Warning":
    case "Warnings":
      if (content.length > 0) {
        result.notes.push({ kind: "warning", text: dedentDocstring(content).trim() });
      }
      break;
    default:
      break;
  }
}

/**
 * Args セクションを name / type / description の配列へ分解する
 */
function parseArgsSection(lines: string[]): ParsedDocstring["args"]
{
  const args: ParsedDocstring["args"] = [];
  let current: { name: string; type: string | null; description: string[] } | null = null;

  for (const line of lines) {
    // `name (type): desc` または `name: desc`
    const match = line.match(/^(\s*)([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/);
    if (match && !isContinuationOnly(line, match[1]!.length)) {
      if (current) {
        args.push({
          name: current.name,
          type: current.type,
          description: current.description.join("\n").trim()
        });
      }
      current = {
        name: match[2]!,
        type: match[3]?.trim() ? match[3]!.trim() : null,
        description: match[4]!.trim() ? [match[4]!.trim()] : []
      };
      continue;
    }
    // 継続行は直前の引数説明へ足す
    if (current) {
      current.description.push(line.trim());
    }
  }
  if (current) {
    args.push({
      name: current.name,
      type: current.type,
      description: current.description.join("\n").trim()
    });
  }
  return args;
}

/**
 * Raises セクションを例外一覧へ分解する
 */
function parseRaisesSection(lines: string[]): ParsedDocstring["raises"]
{
  const raises: ParsedDocstring["raises"] = [];
  let current: { type: string; description: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][\w.]*)\s*:\s*(.*)$/);
    if (match) {
      if (current) {
        raises.push({ type: current.type, description: current.description.join("\n").trim() });
      }
      current = {
        type: match[1]!,
        description: match[2]!.trim() ? [match[2]!.trim()] : []
      };
      continue;
    }
    if (current) {
      current.description.push(line.trim());
    }
  }
  if (current) {
    raises.push({ type: current.type, description: current.description.join("\n").trim() });
  }
  return raises;
}

/**
 * Examples セクションをコードブロック文字列の配列にする
 */
function parseExamplesSection(lines: string[]): string[]
{
  // ReSTのcode-blockはディレクティブ行と、その下のインデントされた本文で構成される。
  // 空行を単純な区切りとして扱うと、1つのサンプルが複数のコードブロックに分割されるため、
  // まずcode-block専用の解析を行う。
  const blocks: string[] = [];
  let current: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const codeDirective = line.match(/^(\s*)\.\.\s+(?:code-block|code)::(?:\s+([^\s]+))?\s*$/i);
    if (codeDirective) {
      // 直前のdoctest形式の本文があれば、ディレクティブの前で確定する
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }

      const directiveIndent = codeDirective[1]!.length;
      index += 1;
      // ReSTではディレクティブと本文の間に空行を置けるため、先頭の空行は捨てる
      while (index < lines.length && lines[index]!.trim() === "") {
        index += 1;
      }

      const codeLines: string[] = [];
      let contentIndent: number | null = null;
      while (index < lines.length) {
        const codeLine = lines[index]!;
        if (codeLine.trim() === "") {
          // 本文開始後の空行はコード内部の空行として保持する
          if (contentIndent !== null) {
            codeLines.push("");
          }
          index += 1;
          continue;
        }

        const indent = leadingIndentLength(codeLine);
        if (indent <= directiveIndent) {
          // ディレクティブと同じ階層へ戻ったら、コードブロックは終了する
          break;
        }
        contentIndent = contentIndent === null ? indent : Math.min(contentIndent, indent);
        codeLines.push(codeLine);
        index += 1;
      }

      // コード本文の共通インデントだけを除去し、空行末尾は出力へ含めない
      while (codeLines.length > 0 && codeLines[codeLines.length - 1]!.trim() === "") {
        codeLines.pop();
      }
      if (contentIndent !== null && codeLines.length > 0) {
        blocks.push(codeLines.map((codeLine) => removeLeadingIndent(codeLine, contentIndent)).join("\n"));
      }
      continue;
    }

    // ReSTディレクティブでない例は、従来どおり空行単位のdoctestとして扱う
    if (line.trim() === "") {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      index += 1;
      continue;
    }
    current.push(line.replace(/^\s+/, ""));
    index += 1;
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  // 中身が無ければ空配列（呼び出し側はスキップ）
  return blocks;
}

/** 行頭の空白幅を返す。Python docstringではタブを1文字として扱い、除去幅と揃える */
function leadingIndentLength(line: string): number
{
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

/** 行頭から指定文字数のインデントを除去する */
function removeLeadingIndent(line: string, indent: number): string
{
  return line.slice(Math.min(indent, line.length));
}

/**
 * 行がセクション見出し（Args: 等）なら正規化名を返す
 */
function matchSectionHeader(line: string): SectionName | null
{
  const match = line.match(/^\s*([A-Za-z]+)\s*:\s*$/);
  if (!match) {
    return null;
  }
  const name = match[1]!;
  const found = SECTION_HEADERS.find((h) => h.toLowerCase() === name.toLowerCase());
  return found ?? null;
}

/**
 * docstring 全体の共通先頭インデントを除去する
 */
function dedentDocstring(raw: string): string
{
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  // Pythonのdocstringでは先頭行だけがインラインで始まり、2行目以降に構造インデントが付くことがある
  const firstContentIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstContentIndex < 0) {
    return lines.join("\n");
  }

  // 先頭の本文行を除く、空でない行の最小インデントを求める
  let minIndent = Infinity;
  for (let i = firstContentIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      continue;
    }
    const match = line.match(/^[ \t]*/);
    const indent = match ? match[0]!.length : 0;
    if (indent < minIndent) {
      minIndent = indent;
    }
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return lines.join("\n");
  }
  return lines.map((line, index) => {
    // 最初の本文行はインラインで始まるため、構造インデントの除去対象から外す
    if (index <= firstContentIndex) {
      return line;
    }
    return line.length >= minIndent ? line.slice(minIndent) : line;
  }).join("\n");
}

/**
 * 前後の空行だけを落とす
 */
function trimBlankEdges(text: string): string
{
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * ReSTの縦棒付き本文をMarkdownの通常段落として扱える形へ変換する
 */
function normalizeRestBodyLines(lines: string[]): string[]
{
  return lines.map((line) => {
    // 「|」で始まるReSTの行ブロックは、先頭のインデントと縦棒を取り除いて本文に戻す
    const match = line.match(/^[\t ]*\|[\t ]?(.*)$/);
    return match ? match[1]! : line;
  });
}

/**
 * Args の継続行判定用（現状は常に新規エントリ優先）
 */
function isContinuationOnly(_line: string, _indent: number): boolean
{
  return false;
}
