---
title: テンプレートコンテキスト変数
order: 12
---

Nunjucksテンプレート（組み込みテーマ / `theme_overrides/`）に渡される公開コンテキストの仕様。

## 変数一覧

| 変数 | 型 | 内容 |
| --- | --- | --- |
| `site` | `{ title, description, baseUrl }` | サイト全体設定 |
| `page` | `Page` | 現在ページ |
| `nav` | `NavNode[]` | ナビゲーションツリー全体 |
| `root` | `string` | 現在ページから出力ルートへの相対プレフィックス（例: `""` / `"../"`） |
| `customCss` | `string[]` | 注入する追加CSSの相対パス一覧（例: `assets/custom/brand.css`） |
| `themeDefaultMode` | `"auto" \| "light" \| "dark"` | テーマ初期モード（`theme.default_mode`） |

## `site`

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `title` | `string` | サイトタイトル（`site.title`） |
| `description` | `string` | サイト説明（`site.description`） |
| `baseUrl` | `string` | 公開ベースURL（`site.base_url`） |

## `page`

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `sourcePath` | `string` | docs/からの相対パス（例: `guide/setup.md`） |
| `outputPath` | `string` | 出力相対パス（例: `guide/setup.html`） |
| `url` | `string` | `base_url`込みのURL（meta等向け） |
| `title` | `string` | ページタイトル |
| `description` | `string` | ページ説明 |
| `frontmatter` | `object` | 解析済みfrontmatter |
| `headings` | `Heading[]` | ページ内目次用見出し（h2〜h6） |
| `contentHtml` | `string` | 変換済み本文HTML（`\| safe` で出力する） |
| `plainText` | `string` | 検索用プレーンテキスト |
| `prev` | `PageRef \| null` | 前のページ |
| `next` | `PageRef \| null` | 次のページ |
| `breadcrumbs` | `PageRef[]` | パンくず（トップページは空配列） |

### `Heading`

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `level` | `number` | 見出しレベル（2〜6） |
| `text` | `string` | タグ除去済みテキスト |
| `anchorId` | `string` | slug化されたID |

### `PageRef`

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `title` | `string` | 表示タイトル |
| `url` | `string` | 出力相対パス（テンプレートでは `root + url` でリンクする） |

## `nav`（`NavNode`）

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `title` | `string` | 表示名 |
| `url` | `string \| null` | 出力相対パス。index.mdの無いセクションは `null` |
| `children` | `NavNode[]` | 子ノード |

## パス規約

- ページ間リンク・アセット参照は必ず `root` 経由の相対パスにする（`file://` 直開き対応）
- `page.url` は `base_url` 込みの絶対パスとして別途保持し、meta等に使う
- 現在ページ判定は `node.url == page.outputPath` で行う
