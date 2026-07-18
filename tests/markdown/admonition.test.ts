import { describe, expect, it, vi } from "vitest";
import { createConverter } from "../../src/markdown/convert.js";
import { Logger } from "../../src/logger.js";
import { createMarkdownConfig, createSilentLogger } from "./helpers.js";

describe("Admonition", () => {
  it("対応5タイプをadmonitionクラス付きasideに変換する", async () => {
    // note / tip / warning / danger / info がそれぞれ描画されること
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const types = ["note", "tip", "warning", "danger", "info"] as const;

    for (const type of types) {
      const { html } = converter.convert(`::: ${type}\nbody\n:::\n`, "index.md");
      expect(html).toContain(`class="admonition admonition-${type}"`);
      expect(html).toContain('class="admonition-title"');
      // タイトル省略時はタイプ名の大文字化（NOTE 等）
      expect(html).toContain(type.toUpperCase());
      expect(html).toContain('class="admonition-body"');
      expect(html).toContain("body");
    }
  });

  it("タイトル指定時はその文字列をタイトルに使う", async () => {
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const { html } = converter.convert("::: tip 便利なヒント\n本文です\n:::\n", "index.md");

    expect(html).toContain("便利なヒント");
    expect(html).not.toContain(">TIP<");
    expect(html).toContain("本文です");
  });

  it("本文内のMarkdown記法を変換する", async () => {
    // Admonition本文でも太字などが効くこと
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const { html } = converter.convert("::: note\n**太字**と`code`\n:::\n", "index.md");

    expect(html).toContain("<strong>太字</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("未知タイプは警告を出してnoteとして描画する", async () => {
    // 未知タイプでもビルドを止めず、noteにフォールバックする
    const warn = vi.fn();
    const logger = new Logger(false, {
      stdout: () => {},
      stderr: warn
    });
    const converter = await createConverter(createMarkdownConfig(), logger);
    const { html } = converter.convert("::: weird\nfallback\n:::\n", "guide/x.md");

    expect(html).toContain('class="admonition admonition-note"');
    expect(html).toContain("NOTE");
    expect(html).toContain("fallback");
    expect(logger.getWarnCount()).toBe(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/weird/);
    expect(warn.mock.calls[0]?.[0]).toMatch(/guide\/x\.md/);
  });
});
