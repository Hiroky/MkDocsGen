import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildError, runBuild } from "../../src/build/pipeline.js";
import { Logger } from "../../src/logger.js";
import { copyBasicSite } from "./helpers.js";

/** 各テストで作った一時ディレクトリの掃除用 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * ビルド用の一時プロジェクトを作る
 */
function createBuildProject(options: {
  files?: Record<string, string>;
  yml?: string;
} = {}): { root: string; configPath: string }
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-build-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));

  const yml = options.yml ?? [
    "site:",
    "  title: Build Test",
    "docs_dir: docs",
    "output_dir: site",
    "markdown:",
    "  allow_html: true"
  ].join("\n") + "\n";

  fs.writeFileSync(path.join(root, "mkdocsgen.yml"), yml, "utf-8");

  const files = options.files ?? {
    "index.md": "# Home\n\nWelcome.\n"
  };
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
function silentLogger(verbose = false): Logger
{
  return new Logger(verbose, { stdout: () => {}, stderr: () => {} });
}

/**
 * infoログを収集するロガーを作る
 */
function capturingInfoLogger(): { logger: Logger; infos: string[]; warnings: string[] }
{
  const infos: string[] = [];
  const warnings: string[] = [];
  const logger = new Logger(false, {
    stdout: (line) => infos.push(line),
    stderr: (line) => warnings.push(line.replace(/^.*?warn:\s*/, ""))
  });
  return { logger, infos, warnings };
}

describe("runBuild", () => {
  afterEach(() => {
    delete process.env.MKDOCSGEN_TEST_DOTENV;
    delete process.env.MKDOCSGEN_TEST_EXISTING;
  });

  it("docs_dir/.envの値をprocess.envへ反映する（既存envは上書きしない）", async () => {
    process.env.MKDOCSGEN_TEST_EXISTING = "from-shell";
    const { configPath } = createBuildProject({
      files: {
        "index.md": "# Home\n",
        ".env": "MKDOCSGEN_TEST_DOTENV=from-dotenv\nMKDOCSGEN_TEST_EXISTING=from-dotenv\n"
      }
    });
    const { logger } = capturingInfoLogger();

    await runBuild({ configPath, strict: false, clean: false, verbose: false }, logger);

    expect(process.env.MKDOCSGEN_TEST_DOTENV).toBe("from-dotenv");
    expect(process.env.MKDOCSGEN_TEST_EXISTING).toBe("from-shell");
  });

  it("正常ビルドでHTMLを出力しサマリを返す", async () => {
    // ページ数・警告数・所要時間が結果とログに出る
    const { configPath } = createBuildProject({
      files: {
        "index.md": "# Home\n",
        "guide.md": "# Guide\n"
      }
    });
    const { logger, infos } = capturingInfoLogger();

    const result = await runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, logger);

    expect(result.pageCount).toBe(2);
    expect(result.warnCount).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(infos.some((line) => /2ページを出力 \(警告0件, .+秒\)/.test(line))).toBe(true);
  });

  it("ビルドでsearch-index.jsonとsearch-index.jsを出力する", async () => {
    // 全文検索用インデックスがページ数ぶんdocumentsを持つこと（JSON確認用・JS読込用）
    const { root, configPath } = createBuildProject({
      files: {
        "index.md": "# Home\n\nWelcome home.\n",
        "guide.md": "# Guide\n\nHow to use.\n"
      }
    });

    await runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, silentLogger());

    const assetsDir = path.join(root, "site", "assets");
    const indexPath = path.join(assetsDir, "search-index.json");
    const indexJsPath = path.join(assetsDir, "search-index.js");
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(indexJsPath)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    expect(index.documents).toHaveLength(2);
    expect(index.documents.map((d: { id: string }) => d.id).sort()).toEqual([
      "guide.html",
      "index.html"
    ]);
    expect(index.documents.some((d: { text: string }) => d.text.includes("Welcome"))).toBe(true);
    expect(fs.readFileSync(indexJsPath, "utf-8")).toContain("__MKDOCSGEN_SEARCH_INDEX__");
  });

  it("--cleanで出力ディレクトリ内のゴミファイルを消す", async () => {
    // 事前クリアが効くこと
    const { root, configPath } = createBuildProject();
    const siteDir = path.join(root, "site");
    fs.mkdirSync(siteDir, { recursive: true });
    const junk = path.join(siteDir, "junk.txt");
    fs.writeFileSync(junk, "old", "utf-8");

    await runBuild({
      configPath,
      strict: false,
      clean: true,
      verbose: false
    }, silentLogger());

    expect(fs.existsSync(junk)).toBe(false);
    expect(fs.existsSync(path.join(siteDir, "index.html"))).toBe(true);
  });

  it("--cleanはoutput_dirがプロジェクトルートのとき拒否する", async () => {
    // lessons: output_dir: . はソースごと消えるため拒否
    const { configPath } = createBuildProject({
      yml: [
        "site:",
        "  title: Unsafe",
        "docs_dir: docs",
        "output_dir: .",
        "markdown:",
        "  allow_html: true"
      ].join("\n") + "\n"
    });

    await expect(runBuild({
      configPath,
      strict: false,
      clean: true,
      verbose: false
    }, silentLogger())).rejects.toThrow(BuildError);
  });

  it("--cleanはoutput_dirがdocs_dirと同じとき拒否する", async () => {
    // lessons: docsと同一はソース消失を防ぐ
    const { configPath } = createBuildProject({
      yml: [
        "site:",
        "  title: Unsafe",
        "docs_dir: docs",
        "output_dir: docs",
        "markdown:",
        "  allow_html: true"
      ].join("\n") + "\n"
    });

    await expect(runBuild({
      configPath,
      strict: false,
      clean: true,
      verbose: false
    }, silentLogger())).rejects.toThrow(BuildError);
  });

  it("リンク切れがあるとき警告を積みビルドは成功する", async () => {
    // 通常ビルドは警告のみで成功
    const { configPath } = createBuildProject({
      files: {
        "index.md": "# Home\n\n[x](./missing.md)\n"
      }
    });
    const { logger, warnings } = capturingInfoLogger();

    const result = await runBuild({
      configPath,
      strict: false,
      clean: false,
      verbose: false
    }, logger);

    expect(result.warnCount).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes("リンク切れ"))).toBe(true);
  });

  it("--strict時にリンク切れ警告があるとBuildErrorになる", async () => {
    // 仕様書7.3: strict失敗
    const { configPath } = createBuildProject({
      files: {
        "index.md": "# Home\n\n[x](./missing.md)\n"
      }
    });

    await expect(runBuild({
      configPath,
      strict: true,
      clean: false,
      verbose: false
    }, silentLogger())).rejects.toThrow(/strictモード/);
  });

  describe("主要ページのHTMLスナップショットが一致する", () => {
    it.each(["index.html", "a.html", "b/c.html"])("%s", async (relPath) => {
      // Phase4以降の統合回帰。フィクスチャをコピーしてビルドする
      const fixture = copyBasicSite();
      cleanups.push(fixture.cleanup);

      await runBuild({
        configPath: fixture.configPath,
        strict: false,
        clean: false,
        verbose: false
      }, silentLogger());

      const html = fs.readFileSync(path.join(fixture.outputDir, relPath), "utf-8");
      expect(html).toMatchSnapshot();
    });
  });
});
