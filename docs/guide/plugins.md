---
title: プラグイン
order: 7
---

`plugins` にはローカルの ESM ファイル（`path`）か、パッケージに同梱された組み込みプラグイン（`builtin`）のどちらかを列挙すると、ビルドライフサイクルへ処理を差し込めます。`path` と `builtin` は同一エントリに両方書けません（どちらか一方のみ）。

## 設定例

```yaml
plugins:
  # 組み込みプラグイン（npm installしただけの環境でも動く）
  - builtin: confluence-export
    options:
      space: DOCS
      dryRun: true
  # 独自のローカルESMファイル
  - path: ./plugins/my-plugin.mjs
    options: {}
```

`options` はプラグインファクトリの引数として渡されます。

## フック

| フック | タイミング |
| --- | --- |
| `configResolved` | 設定読込直後 |
| `transformMarkdown` | 各ページの Markdown 変換前（文字列を返す） |
| `transformHtml` | 各ページの HTML 出力直前（文字列を返す） |
| `buildEnd` | 全ページ出力完了後 |

列挙順に直列実行されます。フック内で例外が投げられると、プラグイン名とスタック付きでビルドが失敗します。

## 組み込みプラグイン: confluence-export

`builtin: confluence-export` で登録できます。YAMLに書いただけでは同期せず、`mkdocsgen build --enable confluence-export` を付けたときだけ Confluence へアップロードします（通常の `build` / `serve` ではサイト生成のみ）。`url` / `username` / `space` / `parentPageId` はYAMLの `options` と環境変数（`CONFLUENCE_URL` / `CONFLUENCE_USERNAME` / `CONFLUENCE_SPACE` / `CONFLUENCE_PARENT_PAGE_ID`）のどちらでも指定でき、両方あれば環境変数が優先されます。`password` だけはYAMLに書けず、`CONFLUENCE_PASSWORD` 環境変数専用です（秘密情報の誤コミット防止）。

環境変数はシェルで `export` する他、`mkdocsgen.yml` と同じフォルダに `.env` を置いても `build` / `serve` の両方で自動的に読み込まれます（既にシェルで設定済みの環境変数がある場合はそちらが優先され、`.env` の値では上書きされません）。

ページの更新対象はタイトルではなく、ページに保存する `mkdocsgen-source-key` プロパティで判定します。同じタイトルの別ページや、このプロパティを持たない既存ページは上書きしません。同名ページがある場合は、まず親階層を付けたタイトル（例: `Setup（Guide）`）、それでも衝突する場合はソースパスを付けたタイトル（例: `Setup（guide/setup.md）`）で新規作成します。作成後はそのタイトルをsourceKeyと組み合わせて再利用するため、次回以降は同じページを更新できます。

本文と `toctree` のページ間相対リンクは、全ページのConfluenceページID確定後に `pages/viewpage.action?pageId=...` 形式へ変換します。見出しアンカー（`#section`）も保持されます。画像は従来どおりConfluence添付ファイル参照へ変換されます。

生成後のStorage Format本文全体のSHA-256をConfluenceのコンテンツプロパティへ保存し、次回の生成結果と一致するページはページ本文の更新API（PUT）をスキップします。Confluence保存時のHTML正規化による見かけ上の差分に影響されず、変更のないページではバージョンを増やしません。

ローカル画像はSHA-256ハッシュをコンテンツプロパティへ保存し、補助情報としてStorage Formatの管理用コメントにも埋め込みます。Confluence側のハッシュと一致する画像は添付ファイルの更新もスキップし、ハッシュが無い既存ページは初回同期時にアップロードして管理情報を付与します。ログにはページごとに `created` / `updated` / `skipped` と画像のアップロード・スキップ数を表示します。

### homeAsRoot（ホームを親ページにする）

既定では、ナビのトップレベル項目（Home / Guide / API 等）は全て `parentPageId`（未指定ならスペース直下）の直接の子として並列に登録されます。`options.homeAsRoot: true` を指定すると、ルートインデックス（`docs/index.md` → ナビの "Home"）を実際の親ページとして扱い、他のトップレベル項目をその子としてぶら下げます。

```yaml
plugins:
  - builtin: confluence-export
    options:
      space: DOCS
      homeAsRoot: true   # HomeをConfluence上の親ページにする
      rootPageTitle: "My Product Documentation"  # Confluence上のindex.mdのタイトル
```

ホーム（`docs/index.md`）が存在しない場合は、`homeAsRoot: true` を指定していても例外にはならず、既定のフラットな構成にフォールバックします。

`options.rootPageTitle` を指定すると、Confluenceへエクスポートするルートページ（`docs/index.md`）のタイトルだけを上書きできます。サイト側のナビゲーション名やMarkdownのfrontmatter titleは変更されません。未指定時は従来どおりルートページのタイトルを使用します。

## 独自プラグインの書き方

```javascript
export default function createPlugin(options = {}) {
  return {
    name: "my-plugin",
    async transformHtml(html, page) {
      return html;
    },
    async buildEnd(context) {
      // context.pages / context.nav などを利用
    }
  };
}
```
