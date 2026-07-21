import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";

/** initが生成する相対パスと内容の組 */
interface ScaffoldFile {
  relativePath: string;
  content: string;
}

/** initの実行結果 */
export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * カレント（指定）ディレクトリに雛形ファイルを生成する
 */
export function runInit(targetDir: string, logger: Logger): InitResult
{
  const created: string[] = [];
  const skipped: string[] = [];

  // 仕様書2.2.1で定められた3ファイルを順に処理する
  for (const file of scaffoldFiles()) {
    const absPath = path.join(targetDir, file.relativePath);

    // 既存があれば上書きせず警告してスキップする
    if (fs.existsSync(absPath)) {
      logger.warn(`既に存在するためスキップしました: ${file.relativePath}`);
      skipped.push(file.relativePath);
      continue;
    }

    // 親ディレクトリ（docs/guide 等）を必要に応じて作る
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content, "utf-8");
    logger.info(`作成しました: ${file.relativePath}`);
    created.push(file.relativePath);
  }

  return { created, skipped };
}

/**
 * 雛形ファイル一覧を返す
 */
function scaffoldFiles(): ScaffoldFile[]
{
  return [
    {
      relativePath: "mkdocsgen.yml",
      content: MKDOCSGEN_YML
    },
    {
      relativePath: "docs/index.md",
      content: INDEX_MD
    },
    {
      relativePath: "docs/guide/getting-started.md",
      content: GETTING_STARTED_MD
    }
  ];
}

/** コメント付きサンプル設定（仕様書3.1ベース） */
const MKDOCSGEN_YML = `# MkDocsGen 設定ファイル
# サイト全体設定
site:
  title: My Documentation        # 必須。サイト名（ヘッダー・<title>に使用）
  description: ""                # 任意。デフォルトのmeta description
  base_url: /                    # 任意。サブパス配信時のベースURL（デフォルト: /）

# 入出力ディレクトリ
docs_dir: docs                   # 任意。Markdownソース（デフォルト: docs）
output_dir: site                 # 任意。出力先（デフォルト: site）

# ナビゲーション（省略時は完全自動構築）
# nav: []
exclude: []                      # 任意。glob形式の除外パターン

# テーマ設定
theme:
  overrides_dir: theme_overrides # 任意。テンプレートオーバーライド用ディレクトリ
  default_mode: auto             # 任意。auto | light | dark（デフォルト: auto）
  custom_css: []                 # 任意。追加CSSファイルのパス一覧

# Markdown
markdown:
  allow_html: true               # 任意。生HTMLを許可するか
  breaks: true                   # 任意。段落内の通常改行を<br>にするか

# Python APIドキュメント
pydoc:
  source_dirs: []                # pydocディレクティブ使用時は必須

# プラグイン
plugins: []                      # 任意。ローカルJS/TSファイルのパス一覧

# 開発サーバー
serve:
  port: 3000                     # 任意
`;

/** トップページのサンプル */
const INDEX_MD = `---
title: Welcome
---

MkDocsGenへようこそ。

このページは \`mkdocsgen init\` が生成したトップページです。

次は [Getting Started](./guide/getting-started.md) を読んでみましょう。
`;

/** 階層構造のサンプル */
const GETTING_STARTED_MD = `---
title: Getting Started
---

## はじめに

\`docs/\` 配下にMarkdownを置くと、ビルド時に静的サイトへ変換されます。

## ビルド方法

プロジェクトルートで次を実行します。

\`\`\`bash
mkdocsgen build
\`\`\`

## 次の一歩

- Markdownを編集して再度ビルドする
- \`mkdocsgen serve\` でライブリロード開発を行う
`;
