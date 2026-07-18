import { describe, expect, it } from "vitest";
import { slugify } from "../../src/markdown/slugify.js";

describe("slugify", () => {
  it("英数字を小文字化し空白をハイフンにする", () => {
    // 一般的な英語見出しのスラッグ化
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("日本語の文字を保持する", () => {
    // 日本語ドキュメント向けにCJK文字を落とさない
    expect(slugify("はじめに")).toBe("はじめに");
    expect(slugify("セットアップ手順")).toBe("セットアップ手順");
  });

  it("記号を除去しハイフンは残す", () => {
    // Unicodeの文字・数字・ハイフン以外は落とす
    expect(slugify("A & B!")).toBe("a--b");
    expect(slugify("foo_bar")).toBe("foobar");
  });

  it("英日混在の見出しも正しく処理する", () => {
    expect(slugify("API リファレンス")).toBe("api-リファレンス");
  });
});
