import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import type { ResolvedConfig } from "../config/schema.js";
import type { BuildContext, Page } from "../types.js";

/**
 * Nunjucksテンプレートでページを最終HTMLに変換するレンダラー
 */
export class Renderer
{
  private env: nunjucks.Environment;
  private config: ResolvedConfig;

  /**
   * オーバーライド優先のNunjucks環境を構築する
   */
  constructor(config: ResolvedConfig)
  {
    this.config = config;
    // テンプレート解決順: theme_overrides/ → 組み込みtemplates/（前者優先）
    // FileSystemLoaderは配列順に探索するため、overridesを先頭に置くだけで実現できる
    const builtinDir = fileURLToPath(new URL("../../templates", import.meta.url));
    this.env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader([config.overridesDirAbs, builtinDir]),
      { autoescape: true }
    );
  }

  /**
   * 1ページ分のHTMLを生成する
   */
  renderPage(page: Page, context: BuildContext): string
  {
    // rootは出力ルートへの相対プレフィックス（例: guide/setup.html → "../"）
    // ページ間リンク・アセット参照をfile://でも動作させるために全テンプレートでroot経由の相対参照にする
    const root = computeRoot(page.outputPath);
    // custom_cssは出力側で assets/custom/<basename> に揃える（copyAssetsと同じ規則）
    const customCss = this.config.theme.custom_css.map((filePath) => {
      return `assets/custom/${path.basename(filePath)}`;
    });

    return this.env.render("page.njk", {
      site: {
        title: this.config.site.title,
        description: this.config.site.description,
        baseUrl: this.config.site.base_url
      },
      page,
      nav: context.nav,
      root,
      customCss,
      themeDefaultMode: this.config.theme.default_mode
    });
  }
}

/**
 * 出力パスの階層数からルートへの相対プレフィックスを求める
 */
export function computeRoot(outputPath: string): string
{
  // POSIX区切り前提。ファイル名分を除いたディレクトリ階層数が "../" の繰り返し回数になる
  const depth = outputPath.split("/").length - 1;
  return "../".repeat(depth);
}
