import { describe, expect, it } from "vitest";
import { rawConfigSchema } from "../../src/config/schema.js";

describe("rawConfigSchema", () => {
  it("必須項目のみの入力でデフォルト値がすべて適用される", () => {
    // site.titleだけあれば残りは仕様どおりのデフォルトになることを確認する
    const result = rawConfigSchema.safeParse({
      site: { title: "My Docs" }
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.site.title).toBe("My Docs");
    expect(result.data.site.description).toBe("");
    expect(result.data.site.base_url).toBe("/");
    expect(result.data.docs_dir).toBe("docs");
    expect(result.data.output_dir).toBe("site");
    expect(result.data.nav).toEqual([]);
    expect(result.data.exclude).toEqual([]);
    expect(result.data.theme.overrides_dir).toBe("theme_overrides");
    expect(result.data.theme.default_mode).toBe("auto");
    expect(result.data.theme.custom_css).toEqual([]);
    expect(result.data.markdown.allow_html).toBe(true);
    expect(result.data.pydoc.source_dirs).toEqual([]);
    expect(result.data.plugins).toEqual([]);
    expect(result.data.serve.port).toBe(3000);
  });

  it("site.title欠落はスキーマエラーになる", () => {
    // 唯一の必須項目が無い場合は失敗させる
    const result = rawConfigSchema.safeParse({
      site: {}
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    // エラーパスにtitleが含まれることを確認する
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths.some((path) => path === "site.title" || path.endsWith("title"))).toBe(true);
  });

  it("未知キーはstrictで拒否する", () => {
    // タイポ（siteeなど）を早期に検出するため未知キーをエラーにする
    const result = rawConfigSchema.safeParse({
      site: { title: "My Docs" },
      sitee: { title: "typo" }
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const messages = result.error.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("sitee");
  });

  it("pydoc / plugins / serve を書いても検証を通す", () => {
    // MVP未使用項目でも設定ファイルに書けばエラーにしない
    const result = rawConfigSchema.safeParse({
      site: { title: "My Docs" },
      pydoc: { source_dirs: ["./src"] },
      plugins: [{ path: "./plugins/foo.mjs", options: { space: "DOCS" } }],
      serve: { port: 4000 }
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.pydoc.source_dirs).toEqual(["./src"]);
    expect(result.data.plugins).toEqual([{ path: "./plugins/foo.mjs", options: { space: "DOCS" } }]);
    expect(result.data.serve.port).toBe(4000);
  });
});
