import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

/** createRequire は ESM から CJS パッケージのパス解決に使う */
const require = createRequire(import.meta.url);

/** Python用Parserの初期化済みラッパー */
export interface PythonParser {
  /** ソース文字列をパースして構文木を返す */
  parse(source: string): import("web-tree-sitter").Tree;
}

/** 初期化はビルド全体で1回だけ行う */
let initPromise: Promise<PythonParser> | null = null;

/**
 * web-tree-sitter と tree-sitter-python.wasm をロードして PythonParser を返す
 *
 * 注意: tree-sitter-python.wasm は旧 dylink 形式のため、web-tree-sitter は 0.25.x 系を使う
 */
export async function createPythonParser(): Promise<PythonParser>
{
  // 既に初期化中または完了していれば同じ Promise を返す（並列呼び出しに耐える）
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async (): Promise<PythonParser> => {
    // web-tree-sitter.wasm（0.25では tree-sitter.wasm）を同梱ディレクトリから探す
    const packageDir = path.dirname(require.resolve("web-tree-sitter"));
    await Parser.init({
      locateFile(scriptName: string) {
        // ランタイムが要求するファイル名をパッケージ配下の実ファイルへマップする
        return path.join(packageDir, scriptName);
      }
    });

    // 言語WASMはリポジトリに同梱している vendor/tree-sitter-python.wasm を使う
    // （tree-sitter-wasms は36言語分・49MBを同梱するため、Python用の1ファイルだけを
    //   vendor化することで配布サイズを削減している）
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const languagePath = path.join(moduleDir, "..", "..", "vendor", "tree-sitter-python.wasm");
    const language = await Language.load(languagePath);
    const parser = new Parser();
    parser.setLanguage(language);

    return {
      /**
       * Pythonソースをパースする
       */
      parse(source: string) {
        // web-tree-sitter 0.25 の型は Tree | null だが、通常入力では Tree が返る
        const tree = parser.parse(source);
        if (!tree) {
          throw new Error("Pythonソースのパースに失敗しました");
        }
        return tree;
      }
    };
  })();

  return initPromise;
}

/**
 * テスト用に初期化キャッシュをリセットする
 */
export function resetPythonParserForTests(): void
{
  initPromise = null;
}
