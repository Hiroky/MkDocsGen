---
title: PyDoc
order: 6
---

# PyDoc

`::: pydoc` ディレクティブで、Python モジュールの API ドキュメントをページへ展開できます。

## 設定

```yaml
pydoc:
  source_dirs:
    - docs/_samples
```

`source_dirs` を起点にモジュールを解決します。見つからない場合は探索パス一覧付きでエラーになります。

## ディレクティブ

```markdown
::: pydoc demo
    members: Greeter, shout
    heading-level: 3
```

| オプション | 説明 |
| --- | --- |
| `members` | 表示するメンバー名（カンマ区切り）。省略時は公開メンバーすべて |
| `show-private` | `true` で単一アンダースコア始まりも表示（`__dunder__` は常に公開扱い） |
| `heading-level` | 見出しの開始レベル（1–6） |

## ライブ例

次のブロックはビルド時に `docs/_samples/demo.py` から展開されます。

::: pydoc demo
    members: Greeter, shout
    heading-level: 3
