---
title: CLIリファレンス
order: 10
---

```bash
mkdocsgen <command> [options]
```

開発中はビルドせずに実行できます。

```bash
npm run dev -- <command> [options]
```

## init

カレント（または指定）ディレクトリに雛形を生成します。既存ファイルは上書きせずスキップします。

```bash
mkdocsgen init
mkdocsgen init ./my-docs
```

## build

静的サイトをビルドします。

```bash
mkdocsgen build
mkdocsgen build --config ./mkdocsgen.yml --clean --strict --verbose
mkdocsgen build --enable confluence-export
```

| オプション | 説明 |
| --- | --- |
| `--config <path>` | 設定ファイル（既定: `./mkdocsgen.yml`） |
| `--clean` | 出力ディレクトリを事前に空にする（ソースと同一・包含は拒否） |
| `--strict` | 警告が1件以上あれば終了コード1 |
| `--verbose` | デバッグログを出力 |
| `--enable <name>` | 副作用のあるプラグインを名前指定で有効化する（複数可。例: `confluence-export`） |

成功時はページ数・警告数・所要時間のサマリを表示します。

## serve

localhost のみで開発サーバーを起動し、変更を監視してライブリロードします。

```bash
mkdocsgen serve
mkdocsgen serve --port 4000 --config ./mkdocsgen.yml
```

| オプション | 説明 |
| --- | --- |
| `--config <path>` | 設定ファイル |
| `--port <number>` | 待受ポート（設定の `serve.port` より優先） |
| `--verbose` | デバッグログ |

ビルドエラー時はプロセスを止めず、ブラウザにエラーオーバーレイを出します。修正されると自動復帰します。
