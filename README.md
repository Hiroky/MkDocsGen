# MkDocsGen

Markdownファイル群から静的なドキュメントサイト（HTML）を生成するドキュメントビルダー。

検索・テーマ切替・Admonition / Shiki / Mermaid・PyDoc・プラグインに対応し、出力は `file://` でも閲覧できます。

## 必要環境

- Node.js 20以上

## クイックスタート

```bash
npm install
npx mkdocsgen init      # 雛形を生成
npx mkdocsgen build     # site/ へ出力
npx mkdocsgen serve     # ライブリロード開発サーバー
```

詳細な利用方法はリポジトリ内のドキュメントを参照してください。

```bash
npm run docs:build      # このリポジトリの docs/ をビルド
npm run docs:serve      # ドキュメントをプレビュー
```

| ドキュメント | 内容 |
| --- | --- |
| [docs/](./docs/index.md) | 利用ガイド（はじめに・設定・Markdown・PyDoc・プラグイン等） |
| [docs/reference/cli.md](./docs/reference/cli.md) | CLIオプション |
| [docs/reference/config.md](./docs/reference/config.md) | 設定スキーマ |
| [docs/reference/template-context.md](./docs/reference/template-context.md) | テンプレートコンテキスト変数 |
| [concept-plan.md](./concept-plan.md) | 設計仕様書（開発者向け） |

## CLI概要

```bash
mkdocsgen init    # mkdocsgen.yml とドキュメント雛形を生成
mkdocsgen build   # 静的サイトをビルド
mkdocsgen serve   # 開発サーバーを起動（ライブリロード）
```

開発中はコンパイルせずに実行できます。

```bash
npm run dev -- build --clean --strict --verbose
```

| build オプション | 説明 |
| --- | --- |
| `--config <path>` | 設定ファイル（デフォルト: `./mkdocsgen.yml`） |
| `--clean` | 出力ディレクトリを事前に空にする |
| `--strict` | 警告が1件以上あれば終了コード1 |
| `--verbose` | デバッグログを出力する |

## 最小のプロジェクト構成

```
my-docs/
├── mkdocsgen.yml
├── docs/
│   └── index.md
└── theme_overrides/   # 任意。partials/footer.njk 等で部分差し替え
```

```yaml
# mkdocsgen.yml
site:
  title: My Docs
```

## 開発用コマンド

| コマンド | 説明 |
| --- | --- |
| `npm run dev -- <args>` | CLIをビルドせずに直接実行する |
| `npm run build` | TypeScriptを `dist/` にコンパイルする |
| `npm run typecheck` | 型チェックのみ実行する |
| `npm test` | テストを1回実行する |
| `npm run test:watch` | テストをウォッチモードで実行する |
| `npm run test:coverage` | カバレッジ付きでテストを実行する |
| `npm run docs:build` | リポジトリの利用ドキュメントをビルドする |
| `npm run docs:serve` | 利用ドキュメントを serve する |
| `npm run example:build` | `examples/phase5-demo` をビルドする |
| `npm run bench` | 100ページ規模のビルド性能を計測する |
| `npm run test:perf` | 性能アサーション付きテスト（`TEST_PERF=1`） |

## ディレクトリ構成

```
src/              # 本体ソース（cli / config / scanner / markdown / build / …）
templates/        # 組み込みテーマ
docs/             # 利用ドキュメント（ドッグフード）
tests/            # テスト（src/ と対応）
examples/         # 目視確認用サンプル・プラグイン参考実装
dev_docs/         # 開発用内部ドキュメント（ロードマップ等）
scripts/          # ベンチ等の補助スクリプト
tasks/            # 開発メモ（lessons.md 等）
```

## 開発方針

- コーディング規約・ワークフローは [CLAUDE.md](./CLAUDE.md) に従う
- すべてのプロダクションコードはテストファースト（TDD）で実装する
