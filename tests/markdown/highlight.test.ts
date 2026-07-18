import { describe, expect, it } from "vitest";
import { createConverter } from "../../src/markdown/convert.js";
import { createMarkdownConfig, createSilentLogger } from "./helpers.js";

describe("コードブロック / Shiki / Mermaid", () => {
  it("言語指定ありのコードをShiki dual theme HTMLに変換する", async () => {
    // ビルド時ハイライトとライト/ダーク両用のCSS変数が付くこと
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const { html } = converter.convert("```ts\nconst x: number = 1;\n```\n", "index.md");

    expect(html).toContain('class="code-block"');
    expect(html).toContain("data-code-copy");
    expect(html).toContain("shiki");
    expect(html).toContain("--shiki-");
    expect(html).toContain("const");
  });

  it("言語指定なしはプレーンなpre/codeとして描画する", async () => {
    // Shikiを通さずプレーンテキストとして出す
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const { html } = converter.convert("```\nplain text\n```\n", "index.md");

    expect(html).toContain('class="code-block"');
    expect(html).toContain("data-code-copy");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("plain text");
    expect(html).not.toContain("shiki");
  });

  it("mermaidフェンスはpre.mermaidとして出力しコピーボタンは付けない", async () => {
    // クライアントサイド描画用に生の図定義を残す
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const { html } = converter.convert("```mermaid\ngraph TD\n  A --> B\n```\n", "index.md");

    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("graph TD");
    // HTMLエスケープ後も矢印が残ること（textContentでは --> に戻る）
    expect(html).toContain("A --&gt; B");
    expect(html).not.toContain("data-code-copy");
    expect(html).not.toContain("shiki");
  });

  it("コピー用ボタンに生コードをdata属性で載せる", async () => {
    // クリック時にクリップボードへ渡す元データを保持する
    const converter = await createConverter(createMarkdownConfig(), createSilentLogger());
    const { html } = converter.convert("```js\nconsole.log(\"hi\");\n```\n", "index.md");

    expect(html).toMatch(/data-code="[^"]*console\.log/);
  });
});
