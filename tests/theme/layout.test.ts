import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates/assets/main.css");

/**
 * セレクタに対応するトップレベルのCSSルール本体を抜き出す
 */
function extractRuleBody(css: string, selector: string): string
{
  // セレクタ直後の { ... } を取り出し、ネスト無しの単純ルール向けに使う
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  expect(match, `rule for ${selector} should exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("theme layout sticky columns", () => {
  it("短いページでフッタを押し出さないよう sticky カラムは max-height と align-self:start を使う", () => {
    // フッタが layout 外にあるため、height:100vh だと sticky カラムが layout を押し広げてフッタが見切れる
    const css = fs.readFileSync(CSS_PATH, "utf-8");
    const sidebar = extractRuleBody(css, ".sidebar");
    const toc = extractRuleBody(css, ".toc-sidebar");

    // ビューポート高さで固定せず、上限だけにしてグリッド行を膨らませない
    expect(sidebar).toContain("align-self: start");
    expect(sidebar).toContain("max-height: calc(100vh - var(--header-height))");
    expect(sidebar).not.toMatch(/(?<!max-)height:\s*calc\(100vh/);

    expect(toc).toContain("align-self: start");
    expect(toc).toContain("max-height: calc(100vh - var(--header-height))");
    expect(toc).not.toMatch(/(?<!max-)height:\s*calc\(100vh/);
  });

  it("PyDocの関数見出しを下線付きセクションとして表示する", () => {
    const css = fs.readFileSync(CSS_PATH, "utf-8");

    expect(css).toContain(".page-body h4,");
    expect(css).toContain(".page-body.pydoc-page h3,");
    expect(css).toContain(".page-body.pydoc-page h4,");
    expect(css).toContain("border-bottom: 1px solid var(--color-border)");
    expect(css).toContain(".page-body.pydoc-page p:has(> strong:only-child)");
    expect(css).not.toContain(".page-body p:has(> strong:only-child)");
  });

  it("画像ライトボックスと拡大可能画像のスタイルを定義する", () => {
    // クリック拡大対象のカーソルとdialogオーバーレイがテーマに含まれること
    const css = fs.readFileSync(CSS_PATH, "utf-8");
    const zoomable = extractRuleBody(css, ".page-body img.image-zoomable");
    expect(zoomable).toContain("cursor: zoom-in");

    expect(css).toContain(".image-lightbox");
    expect(css).toContain(".image-lightbox::backdrop");
    expect(css).toContain("var(--color-overlay)");
  });
});
