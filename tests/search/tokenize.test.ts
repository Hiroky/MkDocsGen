import { describe, expect, it } from "vitest";
import { tokenizeBigrams } from "../../src/search/tokenize.js";

describe("tokenizeBigrams", () => {
  it("日本語をオーバーラップbigramに分解する", () => {
    // 2文字ずつずらしてトークン化する（仕様の日本語検索対応）
    expect(tokenizeBigrams("検索")).toEqual(["検索"]);
    expect(tokenizeBigrams("全文検索")).toEqual(["全文", "文検", "検索"]);
  });

  it("1文字の日本語はそのまま残す", () => {
    // bigramにできない1文字を落とすと検索漏れになるため残す
    expect(tokenizeBigrams("あ")).toEqual(["あ"]);
  });

  it("英単語は小文字化し、語トークンとbigramの両方を返す", () => {
    // 完全一致と部分一致の両方に効かせる
    expect(tokenizeBigrams("Hello")).toEqual(["hello", "he", "el", "ll", "lo"]);
    expect(tokenizeBigrams("ab")).toEqual(["ab", "ab"]);
  });

  it("空白区切りの複数語をそれぞれ処理する", () => {
    // 英日混在テキストを語単位でトークン化する
    const tokens = tokenizeBigrams("Hello 世界");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("he");
    expect(tokens).toContain("世界");
  });

  it("空文字や空白のみは空配列を返す", () => {
    expect(tokenizeBigrams("")).toEqual([]);
    expect(tokenizeBigrams("   ")).toEqual([]);
  });
});
