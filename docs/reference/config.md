---
title: 設定スキーマ
order: 11
---

`mkdocsgen.yml` の全体像です。コメントは説明用で、実ファイルでは `#` コメントが使えます。

```yaml
site:
  title: My Documentation
  description: ""
  base_url: /

docs_dir: docs
output_dir: site

nav: []
  # - title: ホーム
  #   path: index.md
  # - title: ガイド
  #   path: guide/          # 末尾 / でセクション階層を保持
exclude: []

theme:
  overrides_dir: theme_overrides
  default_mode: auto
  custom_css: []
  # logo: brand/logo.svg
  # favicon: brand/favicon.ico

markdown:
  allow_html: true
  breaks: true

pydoc:
  source_dirs: []

plugins: []
  # - path: ./plugins/example.mjs
  #   options:
  #     key: value

serve:
  port: 3000
```

## 補足

- バリデーションは zod で行い、未知キーや型不一致はキーパス付きでエラーになります
- 相対パス（`docs_dir` / `output_dir` / `theme.overrides_dir` / プラグイン path / `pydoc.source_dirs`）は設定ファイルの場所を基準に解決されます
- `nav` に存在しない Markdown パスを書くとビルドエラーです

利用ガイド側の説明は [設定](../guide/configuration.md) も参照してください。
