---
title: 執筆ガイド
order: 3
---

# 執筆ガイド

## ファイル配置

`docs/` 配下の `.md` が1ページになります。ディレクトリはセクションとしてサイドバーに現れます。`index.md` はそのセクションの入口ページです。

## フロントマター

```yaml
---
title: ページタイトル
description: meta description 用
order: 10
draft: false
---
```

| フィールド | 説明 |
| --- | --- |
| `title` | 省略時は先頭見出し、それも無ければファイル名 |
| `order` | 同一階層の並び（小さいほど前。`index.md` は常に先頭） |
| `description` | ページの説明 |
| `draft` | `true` のページはビルドから除外 |

## 内部リンク

Markdown の相対リンクはビルド時に `.html` へ書き換えられます。アンカー（`#見出し`）もそのまま使えます。

```markdown
[設定](./configuration.md)
[この見出し](#ファイル配置)
```

切れリンクは警告になります。`--strict` 時はエラー終了します。

## 除外

```yaml
exclude:
  - drafts/**
  - "**/_private.md"
```
