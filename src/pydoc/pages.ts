import path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import { findPydocDirectives, normalizePydocNewlines } from "./directive.js";
import { resolvePythonModules } from "./resolve.js";
import type { PydocDirectiveOptions } from "./types.js";
import type { PageSource } from "../scanner/scan.js";

/** パッケージ展開前処理の結果 */
export interface ExpandPydocPagesResult {
  /** パッケージページを追加し、元ページのディレクティブをtoctreeへ置換した一覧 */
  sources: PageSource[];
}

/**
 * パッケージ向けpydocディレクティブをモジュール別PageSourceへ分解する
 */
export function expandPydocPackagePages(
  sources: PageSource[],
  config: ResolvedConfig,
  _logger: Logger
): ExpandPydocPagesResult
{
  // source_dirsは設定ファイルの場所を基準に解決し、通常のpydoc展開と同じ探索規則を使う
  const sourceDirsAbs = config.pydoc.source_dirs.map((dir) =>
    path.isAbsolute(dir) ? dir : path.resolve(config.configDir, dir)
  );
  const result: PageSource[] = [...sources];

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]!;
    const normalizedMarkdown = normalizePydocNewlines(source.markdown);
    const directives = findPydocDirectives(normalizedMarkdown);
    if (directives.length === 0) {
      continue;
    }

    let markdown = normalizedMarkdown;
    let changed = false;
    const generatedPaths = new Set<string>();

    // 後ろから置換して、複数ディレクティブの文字オフセットを維持する
    for (let i = directives.length - 1; i >= 0; i--) {
      const directive = directives[i]!;
      const modules = resolvePythonModules(directive.modulePath, sourceDirsAbs);
      const rootModule = modules[0]!;

      // .pyの単一モジュール指定は従来のインライン展開を維持する
      if (path.basename(rootModule.filePath) !== "__init__.py") {
        continue;
      }

      const modulePaths: string[] = [];
      for (const module of modules) {
        const generatedPath = makeGeneratedSourcePath(source.sourcePath, module.modulePath, module.filePath);
        modulePaths.push(generatedPath);
        if (!generatedPaths.has(generatedPath)) {
          generatedPaths.add(generatedPath);
          result.push(makeGeneratedPageSource(source, module, generatedPath, directive.options));
        }
      }

      // ルートパッケージだけをtoctreeへ置く。子ページはナビツリーが自動的に階層表示する
      const rootPath = modulePaths[0]!;
      const replacement = [
        "::: toctree",
        "maxdepth: 3",
        "",
        rootPath,
        ":::",
        ""
      ].join("\n");
      markdown = markdown.slice(0, directive.start) + replacement + markdown.slice(directive.end);
      changed = true;
    }

    if (changed) {
      result[sourceIndex] = { ...source, markdown };
    }
  }

  return { sources: result };
}

/**
 * 生成ページ用のdocs相対パスをPythonモジュールパスから組み立てる
 */
function makeGeneratedSourcePath(sourcePath: string, modulePath: string, filePath: string): string
{
  const base = sourcePath.replace(/\.md$/u, "");
  const moduleRelative = modulePath.split(".").join("/");
  const isPackage = path.basename(filePath) === "__init__.py";
  return isPackage
    ? `${base}/${moduleRelative}/index.md`
    : `${base}/${moduleRelative}.md`;
}

/**
 * 解決済みPythonモジュールから自動生成ページの走査情報を作る
 */
function makeGeneratedPageSource(
  parent: PageSource,
  module: { modulePath: string; filePath: string },
  sourcePath: string,
  options: PydocDirectiveOptions
): PageSource
{
  const outputPath = sourcePath.replace(/\.md$/u, ".html");
  const baseUrl = parent.url.slice(0, parent.url.length - parent.outputPath.length);
  return {
    sourcePath,
    absPath: module.filePath,
    markdown: "",
    frontmatter: { title: module.modulePath },
    title: module.modulePath,
    order: null,
    description: "",
    outputPath,
    url: `${baseUrl}${outputPath}`,
    generatedPydoc: {
      modulePath: module.modulePath,
      filePath: module.filePath,
      options,
      generatedFrom: parent.sourcePath
    }
  };
}
