import type MarkdownIt from "markdown-it";

/**
 * タスクリスト（[ ] / [x]）をチェックボックス付きリスト項目に変換するプラグイン
 */
export function taskListPlugin(md: MarkdownIt): void
{
  // リスト項目のインライン先頭を見て、チェックボックス記法なら属性とHTMLを差し替える
  md.core.ruler.after("inline", "task_list", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      // list_item_open の直後にある inline トークンだけを対象にする
      if (token?.type !== "list_item_open") {
        continue;
      }
      // トークン列は list_item_open → paragraph_open → inline の順になる
      const inline = tokens[i + 2];
      if (inline?.type !== "inline" || !inline.children || inline.children.length === 0) {
        continue;
      }

      const first = inline.children[0];
      if (first?.type !== "text" || first.content === undefined) {
        continue;
      }

      // "[ ] " または "[x] " / "[X] " で始まるものだけをタスク項目にする
      const match = first.content.match(/^\[([ xX])\]\s+(.*)$/);
      if (!match) {
        continue;
      }

      const checked = match[1] !== " ";
      const rest = match[2] ?? "";

      // 元テキストからチェックボックス記法を取り除く
      first.content = rest;

      // list_item にクラスを付け、チェックボックスHTMLを先頭に差し込む
      token.attrJoin("class", "task-list-item");
      const checkbox = new state.Token("html_inline", "", 0);
      // XHTML(Confluence Storage Format)は真偽属性の値省略を許さないため、
      // disabled/checkedは明示的に値を持たせて記述する
      checkbox.content = checked
        ? '<input type="checkbox" disabled="disabled" checked="checked"> '
        : '<input type="checkbox" disabled="disabled"> ';
      inline.children.unshift(checkbox);
    }
  });
}
