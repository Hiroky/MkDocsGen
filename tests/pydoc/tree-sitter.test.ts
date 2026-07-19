import { describe, expect, it } from "vitest";
import { createPythonParser } from "../../src/pydoc/tree-sitter.js";

describe("createPythonParser", () => {
  it("tree-sitter-python.wasm をロードできる", async () => {
    // ロード基盤のスモークテスト
    const parser = await createPythonParser();
    const tree = parser.parse("x = 1\n");
    expect(tree.rootNode.type).toBe("module");
    expect(tree.rootNode.hasError).toBe(false);
  });
});
