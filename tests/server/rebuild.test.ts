import { describe, expect, it, vi } from "vitest";
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

  it("増分ビルドは変更ページだけMarkdown変換する", async () => {
    // 仕様: 変更ページのみ再変換。書き込み差分だけでなく変換コストも差分にする
    const { fullBuild, rebuildDocs } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const logger = silentLogger();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      const state = await fullBuild(config, logger);
      const convertSpy = vi.spyOn(state.converter, "convert");

      fs.writeFileSync(
        path.join(root, "docs/guide/a.md"),
        "---\ntitle: Page A\n---\n\n# Page A\n\nOnly A body.\n",
        "utf-8"
      );

      convertSpy.mockClear();
      const result = await rebuildDocs(state, ["guide/a.md"], logger);
      expect(result.mode).toBe("partial");
      // 変更されたguide/a.mdだけconvertされる（index.md等は呼ばれない）
      expect(convertSpy.mock.calls.map((call) => call[1])).toEqual(["guide/a.md"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("増分ビルドではbuildEndを呼ばない", async () => {
    // serve中の保存連打でConfluence等の副作用プラグインが毎回同期されないようにする
    const { fullBuild, rebuildDocs } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const logger = silentLogger();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      const state = await fullBuild(config, logger);
      let buildEndCount = 0;
      // 既存プラグインに加え、カウント用のスタブを差し込む
      state.plugins = [
        ...state.plugins,
        {
          name: "count-build-end",
          buildEnd() {
            buildEndCount += 1;
          }
        }
      ];

      fs.writeFileSync(
        path.join(root, "docs/guide/a.md"),
        "---\ntitle: Page A\n---\n\n# Page A\n\nBody again.\n",
        "utf-8"
      );

      const result = await rebuildDocs(state, ["guide/a.md"], logger);
      expect(result.mode).toBe("partial");
      expect(buildEndCount).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fullBuild（serve経路）ではbuildEndを呼ばない", async () => {
    // 初回起動・設定/テーマ変更でも副作用プラグインを動かさない
    const { fullBuild } = await import("../../src/server/rebuild.js");
    const root = createTempProject();
    const logger = silentLogger();

    // カウント用プラグインをプロジェクトに置く
    fs.mkdirSync(path.join(root, "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "plugins/count-end.mjs"),
      [
        "let count = 0;",
        "export default function createPlugin() {",
        "  return {",
        "    name: 'count-end',",
        "    buildEnd() { count += 1; },",
        "    getCount() { return count; }",
        "  };",
        "}"
      ].join("\n"),
      "utf-8"
    );
    const yml = fs.readFileSync(path.join(root, "mkdocsgen.yml"), "utf-8");
    fs.writeFileSync(
      path.join(root, "mkdocsgen.yml"),
      `${yml}\nplugins:\n  - path: ./plugins/count-end.mjs\n`,
      "utf-8"
    );
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));

    try {
      const state = await fullBuild(config, logger);
      const plugin = state.plugins.find((p) => p.name === "count-end") as
        | { getCount?: () => number }
        | undefined;
      expect(plugin?.getCount?.()).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
