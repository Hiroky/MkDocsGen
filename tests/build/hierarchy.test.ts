import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../../src/build/pipeline.js";
import { createTempProject, silentLogger } from "../server/helpers.js";

describe("multi-level docs hierarchy build", () => {
  it("3段以上の階層でパンくず・相対root・ネスト画像が出力される", async () => {
    // 目視確認用サンプルと同じ深さの結合検証
    const root = createTempProject({
      pages: {
        "index.md": "---\ntitle: Home\n---\n\n[Leaf](./samples/hierarchy/level-a/level-b/leaf.md)\n",
        "samples/index.md": "---\ntitle: サンプル\n---\n",
        "samples/hierarchy/index.md": "---\ntitle: 階層デモ\n---\n",
        "samples/hierarchy/level-a/index.md": "---\ntitle: Level A\n---\n",
        "samples/hierarchy/level-a/level-b/index.md": "---\ntitle: Level B\n---\n",
        "samples/hierarchy/level-a/level-b/leaf.md": [
          "---",
          "title: Leaf",
          "---",
          "",
          "深いページの本文。",
          "",
          "![nested](./media/dot.png)",
          ""
        ].join("\n")
      }
    });
    const mediaDir = path.join(root, "docs/samples/hierarchy/level-a/level-b/media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "dot.png"), "PNG", "utf-8");

    try {
      await runBuild({
        configPath: path.join(root, "mkdocsgen.yml"),
        strict: true,
        clean: true,
        verbose: false
      }, silentLogger());

      const leafHtml = fs.readFileSync(
        path.join(root, "site/samples/hierarchy/level-a/level-b/leaf.html"),
        "utf-8"
      );

      // 深いページは assets まで ../../../../ が付く
      expect(leafHtml).toContain('href="../../../../assets/main.css"');
      // パンくずが多段で並ぶ
      expect(leafHtml).toContain("サンプル");
      expect(leafHtml).toContain("階層デモ");
      expect(leafHtml).toContain("Level A");
      expect(leafHtml).toContain("Level B");
      expect(leafHtml).toMatch(/aria-current="page"/);
      // ネストした静的画像も同じ相対パスで出る
      expect(fs.readFileSync(
        path.join(root, "site/samples/hierarchy/level-a/level-b/media/dot.png"),
        "utf-8"
      )).toBe("PNG");
      expect(leafHtml).toContain('src="./media/dot.png"');

      // サイドバーに深いページへのリンクが階層パスのまま残る（フラット化されていない）
      expect(leafHtml).toContain("samples/hierarchy/level-a/level-b/leaf.html");
      expect(leafHtml).toContain("samples/hierarchy/level-a/level-b/index.html");
      expect(leafHtml).toContain("Level B");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
