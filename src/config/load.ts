import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ZodIssue } from "zod";
import { rawConfigSchema, type ResolvedConfig } from "./schema.js";

/**
 * 設定読込で発生するエラー。CLIはこのメッセージをそのまま表示して終了コード1にする
 */
export class ConfigError extends Error
{
  /**
   * ConfigErrorを生成する
   */
  constructor(message: string)
  {
    // Errorのメッセージとスタックを正しく初期化する
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * zodのissue一覧を「キーパス: メッセージ」形式の複数行文字列に整形する
 */
function formatZodIssues(issues: ZodIssue[]): string
{
  // 例: "site.title: Invalid input: expected string, received undefined"
  return issues.map((issue) => {
    // 未知キーはissue.keysに実キー名が入るため、メッセージから拾えるようにする
    const keyPath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${keyPath}: ${issue.message}`;
  }).join("\n");
}

/**
 * 設定ファイルを読み込み、検証・パス解決済みのResolvedConfigを返す
 */
export function loadConfig(configPath: string): ResolvedConfig
{
  // 相対パスでも安定して扱えるよう、まず絶対パスへ正規化する
  const absPath = path.resolve(configPath);

  // ファイルが存在しない場合はinitの実行を促すエラーにする（仕様書2.8）
  if (!fs.existsSync(absPath)) {
    throw new ConfigError(
      `設定ファイルが見つかりません: ${absPath}\n` +
      `mkdocsgen init を実行して雛形を生成してください`
    );
  }

  // YAMLをパースする。構文エラー時は行番号付きで報告する（yamlパッケージのlinePosを使用）
  const source = fs.readFileSync(absPath, "utf-8");
  let raw: unknown;
  try {
    raw = YAML.parse(source);
  } catch (error) {
    // YAMLParseErrorなら行・列を埋め込み、それ以外はメッセージだけ載せる
    const message = error instanceof Error ? error.message : String(error);
    const linePos = (error as { linePos?: Array<{ line: number; col: number }> }).linePos;
    if (linePos && linePos.length > 0 && linePos[0]) {
      const { line, col } = linePos[0];
      throw new ConfigError(`YAML構文エラー (${line}:${col}): ${message}`);
    }
    throw new ConfigError(`YAML構文エラー: ${message}`);
  }

  // zodで検証する。失敗時はキーのパスと期待型を整形して報告する
  const parsed = rawConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    // 例: "site.title: ..." を issue ごとに1行で列挙する
    throw new ConfigError(formatZodIssues(parsed.error.issues));
  }

  // 相対パスを設定ファイル基準の絶対パスへ解決して返す
  const configDir = path.dirname(absPath);
  return {
    ...parsed.data,
    configPath: absPath,
    configDir,
    docsDirAbs: path.resolve(configDir, parsed.data.docs_dir),
    outputDirAbs: path.resolve(configDir, parsed.data.output_dir),
    overridesDirAbs: path.resolve(configDir, parsed.data.theme.overrides_dir)
  };
}
