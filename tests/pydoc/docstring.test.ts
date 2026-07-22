import { describe, expect, it } from "vitest";
import { mergeArgTypes, parseGoogleDocstring } from "../../src/pydoc/docstring.js";

describe("parseGoogleDocstring", () => {
  it("概要と Args / Returns / Raises / Examples / Note / Warning を構造化する", () => {
    // 仕様2.5.4の各セクションを取り出せること
    const parsed = parseGoogleDocstring(`
    Greet someone.

    Extra body line.

    Args:
        name: Person name.
        times (int): Repeat count.

    Returns:
        Greeting message.

    Raises:
        ValueError: If name is empty.

    Examples:
        >>> greet("a")
        'Hello, a! '

    Note:
        Keep it short.

    Warning:
        May be loud.
    `);

    expect(parsed.summary).toBe("Greet someone.");
    expect(parsed.body).toContain("Extra body line.");
    expect(parsed.args).toEqual([
      { name: "name", type: null, description: "Person name." },
      { name: "times", type: "int", description: "Repeat count." }
    ]);
    expect(parsed.returns).toBe("Greeting message.");
    expect(parsed.raises).toEqual([{ type: "ValueError", description: "If name is empty." }]);
    expect(parsed.examples[0]).toContain('>>> greet("a")');
    expect(parsed.notes).toEqual([
      { kind: "note", text: "Keep it short." },
      { kind: "warning", text: "May be loud." }
    ]);
  });

  it("Yields を returns として取り出す", () => {
    const parsed = parseGoogleDocstring("Yield values.\n\nYields:\n    Items.\n");
    expect(parsed.returns).toBe("Items.");
  });

  it("ReSTのcode-blockを空行を含む1つのPythonコードブロックとして取り出す", () => {
    const parsed = parseGoogleDocstring(`
    Example.

    Examples:
        .. code-block:: python

            import engine.cmds as cmds

            entity = cmds.createEntity()
            print(entity)
    `);

    expect(parsed.examples).toEqual([
      "import engine.cmds as cmds\n\nentity = cmds.createEntity()\nprint(entity)"
    ]);
  });

  it("ReSTの縦棒付き本文をコードブロックにせず通常本文として取り出す", () => {
    const parsed = parseGoogleDocstring([
      "現在のシーンを保存",
      "",
      "\t| 指定したシーンオブジェクトを保存します。",
      "\t| pathがNoneの場合は上書き保存、指定した場合は別名保存となります。",
      ""
    ].join("\n"));

    expect(parsed.body).toBe(
      "指定したシーンオブジェクトを保存します。\npathがNoneの場合は上書き保存、指定した場合は別名保存となります。"
    );
  });

  it("空行後にインデントされた通常本文をコードブロックにしない", () => {
    const parsed = parseGoogleDocstring([
      "現在のシーンを保存",
      "",
      "\t指定したシーンオブジェクトを保存します。",
      "\tpathがNoneの場合は上書き保存、指定した場合は別名保存となります。",
      ""
    ].join("\n"));

    expect(parsed.body).toBe(
      "指定したシーンオブジェクトを保存します。\npathがNoneの場合は上書き保存、指定した場合は別名保存となります。"
    );
  });

  it("解釈できない部分をエラーにせず本文へ残す", () => {
    // 不正形式はプレーンテキスト許容
    const parsed = parseGoogleDocstring("Summary.\n\nNotARealSection:\n    stuff\n");
    expect(parsed.summary).toBe("Summary.");
    expect(parsed.body).toContain("NotARealSection:");
    expect(parsed.body).toContain("stuff");
  });
});

describe("mergeArgTypes", () => {
  it("シグネチャの型注釈を Args の型より優先する", () => {
    const docstring = parseGoogleDocstring("Do.\n\nArgs:\n    x (str): value\n");
    const merged = mergeArgTypes(docstring, new Map([["x", "int"]]));
    expect(merged?.args[0]?.type).toBe("int");
  });
});
