import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runBuild } from "../../src/build/pipeline.js";
import { copyStaticDocs, syncStaticDocPaths } from "../../src/build/static-docs.js";
import { loadConfig } from "../../src/config/load.js";
import { createTempProject, silentLogger } from "../server/helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * 一時プロジェクトを作り、終了時に消す
 */
function project(pages?: Record<string, string>): string
{
  const root = createTempProject({ pages });
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

describe("copyStaticDocs", () => {
  it("docs配下の非Markdownファイルを同じ相対パスで出力へコピーする", () => {
    // 画像などを ![alt](./images/a.png) で参照できるようにする
    const root = project({
      "index.md": "---\ntitle: Home\n---\n\n![logo](./images/logo.png)\n"
    });
    const imagesDir = path.join(root, "docs/images");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, "logo.png"), "PNGDATA", "utf-8");
    fs.writeFileSync(path.join(root, "docs/note.txt"), "hello", "utf-8");

    const config = loadConfig(path.join(root, "mkdocsgen.yml"));
    fs.mkdirSync(config.outputDirAbs, { recursive: true });

    const count = copyStaticDocs(config);
    expect(count).toBe(2);
    expect(fs.readFileSync(path.join(root, "site/images/logo.png"), "utf-8")).toBe("PNGDATA");
    expect(fs.readFileSync(path.join(root, "site/note.txt"), "utf-8")).toBe("hello");
    // Markdownは変換対象なので静的コピーしない
    expect(fs.existsSync(path.join(root, "site/index.md"))).toBe(false);
  });

  it("excludeに一致する静的ファイルはコピーしない", () => {
    const root = project();
    fs.mkdirSync(path.join(root, "docs/private"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs/private/secret.png"), "SECRET", "utf-8");
    fs.writeFileSync(path.join(root, "docs/ok.png"), "OK", "utf-8");
    fs.writeFileSync(
      path.join(root, "mkdocsgen.yml"),
      ["site:", "  title: Exclude Demo", "docs_dir: docs", "output_dir: site", "exclude:", "  - private/**"].join("\n") + "\n",
      "utf-8"
    );

    const config = loadConfig(path.join(root, "mkdocsgen.yml"));
    fs.mkdirSync(config.outputDirAbs, { recursive: true });

    copyStaticDocs(config);
    expect(fs.existsSync(path.join(root, "site/ok.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, "site/private/secret.png"))).toBe(false);
  });
});

describe("syncStaticDocPaths", () => {
  it("追加・更新はコピーし、削除は出力側からも消す", () => {
    const root = project();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));
    fs.mkdirSync(config.outputDirAbs, { recursive: true });

    fs.writeFileSync(path.join(root, "docs/a.png"), "A1", "utf-8");
    syncStaticDocPaths(config, ["a.png"]);
    expect(fs.readFileSync(path.join(root, "site/a.png"), "utf-8")).toBe("A1");

    fs.writeFileSync(path.join(root, "docs/a.png"), "A2", "utf-8");
    syncStaticDocPaths(config, ["a.png"]);
    expect(fs.readFileSync(path.join(root, "site/a.png"), "utf-8")).toBe("A2");

    fs.rmSync(path.join(root, "docs/a.png"));
    syncStaticDocPaths(config, ["a.png"]);
    expect(fs.existsSync(path.join(root, "site/a.png"))).toBe(false);
  });

  it("Markdownパスは無視する", () => {
    const root = project();
    const config = loadConfig(path.join(root, "mkdocsgen.yml"));
    fs.mkdirSync(config.outputDirAbs, { recursive: true });
    syncStaticDocPaths(config, ["index.md"]);
    expect(fs.existsSync(path.join(root, "site/index.md"))).toBe(false);
  });
});

describe("build copies static docs", () => {
  it("runBuildで画像がsiteへ出力されページから参照できる", async () => {
    const root = project({
      "index.md": "---\ntitle: Home\n---\n\n![logo](./img/logo.png)\n"
    });
    fs.mkdirSync(path.join(root, "docs/img"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs/img/logo.png"), "IMG", "utf-8");

    await runBuild({
      configPath: path.join(root, "mkdocsgen.yml"),
      strict: false,
      clean: true,
      verbose: false
    }, silentLogger());

    expect(fs.readFileSync(path.join(root, "site/img/logo.png"), "utf-8")).toBe("IMG");
    const html = fs.readFileSync(path.join(root, "site/index.html"), "utf-8");
    expect(html).toContain('src="./img/logo.png"');
  });
});
