# MkDocsGen

Markdownファイル群から静的なドキュメントサイト（HTML）を生成するドキュメントビルダー。
詳細な仕様は [concept-plan.md](./concept-plan.md) を参照。

## 必要環境

- Node.js 20以上

## セットアップ

```bash
npm install
```

## 開発用コマンド

| コマンド | 説明 |
| --- | --- |
| `npm run dev -- <args>` | CLIをビルドせずに直接実行する（例: `npm run dev -- build --strict`） |
| `npm run build` | TypeScriptを `dist/` にコンパイルする |
| `npm run typecheck` | 型チェックのみ実行する（出力なし） |
| `npm test` | テストを1回実行する |
| `npm run test:watch` | テストをウォッチモードで実行する |
| `npm run test:coverage` | カバレッジ付きでテストを実行する |

## CLIコマンド

```bash
mkdocsgen init    # mkdocsgen.yml とドキュメント雛形を生成
mkdocsgen build   # 静的サイトをビルド（--config / --strict / --clean）
mkdocsgen serve   # 開発サーバーを起動（--port / --config）
```

## ディレクトリ構成

```
src/
├── cli/          # CLIエントリポイントとコマンド定義
├── config/       # mkdocsgen.yml の読込・zodバリデーション
├── scanner/      # docs/ 走査とナビゲーションツリー構築
├── markdown/     # Markdown変換（GFM / Admonition / Shiki / Mermaid / 内部リンク）
├── pydoc/        # Pythonソース静的解析（web-tree-sitter）とdocstring解析
├── render/       # Nunjucksテンプレートによる最終HTML生成
├── search/       # 検索インデックス生成（MiniSearch / bigram）
├── plugin/       # プラグインのロードとライフサイクルフック実行
└── server/       # 開発サーバー（chokidar監視 + WebSocketライブリロード）
templates/        # 組み込みテーマのNunjucksテンプレート
tests/            # テストコード（src/ とディレクトリ構造を対応させる）
examples/plugins/ # プラグイン参考実装（Confluenceエクスポート等）
dev_docs/         # 開発用内部ドキュメント（ロードマップ等）
tasks/            # 開発メモ（lessons.md 等）
```

## 開発方針

- コーディング規約・ワークフローは [CLAUDE.md](./CLAUDE.md) に従う
- すべてのプロダクションコードはテストファースト（TDD）で実装する
