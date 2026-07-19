import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePythonModule } from "../../src/pydoc/parser.js";
import { createPythonParser } from "../../src/pydoc/tree-sitter.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/pydoc/mypackage/mymodule.py"
);

describe("createPythonParser / parsePythonModule", () => {
  it("WASMをロードしてフィクスチャモジュールを解析できる", async () => {
    // ロード基盤とクラス・関数抽出の基本動作を確認する
    const parser = await createPythonParser();
    const source = fs.readFileSync(fixturePath, "utf-8");
    const result = parsePythonModule(source, "mypackage.mymodule", parser);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.module.docstring?.summary).toContain("Example module");
    expect(result.module.classes.map((c) => c.name)).toContain("Greeter");
    expect(result.module.functions.map((f) => f.name)).toContain("greet");
    expect(result.module.functions.map((f) => f.name)).toContain("_hidden");

    const greeter = result.module.classes.find((c) => c.name === "Greeter")!;
    expect(greeter.attributes.some((a) => a.name === "count" && a.type === "int")).toBe(true);
    expect(greeter.methods.map((m) => m.name)).toEqual(
      expect.arrayContaining(["__init__", "name", "from_default", "shout", "_secret"])
    );

    const shout = greeter.methods.find((m) => m.name === "shout")!;
    expect(shout.decorators).toContain("staticmethod");
    expect(shout.returns).toBe("str");
    expect(shout.params.some((p) => p.name === "text" && p.type === "str")).toBe(true);

    const nameProp = greeter.methods.find((m) => m.name === "name")!;
    expect(nameProp.decorators).toContain("property");

    const greet = result.module.functions.find((f) => f.name === "greet")!;
    expect(greet.params.find((p) => p.name === "times")?.default).toBe("1");
    expect(greet.signature).toContain("def greet(");
  });

  it("構文エラーがあるソースでは ok:false を返す", async () => {
    // --strict 連携の前提として構文エラーを検出できること
    const parser = await createPythonParser();
    const result = parsePythonModule("def broken(\n", "broken", parser);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("構文エラー");
  });

  it("同一モジュールを連続パースしても短い時間で完了する", async () => {
    // フェーズ9初期の性能スモーク（厳密な100ページ計測はフェーズ11）
    const parser = await createPythonParser();
    const source = fs.readFileSync(fixturePath, "utf-8");
    const started = Date.now();
    for (let i = 0; i < 50; i++) {
      const result = parsePythonModule(source, "mypackage.mymodule", parser);
      expect(result.ok).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
