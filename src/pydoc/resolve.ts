import fs from "node:fs";
import path from "node:path";

/**
 * Pythonモジュール解決に失敗したときのエラー。探索パス一覧を保持する
 */
export class ModuleResolveError extends Error
{
  readonly modulePath: string;
  readonly searchedPaths: string[];

  /**
   * モジュール解決エラーを生成する
   */
  constructor(modulePath: string, searchedPaths: string[])
  {
    // 呼び出し側がそのままビルドエラーメッセージに使える文言にする
    const pathsText = searchedPaths.length > 0
      ? searchedPaths.map((p) => `  - ${p}`).join("\n")
      : "  (pydoc.source_dirs が空です)";
    super(`pydocモジュールを解決できません: ${modulePath}\n探索したパス:\n${pathsText}`);
    this.name = "ModuleResolveError";
    this.modulePath = modulePath;
    this.searchedPaths = searchedPaths;
  }
}

/**
 * モジュールパスを source_dirs 起点の .py / __init__.py ファイルへ解決する
 */
export function resolvePythonModule(modulePath: string, sourceDirsAbs: string[]): string
{
  // ドット区切りをディレクトリ区切りへ変換する（例: a.b.c → a/b/c）
  const parts = modulePath.split(".");
  const relativeBase = path.join(...parts);
  const searchedPaths: string[] = [];

  for (const sourceDir of sourceDirsAbs) {
    // 仕様どおり .py を先に試し、無ければパッケージの __init__.py を試す
    const filePath = path.join(sourceDir, `${relativeBase}.py`);
    searchedPaths.push(filePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }

    const initPath = path.join(sourceDir, relativeBase, "__init__.py");
    searchedPaths.push(initPath);
    if (fs.existsSync(initPath) && fs.statSync(initPath).isFile()) {
      return initPath;
    }
  }

  // どれにも当たらなければ探索一覧付きで失敗させる
  throw new ModuleResolveError(modulePath, searchedPaths);
}
