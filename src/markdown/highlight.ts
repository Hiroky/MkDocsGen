import { createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";
import wasmInlined from "@shikijs/engine-oniguruma/wasm-inlined";
import themeGithubLight from "@shikijs/themes/github-light";
import themeGithubDark from "@shikijs/themes/github-dark";
import langJavascript from "@shikijs/langs/javascript";
import langTypescript from "@shikijs/langs/typescript";
import langTsx from "@shikijs/langs/tsx";
import langJsx from "@shikijs/langs/jsx";
import langJson from "@shikijs/langs/json";
import langYaml from "@shikijs/langs/yaml";
import langMarkdown from "@shikijs/langs/markdown";
import langHtml from "@shikijs/langs/html";
import langCss from "@shikijs/langs/css";
import langScss from "@shikijs/langs/scss";
import langShellscript from "@shikijs/langs/shellscript";
import langPython from "@shikijs/langs/python";
import langGo from "@shikijs/langs/go";
import langRust from "@shikijs/langs/rust";
import langJava from "@shikijs/langs/java";
import langC from "@shikijs/langs/c";
import langCpp from "@shikijs/langs/cpp";
import langCsharp from "@shikijs/langs/csharp";
import langSql from "@shikijs/langs/sql";
import langDiff from "@shikijs/langs/diff";
import langToml from "@shikijs/langs/toml";
import langXml from "@shikijs/langs/xml";

/** ライト/ダーク両対応のハイライトに使うテーマ名 */
export const LIGHT_THEME = "github-light";
export const DARK_THEME = "github-dark";

/**
 * ビルド全体で使い回すShikiハイライターを生成する
 *
 * shikiの通常API（createHighlighter）は694言語・132テーマ全てを同梱した
 * @shikijs/langs・@shikijs/themesをnpm install時にディスクへ丸ごと持ってきてしまう。
 * Fine-Grained Bundle（各言語/テーマを個別importする方式）に切り替えることで、
 * 実際に使う分だけをesbuildでtree-shaking可能にしている（npm run build:shikiが同梱先を生成する）。
 * 各言語のエイリアス（例: typescript→ts、yaml→yml）はグラマー内蔵のaliasesメタデータで
 * 自動的に解決されるため、エイリアス名を個別にimportする必要はない。
 */
export async function createCodeHighlighter(): Promise<HighlighterCore>
{
  return createHighlighterCore({
    themes: [themeGithubLight, themeGithubDark],
    langs: [
      langJavascript,
      langTypescript,
      langTsx,
      langJsx,
      langJson,
      langYaml,
      langMarkdown,
      langHtml,
      langCss,
      langScss,
      langShellscript,
      langPython,
      langGo,
      langRust,
      langJava,
      langC,
      langCpp,
      langCsharp,
      langSql,
      langDiff,
      langToml,
      langXml
    ],
    engine: createOnigurumaEngine(wasmInlined)
  });
}

/**
 * コードをShikiのdual theme HTMLへ変換する。未知言語はプレーンテキスト扱い
 */
export function highlightCode(highlighter: HighlighterCore, code: string, lang: string): string
{
  // 末尾改行はmarkdown-itのフェンス慣習で付くため、表示用に除去する
  const normalized = code.replace(/\n$/, "");
  const loaded = highlighter.getLoadedLanguages();
  // 言語が未ロードならplaintextに落とし、ビルドを止めない
  const resolvedLang = loaded.includes(lang) ? lang : "plaintext";

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
