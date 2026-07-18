import { describe, expect, it } from "vitest";
import { createConverter } from "../../src/markdown/convert.js";
import { createMarkdownConfig, createSilentLogger } from "./helpers.js";

describe("createConverter", () => {
  describe("C-1 基本変換", () => {
    it("GFMテーブルをHTMLのtableに変換する", () => {
      // パイプ区切りの表がtable要素になること
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html } = converter.convert("| a | b |\n| --- | --- |\n| 1 | 2 |\n", "index.md");

      expect(html).toContain("<table>");
      expect(html).toContain("<th>");
      expect(html).toContain("a");
      expect(html).toContain("1");
    });

    it("タスクリストをチェックボックス付きliに変換する", () => {
      // [ ] / [x] で始まるリスト項目がcheckboxになること
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html } = converter.convert("- [ ] todo\n- [x] done\n", "index.md");

      expect(html).toContain('type="checkbox"');
      expect(html).toContain("disabled");
      expect(html).toMatch(/<input[^>]*checked/);
      expect(html).toContain("todo");
      expect(html).toContain("done");
    });

    it("打ち消し線をs要素に変換する", () => {
      // ~~text~~ が markdown-it標準どおり <s> になること
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html } = converter.convert("~~old~~\n", "index.md");

      expect(html).toContain("<s>old</s>");
    });

    it("URL文字列を自動リンクする", () => {
      // linkifyにより裸のURLがaタグになること
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html } = converter.convert("see https://example.com/path\n", "index.md");

      expect(html).toContain('href="https://example.com/path"');
    });

    it("allow_htmlがfalseのとき生HTMLをエスケープする", () => {
      // 社内以外の用途向けにスクリプト挿入を防ぐ
      const converter = createConverter(createMarkdownConfig({ allowHtml: false }), createSilentLogger());
      const { html } = converter.convert("<script>alert(1)</script>\n", "index.md");

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("allow_htmlがtrueのとき生HTMLを通す", () => {
      // デフォルトは執筆者を信頼するモデル
      const converter = createConverter(createMarkdownConfig({ allowHtml: true }), createSilentLogger());
      const { html } = converter.convert('<div class="note">hi</div>\n', "index.md");

      expect(html).toContain('<div class="note">hi</div>');
    });
  });

  describe("C-2 アンカー/headings", () => {
    it("見出しにidを付与しh2以上をheadingsに抽出する", () => {
      // h1はページタイトル扱いのためheadingsから除外する
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html, headings } = converter.convert("# Title\n\n## Setup\n\n### Detail\n", "index.md");

      expect(html).toContain('id="setup"');
      expect(html).toContain('id="detail"');
      expect(headings).toEqual([
        { level: 2, text: "Setup", anchorId: "setup" },
        { level: 3, text: "Detail", anchorId: "detail" }
      ]);
    });

    it("日本語見出しのslugを保持する", () => {
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html, headings } = converter.convert("## はじめに\n", "index.md");

      expect(html).toContain('id="はじめに"');
      expect(headings).toEqual([{ level: 2, text: "はじめに", anchorId: "はじめに" }]);
    });

    it("重複見出しは-2連番で一意化する", () => {
      // 同じ見出しが複数あるときアンカーが衝突しないようにする
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html, headings } = converter.convert("## Note\n\n## Note\n\n## Note\n", "index.md");

      expect(html).toContain('id="note"');
      expect(html).toContain('id="note-2"');
      expect(html).toContain('id="note-3"');
      expect(headings.map((h) => h.anchorId)).toEqual(["note", "note-2", "note-3"]);
    });

    it("インライン装飾を含む見出しはテキストのみ抽出する", () => {
      // 太字などが付いていても目次テキストはタグなしにする
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { headings } = converter.convert("## Hello **World**\n", "index.md");

      expect(headings).toEqual([{ level: 2, text: "Hello World", anchorId: "hello-world" }]);
    });
  });

  describe("C-3 内部リンク書き換え", () => {
    it("相対.mdリンクを.htmlに書き換え、アンカーを保持する", () => {
      // ビルド後もページ間リンクが切れないようにする
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html } = converter.convert("[x](../guide/setup.md#sec)\n", "index.md");

      expect(html).toContain('href="../guide/setup.html#sec"');
      expect(html).not.toContain(".md");
    });

    it("拡張子なしの相対リンクや.md以外は書き換えない", () => {
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { html } = converter.convert("[a](./page.html)\n", "index.md");

      expect(html).toContain('href="./page.html"');
    });

    it("外部・絶対・アンカーのみのリンクは書き換えない", () => {
      // http(s) / サイト絶対 / mailto / ページ内アンカーはそのまま
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const md = [
        "[a](https://example.com/a.md)",
        "[b](//cdn.example.com/a.md)",
        "[c](mailto:a@example.com)",
        "[d](/abs/path.md)",
        "[e](#local-anchor)"
      ].join("\n\n");
      const { html } = converter.convert(md, "index.md");

      expect(html).toContain('href="https://example.com/a.md"');
      expect(html).toContain('href="//cdn.example.com/a.md"');
      expect(html).toContain('href="mailto:a@example.com"');
      expect(html).toContain('href="/abs/path.md"');
      expect(html).toContain('href="#local-anchor"');
    });
  });

  describe("C-4 plainText抽出", () => {
    it("HTMLタグを除去しエンティティを復元して空白を正規化する", () => {
      // 検索インデックス用の布石としてプレーンテキストを保持する
      const converter = createConverter(createMarkdownConfig(), createSilentLogger());
      const { plainText } = converter.convert("# Hello\n\nA & B  \n\n**bold**\n", "index.md");

      expect(plainText).not.toMatch(/<[^>]+>/);
      expect(plainText).toContain("Hello");
      expect(plainText).toContain("A & B");
      expect(plainText).toContain("bold");
      // 連続空白は1つに正規化されている
      expect(plainText).not.toMatch(/\s{2,}/);
    });
  });
});
