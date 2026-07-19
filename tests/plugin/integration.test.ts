import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBuild } from "../../src/build/pipeline.js";
import { Logger } from "../../src/logger.js";
import { PluginError } from "../../src/plugin/load.js";

/** 各テストで作った一時ディレクトリの掃除用 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * プラグイン付きビルド用の一時プロジェクトを作る
 */
function createPluginBuildProject(options: {
  files?: Record<string, string>;
  pluginsYml: string;
  pluginFiles: Record<string, string>;
}): { root: string; configPath: string }
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-plugin-build-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));

  const yml = [
    "site:",
    "  title: Plugin Build",
    "docs_dir: docs",
    "output_dir: site",
    "plugins:",
    options.pluginsYml
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(root, "mkdocsgen.yml"), yml, "utf-8");

  for (const [rel, content] of Object.entries(options.pluginFiles)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  const files = options.files ?? { "index.md": "# Home\n\nHello.\n" };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, "docs", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  return { root, configPath: path.join(root, "mkdocsgen.yml") };
}

/**
 * 出力を捨てるロガーを作る
 */
function silentLogger(): Logger
{
  return new Logger(false, { stdout: () => {}, stderr: () => {} });
}

describe("plugin integration in build", () => {
  it("transformHtmlの返り値が最終出力HTMLへ反映される", async () => {
    // 仕様7.3: プラグインのtransformHtmlが返した文字列が最終出力に反映される
    const { root, configPath } = createPluginBuildProject({
      pluginsYml: [
        "  - path: ./plugins/stamp.mjs",
        "    options:",
        "      marker: PLUGIN_STAMP"
      ].join("\n"),
      pluginFiles: {
        "plugins/stamp.mjs": [
          "export default function createPlugin(options) {",
          "  return {",
          "    name: 'stamp',",
          "    transformHtml(html) {",
          "      return html.replace('</body>', `<!--${options.marker}--></body>`);",
          "    }",
          "  };",
          "}"
        ].join("\n")
      }
    });

    await runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, silentLogger());

    const html = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
    expect(html).toContain("<!--PLUGIN_STAMP-->");
  });

  it("transformMarkdownの返り値が変換前ソースとして使われる", async () => {
    // Markdown変換前フックで差し込んだ記法がHTMLに残る
    const { root, configPath } = createPluginBuildProject({
      files: { "index.md": "# Home\n\nBASE\n" },
      pluginsYml: "  - path: ./plugins/prepend.mjs\n",
      pluginFiles: {
        "plugins/prepend.mjs": [
          "export default function createPlugin() {",
          "  return {",
          "    name: 'prepend',",
          "    transformMarkdown(source) {",
          "      return source.replace('BASE', 'TRANSFORMED_MARKDOWN');",
          "    }",
          "  };",
          "}"
        ].join("\n")
      }
    });

    await runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, silentLogger());

    const html = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
    expect(html).toContain("TRANSFORMED_MARKDOWN");
    expect(html).not.toContain(">BASE<");
  });

  it("フック内例外はPluginErrorとしてビルドを失敗させる", async () => {
    // 仕様2.8: プラグインの実行時例外はエラー終了
    const { configPath } = createPluginBuildProject({
      pluginsYml: "  - path: ./plugins/boom.mjs\n",
      pluginFiles: {
        "plugins/boom.mjs": [
          "export default function createPlugin() {",
          "  return {",
          "    name: 'boom',",
          "    configResolved() { throw new Error('intentional'); }",
          "  };",
          "}"
        ].join("\n")
      }
    });

    await expect(runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, silentLogger())).rejects.toBeInstanceOf(PluginError);

    await expect(runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, silentLogger())).rejects.toThrow(/boom/);
  });

  it("複数プラグインのtransformHtmlが列挙順に適用される", async () => {
    // A→Bの順でコメントが埋め込まれる
    const { root, configPath } = createPluginBuildProject({
      pluginsYml: [
        "  - path: ./plugins/a.mjs",
        "  - path: ./plugins/b.mjs"
      ].join("\n"),
      pluginFiles: {
        "plugins/a.mjs": [
          "export default () => ({",
          "  name: 'a',",
          "  transformHtml(html) { return html.replace('</body>', '<!--A--></body>'); }",
          "});"
        ].join("\n"),
        "plugins/b.mjs": [
          "export default () => ({",
          "  name: 'b',",
          "  transformHtml(html) { return html.replace('</body>', '<!--B--></body>'); }",
          "});"
        ].join("\n")
      }
    });

    await runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, silentLogger());

    const html = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
    const posA = html.indexOf("<!--A-->");
    const posB = html.indexOf("<!--B-->");
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeLessThan(posB);
  });
});
