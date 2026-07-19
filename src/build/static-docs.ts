import fs from "node:fs";
import path from "node:path";
import fastGlob from "fast-glob";
import type { ResolvedConfig } from "../config/schema.js";

/**
 * docs_dir配下の非Markdown静的ファイルを、同じ相対パスでoutputへコピーする
 */
export function copyStaticDocs(config: ResolvedConfig): number
{
  // MarkdownはHTML変換側の担当。静的コピー対象から除外する
  const files = fastGlob.sync("**/*", {
    cwd: config.docsDirAbs,
    onlyFiles: true,
    // excludeはページ走査と同じ規則を適用する
    ignore: [...config.exclude, "**/*.md"]
  });

  let copied = 0;
  for (const file of files) {
    const sourcePath = file.split(path.sep).join("/");
    copyOne(config, sourcePath);
    copied += 1;
  }
  return copied;
}

/**
 * 変更された静的ファイルだけを出力へ同期する（追加・更新・削除）
 */
export function syncStaticDocPaths(config: ResolvedConfig, relativePaths: string[]): void
{
  for (const rel of relativePaths) {
    const sourcePath = rel.split(path.sep).join("/");
    // Markdownは変換パイプライン側で扱う
    if (sourcePath.endsWith(".md") || sourcePath.endsWith(".MD")) {
      continue;
    }
    // exclude対象は出力へ出さず、既にあれば削除する
    if (isExcluded(sourcePath, config.exclude)) {
      removeOutput(config, sourcePath);
      continue;
    }

    const absSrc = path.join(config.docsDirAbs, sourcePath);
    if (fs.existsSync(absSrc) && fs.statSync(absSrc).isFile()) {
      copyOne(config, sourcePath);
    } else {
      // ソースが消えた（unlink）場合は出力側も消す
      removeOutput(config, sourcePath);
    }
  }
}

/**
 * 1ファイルをdocs→siteへコピーする
 */
function copyOne(config: ResolvedConfig, sourcePath: string): void
{
  const absSrc = path.join(config.docsDirAbs, sourcePath);
  const absDest = path.join(config.outputDirAbs, sourcePath);
  fs.mkdirSync(path.dirname(absDest), { recursive: true });
  fs.copyFileSync(absSrc, absDest);
}

/**
 * 出力側の静的ファイルを削除する（無ければ何もしない）
 */
function removeOutput(config: ResolvedConfig, sourcePath: string): void
{
  const absDest = path.join(config.outputDirAbs, sourcePath);
  if (fs.existsSync(absDest)) {
    fs.rmSync(absDest, { force: true });
  }
}

/**
 * exclude globに一致する相対パスかどうか（POSIX区切り前提）
 */
function isExcluded(sourcePath: string, exclude: string[]): boolean
{
  if (exclude.length === 0) {
    return false;
  }
  return exclude.some((pattern) => matchGlob(sourcePath, pattern));
}

/**
 * 1つのglobパターンとパスを照合する（*, **, ? をサポート）
 */
function matchGlob(value: string, pattern: string): boolean
{
  // ** / * / ? を正規表現へ落として照合する
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0DOUBLE\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0DOUBLE\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
