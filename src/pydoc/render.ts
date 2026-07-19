import type { Heading } from "../types.js";
import { mergeArgTypes } from "./docstring.js";
import type {
  ParsedDocstring,
  PyClassDoc,
  PyFunctionDoc,
  PyModuleDoc,
  PydocDirectiveOptions
} from "./types.js";

/** render の戻り値 */
export interface PydocRenderResult {
  /** 展開後のMarkdown断片 */
  markdown: string;
  /** 仕様どおりのアンカーIDを持つ見出し一覧（convert後にマージする） */
  extraHeadings: Heading[];
}

/**
 * PyModuleDoc を Markdown + extraHeadings へレンダリングする
 */
export function renderModuleDoc(
  module: PyModuleDoc,
  options: PydocDirectiveOptions
): PydocRenderResult
{
  const parts: string[] = [];
  const extraHeadings: Heading[] = [];
  const headingLevel = options.headingLevel;
  // モジュール見出しは最終セグメント（短い名前）を表示する
  const moduleTitle = module.modulePath.split(".").pop() ?? module.modulePath;
  pushHeading(parts, extraHeadings, headingLevel, moduleTitle, module.modulePath);
  appendDocstring(parts, module.docstring, new Map());

  // フィルタ適用後のクラス・関数を並べる
  const classes = filterMembers(module.classes, options);
  const functions = filterMembers(module.functions, options);

  for (const cls of classes) {
    renderClass(parts, extraHeadings, module.modulePath, cls, headingLevel, options.showPrivate);
  }
  for (const fn of functions) {
    renderFunction(parts, extraHeadings, module.modulePath, fn, headingLevel + 2, null);
  }

  return {
    markdown: parts.join("\n").trim() + "\n",
    extraHeadings
  };
}

/**
 * 構文エラーをページ上に表示するための Markdown を生成する
 */
export function renderSyntaxError(modulePath: string, message: string): PydocRenderResult
{
  // Admonition の danger として見せ、既存のMarkdown拡張経路に載せる
  const markdown = [
    `::: danger Python構文エラー`,
    `モジュール \`${modulePath}\` の解析に失敗しました。`,
    "",
    message,
    `:::`
  ].join("\n") + "\n";
  return { markdown, extraHeadings: [] };
}

/**
 * クラス1つを見出し・属性・メソッドとして書き出す
 */
function renderClass(
  parts: string[],
  extraHeadings: Heading[],
  modulePath: string,
  cls: PyClassDoc,
  moduleHeadingLevel: number,
  showPrivate: boolean
): void
{
  const classLevel = moduleHeadingLevel + 1;
  const anchorId = `${modulePath}.${cls.name}`;
  pushHeading(parts, extraHeadings, classLevel, cls.name, anchorId);

  // クラスシグネチャをコードブロックで示す
  const bases = cls.bases.length > 0 ? `(${cls.bases.join(", ")})` : "";
  parts.push("```python", `class ${cls.name}${bases}:`, "```", "");
  appendDocstring(parts, cls.docstring, new Map());

  if (cls.attributes.length > 0) {
    const attrs = cls.attributes.filter((a) => showPrivate || !a.name.startsWith("_"));
    if (attrs.length > 0) {
      parts.push("**Attributes**", "");
      parts.push("| Name | Type |", "| --- | --- |");
      for (const attr of attrs) {
        parts.push(`| \`${attr.name}\` | ${attr.type ? `\`${attr.type}\`` : ""} |`);
      }
      parts.push("");
    }
  }

  const methods = cls.methods.filter((m) => showPrivate || !m.name.startsWith("_"));
  for (const method of methods) {
    renderFunction(parts, extraHeadings, modulePath, method, moduleHeadingLevel + 2, cls.name);
  }
}

/**
 * 関数またはメソッドを見出し・シグネチャ・docstringとして書き出す
 */
function renderFunction(
  parts: string[],
  extraHeadings: Heading[],
  modulePath: string,
  fn: PyFunctionDoc,
  level: number,
  className: string | null
): void
{
  const anchorId = className
    ? `${modulePath}.${className}.${fn.name}`
    : `${modulePath}.${fn.name}`;
  pushHeading(parts, extraHeadings, level, fn.name, anchorId);
  parts.push("```python", fn.signature, "```", "");

  // Args の型はシグネチャ注釈を優先してマージする
  const typeMap = new Map(fn.params.map((p) => [p.name, p.type] as const));
  appendDocstring(parts, mergeArgTypes(fn.docstring, typeMap), typeMap);
}

/**
 * ParsedDocstring を Markdown 断片として追記する
 */
function appendDocstring(
  parts: string[],
  docstring: ParsedDocstring | null,
  _signatureTypes: Map<string, string | null>
): void
{
  if (!docstring) {
    return;
  }
  if (docstring.summary) {
    parts.push(docstring.summary, "");
  }
  if (docstring.body) {
    parts.push(docstring.body, "");
  }
  if (docstring.args.length > 0) {
    parts.push("**Args**", "");
    parts.push("| Name | Type | Description |", "| --- | --- | --- |");
    for (const arg of docstring.args) {
      const type = arg.type ? `\`${arg.type}\`` : "";
      parts.push(`| \`${arg.name}\` | ${type} | ${arg.description} |`);
    }
    parts.push("");
  }
  if (docstring.returns) {
    parts.push("**Returns**", "", docstring.returns, "");
  }
  if (docstring.raises.length > 0) {
    parts.push("**Raises**", "");
    for (const item of docstring.raises) {
      parts.push(`- \`${item.type}\`: ${item.description}`);
    }
    parts.push("");
  }
  for (const example of docstring.examples) {
    parts.push("```python", example, "```", "");
  }
  for (const note of docstring.notes) {
    const type = note.kind === "warning" ? "warning" : "note";
    parts.push(`::: ${type}`, note.text, ":::", "");
  }
}

/**
 * 見出し行と extraHeadings を同時に積む
 */
function pushHeading(
  parts: string[],
  extraHeadings: Heading[],
  level: number,
  text: string,
  anchorId: string
): void
{
  // Markdown見出しは短い表示名。目次・リンク用IDは extraHeadings で上書きする
  const marks = "#".repeat(Math.min(Math.max(level, 1), 6));
  parts.push(`${marks} ${text}`, "");
  // 目次は h2〜h6 のみ（既存 convert と同じ）。level 1 も仕様上あり得るが目次外
  if (level >= 2 && level <= 6) {
    extraHeadings.push({ level, text, anchorId });
  } else if (level === 1) {
    // h1 は目次に出さないが、リンク検証用に anchorId だけ後段で拾えるよう保持する
    extraHeadings.push({ level: 1, text, anchorId });
  }
}

/**
 * members / show-private でトップレベルメンバーを絞り込む
 */
function filterMembers<T extends { name: string }>(
  items: T[],
  options: PydocDirectiveOptions
): T[]
{
  return items.filter((item) => {
    if (!options.showPrivate && item.name.startsWith("_")) {
      return false;
    }
    if (options.members !== null && !options.members.includes(item.name)) {
      return false;
    }
    return true;
  });
}
