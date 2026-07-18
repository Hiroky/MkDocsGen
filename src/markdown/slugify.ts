/**
 * 見出しテキストをアンカーID用のslugに変換する（日本語の文字は保持する）
 */
export function slugify(text: string): string
{
  // 1. 小文字化する（英語見出しの慣習に合わせる）
  const lower = text.toLowerCase();
  // 2. 空白類をハイフンに置き換える
  const spaced = lower.replace(/\s+/g, "-");
  // 3. Unicodeの文字・数字・ハイフン以外を除去する（日本語は\p{L}で残る）
  return spaced.replace(/[^\p{L}\p{N}-]/gu, "");
}
