# MkDocsGen MVP実装計画書

[concept-plan.md](../concept-plan.md) の仕様のうち、[roadmap.md](./roadmap.md) のフェーズ1〜4に相当する
「`mkdocsgen build` で閲覧可能な静的サイトが出力される」状態（MVP）までの詳細実装計画。

---

## 1. プロジェクト概要

### 1.1 目的

Markdownソース（`docs/`）と設定ファイル（`mkdocsgen.yml`）から、3カラムレイアウト・ライト/ダークテーマ対応の
静的HTMLサイトを `site/` に出力する `mkdocsgen build` コマンドを完成させる。

### 1.2 スコープ

| 含む | 含まない（MVP後のフェーズで実装） |
| --- | --- |
| Config Loader（zod検証・デフォルト適用・エラー整形） | Admonition記法（フェーズ5） |
| ロガー（info/warn/error/debug、警告カウント） | Shikiシンタックスハイライト（フェーズ5） |
| Page Scanner（走査・frontmatter・タイトル/並び順決定） | Mermaid・コードコピーボタン（フェーズ5） |
| ナビツリー構築（自動 + nav設定ハイブリッドマージ） | リンク検証・initコマンド（フェーズ6） |
| prev/next・パンくず算出 | 全文検索（フェーズ7） |
| Markdown変換（GFM・アンカー・内部リンク書き換え） | 開発サーバー serve（フェーズ8） |
| Nunjucksレンダリング・テンプレートオーバーライド | PyDoc（フェーズ9） |
| 組み込みテーマ（3カラム・テーマ切替・レスポンシブ） | プラグイン機構（フェーズ10） |
| buildコマンド統合（`--config` / `--clean` / `--strict` の基本動作） | |

注記:
- MVPではコードブロックはハイライトなしの `<pre><code>` として描画する（フェーズ5でShikiに置き換え）
- `--strict` は「警告が1件以上あれば終了コード1」という一般機構のみMVPで実装する（警告の主要発生源であるリンク検証はフェーズ6）

### 1.3 前提条件

- Node.js 20以上、依存パッケージはインストール済み（package.json 参照）
- コーディング規約・TDDは [CLAUDE.md](../CLAUDE.md) に従う（テストなしのプロダクションコードを書かない）
- 疑似コード中のコメント・命名は実装時もそのまま使用してよい粒度で記述している

---

## 2. 要件定義

### 2.1 機能要件

| ID | 要件 | 仕様書参照 |
| --- | --- | --- |
| FR-01 | `mkdocsgen.yml` を読み込み、zodで検証し `ResolvedConfig` を生成する | 3.1 |
| FR-02 | 設定ファイル不在・YAML構文エラー・スキーマ違反をそれぞれ仕様通りのメッセージでエラー終了する | 2.8 |
| FR-03 | `docs_dir` 配下の `.md` を走査し `exclude`（glob）を適用する | 2.3.1 |
| FR-04 | frontmatter（title/order/description/draft）を解析し、`draft: true` を除外する | 2.3.3 |
| FR-05 | タイトル決定（frontmatter → 先頭 `#` 見出し → ファイル名）・セクション名決定・並び順決定を仕様の優先順位で行う | 2.3.1 |
| FR-06 | `nav` 設定によるハイブリッド上書き（列挙分優先、未列挙分は自動で末尾）。存在しないパスはエラー | 2.3.2 |
| FR-07 | ナビ順に基づき prev/next/breadcrumbs を算出する | 3.2 |
| FR-08 | GFM相当のMarkdown変換（テーブル・タスクリスト・打ち消し線・自動リンク） | 2.4.1 |
| FR-09 | 見出しにアンカーIDを付与し、ページ内目次用の headings を抽出する | 2.4.5, 4.2 |
| FR-10 | 内部相対リンクの `.md` → `.html` 書き換え（アンカー付き対応） | 2.4.5 |
| FR-11 | `markdown.allow_html: false` 時に生HTMLを無効化する | 5.2 |
| FR-12 | Nunjucksテンプレートで最終HTMLを生成し、`theme_overrides/` で部分差し替えできる | 4.4 |
| FR-13 | 3カラムレイアウト・パンくず・前後ナビ・サイドバー・ページ内目次を描画する | 4.1, 4.2 |
| FR-14 | テーマ切替（light → dark → auto 循環、localStorage保存、FOUC防止） | 4.3 |
| FR-15 | レスポンシブ対応（1200px / 768px、モバイルドロワー） | 4.5 |
| FR-16 | `theme.custom_css` を出力へコピーしテンプレートに注入する | 4.4 |
| FR-17 | ビルド完了時にページ数・警告数・所要時間のサマリを表示する | 5.3 |
| FR-18 | `--clean` で出力ディレクトリを事前クリア、`--strict` で警告時に終了コード1 | 2.2.2 |

### 2.2 非機能要件

- JS無効環境でも本文閲覧が可能（テーマ切替・目次追従等のみJS依存）
- 出力HTMLはローカルの `file://` 直開きでも閲覧できるよう、ページ間リンク・アセット参照は相対パスで生成する
  （`page.url` は `base_url` 込みの絶対パスとして別途保持し、meta等に使用する）
- ログは3レベル + `--verbose` でdebug（仕様書5.3）

### 2.3 CLIインターフェース

```
mkdocsgen build [--config <path>] [--strict] [--clean] [--verbose]
```

- 成功: 終了コード0。エラー: 終了コード1（`--strict` 時は警告ありも1）

### 2.4 テンプレートコンテキスト変数（公開仕様）

| 変数 | 型 | 内容 |
| --- | --- | --- |
| `site` | `{ title, description, baseUrl }` | サイト全体設定 |
| `page` | `Page`（3.2参照） | 現在ページ |
| `nav` | `NavNode[]` | ナビゲーションツリー全体 |
| `root` | `string` | 現在ページから出力ルートへの相対プレフィックス（例: `""` / `"../"`） |
| `customCss` | `string[]` | 注入する追加CSSの相対パス一覧 |
| `themeDefaultMode` | `"auto" \| "light" \| "dark"` | テーマ初期モード |

---

## 3. アーキテクチャ設計

### 3.1 データフロー

```
mkdocsgen.yml ──> [config/load] ──> ResolvedConfig ─┐
                                                    v
docs/**/*.md ──> [scanner/scan] ──> PageSource[] ──> [scanner/nav] ──> NavNode[] + ページ順序 + prev/next/breadcrumbs
                                                    │
                                                    v
                    [markdown/convert]（ページごと: contentHtml / headings / plainText）
                                                    │
                                                    v
                    [render/renderer]（Nunjucks: page.njk + partials）──> site/**/*.html
                                                    │
                    [build/pipeline] がアセットコピー（main.css / main.js / custom_css）とサマリ表示を担当
```

### 3.2 モジュール構成と依存関係

```
src/
├── types.ts              # 共有型（Page / NavNode / PageRef / Heading / BuildContext）
├── logger.ts             # ロガー（依存なし）
├── config/
│   ├── schema.ts         # zodスキーマとConfig型（依存なし）
│   └── load.ts           # YAML読込 + 検証 + パス解決（schema, loggerに依存）
├── scanner/
│   ├── scan.ts           # ファイル走査 + frontmatter（configに依存）
│   └── nav.ts            # ナビツリー・順序・prev/next/breadcrumbs（scanに依存）
├── markdown/
│   └── convert.ts        # markdown-it変換（configに依存）
├── render/
│   ├── renderer.ts       # Nunjucks環境とページ描画（configに依存）
│   └── assets.ts         # テーマアセット/custom_cssのコピー
├── build/
│   └── pipeline.ts       # 全体統合（上記すべてに依存）
└── cli/
    ├── program.ts        # コマンド定義（pipelineに依存）
    └── index.ts          # エントリポイント
templates/                # 組み込みテーマ（base.njk / page.njk / partials/ / assets/）
```

- 依存は上から下への一方向のみとし、循環依存を作らない
- `templates/` の解決は `new URL("../../templates", import.meta.url)` で行う
  （`src/render/renderer.ts` からも `dist/render/renderer.js` からも2階層上がリポジトリルートになるため同一式で解決できる）

---

## 4. 実装計画

タスクは「テストを書く → 実装する → 通す」を1タスク内で完結させる（TDD）。
見積もりは1タスク1〜2時間を基準に分割している。同一グループ内のタスクは記載順に実施する。

### グループA: 基盤（設定・ロガー）

| ID | タスク | 内容 | 依存 | 見積 |
| --- | --- | --- | --- | --- |
| A-1 | 共有型定義 | `src/types.ts` に Page / NavNode / PageRef / Heading / BuildContext を定義 | なし | 0.5h |
| A-2 | ロガー | `src/logger.ts`。レベル制御・警告カウント・サマリ用集計 | なし | 1h |
| A-3 | 設定スキーマ | `src/config/schema.ts`。zodスキーマ全項目 + デフォルト値 + strict（未知キー拒否） | なし | 2h |
| A-4 | 設定読込 | `src/config/load.ts`。YAML読込・3種のエラー整形（不在/構文/スキーマ） | A-3 | 2h |
| A-5 | パス解決 | `load.ts` 内で docs_dir 等を設定ファイル基準の絶対パスへ解決し `ResolvedConfig` を確定 | A-4 | 1h |

### グループB: ページ走査・ナビゲーション

| ID | タスク | 内容 | 依存 | 見積 |
| --- | --- | --- | --- | --- |
| B-1 | ファイル走査 | `src/scanner/scan.ts`。fast-globで `.md` 列挙 + exclude適用 | A-5 | 1.5h |
| B-2 | frontmatter解析 | gray-matterでの解析 + 先頭見出し抽出 + タイトル決定 + draft除外 | B-1 | 1.5h |
| B-3 | 自動ナビツリー | `src/scanner/nav.ts`。ディレクトリ構造→ツリー、order/辞書順、index先頭、セクション名決定 | B-2 | 2h |
| B-4 | nav上書きマージ | ハイブリッドマージ + ディレクトリ指定の自動展開 + 存在しないパスのエラー | B-3 | 2h |
| B-5 | ページ関係算出 | ナビ順のフラット化 → prev/next、ツリー位置 → breadcrumbs | B-4 | 1.5h |
| B-6 | 出力パス/URL | sourcePath → outputPath（`.md`→`.html`）と `base_url` 込みurlの算出 | B-2 | 0.5h |

### グループC: Markdown変換

| ID | タスク | 内容 | 依存 | 見積 | 状態 |
| --- | --- | --- | --- | --- | --- |
| C-1 | 基本変換 | `src/markdown/convert.ts`。markdown-it設定（GFM有効・allow_html切替） | A-5 | 1h | 完了 |
| C-2 | アンカー/headings | 見出しslug生成（日本語対応・重複回避）とHeading[]抽出 | C-1 | 2h | 完了 |
| C-3 | 内部リンク書き換え | 相対 `.md` リンクの `.html` 化（アンカー保持、外部/絶対リンクは非対象） | C-1 | 2h | 完了 |
| C-4 | plainText抽出 | HTMLタグ除去 + エンティティ復元 + 空白正規化 | C-1 | 1h | 完了 |

### グループD: レンダリング・テーマ・統合

| ID | タスク | 内容 | 依存 | 見積 | 状態 |
| --- | --- | --- | --- | --- | --- |
| D-1 | Renderer | `src/render/renderer.ts`。Nunjucks環境（overrides→組み込みの解決順）+ renderPage | A-5 | 1.5h | 完了 |
| D-2 | テンプレート一式 | base.njk / page.njk / partials 7種（header/sidebar/toc/breadcrumbs/prev-next/search/footer。searchは枠のみ） | D-1 | 2h | 完了 |
| D-3 | テーマCSS | 3カラムレイアウト + CSS変数パレット（ライト/ダーク） + タイポグラフィ | D-2 | 2h | 完了 |
| D-4 | テーマ切替JS | light→dark→auto循環・localStorage・FOUC防止インラインスクリプト | D-3 | 1.5h | 完了 |
| D-5 | サイドバーJS | セクション展開/折りたたみ・現在ページハイライト・aria属性 | D-3 | 1.5h | 完了 |
| D-6 | 目次追従JS | IntersectionObserverによる現在セクションハイライト・見出し1以下で非表示 | D-3 | 1.5h | 完了 |
| D-7 | レスポンシブ | 1200px/768pxブレークポイント・モバイルドロワー・オーバーレイ | D-3 | 1.5h | 完了 |
| D-8 | アセット処理 | `src/render/assets.ts`。テーマアセットコピー + custom_cssコピーと注入 | D-1 | 1h | 完了 |
| D-9 | buildパイプライン | `src/build/pipeline.ts`。全モジュール統合・clean/strict・エラーハンドリング | B-6, C-4, D-8 | 2h | 完了 |
| D-10 | CLI配線 | program.tsのbuildアクションをpipelineへ接続 + `--verbose` 追加 + サマリ表示 | D-9 | 1h | 完了 |
| D-11 | 統合テスト | フィクスチャ一式からのフルビルド + 出力HTMLスナップショット | D-10 | 2h | 完了 |
| D-12 | オーバーライド検証 | `theme_overrides/partials/footer.njk` 差し替えテスト + ブラウザ目視確認 | D-11 | 1h | 完了 |

**合計見積: 約35時間**

---

## 5. 詳細設計

### 5.1 共有型（src/types.ts）

仕様書3.2の内部データモデルをそのまま定義する。

```typescript
/**
 * ページ内見出し（目次・アンカー用）
 */
export interface Heading {
  level: number;                 // 2〜6（h1はページタイトル扱いで含めない）
  text: string;                  // タグ除去済みテキスト
  anchorId: string;              // slug化されたID
}

/**
 * ナビゲーション参照用の軽量ページ情報
 */
export interface PageRef {
  title: string;
  url: string;
}

/**
 * 1つのMarkdownページ
 */
export interface Page {
  sourcePath: string;            // docs/からの相対パス（例: guide/setup.md）
  outputPath: string;            // 出力相対パス（例: guide/setup.html）
  url: string;                   // base_url込みのURL
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
  url: string | null;            // index.mdの無いセクションはnull
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
```

### 5.2 ロガー（src/logger.ts）

```typescript
/** ログレベル。debugはverbose時のみ出力する */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * ビルド全体で共有するロガー。警告数をカウントし、strict判定とサマリ表示に使う
 */
export class Logger {
  private verbose: boolean;
  private warnCount: number = 0;

  constructor(verbose: boolean) { ... }

  debug(message: string): void   // verbose時のみ標準出力
  info(message: string): void    // 標準出力
  warn(message: string): void    // 標準エラー出力。warnCountを加算し "warn:" プレフィックス付与
  error(message: string): void   // 標準エラー出力。"error:" プレフィックス付与
  getWarnCount(): number         // strict判定・サマリ用
}
```

- 色付けはpicocolorsを使用（warn: 黄 / error: 赤）。テスト時は出力関数を差し替え可能にするため、
  コンストラクタで `write: (line: string) => void` を注入できるようにする（デフォルトはconsole）

### 5.3 Config Loader

#### 5.3.1 スキーマ（src/config/schema.ts）

```typescript
/** mkdocsgen.ymlの生スキーマ。未知キーはstrictで拒否する */
const rawConfigSchema = z.object({
  site: z.object({
    title: z.string(),                                   // 唯一の必須項目
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
  theme: z.object({
    overrides_dir: z.string().default("theme_overrides"),
    default_mode: z.enum(["auto", "light", "dark"]).default("auto"),
    custom_css: z.array(z.string()).default([])
  }).strict().default({}),
  markdown: z.object({
    allow_html: z.boolean().default(true)
  }).strict().default({}),
  pydoc: z.object({
    source_dirs: z.array(z.string()).default([])
  }).strict().default({}),
  plugins: z.array(z.object({
    path: z.string(),
    options: z.record(z.string(), z.unknown()).default({})
  }).strict()).default([]),
  serve: z.object({
    port: z.number().int().min(1).max(65535).default(3000)
  }).strict().default({})
}).strict();

/** zodの出力型（デフォルト適用済み） */
export type RawConfig = z.output<typeof rawConfigSchema>;

/**
 * パス解決済みの正規化設定。以降の全モジュールはこれだけを受け取る
 */
export interface ResolvedConfig extends RawConfig {
  configPath: string;            // 設定ファイルの絶対パス
  configDir: string;             // 設定ファイルのあるディレクトリ（相対パス解決の基準）
  docsDirAbs: string;            // docs_dirの絶対パス
  outputDirAbs: string;          // output_dirの絶対パス
  overridesDirAbs: string;       // theme.overrides_dirの絶対パス
}
```

- pydoc / plugins / serve はMVPでは使用しないが、スキーマ検証だけは通す（設定を書いてもエラーにしない）

#### 5.3.2 読込処理（src/config/load.ts）

```typescript
/**
 * 設定読込で発生するエラー。CLIはこのメッセージをそのまま表示して終了コード1にする
 */
export class ConfigError extends Error {}

/**
 * 設定ファイルを読み込み、検証・パス解決済みのResolvedConfigを返す
 */
export function loadConfig(configPath: string): ResolvedConfig
{
  const absPath = path.resolve(configPath);

  // ファイルが存在しない場合はinitの実行を促すエラーにする（仕様書2.8）
  if (!fs.existsSync(absPath)) {
    throw new ConfigError(
      `設定ファイルが見つかりません: ${absPath}\n` +
      `mkdocsgen init を実行して雛形を生成してください`
    );
  }

  // YAMLをパースする。構文エラー時は行番号付きで報告する（yamlパッケージのlinePosを使用）
  const source = fs.readFileSync(absPath, "utf-8");
  let raw: unknown;
  try {
    raw = YAML.parse(source);
  } catch (e) {
    // YAMLErrorのlinePos[0].line / colを埋め込む
    throw new ConfigError(`YAML構文エラー (${行}:${列}): ${メッセージ}`);
  }

  // zodで検証する。失敗時はキーのパスと期待型を整形して報告する
  const parsed = rawConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    // 例: "site.title: 必須項目です (expected string)" を issue ごとに1行で列挙
    throw new ConfigError(formatZodIssues(parsed.error.issues));
  }

  // 相対パスを設定ファイル基準の絶対パスへ解決して返す
  const configDir = path.dirname(absPath);
  return {
    ...parsed.data,
    configPath: absPath,
    configDir,
    docsDirAbs: path.resolve(configDir, parsed.data.docs_dir),
    outputDirAbs: path.resolve(configDir, parsed.data.output_dir),
    overridesDirAbs: path.resolve(configDir, parsed.data.theme.overrides_dir)
  };
}
```

### 5.4 Page Scanner

#### 5.4.1 走査とfrontmatter（src/scanner/scan.ts）

```typescript
/**
 * 走査直後のページ素材。Markdown変換前のメタ情報のみ持つ
 */
export interface PageSource {
  sourcePath: string;            // docs_dirからの相対パス（POSIX区切りに正規化）
  absPath: string;
  markdown: string;              // frontmatter除去後の本文
  frontmatter: Record<string, unknown>;
  title: string;                 // 決定済みタイトル
  order: number | null;          // frontmatterのorder（数値以外はnull + 警告）
  description: string;
  outputPath: string;            // guide/setup.md → guide/setup.html
  url: string;                   // base_url + outputPath
}

/**
 * docs_dir配下を走査し、draft除外・タイトル決定済みのPageSource一覧を返す
 */
export function scanPages(config: ResolvedConfig, logger: Logger): PageSource[]
{
  // fast-globで走査する。excludeはignoreオプションでglobのまま渡す
  const files = fastGlob.sync("**/*.md", { cwd: config.docsDirAbs, ignore: config.exclude });

  const sources: PageSource[] = [];
  for (const file of files) {
    const { data: frontmatter, content } = grayMatter(読み込んだ内容);

    // draft: true はビルド対象から除外する（仕様書2.3.1）
    if (frontmatter.draft === true) continue;

    // タイトル決定の優先順位: frontmatter.title → 先頭の "# 見出し" → 拡張子なしファイル名
    const title = frontmatter.title
      ?? extractFirstH1(content)   // 正規表現 /^#\s+(.+)$/m で先頭見出しを探す
      ?? path.basename(file, ".md");

    sources.push({ ...一式を構築 });
  }
  return sources;
}
```

#### 5.4.2 ナビツリー構築（src/scanner/nav.ts）

内部で使う中間ツリー構造:

```typescript
/** ディレクトリ構造を表す中間ノード */
interface TreeNode {
  kind: "section" | "page";
  name: string;                  // ディレクトリ名 or ファイル名
  title: string;
  order: number | null;
  page: PageSource | null;       // sectionの場合はindex.mdのPageSource（無ければnull）
  children: TreeNode[];
}
```

処理フロー:

```typescript
/**
 * ナビツリー構築の結果。ツリーとナビ順のフラットなページ列を返す
 */
export interface NavResult {
  nav: NavNode[];
  orderedPages: PageSource[];    // prev/next算出用のナビ順ページ列
  breadcrumbsMap: Map<string, PageRef[]>;  // sourcePath → パンくず
}

export function buildNav(sources: PageSource[], config: ResolvedConfig, logger: Logger): NavResult
{
  // 1. sourcePathを"/"で分割してディレクトリツリー（TreeNode）を構築する
  //    - index.mdは親セクションのpageに割り当て、セクションtitleはindex.mdのtitle → ディレクトリ名の順で決定
  // 2. 各階層をソートする
  //    - index.md（section自身のページ）は常に先頭
  //    - orderがあるものが先（数値昇順）。同順・order無しは名前の辞書順
  // 3. config.navが指定されていればハイブリッドマージを行う
  //    - navエントリを順に解決する。path末尾が"/"ならセクション、それ以外はページ
  //    - 解決できないpathはConfigErrorで即エラー（該当パスをメッセージに含める）
  //    - navエントリのtitle指定があればノードのtitleを上書きする
  //    - navに列挙されなかったルート直下のノードは、自動ソート順のまま末尾に追加する
  // 4. TreeNode → NavNode へ変換する（kind情報を落とし、urlを確定）
  // 5. ツリーを深さ優先で走査してorderedPagesとbreadcrumbsMapを作る
  //    - パンくずは「ルートから当該ページまでのセクション列 + 自分自身」。トップページ(index.md)は空配列
}
```

prev/next算出（buildNavの結果を使う）:

```typescript
/**
 * ナビ順のページ列からprev/nextを割り当てる
 */
export function assignPrevNext(orderedPages: PageSource[]): Map<string, { prev: PageRef | null; next: PageRef | null }>
{
  // i番目のページに対し prev = i-1（先頭はnull）、next = i+1（末尾はnull）を対応付ける
}
```

### 5.5 Markdown変換（src/markdown/convert.ts）

```typescript
/** 変換結果 */
export interface ConvertResult {
  html: string;
  headings: Heading[];
  plainText: string;
}

/**
 * Markdown変換器。markdown-itインスタンスを1回だけ構築し全ページで使い回す
 */
export function createConverter(config: ResolvedConfig, logger: Logger)
{
  const md = new MarkdownIt({
    html: config.markdown.allow_html,   // 生HTML許可の切り替え（仕様書5.2）
    linkify: true                       // 自動リンク（GFM）
  });
  // GFMのテーブル・打ち消し線はmarkdown-it本体で対応済み。タスクリストのみ自前ルールを追加する
  //（"[ ] " / "[x] " で始まるリスト項目をチェックボックス付き<li>に変換する軽量プラグインを実装）

  return {
    /**
     * 1ページ分のMarkdownをHTML・見出し一覧・プレーンテキストへ変換する
     */
    convert(markdown: string, sourcePath: string): ConvertResult { ... }
  };
}
```

主要ロジックの疑似コード:

```typescript
// --- 見出しアンカー付与とheadings抽出（coreルーラーの後処理として実装） ---
function applyHeadingAnchors(tokens: Token[], headings: Heading[]): void
{
  const used = new Set<string>();
  for (heading_openトークンとその直後のinlineトークンの組) {
    const text = inlineトークンの子からテキストを連結;
    // 日本語を保持するslug化: 小文字化 → 空白をハイフン → Unicodeの文字・数字・ハイフン以外を除去
    let slug = slugify(text);
    // 重複時は -2, -3 ... を付けて一意化する
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    heading_openトークンに attrSet("id", slug);
    if (レベルが2以上) headings.push({ level, text, anchorId: slug });
  }
}

// --- 内部リンク書き換え（link_openのhref属性を加工） ---
function rewriteInternalLink(href: string): string
{
  // 対象外: http(s)://、//、mailto:、ページ内アンカーのみ(#...)、サイト絶対パス(/...)
  if (isExternalOrAbsolute(href)) return href;
  // "target.md" / "../a/b.md#section" のような相対.mdリンクだけを書き換える
  const [pathPart, anchor] = hrefを"#"で分割;
  if (!pathPart.endsWith(".md")) return href;
  return pathPart.replace(/\.md$/, ".html") + (anchor ? `#${anchor}` : "");
}

// --- plainText抽出（検索インデックスの布石。MVPではPage.plainTextに保持するだけ） ---
function htmlToPlainText(html: string): string
{
  // タグ除去 → 主要エンティティ(&amp; &lt; &gt; &quot; &#39;)復元 → 連続空白を1つに正規化
}
```

- リンク先ファイルの存在チェックはMVPでは行わない（フェーズ6のリンク検証で実装）

### 5.6 レンダリング

#### 5.6.1 Renderer（src/render/renderer.ts）

```typescript
/**
 * Nunjucksテンプレートでページを最終HTMLに変換するレンダラー
 */
export class Renderer {
  private env: nunjucks.Environment;

  constructor(config: ResolvedConfig)
  {
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
    const root = "../".repeat(page.outputPathの階層数);
    return this.env.render("page.njk", {
      site: { title, description, baseUrl },
      page, nav: context.nav, root,
      customCss: 相対パス化したcustom_css一覧,
      themeDefaultMode: config.theme.default_mode
    });
  }
}
```

#### 5.6.2 テンプレート構成（templates/）

```
templates/
├── base.njk          # <!DOCTYPE>〜</html>。head内にFOUC防止インラインJS、blockで各部を定義
├── page.njk          # base.njkを継承し、mainコンテンツ・パンくず・前後ナビを流し込む
├── partials/
│   ├── header.njk        # サイトタイトル・検索枠（MVPでは非活性のプレースホルダ）・テーマ切替ボタン
│   ├── sidebar.njk       # navを再帰マクロで描画。現在ページにaria-current="page"
│   ├── toc.njk           # page.headingsからページ内目次。headingsが1以下なら出力しない
│   ├── breadcrumbs.njk   # page.breadcrumbsから生成。空配列（トップページ）なら出力しない
│   ├── prev-next.njk     # page.prev / page.nextの存在する側だけ描画
│   ├── search.njk        # 検索UI枠のみ（フェーズ7で実装。inputはdisabled）
│   └── footer.njk        # ビルド情報（サイト名・生成日時）
└── assets/
    ├── main.css      # テーマ全体（CSS変数・3カラム・レスポンシブ）
    └── main.js       # テーマ切替・サイドバー開閉・目次追従・ドロワー
```

- ナビ描画はNunjucksマクロの再帰呼び出しで実装する（`{% macro navTree(nodes, currentUrl, root) %}`）
- 現在ページ判定は `node.url == page.outputPath` の比較で行い、リンクhrefは `root + node.url` で相対化する

#### 5.6.3 テーマ切替の動作（main.js + base.njkインラインJS）

```javascript
// --- base.njk の<head>内インラインスクリプト（FOUC防止のため同期実行） ---
// 1. localStorage "mkdocsgen-theme" を読む（値: "light" | "dark" | "auto" | 無し）
// 2. 無ければテンプレート変数themeDefaultModeを初期値とする
// 3. "auto"の場合はmatchMedia("(prefers-color-scheme: dark)")で実際のモードを解決する
// 4. document.documentElement.dataset.theme = 解決結果("light" | "dark") を設定する

// --- main.js のテーマ切替ボタン ---
// クリックごとに light → dark → auto → light... と循環し、localStorageへ保存して即時反映する
// autoモード中はprefers-color-schemeのchangeイベントを監視して追従する
// ボタンのアイコン表示も現在モードに合わせて更新する
```

#### 5.6.4 アセット処理（src/render/assets.ts）

```typescript
/**
 * テーマアセットとcustom_cssを出力ディレクトリへコピーする
 */
export function copyAssets(config: ResolvedConfig): string[]
{
  // templates/assets/* を outputDirAbs/assets/ へ再帰コピーする
  // theme.custom_cssの各ファイルを outputDirAbs/assets/custom/ へコピーする
  //（存在しないcustom_cssパスはConfigErrorにする）
  // 戻り値: テンプレートへ注入する追加CSSの出力相対パス一覧（例: assets/custom/brand.css）
}
```

### 5.7 buildパイプライン（src/build/pipeline.ts）

```typescript
/** buildコマンドのオプション */
export interface BuildOptions {
  configPath: string;
  strict: boolean;
  clean: boolean;
  verbose: boolean;
}

/** ビルド結果サマリ */
export interface BuildResult {
  pageCount: number;
  warnCount: number;
  durationMs: number;
}

/**
 * ビルド全体を実行する。CLIから呼ばれる唯一の入口
 */
export async function runBuild(options: BuildOptions, logger: Logger): Promise<BuildResult>
{
  const startedAt = Date.now();

  // 1. 設定を読み込む（失敗時はConfigErrorがそのまま上へ伝播しCLIが表示する）
  const config = loadConfig(options.configPath);

  // 2. --clean指定時は出力ディレクトリを空にする
  //    誤爆防止のため、outputDirAbsがconfigDir配下に無い場合はエラーにする
  if (options.clean) fs.rmSync(config.outputDirAbs, { recursive: true, force: true });

  // 3. ページ走査 → ナビ構築 → prev/next割り当て
  const sources = scanPages(config, logger);
  const navResult = buildNav(sources, config, logger);
  const relations = assignPrevNext(navResult.orderedPages);

  // 4. 各ページをMarkdown変換してPage[]を完成させる
  const converter = createConverter(config, logger);
  const pages: Page[] = navResult.orderedPages.map((source) => {
    const converted = converter.convert(source.markdown, source.sourcePath);
    return { ...sourceのメタ情報, ...converted, ...relations.get(source.sourcePath), breadcrumbs };
  });

  // 5. アセットをコピーし、全ページをレンダリングして書き出す
  const customCss = copyAssets(config);
  const renderer = new Renderer(config);
  const context: BuildContext = { config, pages, nav: navResult.nav };
  for (const page of pages) {
    const html = renderer.renderPage(page, context);
    出力先ディレクトリをmkdir -pしてから書き込む;
  }

  // 6. サマリを表示し、strict判定を行う
  const result = { pageCount: pages.length, warnCount: logger.getWarnCount(), durationMs: Date.now() - startedAt };
  logger.info(`${pageCount}ページを出力 (警告${warnCount}件, ${duration}秒)`);
  if (options.strict && result.warnCount > 0) {
    throw new BuildError("strictモード: 警告があるためビルドを失敗させます");
  }
  return result;
}
```

CLI側（program.tsのbuildアクション）:

```typescript
.action(async (options) => {
  const logger = new Logger(options.verbose);
  try {
    await runBuild({ ...options整形 }, logger);
  } catch (e) {
    // ConfigError / BuildErrorはメッセージのみ、想定外の例外はスタックトレース付きで表示する
    logger.error(整形したメッセージ);
    process.exitCode = 1;
  }
});
```

---

## 6. テスト計画

### 6.1 テスト戦略

- **単体テスト**: 各モジュールを純粋関数ベースでテストする。ファイルI/Oが必要なものは
  `tests/fixtures/` 配下のフィクスチャ、または一時ディレクトリ（`fs.mkdtempSync`）を使う
- **統合テスト**: フィクスチャプロジェクト（docs/ + mkdocsgen.yml）から `runBuild` を実行し、
  出力HTMLをVitestのスナップショットで比較する
- **目視確認**: レイアウト・テーマ切替・レスポンシブはD-11/D-12完了時にブラウザで確認する
  （スクリーンショット確認をもって完了とする）

### 6.2 フィクスチャ構成

```
tests/fixtures/
├── basic-site/               # 統合テスト用の標準プロジェクト
│   ├── mkdocsgen.yml
│   ├── docs/
│   │   ├── index.md          # トップページ
│   │   ├── a.md              # 単独ページ（order指定あり）
│   │   ├── b/index.md        # セクショントップ
│   │   ├── b/c.md            # セクション配下ページ（内部リンク・GFM記法を含む）
│   │   └── drafts/x.md       # draft: true（除外確認用）
│   └── theme_overrides/      # D-12用（footer.njkのみ差し替え）
└── configs/                  # Config Loaderテスト用のYAML群（正常・構文エラー・型違反 等）
```

### 6.3 テストケース一覧

| 対象 | ケース | 期待結果 |
| --- | --- | --- |
| config | 必須項目のみのYAML | デフォルト値がすべて適用される |
| config | site.title欠落 | ConfigError（キー名と期待型を含む） |
| config | 未知キー `sitee:` | ConfigError（未知キーを含む） |
| config | 構文エラーYAML | ConfigError（行番号を含む） |
| config | ファイル不在 | ConfigError（"mkdocsgen init" を含む） |
| config | 相対docs_dir | configDir基準の絶対パスに解決される |
| scanner | `a.md, b/index.md, b/c.md` | ナビが `a, b(c)` 構造になる |
| scanner | `order: 1` のページ | 辞書順より優先され先頭に来る |
| scanner | index.mdを含む階層 | index.mdが常に先頭 |
| scanner | frontmatter title / 先頭h1 / なし | 優先順位通りにタイトル決定 |
| scanner | `draft: true` | ページ一覧から除外される |
| scanner | exclude: `drafts/**` | 該当ファイルが走査されない |
| scanner | navで一部のみ列挙 | 列挙分が先頭、残りは自動順で末尾 |
| scanner | navに存在しないパス | エラー（該当パスを含む） |
| scanner | navのディレクトリ指定 `guide/` | 配下が自動展開される |
| scanner | 先頭/末尾ページ | prev/nextの片側がnull |
| scanner | ネストページ | breadcrumbsがルート→自身の順 |
| markdown | テーブル/タスクリスト/打ち消し/自動リンク | GFM相当のHTMLが出る |
| markdown | 見出し（日本語含む） | id付与とheadings抽出、重複見出しは-2連番 |
| markdown | `[x](../guide/setup.md#sec)` | `../guide/setup.html#sec` に書き換え |
| markdown | `https://...` / `/abs` / `#anchor` | 書き換えられない |
| markdown | allow_html: false + `<script>` | エスケープされて出力される |
| markdown | plainText抽出 | タグ除去・空白正規化されたテキスト |
| render | オーバーライド無し | 組み込みfooterが使われる |
| render | footer.njkのみオーバーライド | フッターのみ差し替わり他は組み込み |
| render | ネストページのroot | `"../"` が適用されリンクが相対になる |
| build | basic-siteフルビルド | 全HTML出力がスナップショット一致 |
| build | --clean | 事前に置いたゴミファイルが消える |
| build | --strict + 警告発生 | BuildErrorで失敗する |
| cli | build失敗時 | 終了コード1 |

### 6.4 テスト自動化

- `npm test` で全テストが常時実行可能（外部依存なし）
- CI導入（GitHub Actions等）はMVPスコープ外とし、ローカルでの `typecheck + test` 通過をマージ条件とする

---

## 7. リスク管理

| リスク | 影響 | 対策 |
| --- | --- | --- |
| markdown-itのGFM対応範囲の誤認（タスクリスト等は標準非対応） | C-1の手戻り | 計画時点で確認済み。タスクリストは自前の軽量ルールで実装する方針を織り込み済み |
| 日本語見出しのslug化の仕様ブレ | アンカーリンクの安定性 | slugifyを純粋関数として切り出しテストで仕様を固定する。フェーズ6のリンク検証でも同じ関数を使う |
| file://閲覧と`base_url`の両立が崩れる | 出力の使い勝手 | 「表示リンクはroot相対・page.urlはbase_url込み」の二本立てを全テンプレートで徹底し、統合テストでhref属性を検証する |
| Nunjucksテンプレートのテスト困難性 | D系タスクの品質 | ロジックはできる限りTS側（Renderer/パイプライン）へ寄せ、テンプレートは表示のみに徹する |
| スナップショットテストが変更に脆い | 保守コスト | スナップショット対象はbasic-siteの主要3ページに限定し、細部はhref/id等のピンポイントassertで担保する |
| テーマCSS/JSの工数超過 | スケジュール | MVPでは装飾を最小限にし「構造とテーマ切替が正しい」ことを優先する。見た目の磨き込みはフェーズ11へ送る |
| 増分ビルドを見据えない設計にしてしまう | フェーズ8で手戻り | パイプラインを「ページ単位の変換関数の集合」として構成し、変換器・レンダラーを再利用可能なインスタンスにしておく |

---

## 8. 進捗管理

### 8.1 マイルストーン

| マイルストーン | 内容 | 対応タスク |
| --- | --- | --- |
| M1 | 設定が読める（loadConfigがテスト込みで完成） | A-1〜A-5 |
| M2 | ナビツリーが組める（フィクスチャからNavResultが出る） | B-1〜B-6 |
| M3 | Markdownが変換できる（ConvertResultが出る）【到達済み】 | C-1〜C-4 |
| M4 | **MVP完成**: `mkdocsgen build` でサイトが出力されブラウザ閲覧できる【到達済み】 | D-1〜D-12 |

### 8.2 進捗の付け方

- 本計画書のタスク表を正とし、完了したタスクは実装コミットに含める形でチェックを付ける
- [roadmap.md](./roadmap.md) のフェーズ1〜4のチェックボックスもタスク完了に合わせて更新する
- 各マイルストーン到達時に「テスト全通過 + typecheck通過」を確認してから次グループへ進む
- 想定外の設計変更が必要になった場合は作業を止め、本計画書を修正してから再開する（CLAUDE.mdの再計画方針）

### 8.3 レビュー・検証タイミング

- M4到達時: `basic-site` のビルド結果をブラウザで開き、レイアウト・テーマ切替・レスポンシブ・
  オーバーライド動作を目視確認する（スクリーンショットを残す）
- 完了報告前に「該当変更を取り消すとレッドになるテストが存在するか」を確認する（CLAUDE.mdのTDD方針）

### 8.4 作成・更新するドキュメント

| ドキュメント | 内容 | タイミング |
| --- | --- | --- |
| README.md | buildコマンドの使い方更新 | M4完了時 |
| dev_docs/template-context.md | テンプレートコンテキスト変数の公開仕様（2.4を清書） | D-2完了時 |
| tasks/lessons.md | 実装中に受けた指摘・学びの記録 | 随時 |
