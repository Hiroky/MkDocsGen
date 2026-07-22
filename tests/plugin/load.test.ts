import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { PluginError, loadPlugins } from "../../src/plugin/load.js";
import { createPluginFixture } from "./helpers.js";

/** 各テストで作った一時ディレクトリの掃除用 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("loadPlugins", () => {
  it("pluginsが空なら空配列を返す", async () => {
    // プラグイン未設定時は何も読み込まず空で返す
    const fixture = createPluginFixture({ plugins: [] });
    cleanups.push(fixture.cleanup);

    const plugins = await loadPlugins(fixture.config);
    expect(plugins).toEqual([]);
  });

  it("ローカルESMのdefault exportファクトリにoptionsを渡してPluginを得る", async () => {
    // YAMLのoptionsがファクトリ引数として渡り、name付きPluginになる
    const fixture = createPluginFixture({
      plugins: [{ path: "./plugins/echo.mjs", options: { tag: "hello" } }],
      pluginFiles: {
        "plugins/echo.mjs": [
          "export default function createPlugin(options) {",
          "  return {",
          "    name: 'echo',",
          "    received: options.tag,",
          "    configResolved() {}",
          "  };",
          "}"
        ].join("\n")
      }
    });
    cleanups.push(fixture.cleanup);

    const plugins = await loadPlugins(fixture.config);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("echo");
    expect((plugins[0] as { received?: string }).received).toBe("hello");
  });

  it("複数プラグインを列挙順で読み込む", async () => {
    // 後段の直列実行のため、読み込み順もYAML列挙順を保つ
    const fixture = createPluginFixture({
      plugins: [
        { path: "./plugins/a.mjs" },
        { path: "./plugins/b.mjs" }
      ],
      pluginFiles: {
        "plugins/a.mjs": "export default () => ({ name: 'a' });\n",
        "plugins/b.mjs": "export default () => ({ name: 'b' });\n"
      }
    });
    cleanups.push(fixture.cleanup);

    const plugins = await loadPlugins(fixture.config);
    expect(plugins.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("ファイルが存在しない場合はPluginErrorを投げる", async () => {
    // パスミスはビルド開始前に分かるようにする
    const fixture = createPluginFixture({
      plugins: [{ path: "./plugins/missing.mjs" }]
    });
    cleanups.push(fixture.cleanup);

    await expect(loadPlugins(fixture.config)).rejects.toBeInstanceOf(PluginError);
    await expect(loadPlugins(fixture.config)).rejects.toThrow(/missing\.mjs/);
  });

  it("default exportが関数でない場合はPluginErrorを投げる", async () => {
    // ファクトリ以外のdefault exportは仕様外なので拒否する
    const fixture = createPluginFixture({
      plugins: [{ path: "./plugins/bad.mjs" }],
      pluginFiles: {
        "plugins/bad.mjs": "export default { name: 'not-a-factory' };\n"
      }
    });
    cleanups.push(fixture.cleanup);

    await expect(loadPlugins(fixture.config)).rejects.toBeInstanceOf(PluginError);
    await expect(loadPlugins(fixture.config)).rejects.toThrow(/PluginFactory|default export/);
  });

  it("ファクトリがname無しを返した場合はPluginErrorを投げる", async () => {
    // 例外メッセージに使うためnameは必須
    const fixture = createPluginFixture({
      plugins: [{ path: "./plugins/noname.mjs" }],
      pluginFiles: {
        "plugins/noname.mjs": "export default () => ({});\n"
      }
    });
    cleanups.push(fixture.cleanup);

    await expect(loadPlugins(fixture.config)).rejects.toBeInstanceOf(PluginError);
    await expect(loadPlugins(fixture.config)).rejects.toThrow(/name/);
  });

  it("builtin指定で組み込みプラグインをpath無しで解決できる", async () => {
    // dryRun:trueなのでAPI呼び出しは発生しない
    const fixture = createPluginFixture({
      plugins: [{ builtin: "confluence-export", options: { space: "DOCS", dryRun: true } }]
    });
    cleanups.push(fixture.cleanup);

    const plugins = await loadPlugins(fixture.config);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("confluence-export");
  });

  it("未知のbuiltin名はPluginErrorになる", async () => {
    // 利用可能な組み込みプラグイン名を案内する
    const fixture = createPluginFixture({
      plugins: [{ builtin: "no-such-plugin" }]
    });
    cleanups.push(fixture.cleanup);

    await expect(loadPlugins(fixture.config)).rejects.toBeInstanceOf(PluginError);
    await expect(loadPlugins(fixture.config)).rejects.toThrow(/no-such-plugin/);
  });

  it("同一プロセス内でプラグインファイルを書き換えたら新しいファクトリが使われる", async () => {
    // Node ESMキャッシュに乗っても、mtime付きURLで再読込できるようにする
    const fixture = createPluginFixture({
      plugins: [{ path: "./plugins/versioned.mjs" }],
      pluginFiles: {
        "plugins/versioned.mjs": "export default () => ({ name: 'v1', label: 'first' });\n"
      }
    });
    cleanups.push(fixture.cleanup);

    const first = await loadPlugins(fixture.config);
    expect(first[0]?.name).toBe("v1");
    expect((first[0] as { label?: string }).label).toBe("first");

    // 内容を書き換え、mtimeが進むよう少し待ってから書き込む
    const pluginPath = `${fixture.root}/plugins/versioned.mjs`;
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(
      pluginPath,
      "export default () => ({ name: 'v2', label: 'second' });\n",
      "utf-8"
    );

    const second = await loadPlugins(fixture.config);
    expect(second[0]?.name).toBe("v2");
    expect((second[0] as { label?: string }).label).toBe("second");
  });
});
