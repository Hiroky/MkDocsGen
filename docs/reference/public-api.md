---
title: 公開APIとバージョニング
order: 13
---

外部のビルドスクリプトやプラグインから利用できるAPIと、互換性を管理するための方針です。

## 公開エントリポイント

### `mkdocsgen`

ルートエントリポイントでは、ビルド処理と設定、ロガーを公開します。

- `runBuild`
- `BuildOptions`
- `BuildResult`
- `loadConfig`
- `ResolvedConfig`
- `Logger`
- `BuildLogger`
- `LoggerWriters`
- `LogLevel`

### `mkdocsgen/plugin`

プラグイン開発者向けに、次のAPI v1型を公開します。

- `MkDocsGenPlugin`
- `MkDocsGenPluginFactory`
- `PluginConfigContext`
- `PluginMarkdownContext`
- `PluginHtmlContext`
- `PluginBuildContext`
- `PluginHeading`
- `PluginPageSummary`
- `PluginNavNode`

API v1のコンテキストは内部の `ResolvedConfig`、`Page`、`BuildContext` とは別の公開モデルです。プラグインへ渡す値は内部状態からコピーされ、読み取り専用として扱われます。

### `mkdocsgen/logger`

ロガーを単独で利用する場合のエントリポイントです。ルートエントリポイントと同じく `Logger`、`BuildLogger`、`LoggerWriters`、`LogLevel` を公開します。

## `ResolvedConfig` の扱い

`ResolvedConfig` は `loadConfig` の戻り値として既に公開しているため、当面は公開APIとして維持します。設定ファイル由来の値に加えて、解決済みの絶対パスを含む型です。

そのため、`ResolvedConfig` のプロパティ変更は公開APIの変更として扱います。内部構造の変更自由度を優先する必要が生じた場合は、1.0.0より前に公開専用の設定型を追加し、移行方法を用意してから再評価します。

## バージョン方針

パッケージのバージョンはSemVerに従います。現在は `0.x` の開発段階であり、公開APIの変更にはリリースノートで移行内容を明記します。

- パッチ番号は、既存APIの互換性を保つバグ修正と内部改善に使用します
- マイナー番号は、後方互換性のある機能追加に使用します
- 互換性を壊す変更は、1.0.0まではマイナー番号を上げて移行手順を明記し、1.0.0以降はメジャー番号を上げます
- 1.0.0では、ルートAPIとプラグインAPI v1の公開契約を改めて固定します

プラグインの `apiVersion` はパッケージのバージョンとは別の互換性番号です。

- `apiVersion` なしはレガシーAPIとして互換性のために受け入れます
- `apiVersion: 1` は現在の公開プラグインAPIです
- それ以外の値はロード時に拒否します
- 将来のAPI v2は、仕様・型・移行手順を定義してから受け入れます

## 将来のリリース手順

実際のリリース時は、次の確認を完了してからバージョンを更新します。

1. `package.json` と `package-lock.json` のバージョンを更新する
2. `npm run typecheck`、`npm run build`、`npm test` を実行する
3. 変更内容と移行情報をリリースノートへ記録する
4. `vX.Y.Z` タグとGitHub Releaseを作成する
5. npm公開を行う場合は、公開前に生成物と公開先を確認する

この手順は方針の定義であり、現在の作業ではタグ作成・GitHub Release・npm公開は行いません。
