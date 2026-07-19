import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** basic-siteフィクスチャの絶対パス */
export const BASIC_SITE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/basic-site"
);

/**
 * basic-siteを一時ディレクトリへ複製し、汚染せずにビルドできるようにする
 */
export function copyBasicSite(options: {
  withOverrides?: boolean;
} = {}): { root: string; configPath: string; outputDir: string; cleanup: () => void }
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-build-"));
  // フィクスチャ一式をコピーする（theme_overridesはオプションで除外可能）
  copyDirRecursive(BASIC_SITE_DIR, root, {
    skipOverrides: options.withOverrides === false
  });

  return {
    root,
    configPath: path.join(root, "mkdocsgen.yml"),
    outputDir: path.join(root, "site"),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

/**
 * ディレクトリを再帰コピーする
 */
function copyDirRecursive(
  srcDir: string,
  destDir: string,
  options: { skipOverrides?: boolean } = {}
): void
{
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    // オーバーライド検証用にtheme_overridesを除外できるようにする
    if (options.skipOverrides && entry.name === "theme_overrides") {
      continue;
    }
    // 以前のビルド成果物があればコピーしない
    if (entry.name === "site") {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, options);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
