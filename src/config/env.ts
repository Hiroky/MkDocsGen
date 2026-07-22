import fs from "node:fs";
import path from "node:path";

/**
 * .env形式のテキストを KEY=VALUE のレコードへ解析する
 */
export function parseEnvFile(content: string): Record<string, string>
{
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    // 空行・コメント行はスキップする
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    // "="を含まない行（構文として不正）はスキップする
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (key === "") {
      continue;
    }

    let value = line.slice(eqIndex + 1).trim();
    // 前後が同じクォート文字で囲まれていれば剥がす
    const isDoubleQuoted = value.startsWith("\"") && value.endsWith("\"") && value.length >= 2;
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * docs_dir配下の.envを読み、未設定のprocess.envキーにのみ反映する
 * （シェルでexport済みの環境変数を優先し、上書きしない）
 */
export function loadDocsEnv(docsDirAbs: string): string[]
{
  const envPath = path.join(docsDirAbs, ".env");
  // .envは任意ファイルのため、無ければ何もせず静かに続行する
  if (!fs.existsSync(envPath)) {
    return [];
  }

  const content = fs.readFileSync(envPath, "utf-8");
  const parsed = parseEnvFile(content);

  const appliedKeys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      appliedKeys.push(key);
    }
  }

  return appliedKeys;
}
