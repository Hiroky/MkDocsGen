import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";

// ESMからnode_modules内のmermaidパスを解決するためのrequire
const require = createRequire(import.meta.url);

/** copyAssetsの戻り値。テンプレートへ渡す出力相対パスをまとめる */
export interface CopiedAssets {
  customCss: string[];
  logo: string | null;
  favicon: string | null;
}

/** copyAssetsのオプション */
export interface CopyAssetsOptions {
  /** trueならbuild-themeのminify版で上書きする。未指定時はdist経由ならtrue、src経由（docs:build等）ならfalse */
  useMinifiedTheme?: boolean;
}

/**
 * theme.logo / theme.favicon の出力相対パスを求める（未設定ならnull）
 */
export function resolveBrandAssetPath(relPath: string | undefined): string | null
{
  // 未指定ならテンプレート側でデフォルト表示に任せる
  if (!relPath) {
    return null;
  }
  return `assets/brand/${path.basename(relPath)}`;
}

/**
 * テーマアセットとcustom_css / logo / faviconを出力ディレクトリへコピーする
 */
export function copyAssets(config: ResolvedConfig, options: CopyAssetsOptions = {}): CopiedAssets
{
  // 組み込みテーマのassetsディレクトリを解決する（src/distどちらからでも2階層上がリポジトリルート）
  const builtinAssetsDir = fileURLToPath(new URL("../../templates/assets", import.meta.url));
  const outputAssetsDir = path.join(config.outputDirAbs, "assets");

  // templates/assets/* を outputDirAbs/assets/ へ再帰コピーする
  fs.mkdirSync(outputAssetsDir, { recursive: true });
  copyDirRecursive(builtinAssetsDir, outputAssetsDir);

  // 公開バイナリ（dist経由）だけ minify 済みで上書きする。
  // docs:build / docs:serve は tsx で src から動くため、templates の編集がそのまま届く
  if (options.useMinifiedTheme ?? shouldUseMinifiedThemeByDefault()) {
    overwriteWithMinifiedThemeAssets(outputAssetsDir);
  }

  // Mermaidランタイムをnode_modulesから同梱する（閲覧時のクライアント描画用）
  copyMermaidRuntime(outputAssetsDir);

  // MiniSearchランタイムをnode_modulesから同梱する（検索の遅延ロード用）
  copyMinisearchRuntime(outputAssetsDir);

  // theme.custom_cssの各ファイルを outputDirAbs/assets/custom/ へコピーする
  const customCss = copyCustomCss(config, outputAssetsDir);

  // theme.logo / theme.favicon を assets/brand/ へコピーする
  const brand = copyBrandAssets(config, outputAssetsDir);

  return {
    customCss,
    logo: brand.logo,
    favicon: brand.favicon
  };
}

/**
 * custom_cssをassets/customへコピーし、出力相対パス一覧を返す
 */
function copyCustomCss(config: ResolvedConfig, outputAssetsDir: string): string[]
{
  const customOutputDir = path.join(outputAssetsDir, "custom");
  const injected: string[] = [];
  const usedNames = new Set<string>();
  for (const relCss of config.theme.custom_css) {
    // 設定ファイル基準の絶対パスへ解決する
    const absCss = path.resolve(config.configDir, relCss);
    if (!fs.existsSync(absCss)) {
      throw new ConfigError(`custom_css が見つかりません: ${relCss}`);
    }
    const fileName = path.basename(absCss);
    // 同名basenameは後勝ち上書きになるため、衝突を明示エラーにする
    if (usedNames.has(fileName)) {
      throw new ConfigError(`custom_css のファイル名が重複しています: ${fileName}`);
    }
    usedNames.add(fileName);
    fs.mkdirSync(customOutputDir, { recursive: true });
    fs.copyFileSync(absCss, path.join(customOutputDir, fileName));
    // テンプレートへ注入する出力相対パス（POSIX区切り）を集める
    injected.push(`assets/custom/${fileName}`);
  }
  return injected;
}

/**
 * logo / faviconをassets/brandへコピーし、出力相対パスを返す
 */
function copyBrandAssets(
  config: ResolvedConfig,
  outputAssetsDir: string
): { logo: string | null; favicon: string | null }
{
  const brandDir = path.join(outputAssetsDir, "brand");
  const usedNames = new Set<string>();

  /**
   * 1ファイルをbrandへコピーし、出力相対パスを返す
   */
  const copyOne = (label: "logo" | "favicon", relPath: string | undefined): string | null => {
    // 未設定なら何もしない
    if (!relPath) {
      return null;
    }
    const absPath = path.resolve(config.configDir, relPath);
    if (!fs.existsSync(absPath)) {
      throw new ConfigError(`${label} が見つかりません: ${relPath}`);
    }
    const fileName = path.basename(absPath);
    // logoとfaviconが同名だと上書きになるため、衝突を明示エラーにする
    if (usedNames.has(fileName)) {
      throw new ConfigError(`${label} のファイル名が重複しています: ${fileName}`);
    }
    usedNames.add(fileName);
    fs.mkdirSync(brandDir, { recursive: true });
    fs.copyFileSync(absPath, path.join(brandDir, fileName));
    return resolveBrandAssetPath(relPath);
  };

  return {
    logo: copyOne("logo", config.theme.logo),
    favicon: copyOne("favicon", config.theme.favicon)
  };
}

/** minify対象のテーマアセットファイル名一覧 */
const MINIFIABLE_THEME_ASSETS = ["main.js", "main.css"];

/**
 * dist経由（公開CLI）ならminify済みテーマを使い、src経由（docs:build等）なら使わない
 */
function shouldUseMinifiedThemeByDefault(): boolean
{
  // このファイル自身の配置で判定する（src/render vs dist/render）
  return fileURLToPath(import.meta.url).includes(`${path.sep}dist${path.sep}`);
}

/**
 * build-theme/配下のminify済みファイルがあれば出力assetsを上書きする
 */
function overwriteWithMinifiedThemeAssets(outputAssetsDir: string): void
{
  for (const fileName of MINIFIABLE_THEME_ASSETS) {
    const minifiedPath = fileURLToPath(new URL(`../../build-theme/${fileName}`, import.meta.url));
    if (fs.existsSync(minifiedPath)) {
      fs.copyFileSync(minifiedPath, path.join(outputAssetsDir, fileName));
    }
  }
}

/**
 * mermaid.min.jsを出力assetsへコピーする
 *
 * mermaidパッケージ本体はcytoscape/katex等の周辺依存が大きいため採用せず、
 * 実際に使うUMDビルド1ファイルのみをvendor/へ同梱している
 */
function copyMermaidRuntime(outputAssetsDir: string): void
{
  const mermaidEntry = fileURLToPath(new URL("../../vendor/mermaid.min.js", import.meta.url));
  fs.copyFileSync(mermaidEntry, path.join(outputAssetsDir, "mermaid.min.js"));
}

/**
 * minisearchのUMDビルドを出力assetsへコピーする
 */
function copyMinisearchRuntime(outputAssetsDir: string): void
{
  // exportsにUMDパスが無いため、パッケージ入口から相対解決する
  const packageEntry = require.resolve("minisearch");
  const minisearchEntry = path.resolve(path.dirname(packageEntry), "../umd/index.js");
  fs.copyFileSync(minisearchEntry, path.join(outputAssetsDir, "minisearch.min.js"));
}

/**
 * ディレクトリを再帰的にコピーする
 */
function copyDirRecursive(srcDir: string, destDir: string): void
{
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      // サブディレクトリも同じ規則でコピーする
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
