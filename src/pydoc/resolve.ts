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

/** 解決済みPythonモジュールのパス情報 */
export interface ResolvedPythonModule {
  /** ドット区切りのPythonモジュールパス */
  modulePath: string;
  /** Pythonソースファイルの絶対パス */
  filePath: string;
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

/** モジュールまたはパッケージ配下のPythonソースを再帰的に解決する */
export function resolvePythonModules(
  modulePath: string,
  sourceDirsAbs: string[]
): ResolvedPythonModule[]
{
  // まず既存の単一モジュール解決を使い、source_dirsの優先順位を維持する
  const rootFilePath = resolvePythonModule(modulePath, sourceDirsAbs);
  if (path.basename(rootFilePath) !== "__init__.py") {
    return [{ modulePath, filePath: rootFilePath }];
  }

  // パッケージ自身の __init__.py を先頭に置き、その後を再帰的に列挙する
  const modules: ResolvedPythonModule[] = [{ modulePath, filePath: rootFilePath }];
  collectPackageModules(path.dirname(rootFilePath), modulePath, modules);
  return modules;
}

/** パッケージディレクトリ内のPythonソースを決定的な順序で収集する */
function collectPackageModules(
  directory: string,
  packagePath: string,
  modules: ResolvedPythonModule[]
): void
{
  // ファイルシステムの列挙順はOSやファイルシステムに依存するため、名前で並べ替える
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name !== "__pycache__" && !entry.name.startsWith("."))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const fileNames = new Set(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
      .map((entry) => entry.name.slice(0, -3))
  );

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".py") && entry.name !== "__init__.py") {
      // __init__.py は現在のパッケージとして追加済みなので、通常のモジュールだけ追加する
      modules.push({
        modulePath: `${packagePath}.${entry.name.slice(0, -3)}`,
        filePath: path.join(directory, entry.name)
      });
      continue;
    }
    if (!entry.isDirectory() || entry.name === "__pycache__" || fileNames.has(entry.name)) {
      // 同名の .py がある場合は、単一モジュール解決と同じくファイルを優先する
      continue;
    }

    const childDirectory = path.join(directory, entry.name);
    const childInit = path.join(childDirectory, "__init__.py");
    const childPath = `${packagePath}.${entry.name}`;
    if (fs.existsSync(childInit) && fs.statSync(childInit).isFile()) {
      // サブパッケージ自身もAPIを持つため、__init__.pyを1モジュールとして含める
      modules.push({ modulePath: childPath, filePath: childInit });
    }
    // __init__.py がない名前空間パッケージも、配下のPythonソースを収集する
    collectPackageModules(childDirectory, childPath, modules);
  }
}
