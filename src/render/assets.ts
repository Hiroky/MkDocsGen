import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";

/**
 * テーマアセットとcustom_cssを出力ディレクトリへコピーする
 */
export function copyAssets(config: ResolvedConfig): string[]
{
  // 組み込みテーマのassetsディレクトリを解決する（src/distどちらからでも2階層上がリポジトリルート）
  const builtinAssetsDir = fileURLToPath(new URL("../../templates/assets", import.meta.url));
  const outputAssetsDir = path.join(config.outputDirAbs, "assets");

  // templates/assets/* を outputDirAbs/assets/ へ再帰コピーする
  fs.mkdirSync(outputAssetsDir, { recursive: true });
  copyDirRecursive(builtinAssetsDir, outputAssetsDir);

  // theme.custom_cssの各ファイルを outputDirAbs/assets/custom/ へコピーする
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
