import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import type { ResolvedConfig } from "../config/schema.js";
import type { BuildContext, Page } from "../types.js";
import { resolveBrandAssetPath } from "./assets.js";

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
    // logo / faviconも copyAssetsと同じ assets/brand/<basename> 規則で渡す
    const logo = resolveBrandAssetPath(this.config.theme.logo);
    const favicon = resolveBrandAssetPath(this.config.theme.favicon);
    // SVG faviconはtypeを明示しないと一部ブラウザで認識されない
    const faviconType = this.config.theme.favicon?.toLowerCase().endsWith(".svg")
      ? "image/svg+xml"
      : null;

    return this.env.render("page.njk", {
      site: {
        title: this.config.site.title,
        description: this.config.site.description,
        baseUrl: this.config.site.base_url,
        // 未設定時はテンプレート側で「© {title}」にフォールバックする
        copyright: this.config.site.copyright ?? null
      },
      page,
      nav: context.nav,
      root,
      customCss,
      logo,
      favicon,
      faviconType,
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
