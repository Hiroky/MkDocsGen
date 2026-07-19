---
title: テーマとカスタマイズ
order: 5
---

# テーマとカスタマイズ

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

## 初期テーマモード

```yaml
theme:
  default_mode: auto   # auto | light | dark
```

ユーザーがトグルで選んだ値は `localStorage` に保存されます。
