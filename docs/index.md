---
title: MkDocsGen
description: Markdownから静的ドキュメントサイトを生成する
order: 0
---

# MkDocsGen

Markdownファイル群から、検索・テーマ切替・APIドキュメント展開まで備えた静的ドキュメントサイトを生成します。

## 特徴

- GFM（テーブル・タスクリスト等）と Admonition / Shiki / Mermaid
- クライアントサイド全文検索（`file://` でも動作）
- `::: pydoc` による Python API ドキュメント展開
- ローカル ESM プラグインによるビルドライフサイクル拡張
- `mkdocsgen serve` によるライブリロード開発サーバー

## クイックスタート

```bash
npm install
npm run build           # dist/ を生成してから npx mkdocsgen を使う
npx mkdocsgen init
npx mkdocsgen build
npx mkdocsgen serve
```

コンパイルなしで動かす場合:

```bash
npm run dev -- init
npm run dev -- build
npm run dev -- serve
```

このリポジトリ自体のドキュメントは次でビルドできます。

```bash
npm run docs:build
npm run docs:serve
```

## 次に読む

- [はじめに](./guide/getting-started.md) — インストールから最初のビルドまで
- [設定](./guide/configuration.md) — `mkdocsgen.yml` の概要
- [CLIリファレンス](./reference/cli.md) — コマンドとオプション一覧
