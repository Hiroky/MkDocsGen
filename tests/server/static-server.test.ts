import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStaticServer } from "../../src/server/static-server.js";
import { safeRmSync } from "./helpers.js";

/** 起動したサーバーのクローズ関数 */
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      try {
        await close();
      } catch {
        // すでにクローズされている場合の例外を安全に握りつぶす
      }
    }
  }
});

/**
 * 静的配信用の一時ルートを作る
 */
function createStaticRoot(): string
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-static-"));
  fs.writeFileSync(path.join(root, "index.html"), "<html><body>ok</body></html>", "utf-8");
  return root;
}

describe("startStaticServer", () => {
  it("不正なパーセントエンコードは400を返す", async () => {
    // decodeURIComponent失敗を外側catchの500にせず、400として返す
    const root = createStaticRoot();
    let handle: { close: () => Promise<void>; port: number } | undefined;
    try {
      handle = await startStaticServer(root, 0);
      closers.push(() => handle!.close());

      const res = await fetch(`http://127.0.0.1:${handle.port}/%E0%A4%A`);
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/Bad Request/i);
    } finally {
      // サーバーを停止してからディレクトリを安全に削除
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  });

  it("正常なHTMLを200で返す", async () => {
    const root = createStaticRoot();
    let handle: { close: () => Promise<void>; port: number } | undefined;
    try {
      handle = await startStaticServer(root, 0);
      closers.push(() => handle!.close());

      const res = await fetch(`http://127.0.0.1:${handle.port}/index.html`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("ok");
    } finally {
      // サーバーを停止してからディレクトリを安全に削除
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  });
});
