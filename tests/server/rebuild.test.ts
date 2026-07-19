import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../src/config/load.js";
import { createTempProject, silentLogger } from "./helpers.js";

describe("rebuild helpers", () => {
  it("タイトル不変の本文変更はpartialで当該ページのみ再出力する", async () => {
    // 仕様5.1 / 8.3: 増分は変更ページのみ。nav非影響ならpartial
    const { fullBuild, rebuildDocs } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const logger = silentLogger();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      const state = await fullBuild(config, logger);
      const beforeIndex = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
      const beforeA = fs.readFileSync(path.join(root, "site/guide/a.html"), "utf-8");

      // タイトルは変えず本文だけ更新する
      fs.writeFileSync(
        path.join(root, "docs/guide/a.md"),
        "---\ntitle: Page A\n---\n\n# Page A\n\nOnly A changed.\n",
        "utf-8"
      );

      const result = await rebuildDocs(state, ["guide/a.md"], logger);
      expect(result.mode).toBe("partial");
      expect(result.rebuiltPaths).toEqual(["guide/a.md"]);

      const afterIndex = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
      const afterA = fs.readFileSync(path.join(root, "site/guide/a.html"), "utf-8");
      // 変更していないページのHTMLはバイト一致で残る
      expect(afterIndex).toBe(beforeIndex);
      expect(afterA).not.toBe(beforeA);
      expect(afterA).toContain("Only A changed");
      expect(beforeA).not.toContain("Only A changed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("タイトル変更はnav影響のためfull再ビルドする", async () => {
    // 仕様8.3: title変更はサイドバー全体に影響するためfull
    const { fullBuild, rebuildDocs } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const logger = silentLogger();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      const state = await fullBuild(config, logger);

      fs.writeFileSync(
        path.join(root, "docs/guide/a.md"),
        "---\ntitle: Renamed A\n---\n\n# Renamed A\n\nContent.\n",
        "utf-8"
      );

      const result = await rebuildDocs(state, ["guide/a.md"], logger);
      expect(result.mode).toBe("full");

      const indexHtml = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
      // 他ページのサイドバーにも新タイトルが反映される
      expect(indexHtml).toContain("Renamed A");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ページ追加・削除はfull再ビルドする", async () => {
    const { fullBuild, rebuildDocs } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const logger = silentLogger();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      let state = await fullBuild(config, logger);

      // 追加
      fs.writeFileSync(
        path.join(root, "docs/guide/b.md"),
        "---\ntitle: Page B\n---\n\n# Page B\n",
        "utf-8"
      );
      let result = await rebuildDocs(state, ["guide/b.md"], logger);
      expect(result.mode).toBe("full");
      expect(fs.existsSync(path.join(root, "site/guide/b.html"))).toBe(true);
      state = result.state;

      // 削除
      fs.rmSync(path.join(root, "docs/guide/b.md"));
      result = await rebuildDocs(state, ["guide/b.md"], logger);
      expect(result.mode).toBe("full");
      expect(fs.existsSync(path.join(root, "site/guide/b.html"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("監視パス種別を正しく分類する", async () => {
    const { classifyPath } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      expect(classifyPath(path.join(root, "mkdocsgen.yml"), config)).toBe("config");
      expect(classifyPath(path.join(root, "docs/index.md"), config)).toBe("docs");
      expect(classifyPath(path.join(root, "theme_overrides/page.njk"), config)).toBe("theme");
      expect(classifyPath(path.join(root, "site/index.html"), config)).toBe("ignore");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
