import { describe, expect, it } from "vitest";
import { injectLivereloadScript, LIVERELOAD_CLIENT_JS } from "../../src/server/livereload.js";

describe("injectLivereloadScript", () => {
  it("</body>直前へscriptタグを挿入する", () => {
    // serve配信時だけ注入し、ビルド成果物自体は汚さない前提のヘルパ
    const html = "<html><body><p>hi</p></body></html>";
    const result = injectLivereloadScript(html);
    expect(result).toContain('<script src="/__mkdocsgen/livereload.js"></script>\n</body>');
  });

  it("既に注入済みなら二重挿入しない", () => {
    const html = '<html><body><script src="/__mkdocsgen/livereload.js"></script></body></html>';
    expect(injectLivereloadScript(html)).toBe(html);
  });
});

describe("LIVERELOAD_CLIENT_JS", () => {
  it("エラーオーバーレイ表示とreload時の非表示を含む", () => {
    // 仕様2.8: serve中のビルドエラーはオーバーレイ表示、修正後に自動復帰
    expect(LIVERELOAD_CLIENT_JS).toContain("data-mkdocsgen-error-overlay");
    expect(LIVERELOAD_CLIENT_JS).toContain("MkDocsGen build error");
    expect(LIVERELOAD_CLIENT_JS).toContain('data.type === "error"');
    expect(LIVERELOAD_CLIENT_JS).toContain("showError");
    expect(LIVERELOAD_CLIENT_JS).toContain('data.type === "reload"');
    expect(LIVERELOAD_CLIENT_JS).toContain("hideError");
  });
});
