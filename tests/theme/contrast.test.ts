import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** テーマCSSの絶対パス */
const CSS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates/assets/main.css");

/**
 * #RRGGBB を 0–1 の sRGB に分解する
 */
function parseHex(hex: string): [number, number, number]
{
  const normalized = hex.replace("#", "").toLowerCase();
  const full = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * sRGB成分を相対輝度用に線形化する
 */
function linearize(channel: number): number
{
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG相対輝度を計算する
 */
function relativeLuminance(hex: string): number
{
  const [r, g, b] = parseHex(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 2色のコントラスト比を返す（大きい方が前景でも背景でも可）
 */
function contrastRatio(a: string, b: string): number
{
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * マーカー文字列の直後にある最初の { ... } から --color-* を抽出する
 */
function extractPaletteAfter(css: string, marker: string): Record<string, string>
{
  const markerIndex = css.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`palette marker not found: ${marker}`);
  }
  const braceStart = css.indexOf("{", markerIndex);
  if (braceStart < 0) {
    throw new Error(`palette block brace not found after: ${marker}`);
  }
  const braceEnd = css.indexOf("}", braceStart);
  if (braceEnd < 0) {
    throw new Error(`palette block end not found after: ${marker}`);
  }
  const block = css.slice(braceStart + 1, braceEnd);
  const vars: Record<string, string> = {};
  for (const line of block.split(";")) {
    const m = line.match(/--color-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*/);
    if (m) {
      vars[m[1]] = m[2];
    }
  }
  return vars;
}

describe("theme contrast (WCAG AA)", () => {
  it("ライト/ダークの主要テキスト・アクセント対がコントラスト比4.5以上", () => {
    // 仕様4.6: カラーパレットはライト/ダークともWCAG AAを満たす
    const css = fs.readFileSync(CSS_PATH, "utf-8");
    // :root と light は同一ブロックなので :root から取る
    const lightPalette = extractPaletteAfter(css, ":root");
    const dark = extractPaletteAfter(css, 'html[data-theme="dark"]');
    const pairs: Array<{ name: string; fg: string; bg: string; palette: Record<string, string> }> = [
      { name: "light text/bg", fg: "text", bg: "bg", palette: lightPalette },
      { name: "light text/surface", fg: "text", bg: "surface", palette: lightPalette },
      { name: "light muted/bg", fg: "text-muted", bg: "bg", palette: lightPalette },
      { name: "light muted/sidebar", fg: "text-muted", bg: "sidebar-bg", palette: lightPalette },
      { name: "light accent/surface", fg: "accent", bg: "surface", palette: lightPalette },
      { name: "light accent/soft", fg: "accent", bg: "accent-soft", palette: lightPalette },
      { name: "dark text/bg", fg: "text", bg: "bg", palette: dark },
      { name: "dark text/surface", fg: "text", bg: "surface", palette: dark },
      { name: "dark muted/bg", fg: "text-muted", bg: "bg", palette: dark },
      { name: "dark muted/sidebar", fg: "text-muted", bg: "sidebar-bg", palette: dark },
      { name: "dark accent/surface", fg: "accent", bg: "surface", palette: dark },
      { name: "dark accent/soft", fg: "accent", bg: "accent-soft", palette: dark }
    ];

    for (const pair of pairs) {
      const fg = pair.palette[pair.fg];
      const bg = pair.palette[pair.bg];
      expect(fg, `${pair.name} fg missing`).toBeTruthy();
      expect(bg, `${pair.name} bg missing`).toBeTruthy();
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${pair.name} ${fg}/${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
