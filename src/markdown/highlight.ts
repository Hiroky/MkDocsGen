import { createHighlighter, type Highlighter } from "shiki";

/** ライト/ダーク両対応のハイライトに使うテーマ名 */
export const LIGHT_THEME = "github-light";
export const DARK_THEME = "github-dark";

/**
 * ビルド全体で使い回すShikiハイライターを生成する
 */
export async function createCodeHighlighter(): Promise<Highlighter>
{
  // dual theme用にライト/ダーク両方を事前ロードする
  return createHighlighter({
    themes: [LIGHT_THEME, DARK_THEME],
    // よく使う言語を先に載せ、未知言語は呼び出し側でフォールバックする
    langs: [
      "javascript",
      "typescript",
      "tsx",
      "jsx",
      "json",
      "yaml",
      "yml",
      "markdown",
      "md",
      "html",
      "css",
      "scss",
      "bash",
      "shell",
      "sh",
      "python",
      "py",
      "go",
      "rust",
      "java",
      "c",
      "cpp",
      "sql",
      "diff",
      "toml",
      "xml",
      "plaintext",
      "text"
    ]
  });
}

/**
 * コードをShikiのdual theme HTMLへ変換する。未知言語はプレーンテキスト扱い
 */
export function highlightCode(highlighter: Highlighter, code: string, lang: string): string
{
  // 末尾改行はmarkdown-itのフェンス慣習で付くため、表示用に除去する
  const normalized = code.replace(/\n$/, "");
  const loaded = highlighter.getLoadedLanguages();
  // 言語が未ロードならplaintextに落とし、ビルドを止めない
  const resolvedLang = loaded.includes(lang as never) ? lang : "plaintext";

  return highlighter.codeToHtml(normalized, {
    lang: resolvedLang,
    themes: {
      light: LIGHT_THEME,
      dark: DARK_THEME
    },
    // CSS変数（--shiki-light / --shiki-dark）でテーマ切替できるようにする
    defaultColor: false
  });
}
