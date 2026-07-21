---
title: 設定
order: 2
---

設定はプロジェクトルートの `mkdocsgen.yml` に書きます。必須は `site.title` のみです。

## 最小例

```yaml
site:
  title: My Docs
```

## 主なキー

| キー | 説明 |
| --- | --- |
| `site.title` / `description` / `base_url` | サイト名・説明・公開ベースURL |
| `docs_dir` / `output_dir` | 入力・出力ディレクトリ（既定: `docs` / `site`） |
| `nav` | ナビの明示順（省略時はディレクトリから自動構築） |
| `exclude` | glob 形式の除外パターン |
| `theme` | オーバーライドDIR・初期テーマ・追加CSS・logo / favicon |
| `markdown.allow_html` | 生HTMLの許可（既定: `true`） |
| `markdown.breaks` | 段落内の通常改行を `<br>` にする（既定: `true`） |
| `pydoc.source_dirs` | `::: pydoc` のモジュール探索パス |
| `plugins` | ローカル ESM プラグイン一覧 |
| `serve.port` | 開発サーバーのポート |

詳細なスキーマは [設定リファレンス](../reference/config.md) を参照してください。

## ナビゲーション

`nav` を省略すると `docs/` の構造から自動でツリーを作ります。`nav` に列挙したパスは先頭に固定され、未列挙のページは末尾に自動追加されます。存在しないパスを指定するとビルドエラーになります。

セクションの階層をサイドバーに残すときは、個別ページではなくディレクトリ（末尾 `/`）を指定します。ページ単位で列挙すると、そのページだけが取り出されて階層が潰れる点に注意してください。

```yaml
nav:
  - title: ホーム
    path: index.md
  - title: ガイド
    path: guide/
  - title: サンプル
    path: samples/
```
