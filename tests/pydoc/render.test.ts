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
    expect(markdown).toContain("### Greeter");
    expect(markdown).toContain("#### shout");
    expect(markdown).toContain("```python");
    expect(markdown).toContain("def shout(text: str) -> str");
    expect(markdown).toContain("| Name | Type | Description |");
    expect(markdown).toContain("`text`");
    expect(markdown).toContain("**Returns**");
    expect(markdown).toContain("**Raises**");
    expect(markdown).toContain("::: note");
    expect(markdown).toContain("::: warning");
    expect(markdown).not.toContain("_secret");
    expect(markdown).not.toContain("_hidden");

    expect(extraHeadings).toEqual(
      expect.arrayContaining([
        { level: 2, text: "mymodule", anchorId: "mypackage.mymodule" },
        { level: 3, text: "Greeter", anchorId: "mypackage.mymodule.Greeter" },
        { level: 4, text: "shout", anchorId: "mypackage.mymodule.Greeter.shout" },
        { level: 4, text: "greet", anchorId: "mypackage.mymodule.greet" }
      ])
    );
  });

  it("members でトップレベルを絞り込める", () => {
    const { markdown } = renderModuleDoc(sample, {
      members: ["greet"],
      showPrivate: false,
      headingLevel: 2
    });
    expect(markdown).toContain("#### greet");
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
