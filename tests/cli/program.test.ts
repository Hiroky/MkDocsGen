import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/program.js";

describe("createProgram", () => {
  it("CLI名がmkdocsgenである", () => {
    // コマンド名が仕様通りであることを確認する
    const program = createProgram();
    expect(program.name()).toBe("mkdocsgen");
  });

  it("init / build / serve の3コマンドが定義されている", () => {
    // 仕様書2.2で定められた3つのサブコマンドが揃っていることを確認する
    const program = createProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(["init", "build", "serve"]);
  });

  it("buildコマンドに --config / --strict / --clean / --verbose オプションが定義されている", () => {
    // 仕様書2.2.2で定められたビルドオプションが揃っていることを確認する
    const program = createProgram();
    const build = program.commands.find((command) => command.name() === "build");
    const flags = build?.options.map((option) => option.long) ?? [];
    expect(flags).toContain("--config");
    expect(flags).toContain("--strict");
    expect(flags).toContain("--clean");
    expect(flags).toContain("--verbose");
  });

  it("serveコマンドに --port / --config / --verbose オプションが定義されている", () => {
    // 仕様書2.2.3で定められた開発サーバーオプションが揃っていることを確認する
    const program = createProgram();
    const serve = program.commands.find((command) => command.name() === "serve");
    const flags = serve?.options.map((option) => option.long) ?? [];
    expect(flags).toContain("--port");
    expect(flags).toContain("--config");
    expect(flags).toContain("--verbose");
  });
});
