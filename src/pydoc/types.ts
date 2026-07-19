/**
 * 関数・メソッドの引数1つ分
 */
export interface PyParam {
  name: string;
  type: string | null;
  default: string | null;
}

/**
 * 型アノテーション付きクラス変数
 */
export interface PyAttributeDoc {
  name: string;
  type: string | null;
}

/**
 * Googleスタイルdocstringの構造化結果
 */
export interface ParsedDocstring {
  /** 冒頭の概要 */
  summary: string;
  /** セクション外の本文（Markdown） */
  body: string;
  args: { name: string; type: string | null; description: string }[];
  returns: string | null;
  raises: { type: string; description: string }[];
  /** コードブロック群 */
  examples: string[];
  notes: { kind: "note" | "warning"; text: string }[];
}

/**
 * 関数またはメソッドの解析結果
 */
export interface PyFunctionDoc {
  name: string;
  /** 表示用に整形したシグネチャ */
  signature: string;
  /** 名前・型・デフォルト値 */
  params: PyParam[];
  /** 戻り値型アノテーション */
  returns: string | null;
  decorators: string[];
  docstring: ParsedDocstring | null;
}

/**
 * クラスの解析結果
 */
export interface PyClassDoc {
  name: string;
  bases: string[];
  docstring: ParsedDocstring | null;
  methods: PyFunctionDoc[];
  attributes: PyAttributeDoc[];
}

/**
 * pydoc解析結果（モジュール単位）
 */
export interface PyModuleDoc {
  /** mypackage.mymodule */
  modulePath: string;
  docstring: ParsedDocstring | null;
  classes: PyClassDoc[];
  functions: PyFunctionDoc[];
}

/**
 * ::: pydoc ディレクティブのオプション
 */
export interface PydocDirectiveOptions {
  /** 展開対象を限定（省略時は全公開メンバー） */
  members: string[] | null;
  /** _始まりのメンバーを含めるか */
  showPrivate: boolean;
  /** 展開時の見出し開始レベル */
  headingLevel: number;
}

/**
 * Markdown内の1つの ::: pydoc ディレクティブ
 */
export interface PydocDirective {
  /** モジュールパス（例: mypackage.mymodule） */
  modulePath: string;
  options: PydocDirectiveOptions;
  /** 置換対象の開始オフセット（文字位置） */
  start: number;
  /** 置換対象の終了オフセット（文字位置・排他） */
  end: number;
}
