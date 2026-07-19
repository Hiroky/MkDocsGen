import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStaticServer } from "../../src/server/static-server.js";

/** 起動したサーバーのクローズ関数 */
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      await close();
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
    try {
      const handle = await startStaticServer(root, 0);
      closers.push(() => handle.close());

      const res = await fetch(`http://127.0.0.1:${handle.port}/%E0%A4%A`);
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/Bad Request/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("正常なHTMLを200で返す", async () => {
    const root = createStaticRoot();
    try {
      const handle = await startStaticServer(root, 0);
      closers.push(() => handle.close());

      const res = await fetch(`http://127.0.0.1:${handle.port}/index.html`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("ok");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
