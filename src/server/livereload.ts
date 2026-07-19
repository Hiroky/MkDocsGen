/**
 * ブラウザへ注入するライブリロード＋エラーオーバーレイ用クライアントスクリプト
 */
export const LIVERELOAD_CLIENT_JS = `(function () {
  "use strict";
  var WS_PATH = "/__mkdocsgen/ws";
  var overlay = null;
  var reconnectTimer = null;

  /**
   * エラーオーバーレイ用のDOM要素を用意する
   */
  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.setAttribute("data-mkdocsgen-error-overlay", "");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:99999",
      "background:rgba(20,20,20,0.92)",
      "color:#f5f5f5",
      "font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
      "padding:24px",
      "white-space:pre-wrap",
      "overflow:auto",
      "display:none"
    ].join(";");
    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * ビルドエラーを全画面オーバーレイで表示する
   */
  function showError(message) {
    var el = ensureOverlay();
    el.textContent = "MkDocsGen build error\\n\\n" + String(message || "Unknown error");
    el.style.display = "block";
  }

  /**
   * エラーオーバーレイを隠す
   */
  function hideError() {
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  /**
   * WebSocketへ接続し、reload/errorを処理する
   */
  function connect() {
    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    var ws = new WebSocket(protocol + "//" + location.host + WS_PATH);

    ws.addEventListener("message", function (event) {
      var data;
      try {
        data = JSON.parse(String(event.data));
      } catch (_error) {
        return;
      }
      if (data.type === "reload") {
        hideError();
        location.reload();
        return;
      }
      if (data.type === "error") {
        showError(data.message);
      }
    });

    ws.addEventListener("close", function () {
      // サーバー再起動中は少し待ってからページごと再接続する
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(function () {
        location.reload();
      }, 1000);
    });
  }

  connect();
})();
`;

/**
 * HTMLへライブリロード用scriptタグを注入する
 */
export function injectLivereloadScript(html: string): string
{
  const tag = '<script src="/__mkdocsgen/livereload.js"></script>';
  // 既に注入済みなら二重に足さない
  if (html.includes("/__mkdocsgen/livereload.js")) {
    return html;
  }
  // </body>の直前へ入れる。無い場合は末尾へ追記する
  const lower = html.toLowerCase();
  const index = lower.lastIndexOf("</body>");
  if (index === -1) {
    return `${html}\n${tag}\n`;
  }
  return `${html.slice(0, index)}${tag}\n${html.slice(index)}`;
}
