import { describe, expect, it } from "vitest";
import { findPydocDirectives, parsePydocDirectiveBlock } from "../../src/pydoc/directive.js";

describe("parsePydocDirectiveBlock / findPydocDirectives", () => {
  it("モジュールパスのみのディレクティブをパースする", () => {
    const markdown = "Before\n\n::: pydoc mypackage.mymodule\n\nAfter\n";
    const found = findPydocDirectives(markdown);
    expect(found).toHaveLength(1);
    expect(found[0]!.modulePath).toBe("mypackage.mymodule");
    expect(found[0]!.options).toEqual({
      members: null,
      showPrivate: false,
      headingLevel: 2
    });
  });

  it("インデント付きオプションをパースする", () => {
    const block = [
      "::: pydoc mypackage.mymodule",
      "    members: ClassA, func_b     # comment",
      "    show-private: true",
      "    heading-level: 3"
    ].join("\n");
    const parsed = parsePydocDirectiveBlock(block);
    expect(parsed).not.toBeNull();
    expect(parsed!.modulePath).toBe("mypackage.mymodule");
    expect(parsed!.options.members).toEqual(["ClassA", "func_b"]);
    expect(parsed!.options.showPrivate).toBe(true);
    expect(parsed!.options.headingLevel).toBe(3);
  });

  it("閉じ:::付きでもディレクティブ範囲を消費する", () => {
    // Admonitionとの衝突を避けるため閉じがあってもpydocとして取る
    const markdown = "::: pydoc foo.bar\n    members: A\n:::\n";
    const found = findPydocDirectives(markdown);
    expect(found).toHaveLength(1);
    expect(found[0]!.modulePath).toBe("foo.bar");
    expect(markdown.slice(found[0]!.start, found[0]!.end)).toContain(":::");
    expect(markdown.slice(found[0]!.start, found[0]!.end)).toContain("members: A");
  });

  it("コードフェンス内の ::: pydoc は検出しない", () => {
    // ドキュメント例が誤展開・ビルド失敗しないよう Admonition と同様にスキップする
    const markdown = [
      "説明",
      "",
      "```markdown",
      "::: pydoc example.mod",
      "```",
      "",
      "::: pydoc real.mod",
      ""
    ].join("\n");
    const found = findPydocDirectives(markdown);
    expect(found).toHaveLength(1);
    expect(found[0]!.modulePath).toBe("real.mod");
  });

  it("~~~ フェンス内の ::: pydoc も検出しない", () => {
    const markdown = "~~~\n::: pydoc inside.fence\n~~~\n\n::: pydoc outside.mod\n";
    const found = findPydocDirectives(markdown);
    expect(found).toHaveLength(1);
    expect(found[0]!.modulePath).toBe("outside.mod");
  });
});
