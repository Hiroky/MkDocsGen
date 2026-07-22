import { describe, expect, it } from "vitest";
import { renderModuleDoc } from "../../src/pydoc/render.js";
import type { PyModuleDoc } from "../../src/pydoc/types.js";

describe("renderModuleDoc", () => {
  const sample: PyModuleDoc = {
    modulePath: "mypackage.mymodule",
    docstring: {
      summary: "Module summary.",
      body: "",
      args: [],
      returns: null,
      raises: [],
      examples: [],
      notes: []
    },
    classes: [
      {
        name: "Greeter",
        bases: ["Base"],
        docstring: {
          summary: "A greeter.",
          body: "",
          args: [],
          returns: null,
          raises: [],
          examples: [],
          notes: [{ kind: "note", text: "Be kind." }]
        },
        methods: [
          {
            name: "__init__",
            signature: "def __init__(self, name: str) -> None",
            params: [
              { name: "self", type: null, default: null },
              { name: "name", type: "str", default: null }
            ],
            returns: "None",
            decorators: [],
            docstring: {
              summary: "Create a greeter.",
              body: "",
              args: [{ name: "name", type: null, description: "Person name." }],
              returns: null,
              raises: [],
              examples: [],
              notes: []
            }
          },
          {
            name: "shout",
            signature: "@staticmethod\ndef shout(text: str) -> str",
            params: [{ name: "text", type: "str", default: null }],
            returns: "str",
            decorators: ["staticmethod"],
            docstring: {
              summary: "Uppercase.",
              body: "",
              args: [{ name: "text", type: null, description: "Input." }],
              returns: "Upper text.",
              raises: [{ type: "ValueError", description: "Empty." }],
              examples: ['>>> Greeter.shout("hi")\n\'HI\''],
              notes: [{ kind: "warning", text: "Loud." }]
            }
          },
          {
            name: "_secret",
            signature: "def _secret(self) -> None",
            params: [{ name: "self", type: null, default: null }],
            returns: "None",
            decorators: [],
            docstring: null
          }
        ],
        attributes: [{ name: "count", type: "int" }]
      }
    ],
    functions: [
      {
        name: "greet",
        signature: "def greet(name: str) -> str",
        params: [{ name: "name", type: "str", default: null }],
        returns: "str",
        decorators: [],
        docstring: {
          summary: "Greet.",
          body: "",
          args: [{ name: "name", type: null, description: "Who." }],
          returns: null,
          raises: [],
          examples: [],
          notes: []
        }
      },
      {
        name: "_hidden",
        signature: "def _hidden() -> None",
        params: [],
        returns: "None",
        decorators: [],
        docstring: null
      }
    ]
  };

  it("見出しレベルとシグネチャ・表・Examples/NoteをMarkdown化する", () => {
    const { markdown, extraHeadings } = renderModuleDoc(sample, {
      members: null,
      showPrivate: false,
      headingLevel: 2
    });

    expect(markdown).toContain("## mymodule");
    expect(markdown).toContain("### Greeter(Base)");
    expect(markdown).not.toContain("class Greeter(Base):");
    expect(markdown).toContain("#### shout(text: str)");
    expect(markdown).not.toContain("def shout(text: str) -> str");
    expect(markdown).toContain("```python");
    expect(markdown).toContain("| Name | Type | Description |");
    expect(markdown).toContain("`text`");
    expect(markdown).toContain("**Returns**");
    expect(markdown).toContain("**Raises**");
    expect(markdown).toContain("::: note");
    expect(markdown).toContain("::: warning");
    // dunder はデフォルト表示、単一 _ 始まりの private は非表示
    expect(markdown).toContain("__init__");
    expect(markdown).toContain("Create a greeter.");
    expect(markdown).not.toContain("_secret");
    expect(markdown).not.toContain("_hidden");

    expect(extraHeadings).toEqual(
      expect.arrayContaining([
        { level: 2, text: "mymodule", anchorId: "mypackage.mymodule" },
        { level: 3, text: "Greeter(Base)", tocText: "Greeter", anchorId: "mypackage.mymodule.Greeter" },
        { level: 4, text: "__init__(name: str)", tocText: "__init__", anchorId: "mypackage.mymodule.Greeter.__init__" },
        { level: 4, text: "shout(text: str)", tocText: "shout", anchorId: "mypackage.mymodule.Greeter.shout" },
        { level: 4, text: "greet(name: str)", tocText: "greet", anchorId: "mypackage.mymodule.greet" }
      ])
    );
  });

  it("heading-level が深くても見出しレベルを6に収め extraHeadings に載せる", () => {
    // heading-level:5 でもメソッドが level7 にならず、仕様アンカーが付くこと
    const { markdown, extraHeadings } = renderModuleDoc(sample, {
      members: ["Greeter"],
      showPrivate: false,
      headingLevel: 5
    });
    expect(markdown).toContain("##### mymodule");
    expect(markdown).toContain("###### Greeter(Base)");
    expect(markdown).toContain("###### __init__(name: str)");
    expect(extraHeadings.every((h) => h.level >= 1 && h.level <= 6)).toBe(true);
    expect(extraHeadings.some((h) => h.anchorId === "mypackage.mymodule.Greeter.__init__")).toBe(true);
  });

  it("members でトップレベルを絞り込める", () => {
    const { markdown } = renderModuleDoc(sample, {
      members: ["greet"],
      showPrivate: false,
      headingLevel: 2
    });
    expect(markdown).toContain("#### greet(name: str)");
    expect(markdown).not.toContain("### Greeter");
  });

  it("show-private: true で _始まりを含める", () => {
    const { markdown } = renderModuleDoc(sample, {
      members: null,
      showPrivate: true,
      headingLevel: 2
    });
    expect(markdown).toContain("_secret");
    expect(markdown).toContain("_hidden");
  });
});
