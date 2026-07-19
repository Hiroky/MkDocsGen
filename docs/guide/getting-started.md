---
title: はじめに
order: 1
---

# はじめに

MkDocsGen でドキュメントサイトを作る最短手順です。

## 必要環境

- Node.js 20 以上

## インストール

リポジトリをクローンするか、パッケージをプロジェクトに追加します。

```bash
npm install
# 開発中のCLIはそのまま使える
npm run build   # dist/ へコンパイル（npx mkdocsgen 用）
```

## プロジェクトを初期化する

空のディレクトリで:

```bash
npx mkdocsgen init
```

次のファイルが生成されます（既存ファイルはスキップ＋警告）。

- `mkdocsgen.yml`
- `docs/index.md`
- `docs/guide/getting-started.md`

## ビルドする

```bash
npx mkdocsgen build
# または開発ツリーから
npm run dev -- build --clean --strict
```

成功すると `site/` に HTML が出力されます。`index.html` をブラウザで開けば（`file://` 可）閲覧できます。

## 開発サーバー

```bash
npx mkdocsgen serve
# ポート変更
npx mkdocsgen serve --port 4000
```

`docs/` や設定・テーマを編集すると自動で再ビルドされ、ブラウザがリロードされます。

## このリポジトリのドキュメント

MkDocsGen 自身の利用ガイドはリポジトリルートの `docs/` です。

```bash
npm run docs:build -- --strict
npm run docs:serve
```
