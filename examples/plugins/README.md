# Plugin Examples

MkDocsGenのプラグイン参考実装です。コアのテスト対象外です。

## confluence-export.mjs

`buildEnd` フックでナビ階層とページHTMLをConfluence REST APIへ同期する骨格実装です。

### 使い方

1. プロジェクトにプラグインをコピーするか、パスで参照する
2. `mkdocsgen.yml` に追加する:

```yaml
plugins:
  - path: ./examples/plugins/confluence-export.mjs
    options:
      space: DOCS
      parentPageId: "123456"   # 任意
      dryRun: true             # まずtrueで計画だけ確認
```

3. 認証情報を環境変数で渡す（YAMLには書かない）:

```bash
export CONFLUENCE_BASE_URL="https://example.atlassian.net/wiki"
export CONFLUENCE_EMAIL="you@example.com"
export CONFLUENCE_API_TOKEN="..."
```

4. `mkdocsgen build` を実行する

`dryRun: true` のときはAPIを呼ばず、エクスポート計画のみをログ出力します。
