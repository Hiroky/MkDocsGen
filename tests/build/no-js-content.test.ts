import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../../src/build/pipeline.js";
import { createTempProject, silentLogger } from "../server/helpers.js";

describe("JS-disabled content viewing", () => {
  it("生成HTMLはscript無しでも本文とMermaidソースを静的に含む", async () => {
    // 仕様5.1: JS無効でも本文閲覧可能。Mermaidはpre.mermaidのまま残る
    const root = createTempProject({
      title: "No JS Site",
      pages: {
        "index.md": [
          "---",
          "title: Home",
          "---",
          "",
          "# Home",
          "",
          "本文は静的HTMLとして埋め込まれる。",
          "",
          "```mermaid",
          "graph TD",
          "  A --> B",
          "```",
          ""
        ].join("\n")
      }
    });
    const logger = silentLogger();

    try {
      await runBuild({
        configPath: path.join(root, "mkdocsgen.yml"),
        strict: false,
        clean: true,
        verbose: false
      }, logger);

      const html = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
      // メイン本文領域が静的に存在する
      expect(html).toContain('id="main-content"');
      expect(html).toContain("page-body");
      expect(html).toContain("本文は静的HTMLとして埋め込まれる。");
      // Mermaidはクライアント描画用にソースが残る（JS無しでもテキストとして読める）
      expect(html).toContain('class="mermaid"');
      expect(html).toContain("graph TD");
      // HTMLエスケープされた矢印でもソースが残っていること
      expect(html).toMatch(/A --(&gt;|>) B/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
