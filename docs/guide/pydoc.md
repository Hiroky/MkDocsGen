---
title: PyDoc
order: 6
---

`::: pydoc` ディレクティブで、Python モジュールの API ドキュメントをページへ展開できます。

## 設定

```yaml
pydoc:
  source_dirs:
    - docs/_samples
```

`source_dirs` を起点にモジュールを解決します。見つからない場合は探索パス一覧付きでエラーになります。

指定したモジュールが `__init__.py` を持つパッケージの場合は、そのパッケージ自身と配下のPythonソースを再帰的に列挙し、モジュールごとのHTMLページへ分けて出力します。パッケージページを親としたSphinx風の階層がナビゲーションに作られるため、Pythonソースの追加・削除は次回ビルド時に自動反映され、モジュールごとのMarkdownスタブは不要です。`__pycache__` と隠しディレクトリは列挙対象外です。

## ディレクティブ

```markdown
::: pydoc demo
    members: Greeter, shout
    heading-level: 3
```

## パッケージの再帰展開

```markdown
::: pydoc mypackage
    heading-level: 2
```

この指定では、`mypackage/__init__.py` と配下の `*.py` を1つのディレクティブから展開します。元のページにはパッケージへの `toctree` が入り、各モジュールは `api/mypackage/<module>.html` 相当の階層へ出力されます。サブパッケージの `__init__.py` も、そのサブパッケージの入口ページとして含まれます。

| オプション | 説明 |
| --- | --- |
| `members` | 表示するメンバー名（カンマ区切り）。省略時は公開メンバーすべて |
| `show-private` | `true` で単一アンダースコア始まりも表示（`__dunder__` は常に公開扱い） |
| `heading-level` | 見出しの開始レベル（1–6） |

## ライブ例

次のブロックはビルド時に `docs/_samples/mypackage/` をパッケージとして再帰展開します。配下のモジュール（`greeter` / `utils` / `nested.models` など）は個別ページへ分かれ、この位置には目次が入ります。

::: pydoc mypackage
    heading-level: 2
