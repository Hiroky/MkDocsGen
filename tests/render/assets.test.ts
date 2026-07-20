import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "../../src/config/load.js";
import { copyAssets } from "../../src/render/assets.js";
import { createRenderFixture } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("copyAssets", () => {
  it("テーマアセットをoutput/assetsへコピーする", () => {
    // 組み込みmain.css / main.jsが出力側へ届くこと
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    const customCss = copyAssets(fixture.config);

    expect(customCss).toEqual([]);
    expect(fs.existsSync(path.join(fixture.config.outputDirAbs, "assets", "main.css"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.config.outputDirAbs, "assets", "main.js"))).toBe(true);
  });

  it("同梱フォントをoutput/assets/fontsへコピーしmain.cssが参照する", () => {
    // Latin用webフォント（Inter / JetBrains Mono）がfile://でも読めるよう同梱されること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    copyAssets(fixture.config);

    const fontsDir = path.join(fixture.config.outputDirAbs, "assets", "fonts");
    expect(fs.existsSync(path.join(fontsDir, "inter-latin-wght-normal.woff2"))).toBe(true);
    expect(fs.existsSync(path.join(fontsDir, "jetbrains-mono-latin-wght-normal.woff2"))).toBe(true);
    // main.cssに@font-face宣言とフォント名があること
    const css = fs.readFileSync(path.join(fixture.config.outputDirAbs, "assets", "main.css"), "utf-8");
    expect(css).toContain("@font-face");
    expect(css).toContain("Inter Variable");
    expect(css).toContain("JetBrains Mono Variable");
  });

  it("mermaid.min.jsをoutput/assetsへコピーする", () => {
    // クライアントサイド描画用ランタイムが同梱されること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    copyAssets(fixture.config);

    const mermaidPath = path.join(fixture.config.outputDirAbs, "assets", "mermaid.min.js");
    expect(fs.existsSync(mermaidPath)).toBe(true);
    expect(fs.statSync(mermaidPath).size).toBeGreaterThan(0);
  });

  it("minisearch.min.jsをoutput/assetsへコピーする", () => {
    // 検索の遅延ロード用UMDが同梱されること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    copyAssets(fixture.config);

    const minisearchPath = path.join(fixture.config.outputDirAbs, "assets", "minisearch.min.js");
    expect(fs.existsSync(minisearchPath)).toBe(true);
    expect(fs.statSync(minisearchPath).size).toBeGreaterThan(0);
  });

  it("custom_cssをassets/customへコピーし相対パス一覧を返す", () => {
    // 追加CSSの注入経路を確認する
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const brandPath = path.join(fixture.root, "brand.css");
    fs.writeFileSync(brandPath, "body { color: red; }", "utf-8");
    fixture.config.theme.custom_css = ["brand.css"];
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    const customCss = copyAssets(fixture.config);

    expect(customCss).toEqual(["assets/custom/brand.css"]);
    expect(fs.readFileSync(path.join(fixture.config.outputDirAbs, "assets", "custom", "brand.css"), "utf-8")).toBe("body { color: red; }");
  });

  it("存在しないcustom_cssはConfigErrorにする", () => {
    // 誤ったパスを早期に検出する
    const fixture = createRenderFixture({ customCss: ["missing.css"] });
    cleanups.push(fixture.cleanup);
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    expect(() => copyAssets(fixture.config)).toThrow(ConfigError);
    expect(() => copyAssets(fixture.config)).toThrow(/missing\.css/);
  });

  it("同名basenameのcustom_cssはConfigErrorにする", () => {
    // 上書き衝突を隠さず明示的に失敗させる
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    fs.mkdirSync(path.join(fixture.root, "a"), { recursive: true });
    fs.mkdirSync(path.join(fixture.root, "b"), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, "a", "brand.css"), "a{}", "utf-8");
    fs.writeFileSync(path.join(fixture.root, "b", "brand.css"), "b{}", "utf-8");
    fixture.config.theme.custom_css = ["a/brand.css", "b/brand.css"];
    fs.mkdirSync(fixture.config.outputDirAbs, { recursive: true });

    expect(() => copyAssets(fixture.config)).toThrow(ConfigError);
    expect(() => copyAssets(fixture.config)).toThrow(/basename|同名|重複/);
  });
});
