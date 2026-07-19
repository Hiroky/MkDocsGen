import { describe, expect, it } from "vitest";
import { injectLivereloadScript } from "../../src/server/livereload.js";

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
