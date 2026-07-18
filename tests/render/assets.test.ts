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
});
