import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedConfig } from "../../src/config/schema.js";
import type { BuildContext, NavNode, Page } from "../../src/types.js";

/**
 * レンダリングテスト用の最小ResolvedConfigを一時ディレクトリ上に組み立てる
 */
export function createRenderFixture(options: {
  overrides?: Record<string, string>;
  customCss?: string[];
  defaultMode?: "auto" | "light" | "dark";
} = {}): { root: string; config: ResolvedConfig; cleanup: () => void }
{
  // OSの一時領域にユニークな作業ディレクトリを作る
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-render-"));
  const overridesDir = path.join(root, "theme_overrides");
  fs.mkdirSync(overridesDir, { recursive: true });

  // オーバーライドファイルが指定されていれば書き出す
  for (const [relPath, content] of Object.entries(options.overrides ?? {})) {
    const absPath = path.join(overridesDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
  }

  const config: ResolvedConfig = {
    site: { title: "Test Site", description: "desc", base_url: "/" },
    docs_dir: "docs",
    output_dir: "site",
    nav: [],
    exclude: [],
    theme: {
      overrides_dir: "theme_overrides",
      default_mode: options.defaultMode ?? "auto",
      custom_css: options.customCss ?? []
    },
    markdown: { allow_html: true },
    pydoc: { source_dirs: [] },
    plugins: [],
    serve: { port: 3000 },
    configPath: path.join(root, "mkdocsgen.yml"),
    configDir: root,
    docsDirAbs: path.join(root, "docs"),
    outputDirAbs: path.join(root, "site"),
    overridesDirAbs: overridesDir
  };

  return {
    root,
    config,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

/**
 * テスト用の最小Pageを組み立てる
 */
export function createTestPage(overrides: Partial<Page> = {}): Page
{
  return {
    sourcePath: "index.md",
    outputPath: "index.html",
    url: "/index.html",
    title: "Home",
    description: "",
    frontmatter: {},
    headings: [],
    anchorIds: [],
    links: [],
    contentHtml: "<p>Hello</p>",
    plainText: "Hello",
    prev: null,
    next: null,
    breadcrumbs: [],
    ...overrides
  };
}

/**
 * テスト用の最小BuildContextを組み立てる
 */
export function createTestContext(config: ResolvedConfig, pages: Page[], nav: NavNode[] = []): BuildContext
{
  return { config, pages, nav };
}
