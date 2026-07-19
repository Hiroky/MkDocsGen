# Examples

変換済みサイトを手元で確認するためのサンプルです。

## phase5-demo

Admonition / Shiki / Mermaid / 全文検索などの見た目を確認するデモ。

### 確認手順

```bash
npm run example:build
```

出力先は `examples/phase5-demo/site/`。`index.html` をブラウザで直接開けばよい（サーバー不要）。

主な確認ポイント:

- `site/index.html` … レンダリング結果
- `site/assets/search-index.json` … 検索インデックス（確認用）
- ヘッダーの検索ボックス … 全文検索

`site/` は `.gitignore` 対象のため、確認のたびに `example:build` で再生成する。

## plugins

プラグイン参考実装（Confluenceエクスポート等）。詳細は [plugins/README.md](./plugins/README.md)。
