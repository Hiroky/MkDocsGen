/**
 * 公開プラグインAPI型定義
 *
 * 外部プラグイン開発者が依存する安定した型境界を提供します。
 * 内部モデル（ResolvedConfig, Page, BuildContextなど）の直接参照を排除し、
 * 将来の内部実装リファクタリング時にもプラグイン互換性を維持します。
 */

/**
 * プラグイン向け設定コンテキスト（読み取り専用）
 */
export interface PluginConfigContext {
  /** サイトタイトル */
  readonly siteTitle: string;
  /** サイト説明文 */
  readonly siteDescription: string;
  /** ドキュメントディレクトリ（絶対パス） */
  readonly docsDir: string;
  /** 出力ディレクトリ（絶対パス） */
  readonly outputDir: string;
  /** ベースURL */
  readonly baseUrl: string;
  /** コピーライト */
  readonly copyright?: string | undefined;
}

/**
 * Markdown変換時のページコンテキスト
 */
export interface PluginMarkdownContext {
  /** docs/からの相対パス（例: guide/setup.md） */
  readonly sourcePath: string;
  /** 出力相対パス（例: guide/setup.html） */
  readonly outputPath: string;
  /** base_url込みのURL */
  readonly url: string;
  /** ページタイトル */
  readonly title: string;
  /** ページ概要 */
  readonly description: string;
  /** フロントマター情報 */
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

/**
 * HTML変換時の見出し情報
 */
export interface PluginHeading {
  /** 見出しレベル（2〜6） */
  readonly level: number;
  /** タグ除去済み見出しテキスト */
  readonly text: string;
  /** 見出しアンカーID */
  readonly anchorId: string;
}

/**
 * HTML変換時のページコンテキスト
 */
export interface PluginHtmlContext {
  /** docs/からの相対パス（例: guide/setup.md） */
  readonly sourcePath: string;
  /** 出力相対パス（例: guide/setup.html） */
  readonly outputPath: string;
  /** base_url込みのURL */
  readonly url: string;
  /** ページタイトル */
  readonly title: string;
  /** ページ概要 */
  readonly description: string;
  /** フロントマター情報 */
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** ページ内見出し一覧 */
  readonly headings: ReadonlyArray<PluginHeading>;
}

/**
 * ビルド完了時のページ概要情報
 */
export interface PluginPageSummary {
  /** docs/からの相対パス（例: guide/setup.md） */
  readonly sourcePath: string;
  /** 出力相対パス（例: guide/setup.html） */
  readonly outputPath: string;
  /** base_url込みのURL */
  readonly url: string;
  /** ページタイトル */
  readonly title: string;
  /** ページ概要 */
  readonly description: string;
  /** フロントマター情報 */
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** ページ内見出し一覧 */
  readonly headings: ReadonlyArray<PluginHeading>;
  /** 生成されたHTML本文断片 */
  readonly contentHtml: string;
}

/**
 * ナビゲーション階層の公開ノード情報
 */
export interface PluginNavNode {
  /** ノード表示タイトル */
  readonly title: string;
  /** 出力相対パス（セクション親ノードでindex.mdが無い場合はnull） */
  readonly url: string | null;
  /** 子ノード一覧 */
  readonly children: ReadonlyArray<PluginNavNode>;
}

/**
 * ビルド完了時の全体コンテキスト
 */
export interface PluginBuildContext {
  /** ドキュメントディレクトリ（絶対パス） */
  readonly docsDir: string;
  /** 出力ディレクトリ（絶対パス） */
  readonly outputDir: string;
  /** 生成された全ページの情報一覧 */
  readonly pages: ReadonlyArray<PluginPageSummary>;
  /** ナビゲーション階層ツリー */
  readonly nav: ReadonlyArray<PluginNavNode>;
  /** CLIの --enable で明示指定されたプラグイン名一覧 */
  readonly enabledPlugins: ReadonlyArray<string>;
}


/**
 * 公開プラグインインターフェース（APIバージョン1）
 */
export interface MkDocsGenPlugin {
  /** プラグイン識別名 */
  name: string;
  /** プラグインAPIバージョン（必須: 1） */
  apiVersion: 1;

  /** 設定確定直後に呼ばれるフック */
  configResolved?(context: PluginConfigContext): void | Promise<void>;
  /** Markdown変換前に呼ばれるフック */
  transformMarkdown?(source: string, context: PluginMarkdownContext): string | Promise<string>;
  /** HTML生成後に呼ばれるフック */
  transformHtml?(html: string, context: PluginHtmlContext): string | Promise<string>;
  /** 全ページ出力完了後に呼ばれるフック */
  buildEnd?(context: PluginBuildContext): void | Promise<void>;
}

/**
 * プラグインファクトリ関数
 */
export type MkDocsGenPluginFactory = (options: Record<string, unknown>) => MkDocsGenPlugin;
