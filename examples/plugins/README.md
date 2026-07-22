# Plugin Examples

MkDocsGenの独自プラグインの書き方を示すディレクトリです。

Confluenceエクスポートは組み込みプラグインとしてパッケージに同梱されています。`examples/plugins/confluence-export.mjs` のようなファイルをパスで参照する必要はなく、`mkdocsgen.yml` に次のように書くだけで有効化できます。

```yaml
plugins:
  - builtin: confluence-export
    options:
      space: DOCS
      dryRun: true
```

設定項目（`url` / `username` / `password` / `space` / `parentPageId`）や環境変数（`CONFLUENCE_URL` 等）の詳細は [docs/guide/plugins.md](../../docs/guide/plugins.md) を参照してください。

## 独自プラグインを書く場合

`plugins` に `path` でローカルESMファイルを指定すると、同じフック（`configResolved` / `transformMarkdown` / `transformHtml` / `buildEnd`）を使った独自プラグインを追加できます。

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

```yaml
plugins:
  - path: ./plugins/my-plugin.mjs
    options: {}
```

フック一覧やタイミングは [docs/guide/plugins.md](../../docs/guide/plugins.md) を参照してください。
