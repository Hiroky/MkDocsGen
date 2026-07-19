import type { ResolvedConfig } from "../config/schema.js";
import type { BuildContext, Page } from "../types.js";

/**
 * プラグインへ渡すページメタ情報（Markdown変換前の時点で確定しているもの）
 */
export interface PageMeta {
  /** docs/からの相対パス（例: guide/setup.md） */
  sourcePath: string;
  /** 出力相対パス（例: guide/setup.html） */
  outputPath: string;
  /** base_url込みのURL */
  url: string;
  title: string;
  description: string;
  frontmatter: Record<string, unknown>;
}

/**
 * ビルドライフサイクルフックを持つプラグイン本体
 */
export interface Plugin {
  /** エラー表示やログで使うプラグイン名 */
  name: string;
  /** 設定確定直後。検証・加工に使う */
  configResolved?(config: ResolvedConfig): void | Promise<void>;
  /** Markdown変換前。独自記法のプリプロセスに使う */
  transformMarkdown?(source: string, page: PageMeta): string | Promise<string>;
  /** ページHTML生成後。HTML加工・埋め込みに使う */
  transformHtml?(html: string, page: Page): string | Promise<string>;
  /** 全ページ出力完了後。外部エクスポート等に使う */
  buildEnd?(context: BuildContext): void | Promise<void>;
}

/**
 * プラグインファクトリ。YAMLのoptionsが引数として渡される
 */
export type PluginFactory = (options: Record<string, unknown>) => Plugin;
