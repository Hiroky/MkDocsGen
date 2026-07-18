import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config/load.js";

/** このテストファイル基準でフィクスチャへの絶対パスを作る */
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/configs");

/**
 * フィクスチャYAMLへの絶対パスを返す
 */
function fixture(name: string): string
{
  return path.join(fixturesDir, name);
}

describe("loadConfig", () => {
  it("必須項目のみのYAMLでデフォルト値が適用される", () => {
    // 正常系: スキーマデフォルトが乗ったResolvedConfigになる
    const config = loadConfig(fixture("minimal.yml"));

    expect(config.site.title).toBe("Minimal Site");
    expect(config.site.description).toBe("");
    expect(config.docs_dir).toBe("docs");
    expect(config.output_dir).toBe("site");
    expect(config.theme.default_mode).toBe("auto");
    expect(config.markdown.allow_html).toBe(true);
  });

  it("相対パスは設定ファイル基準の絶対パスに解決される", () => {
    // docs_dir等はcwdではなくconfigDir基準で解決する
    const configPath = fixture("relative-paths.yml");
    const config = loadConfig(configPath);
    const configDir = path.dirname(configPath);

    expect(config.configPath).toBe(path.resolve(configPath));
    expect(config.configDir).toBe(configDir);
    expect(config.docsDirAbs).toBe(path.resolve(configDir, "content/docs"));
    expect(config.outputDirAbs).toBe(path.resolve(configDir, "build/site"));
    expect(config.overridesDirAbs).toBe(path.resolve(configDir, "custom_theme"));
  });

  it("site.title欠落はConfigErrorになる", () => {
    // スキーマ違反はキー名を含むメッセージで報告する
    expect(() => loadConfig(fixture("missing-title.yml"))).toThrow(ConfigError);
    try {
      loadConfig(fixture("missing-title.yml"));
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("site.title");
    }
  });

  it("未知キーはConfigErrorになる", () => {
    // タイポ検出のため未知キー名をメッセージに含める
    expect(() => loadConfig(fixture("unknown-key.yml"))).toThrow(ConfigError);
    try {
      loadConfig(fixture("unknown-key.yml"));
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("sitee");
    }
  });

  it("YAML構文エラーは行番号付きのConfigErrorになる", () => {
    // 仕様書2.8: 構文エラーは行番号付きで報告する
    expect(() => loadConfig(fixture("syntax-error.yml"))).toThrow(ConfigError);
    try {
      loadConfig(fixture("syntax-error.yml"));
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toMatch(/YAML構文エラー \(\d+:\d+\)/);
    }
  });

  it("ファイル不在はmkdocsgen initを促すConfigErrorになる", () => {
    // 仕様書2.8: 不在時はinit実行を促す
    const missing = path.join(fixturesDir, "does-not-exist.yml");
    expect(() => loadConfig(missing)).toThrow(ConfigError);
    try {
      loadConfig(missing);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("mkdocsgen init");
      expect((error as ConfigError).message).toContain(path.resolve(missing));
    }
  });
});
