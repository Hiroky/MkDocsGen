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

  it("main.jsがリンクなしセクション見出しクリックで展開する", () => {
    // 親にurlが無い場合、見出し選択でも子階層を開閉できること
    const mainJs = fs.readFileSync(path.join(ASSETS_DIR, "main.js"), "utf-8");
    expect(mainJs).toContain("initSidebarToggles");
    // トグルボタン以外に、リンク無し行（.nav-label）からの展開処理があること
    expect(mainJs).toMatch(/\.nav-label[\s\S]*aria-expanded|aria-expanded[\s\S]*\.nav-label/);
    expect(mainJs).toMatch(/nav-section-row[\s\S]*\.nav-link|querySelector\("\.nav-link"\)/);
  });

  it("テーマ切替はアイコンボタンで検索の左に置かれる", () => {
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({ contentHtml: "<p>Body</p>" });
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page], []));

    // テーマトグルが検索より前にあり、テキストではなくアイコンを持つこと
    const actionsMatch = html.match(/class="header-actions"([\s\S]*?)<\/div>\s*<\/header>/);
    expect(actionsMatch).not.toBeNull();
    const actionsHtml = actionsMatch?.[1] ?? "";
    expect(actionsHtml.indexOf("theme-toggle")).toBeGreaterThanOrEqual(0);
    expect(actionsHtml.indexOf("theme-toggle")).toBeLessThan(actionsHtml.indexOf("data-search"));
    expect(actionsHtml).toContain("theme-toggle-icon");
    expect(actionsHtml).not.toMatch(/theme-toggle-label/);

    // JS側でモードをdata属性へ反映し、CSSでアイコン切替できること
    const mainJs = fs.readFileSync(path.join(ASSETS_DIR, "main.js"), "utf-8");
    expect(mainJs).toMatch(/dataset\.mode\s*=\s*mode|setAttribute\("data-mode"/);
  });

  it("主要フォントのpreloadとfont-display:blockでFOUTを抑止する", () => {
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({ contentHtml: "<p>Body</p>" });
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page], []));

    expect(html).toContain('rel="preload"');
    expect(html).toContain("assets/fonts/inter-latin-wght-normal.woff2");
    expect(html).toContain("assets/fonts/jetbrains-mono-latin-wght-normal.woff2");
    expect(html).toMatch(/as="font"[^>]*type="font\/woff2"|type="font\/woff2"[^>]*as="font"/);
    // file://ではcrossorigin付きCORS fetchが失敗するため、preloadにcrossoriginを付けない
    expect(html).not.toMatch(/rel="preload"[^>]*crossorigin|crossorigin[^>]*rel="preload"/);

    const css = fs.readFileSync(path.join(ASSETS_DIR, "main.css"), "utf-8");
    expect(css).toContain("font-display: block");
    expect(css).not.toContain("font-display: optional");
  });

  it("main.cssがインタラクティブ要素の:focus-visibleを定義する", () => {
    const css = fs.readFileSync(path.join(ASSETS_DIR, "main.css"), "utf-8");
    expect(css).toContain(":focus-visible");
  });

  it("画像ライトボックス用のdialogマークアップがレンダリング結果に含まれる", () => {
    // 本文画像の拡大表示用dialogと閉じるボタンが全ページに埋め込まれること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({ contentHtml: "<p>Body</p>" });
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page], []));

    expect(html).toContain("data-image-lightbox");
    expect(html).toContain("data-lightbox-close");
    expect(html).toContain("data-lightbox-image");
    expect(html).toContain("data-lightbox-caption");
    expect(html).toContain('aria-label="画像の拡大表示"');
  });

  it("main.jsがリンクなし画像だけライトボックスを開きEscapeでドロワーと二重閉じしない", () => {
    // リンク付き画像は通常遷移、リンクなしはshowModal。閉じた後は元画像へフォーカス復帰
    const mainJs = fs.readFileSync(path.join(ASSETS_DIR, "main.js"), "utf-8");
    expect(mainJs).toContain("initImageLightbox");
    expect(mainJs).toContain('closest("a[href]")');
    expect(mainJs).toContain("showModal");
    expect(mainJs).toContain("image-zoomable");
    // ライトボックス内Escapeは伝播を止め、ドロワーと同時に閉じない
    expect(mainJs).toMatch(/initImageLightbox[\s\S]*Escape[\s\S]*stopPropagation/);
    // 閉じたあとに元画像へフォーカスを戻す
    expect(mainJs).toMatch(/initImageLightbox[\s\S]*\.focus\(/);
  });
});
