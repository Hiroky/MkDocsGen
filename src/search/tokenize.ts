/**
 * 検索用にテキストをbigramトークンへ分解する
 */
export function tokenizeBigrams(text: string): string[]
{
  // 空白で語に分け、語ごとにトークンを集める
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const tokens: string[] = [];

  for (const word of words) {
    // 英数字のみの語は小文字化して語トークンを残し、さらにbigramも追加する
    if (/^[A-Za-z0-9]+$/.test(word)) {
      const lower = word.toLowerCase();
      tokens.push(lower);
      // 2文字以上ならオーバーラップbigramも追加する（部分一致用）
      if (lower.length >= 2) {
        for (let i = 0; i < lower.length - 1; i++) {
          tokens.push(lower.slice(i, i + 2));
        }
      }
      continue;
    }

    // 日本語など空白なし連続文字はオーバーラップbigramにする
    if (word.length === 1) {
      // 1文字はbigramにできないためそのまま残す（検索漏れ防止）
      tokens.push(word);
      continue;
    }
    for (let i = 0; i < word.length - 1; i++) {
      tokens.push(word.slice(i, i + 2));
    }
  }

  return tokens;
}
