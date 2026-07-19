---
title: プラグイン
order: 7
---

ローカルの ESM ファイルを `plugins` に列挙すると、ビルドライフサイクルへ処理を差し込めます。

## 設定例

```yaml
plugins:
  - path: ./examples/plugins/confluence-export.mjs
    options:
      space: DOCS
      dryRun: true
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

## 参考実装

Confluence エクスポートの骨格はリポジトリの `examples/plugins/confluence-export.mjs` にあります。認証情報は環境変数のみを使い、YAML には書きません。

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
