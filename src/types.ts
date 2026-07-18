import type { ResolvedConfig } from "./config/schema.js";

/**
 * ページ内見出し（目次・アンカー用）
 */
export interface Heading {
  /** 見出しレベル。2〜6（h1はページタイトル扱いで含めない） */
  level: number;
  /** タグ除去済みテキスト */
  text: string;
  /** slug化されたID */
  anchorId: string;
}

/**
 * ナビゲーション参照用の軽量ページ情報
 */
export interface PageRef {
  title: string;
  /** 出力相対パス。index無しセクションのパンくずではnull */
  url: string | null;
}

/**
 * 1つのMarkdownページ
 */
export interface Page {
  /** docs/からの相対パス（例: guide/setup.md） */
  sourcePath: string;
  /** 出力相対パス（例: guide/setup.html） */
  outputPath: string;
  /** base_url込みのURL */
  url: string;
  title: string;
  description: string;
  frontmatter: Record<string, unknown>;
  headings: Heading[];
  contentHtml: string;
  plainText: string;
  prev: PageRef | null;
  next: PageRef | null;
  breadcrumbs: PageRef[];
}

/**
 * ナビゲーションツリーのノード（セクションまたはページ）
 */
export interface NavNode {
  title: string;
  /** index.mdの無いセクションはnull */
  url: string | null;
  children: NavNode[];
}

/**
 * ビルド全体のコンテキスト
 */
export interface BuildContext {
  config: ResolvedConfig;
  pages: Page[];
  nav: NavNode[];
}
