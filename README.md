# MkDocsGen

Markdown + Python API docs + Confluence export を Node.js だけで扱える静的ドキュメントビルダー。

検索・テーマ切替・Admonition / Shiki / Mermaid・PyDoc・プラグインに対応し、出力は `file://` でも閲覧できます。

## なぜ MkDocsGen なのか？

- **Node.js だけで完結（Python 実行環境不要）**
  Python API ドキュメント抽出は tree-sitter による AST 静的解析で行うため、Python のインストールや仮想環境、依存解決が一切不要です。フロントエンドや Node.js 主体の開発環境・CI/CD パイプラインにそのまま導入できます。
- **どこでも閲覧可能（`file://` 完全対応の全文検索）**
  生成される静的 HTML は `fetch` に依存せず、相対パスのインデックス読み込みにより Web サーバーなし（ローカルで開くだけ / ファイル共有 / オフライン / zip 配布）でも全文検索やテーマ切り替えが軽快に動作します。
- **ドキュメントサイトと Confluence の二重管理を解消**
  Git 管理の Markdown ドキュメントを正（Single Source of Truth）としながら、美しい静的サイトの生成と、社内 Confluence スペースへの自動同期（差分更新・dryRun 対応）を同一ツールで実現します。
- **モダンなドキュメント作成体験**
  Shiki によるビルド時静的シンタックスハイライト、Mermaid ダイアグラム、Admonition（警告・注意等のコールアウト）、WebSocket ライブリロード付き開発サーバー、Nunjucks によるテーマカスタマイズ性を提供します。

## 必要環境

- Node.js 22 以上

## クイックスタート

既存のプロジェクトに導入する場合、または新規ドキュメントを作成する場合の手順です。

```bash
# パッケージのインストール
npm install -D mkdocsgen

# 設定ファイル (mkdocsgen.yml) と docs/ の雛形を生成
npx mkdocsgen init

# ローカル開発サーバーを起動（ライブリロード対応）
npx mkdocsgen serve

# 本番用静的サイトをビルド（site/ へ出力）
npx mkdocsgen build
```

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

## 主な機能

### Markdown 執筆機能
- GitHub Flavored Markdown (GFM) 完全サポート（テーブル、タスクリスト等）
- Admonition（`::: note`, `::: warning`, `::: tip` 等のコールアウトブロック）
- Shiki によるビルド時静的シンタックスハイライト
- Mermaid による図表・ダイアグラムのクライアントサイド描画

### Python API ドキュメント自動展開 (PyDoc)
Markdown 内にディレクティブを記述するだけで、Python ソースコードからクラスや関数のシグネチャ、Google スタイル docstring を自動展開します。

```markdown
::: pydoc my_package.module.MyClass
    heading-level: 3
    members: true
```

### プラグイン（組み込み: Confluence エクスポート）
`mkdocsgen.yml` の `plugins` に組み込みプラグイン `confluence-export` を設定することで、生成したドキュメントを Confluence へ直接同期できます。

```yaml
plugins:
  - builtin: confluence-export
    options:
      url: https://example.atlassian.net/wiki   # 任意。環境変数があればそちらが優先
      username: alice                            # 任意。環境変数があればそちらが優先
      space: DOCS
      parentPageId: "123456"   # 任意
      dryRun: true             # まず true で同期計画を確認
```

YAML に設定を記述しただけでは同期されません。実際に Confluence へエクスポートする際は、明示的に `--enable confluence-export` を指定します。

```bash
npx mkdocsgen build                              # サイト生成のみ（同期しない）
npx mkdocsgen build --enable confluence-export   # サイト生成後に Confluence へ同期
```

認証情報は環境変数またはプロジェクトルートの `.env` で管理できます。

```bash
# .env（mkdocsgen.yml と同じディレクトリ）
CONFLUENCE_URL=https://example.atlassian.net/wiki
CONFLUENCE_USERNAME=alice
CONFLUENCE_PASSWORD=...
```

詳細は [docs/guide/plugins.md](./docs/guide/plugins.md) を参照してください。独自プラグインの作成方法は [examples/plugins/README.md](./examples/plugins/README.md) に記載されています。

## CLI コマンド

```bash
npx mkdocsgen init    # mkdocsgen.yml とドキュメント雛形を生成
npx mkdocsgen build   # 静的サイトをビルド
npx mkdocsgen serve   # 開発サーバーを起動（ライブリロード）
```

### build オプション

| オプション | 説明 |
| --- | --- |
| `--config <path>` | 設定ファイルパス（デフォルト: `./mkdocsgen.yml`） |
| `--clean` | 出力ディレクトリを事前に空にする |
| `--strict` | 警告が 1 件以上あれば終了コード 1 で終了 |
| `--verbose` | デバッグログを出力する |
| `--enable <plugin>` | 指定したプラグインを有効化して実行 |

### serve オプション

| オプション | 説明 |
| --- | --- |
| `--config <path>` | 設定ファイルパス（デフォルト: `./mkdocsgen.yml`） |
| `--port <number>` | 待受ポート番号（デフォルト: `3000`） |
| `--open` | 起動時にブラウザを自動で開く |
| `--verbose` | デバッグログを出力する |

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/](./docs/index.md) | 利用ガイド（はじめに・設定・Markdown・PyDoc・プラグイン等） |
| [docs/reference/cli.md](./docs/reference/cli.md) | CLI オプション詳細 |
| [docs/reference/config.md](./docs/reference/config.md) | 設定スキーマ仕様 |
| [docs/reference/template-context.md](./docs/reference/template-context.md) | テンプレートコンテキスト変数 |
| [concept-plan.md](./concept-plan.md) | 設計仕様書（開発者向け） |

## Development

MkDocsGen 本体の開発・コントリビューションを行う場合の手順です。

### リポジトリのセットアップ

```bash
# リポジトリのクローン
git clone https://github.com/Hiroky/MkDocsGen.git
cd MkDocsGen

# 依存関係のインストール
npm install

# TypeScript コンパイルとアセットのビルド（dist/ を生成）
npm run build
```

### 開発用コマンド

CLI はビルドを行わずに `npm run dev` で直接実行できます。

```bash
# TypeScript をコンパイルせずに直接 CLI を実行
npm run dev -- serve
npm run dev -- build --clean --strict
```

| コマンド | 説明 |
| --- | --- |
| `npm run dev -- <args>` | CLI をビルドせずに直接実行する |
| `npm run build` | TypeScript とアセットをコンパイルする (`dist/`, `build-theme/`) |
| `npm run typecheck` | 型チェックのみ実行する |
| `npm test` | 単体・結合テストを実行する |
| `npm run test:watch` | テストをウォッチモードで実行する |
| `npm run test:coverage` | テストカバレッジを計測する |
| `npm run docs:build` | 本リポジトリ内の利用ドキュメントをビルドする |
| `npm run docs:serve` | 本リポジトリ内の利用ドキュメントを serve する |
| `npm run bench` | 100 ページ規模のビルド性能を計測する |
| `npm run test:perf` | 性能アサーション付きテストを実行する (`TEST_PERF=1`) |

### ディレクトリ構成

```
src/              # 本体ソース（cli / config / scanner / markdown / build / …）
templates/        # 組み込みテーマ（Nunjucks / CSS / JS）
docs/             # 利用ドキュメント（ドッグフード）
tests/            # テストスイート（src/ と 1:1 対応）
examples/         # 動作確認用サンプル・プラグイン参考実装
dev_docs/         # 開発用内部ドキュメント
scripts/          # ビルド・ベンチマーク等の補助スクリプト
tasks/            # 開発メモ（lessons.md 等）
```

## 開発方針

- コーディング規約・ワークフローは [CLAUDE.md](./CLAUDE.md) に従う
- すべてのプロダクションコードはテストファースト（TDD）で実装する

## ライセンス

[MIT](./LICENSE)
