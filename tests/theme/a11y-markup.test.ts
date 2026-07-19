import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Renderer } from "../../src/render/renderer.js";
import { createRenderFixture, createTestContext, createTestPage } from "../render/helpers.js";

const cleanups: Array<() => void> = [];
const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates/assets");

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("theme a11y markup", () => {
  it("skip-link・aria-current・aria-expandedがレンダリング結果に含まれる", () => {
    // 仕様4.6: ナビにaria-current / aria-expanded、スキップリンクがあること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({
      contentHtml: "<h2 id=\"sec\">Section</h2><p>Body</p>",
      headings: [
        { level: 2, text: "Section", anchorId: "sec" },
        { level: 2, text: "More", anchorId: "more" }
      ]
    });
    // サイドバーのaria-currentを出すため、現在ページを含むnavを渡す
    const nav = [{ title: "Home", url: "index.html", children: [] }];
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page], nav));

    expect(html).toContain('class="skip-link"');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("aria-expanded");
    expect(html).toContain('aria-label="ページ内目次"');
  });

  it("main.jsがTOCのaria-current更新とドロワーEscape閉じを含む", () => {
    // クライアント側の必須キーボード/ARIA挙動が実装されていること
    const mainJs = fs.readFileSync(path.join(ASSETS_DIR, "main.js"), "utf-8");
    expect(mainJs).toContain('setAttribute("aria-current"');
    expect(mainJs).toContain('removeAttribute("aria-current")');
    // Escapeでドロワーを閉じる分岐があること
    expect(mainJs).toMatch(/initDrawer[\s\S]*Escape[\s\S]*setOpen\(false/);
    // 閉じたドロワーは inert / aria-hidden でフォーカス不可にし、トグルへフォーカス復帰する
    expect(mainJs).toContain('setAttribute("inert"');
    expect(mainJs).toContain('setAttribute("aria-hidden", "true")');
    expect(mainJs).toContain("toggle.focus()");
    // 検索結果が開いている Escape は stopPropagation し、ドロワーと二重閉じしない
    expect(mainJs).toMatch(/Escape[\s\S]*stopPropagation/);
  });

  it("main.cssがインタラクティブ要素の:focus-visibleを定義する", () => {
    const css = fs.readFileSync(path.join(ASSETS_DIR, "main.css"), "utf-8");
    expect(css).toContain(":focus-visible");
  });
});
