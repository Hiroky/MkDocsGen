import { z } from "zod";

/**
 * オブジェクト欠落時に空オブジェクトを通し、ネスト側のdefaultを効かせる
 */
function withObjectDefaults<T extends z.ZodType>(schema: T)
{
  // zod 4では .default({}) だとネストdefaultが走らないため、undefinedを{}へ正規化する
  return z.preprocess((value) => (value === undefined ? {} : value), schema);
}

/** テーマ設定のスキーマ */
const themeSchema = z.object({
  overrides_dir: z.string().default("theme_overrides"),
  default_mode: z.enum(["auto", "light", "dark"]).default("auto"),
  custom_css: z.array(z.string()).default([]),
  // ヘッダ左に並記するロゴ画像（設定ファイル基準の相対パス）
  logo: z.string().optional(),
  // サイトのfavicon（設定ファイル基準の相対パス）
  favicon: z.string().optional()
}).strict();

/** Markdown変換オプションのスキーマ */
const markdownSchema = z.object({
  allow_html: z.boolean().default(true),
  // 段落内の通常改行を<br>にする（日本語ドキュメント向けの既定）
  breaks: z.boolean().default(true)
}).strict();

/** PyDoc設定のスキーマ */
const pydocSchema = z.object({
  source_dirs: z.array(z.string()).default([])
}).strict();

/** 開発サーバー設定のスキーマ（MVPでは未使用だが検証のみ通す） */
const serveSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000)
}).strict();

/**
 * mkdocsgen.ymlの生スキーマ。未知キーはstrictで拒否する
 */
export const rawConfigSchema = z.object({
  site: z.object({
    // 唯一の必須項目。サイト名としてヘッダーやtitleに使う
    title: z.string(),
    description: z.string().default(""),
    base_url: z.string().default("/")
  }).strict(),
  docs_dir: z.string().default("docs"),
  output_dir: z.string().default("site"),
  nav: z.array(z.object({
    title: z.string().optional(),
    path: z.string()
  }).strict()).default([]),
  exclude: z.array(z.string()).default([]),
  theme: withObjectDefaults(themeSchema),
  markdown: withObjectDefaults(markdownSchema),
  pydoc: withObjectDefaults(pydocSchema),
  plugins: z.array(z.object({
    path: z.string(),
    options: z.record(z.string(), z.unknown()).default({})
  }).strict()).default([]),
  serve: withObjectDefaults(serveSchema)
}).strict();

/** zodの出力型（デフォルト適用済み） */
export type RawConfig = z.output<typeof rawConfigSchema>;

/**
 * パス解決済みの正規化設定。以降の全モジュールはこれだけを受け取る
 */
export interface ResolvedConfig extends RawConfig {
  /** 設定ファイルの絶対パス */
  configPath: string;
  /** 設定ファイルのあるディレクトリ（相対パス解決の基準） */
  configDir: string;
  /** docs_dirの絶対パス */
  docsDirAbs: string;
  /** output_dirの絶対パス */
  outputDirAbs: string;
  /** theme.overrides_dirの絶対パス */
  overridesDirAbs: string;
}
