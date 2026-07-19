import type { Node } from "web-tree-sitter";
import { parseGoogleDocstring } from "./docstring.js";
import type { PythonParser } from "./tree-sitter.js";
import type {
  ParsedDocstring,
  PyAttributeDoc,
  PyClassDoc,
  PyFunctionDoc,
  PyModuleDoc,
  PyParam
} from "./types.js";

/** パース成功時の結果 */
export interface ParsePythonSuccess {
  ok: true;
  module: PyModuleDoc;
}

/** 構文エラー時の結果 */
export interface ParsePythonFailure {
  ok: false;
  /** 人間向けのエラー概要 */
  message: string;
}

export type ParsePythonResult = ParsePythonSuccess | ParsePythonFailure;

/**
 * Pythonソースを静的解析してモジュールドキュメントを返す
 */
export function parsePythonModule(
  source: string,
  modulePath: string,
  pythonParser: PythonParser
): ParsePythonResult
{
  // tree-sitter で構文木を構築する
  const tree = pythonParser.parse(source);
  const root = tree.rootNode;

  // 構文エラーがある場合はディレクティブをスキップさせるため失敗を返す
  if (root.hasError) {
    return {
      ok: false,
      message: `Python構文エラー: ${modulePath}`
    };
  }

  const classes: PyClassDoc[] = [];
  const functions: PyFunctionDoc[] = [];

  // モジュール先頭の docstring を取る（最初の式が文字列のとき）
  const moduleDocstring = extractLeadingDocstring(root);

  // モジュール直下のクラス・関数（デコレータ付き含む）を走査する
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (!child) {
      continue;
    }
    // 先頭 docstring の expression_statement はメンバーではない
    if (child.type === "expression_statement" && i === 0 && moduleDocstring) {
      continue;
    }
    if (child.type === "class_definition") {
      classes.push(extractClass(child));
      continue;
    }
    if (child.type === "function_definition") {
      functions.push(extractFunction(child));
      continue;
    }
    if (child.type === "decorated_definition") {
      // デコレータ付き定義は内側の実体を見て振り分ける
      const inner = findDefinition(child);
      const decorators = extractDecorators(child);
      if (inner?.type === "class_definition") {
        const cls = extractClass(inner);
        // クラス自体のデコレータは仕様上必須ではないが保持はしない（メソッド側で使う）
        classes.push(cls);
      } else if (inner?.type === "function_definition") {
        const fn = extractFunction(inner);
        fn.decorators = decorators;
        // デコレータ反映後にシグネチャ表示を更新する
        fn.signature = formatSignature(fn.name, fn.params, fn.returns, fn.decorators);
        functions.push(fn);
      }
    }
  }

  return {
    ok: true,
    module: {
      modulePath,
      docstring: moduleDocstring,
      classes,
      functions
    }
  };
}

/**
 * decorated_definition から class/function_definition を取り出す
 */
function findDefinition(decorated: Node): Node | null
{
  for (let i = 0; i < decorated.namedChildCount; i++) {
    const child = decorated.namedChild(i);
    if (!child) {
      continue;
    }
    if (child.type === "class_definition" || child.type === "function_definition") {
      return child;
    }
  }
  return null;
}

/**
 * @decorator 行からデコレータ名一覧を抽出する
 */
function extractDecorators(decorated: Node): string[]
{
  const names: string[] = [];
  for (let i = 0; i < decorated.namedChildCount; i++) {
    const child = decorated.namedChild(i);
    if (!child || child.type !== "decorator") {
      continue;
    }
    // @property / @staticmethod / @classmethod / @foo.bar などをテキストで取る
    const text = child.text.replace(/^@/, "").trim();
    // 呼び出し形式 @decorator(...) は名前部分だけ残す
    const callFree = text.replace(/\(.*\)$/s, "");
    names.push(callFree);
  }
  return names;
}

/**
 * ブロック先頭の docstring を ParsedDocstring へ変換する
 */
function extractLeadingDocstring(scope: Node): ParsedDocstring | null
{
  // 最初の named child が expression_statement > string なら docstring
  const first = firstMeaningfulChild(scope);
  if (!first || first.type !== "expression_statement") {
    return null;
  }
  const strNode = first.namedChild(0);
  if (!strNode || strNode.type !== "string") {
    return null;
  }
  return parseGoogleDocstring(unwrapStringLiteral(strNode.text));
}

/**
 * class_definition から PyClassDoc を構築する
 */
function extractClass(node: Node): PyClassDoc
{
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "Unknown";
  const bases = extractBases(node);
  const body = node.childForFieldName("body");
  const docstring = body ? extractLeadingDocstring(body) : null;
  const methods: PyFunctionDoc[] = [];
  const attributes: PyAttributeDoc[] = [];

  if (body) {
    for (let i = 0; i < body.namedChildCount; i++) {
      const child = body.namedChild(i);
      if (!child) {
        continue;
      }
      // 先頭 docstring は属性でもメソッドでもない
      if (child.type === "expression_statement" && i === 0 && docstring) {
        // 型アノテーション付きクラス変数は expression_statement だが docstring とは別
        // 先頭が docstring の場合はスキップ済み。注釈属性は別分岐で拾う
        continue;
      }
      if (child.type === "function_definition") {
        methods.push(extractFunction(child));
        continue;
      }
      if (child.type === "decorated_definition") {
        const inner = findDefinition(child);
        if (inner?.type === "function_definition") {
          const fn = extractFunction(inner);
          fn.decorators = extractDecorators(child);
          fn.signature = formatSignature(fn.name, fn.params, fn.returns, fn.decorators);
          methods.push(fn);
        }
        continue;
      }
      // 型アノテーション付き代入/注釈: `count: int` または `count: int = 0`
      const attr = extractAnnotatedAttribute(child);
      if (attr) {
        attributes.push(attr);
      }
    }
  }

  return { name, bases, docstring, methods, attributes };
}

/**
 * クラスの基底クラス名一覧を取り出す
 */
function extractBases(classNode: Node): string[]
{
  const bases: string[] = [];
  // superclasses は argument_list フィールド
  const args = classNode.childForFieldName("superclasses");
  if (!args) {
    return bases;
  }
  for (let i = 0; i < args.namedChildCount; i++) {
    const child = args.namedChild(i);
    if (child) {
      bases.push(child.text);
    }
  }
  return bases;
}

/**
 * 型アノテーション付きクラス変数を抽出する
 */
function extractAnnotatedAttribute(node: Node): PyAttributeDoc | null
{
  // `name: type` は expression_statement 配下、または assignment
  if (node.type === "expression_statement") {
    const inner = node.namedChild(0);
    if (!inner) {
      return null;
    }
    return extractAnnotatedAttribute(inner);
  }
  if (node.type === "assignment") {
    // `count: int = 0` 形式。left が typed な identifier パターン
    const left = node.childForFieldName("left");
    const typeNode = node.childForFieldName("type");
    if (left && typeNode) {
      return { name: left.text, type: typeNode.text };
    }
    // 一部の木では left が `identifier : type` ではなく別構造
  }
  // tree-sitter-python では `count: int` は expression_statement > identifier + type の並びではなく
  // `expression_statement` のテキスト全体が `count: int` になる場合がある。
  // 実際の dump では expression_statement の named children が identifier と type。
  if (node.type === "identifier") {
    return null;
  }
  // named children が identifier + type の並びなら注釈属性とみなす
  if (node.namedChildCount >= 2) {
    const first = node.namedChild(0);
    const second = node.namedChild(1);
    if (first?.type === "identifier" && second?.type === "type") {
      return { name: first.text, type: second.text };
    }
  }
  // assignment で type field があるケース
  if (node.type === "assignment" || node.type === "augmented_assignment") {
    const nameNode = node.namedChild(0);
    const typeNode = node.childForFieldName("type") ?? node.descendantsOfType("type")[0];
    if (nameNode && typeNode) {
      const name = nameNode.type === "identifier" ? nameNode.text : nameNode.child(0)?.text;
      if (name) {
        return { name, type: typeNode.text };
      }
    }
  }
  return null;
}

/**
 * function_definition から PyFunctionDoc を構築する
 */
function extractFunction(node: Node): PyFunctionDoc
{
  const nameNode = node.childForFieldName("name");
  const name = nameNode?.text ?? "unknown";
  const paramsNode = node.childForFieldName("parameters");
  const params = paramsNode ? extractParams(paramsNode) : [];
  const returnTypeNode = node.childForFieldName("return_type");
  const returns = returnTypeNode ? returnTypeNode.text : null;
  const body = node.childForFieldName("body");
  const docstring = body ? extractLeadingDocstring(body) : null;
  const decorators: string[] = [];
  return {
    name,
    signature: formatSignature(name, params, returns, decorators),
    params,
    returns,
    decorators,
    docstring
  };
}

/**
 * parameters ノードから引数一覧を抽出する
 */
function extractParams(paramsNode: Node): PyParam[]
{
  const params: PyParam[] = [];
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const child = paramsNode.namedChild(i);
    if (!child) {
      continue;
    }
    // self / cls の素の identifier も含める（表示用シグネチャのため）
    if (child.type === "identifier") {
      params.push({ name: child.text, type: null, default: null });
      continue;
    }
    if (child.type === "typed_parameter") {
      const name = child.child(0)?.text ?? child.text;
      const typeNode = child.childForFieldName("type") ?? child.descendantsOfType("type")[0];
      params.push({ name: stripParamName(name), type: typeNode?.text ?? null, default: null });
      continue;
    }
    if (child.type === "default_parameter") {
      const nameNode = child.childForFieldName("name") ?? child.namedChild(0);
      const valueNode = child.childForFieldName("value") ?? child.namedChild(child.namedChildCount - 1);
      params.push({
        name: nameNode?.text ?? "?",
        type: null,
        default: valueNode?.text ?? null
      });
      continue;
    }
    if (child.type === "typed_default_parameter") {
      const nameNode = child.childForFieldName("name") ?? child.namedChild(0);
      const typeNode = child.childForFieldName("type") ?? child.descendantsOfType("type")[0];
      const valueNode = child.childForFieldName("value") ?? child.namedChild(child.namedChildCount - 1);
      params.push({
        name: nameNode?.text ?? "?",
        type: typeNode?.text ?? null,
        default: valueNode?.text ?? null
      });
      continue;
    }
    if (child.type === "list_splat_pattern" || child.type === "list_splat") {
      // *args
      const name = child.text.replace(/^\*/, "");
      params.push({ name: `*${name}`, type: null, default: null });
      continue;
    }
    if (child.type === "dictionary_splat_pattern" || child.type === "dictionary_splat") {
      const name = child.text.replace(/^\*\*/, "");
      params.push({ name: `**${name}`, type: null, default: null });
      continue;
    }
  }
  return params;
}

/**
 * typed_parameter の先頭テキストから名前だけ残す
 */
function stripParamName(raw: string): string
{
  // "a: int" のように型が混ざる場合はコロン前を名前とする
  const idx = raw.indexOf(":");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

/**
 * 表示用シグネチャ文字列を組み立てる
 */
function formatSignature(
  name: string,
  params: PyParam[],
  returns: string | null,
  decorators: string[]
): string
{
  const paramText = params.map((p) => {
    let part = p.name;
    if (p.type) {
      part += `: ${p.type}`;
    }
    if (p.default !== null) {
      part += ` = ${p.default}`;
    }
    return part;
  }).join(", ");
  let sig = `def ${name}(${paramText})`;
  if (returns) {
    sig += ` -> ${returns}`;
  }
  // デコレータがある場合は先頭に付ける
  if (decorators.length > 0) {
    const decoLines = decorators.map((d) => `@${d}`).join("\n");
    sig = `${decoLines}\n${sig}`;
  }
  return sig;
}

/**
 * 三重引用符・通常引用符の文字列リテラルを中身だけにする
 */
function unwrapStringLiteral(raw: string): string
{
  const trimmed = raw.trim();
  // プレフィックス（r/f/b/u）を除去してから引用符を剥がす
  const withoutPrefix = trimmed.replace(/^[rRuUfFbB]+/, "");
  if (withoutPrefix.startsWith('"""') && withoutPrefix.endsWith('"""')) {
    return withoutPrefix.slice(3, -3);
  }
  if (withoutPrefix.startsWith("'''") && withoutPrefix.endsWith("'''")) {
    return withoutPrefix.slice(3, -3);
  }
  if (
    (withoutPrefix.startsWith('"') && withoutPrefix.endsWith('"')) ||
    (withoutPrefix.startsWith("'") && withoutPrefix.endsWith("'"))
  ) {
    return withoutPrefix.slice(1, -1);
  }
  return withoutPrefix;
}

/**
 * block/module の最初の意味ある子（コメント等を除く）を返す
 */
function firstMeaningfulChild(scope: Node): Node | null
{
  // body フィールドがあるノードでは body を見る
  const body = scope.type === "block" || scope.type === "module"
    ? scope
    : scope.childForFieldName("body") ?? scope;
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (child) {
      return child;
    }
  }
  return null;
}
