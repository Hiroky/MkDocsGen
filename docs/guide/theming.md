---
title: テーマとカスタマイズ
order: 5
---

## 組み込みテーマ

3カラムレイアウト（サイドバー / 本文 / 目次）、ライト・ダーク・auto 切替、レスポンシブ対応が標準です。

## テンプレートオーバーライド

`theme.overrides_dir`（既定: `theme_overrides/`）に組み込みと同じ相対パスで `.njk` を置くと、そのファイルだけ差し替わります。

```
theme_overrides/
  partials/footer.njk
```

利用可能なブロック: `title` / `head` / `content` / `scripts`。

テンプレートに渡る変数は [テンプレートコンテキスト](../reference/template-context.md) を参照してください。

## 追加CSS

```yaml
theme:
  custom_css:
    - assets/brand.css
```

パスは設定ファイル基準です。ビルド時に出力へコピーされ、各ページの `<head>` にリンクされます。

## ロゴとfavicon

```yaml
theme:
  logo: brand/logo.svg
  favicon: brand/favicon.ico
```

- パスは設定ファイル基準の相対パスです
- ビルド時に `assets/brand/<ファイル名>` へコピーされます
- `logo` はヘッダのサイトタイトル左に画像として並記されます（未指定時は組み込みのマーク）
- `favicon` は各ページの `<head>` に `<link rel="icon">` として埋め込まれます
- SVG の favicon には自動で `type="image/svg+xml"` が付きます

## コピーライト

```yaml
site:
  title: My Docs
  copyright: "© 2026 Example Inc."
```

未指定時はフッターに `© {site.title}` が出ます。指定時はその文字列がそのまま使われます。

## 初期テーマモード

```yaml
theme:
  default_mode: auto   # auto | light | dark
```

ユーザーがトグルで選んだ値は `localStorage` に保存されます。
