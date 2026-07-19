import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { createTempProject, silentLogger, sleep } from "./helpers.js";

/** 起動したserveのクローズ関数を集めてafterEachで確実に止める */
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  // テスト間でポートやウォッチャが残らないよう逆順で閉じる
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      await close();
    }
  }
});

describe("runServe", () => {
  it("localhostにバインドしてビルド済みHTMLを返す", async () => {
    // 仕様: HTTPサーバーはlocalhostのみ、静的ファイルを配信する
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    const logger = silentLogger();

    try {
      const handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle.close());

      expect(handle.host).toBe("127.0.0.1");
      expect(handle.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${handle.port}/index.html`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Home");
      // serve時のみライブリロード用スクリプトが注入される
      expect(html).toContain("/__mkdocsgen/livereload.js");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("CLIの--port指定が設定のserve.portより優先される", async () => {
    // --port が mkdocsgen.yml の serve.port を上書きすること
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject({ port: 3999 });
    const logger = silentLogger();

    try {
      const handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle.close());

      // port:0 指定時はOSが空きポートを割り当てる（設定の3999ではない）
      expect(handle.port).not.toBe(3999);
      expect(handle.port).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("Markdown編集後にWebSocketでreloadが届く", async () => {
    // 完了条件: ファイル編集 → ライブリロード通知
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    const logger = silentLogger();

    try {
      const handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle.close());

      const messagePromise = new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/__mkdocsgen/ws`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("reloadメッセージがタイムアウトしました"));
        }, 8000);
        ws.on("message", (data) => {
          clearTimeout(timer);
          resolve(String(data));
          ws.close();
        });
        ws.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        // 接続完了後にファイルを編集する（接続前の通知を逃さない）
        ws.on("open", async () => {
          await sleep(200);
          const target = path.join(root, "docs/guide/a.md");
          fs.writeFileSync(target, "---\ntitle: Page A\n---\n\n# Page A\n\nUpdated content.\n", "utf-8");
        });
      });

      const raw = await messagePromise;
      const payload = JSON.parse(raw) as { type: string };
      expect(payload.type).toBe("reload");

      // 増分ビルド結果が出力に反映されていること
      const html = fs.readFileSync(path.join(root, "site/guide/a.html"), "utf-8");
      expect(html).toContain("Updated content");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15000);

  it("ビルドエラー時はerrorメッセージを送り、修正後にreloadする", async () => {
    // 仕様2.8: serve中のビルドエラーはプロセス継続＋オーバーレイ、修正で復帰
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    const logger = silentLogger();

    try {
      const handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle.close());

      const messages: Array<{ type: string; message?: string }> = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/__mkdocsgen/ws`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("error/reloadメッセージがタイムアウトしました"));
        }, 12000);

        ws.on("message", (data) => {
          const payload = JSON.parse(String(data)) as { type: string; message?: string };
          messages.push(payload);
          // errorのあとreloadが来たら完了
          if (messages.some((m) => m.type === "error") && messages.some((m) => m.type === "reload")) {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        });
        ws.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        ws.on("open", async () => {
          await sleep(200);
          // 壊れたYAMLにしてビルドエラーを起こす
          fs.writeFileSync(path.join(root, "mkdocsgen.yml"), "site:\n  title: [\nbad\n", "utf-8");
          // エラー通知を待ってから正しい設定へ戻す
          await sleep(1500);
          fs.writeFileSync(path.join(root, "mkdocsgen.yml"), [
            "site:",
            "  title: Serve Demo",
            "docs_dir: docs",
            "output_dir: site",
            "serve:",
            "  port: 3000"
          ].join("\n") + "\n", "utf-8");
        });
      });

      expect(messages.some((m) => m.type === "error")).toBe(true);
      expect(messages.some((m) => m.type === "reload")).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
