import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { createTempProject, safeRmSync, silentLogger, sleep } from "./helpers.js";

/** 起動したserveのクローズ関数を集めてafterEachで確実に止める */
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  // テスト間でポートやウォッチャが残らないよう逆順で閉じる
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
  delete process.env.MKDOCSGEN_TEST_SERVE_DOTENV;
});

describe("runServe", () => {
  it("mkdocsgen.ymlと同じフォルダの.envの値をprocess.envへ反映する", async () => {
    // 仕様: build同様、serveの初回ビルド時もmkdocsgen.ymlと同じフォルダの.envを読み込む
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    fs.writeFileSync(
      path.join(root, ".env"),
      "MKDOCSGEN_TEST_SERVE_DOTENV=from-dotenv\n",
      "utf-8"
    );
    const logger = silentLogger();
    let handle: { close: () => Promise<void> } | undefined;

    try {
      handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle!.close());

      expect(process.env.MKDOCSGEN_TEST_SERVE_DOTENV).toBe("from-dotenv");
    } finally {
      // Windows環境でオープン中のディレクトリ削除によるEBUSYを防ぐため、先にサーバーとウォッチャーを閉じる
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  }, 20000);

  it("localhostにバインドしてビルド済みHTMLを返す", async () => {
    // 仕様: HTTPサーバーはlocalhostのみ、静的ファイルを配信する
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    const logger = silentLogger();
    let handle: { close: () => Promise<void>; host: string; port: number } | undefined;

    try {
      handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle!.close());

      expect(handle.host).toBe("127.0.0.1");
      expect(handle.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${handle.port}/index.html`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Home");
      // serve時のみライブリロード用スクリプトが注入される
      expect(html).toContain("/__mkdocsgen/livereload.js");
    } finally {
      // サーバーを停止してからディレクトリを安全に削除
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  }, 20000);

  it("CLIの--port指定が設定のserve.portより優先される", async () => {
    // --port が mkdocsgen.yml の serve.port を上書きすること
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject({ port: 3999 });
    const logger = silentLogger();
    let handle: { close: () => Promise<void>; port: number } | undefined;

    try {
      handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle!.close());

      // port:0 指定時はOSが空きポートを割り当てる（設定の3999ではない）
      expect(handle.port).not.toBe(3999);
      expect(handle.port).toBeGreaterThan(0);
    } finally {
      // サーバーを停止してからディレクトリを安全に削除
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  }, 20000);

  it("Markdown編集後にWebSocketでreloadが届く", async () => {
    // 完了条件: ファイル編集 → ライブリロード通知
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    const logger = silentLogger();
    let handle: { close: () => Promise<void>; port: number } | undefined;

    try {
      handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle!.close());

      const messagePromise = new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${handle!.port}/__mkdocsgen/ws`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("reloadメッセージがタイムアウトしました"));
        }, 15000);
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
          try {
            await sleep(300);
            const target = path.join(root, "docs/guide/a.md");
            fs.writeFileSync(target, "---\ntitle: Page A\n---\n\n# Page A\n\nUpdated content.\n", "utf-8");
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });
      });

      const raw = await messagePromise;
      const payload = JSON.parse(raw) as { type: string };
      expect(payload.type).toBe("reload");

      // 増分ビルド結果が出力に反映されていること
      const html = fs.readFileSync(path.join(root, "site/guide/a.html"), "utf-8");
      expect(html).toContain("Updated content");
    } finally {
      // サーバーを停止してからディレクトリを安全に削除
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  }, 30000);

  it("ビルドエラー時はerrorメッセージを送り、修正後にreloadする", async () => {
    // 仕様2.8: serve中のビルドエラーはプロセス継続＋オーバーレイ、修正で復帰
    const { runServe } = await import("../../src/server/serve.js");
    const root = createTempProject();
    const logger = silentLogger();
    let handle: { close: () => Promise<void>; port: number } | undefined;

    try {
      handle = await runServe({
        configPath: path.join(root, "mkdocsgen.yml"),
        port: 0,
        verbose: false
      }, logger);
      closers.push(() => handle!.close());

      const messages: Array<{ type: string; message?: string }> = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${handle!.port}/__mkdocsgen/ws`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("error/reloadメッセージがタイムアウトしました"));
        }, 18000);

        let recovered = false;

        ws.on("message", (data) => {
          try {
            const payload = JSON.parse(String(data)) as { type: string; message?: string };
            messages.push(payload);

            // 1. 最初のエラー通知を受け取ったら、即座に正しい設定に戻す（固定sleepを廃止してイベント駆動化）
            if (payload.type === "error" && !recovered) {
              recovered = true;
              fs.writeFileSync(path.join(root, "mkdocsgen.yml"), [
                "site:",
                "  title: Serve Demo",
                "docs_dir: docs",
                "output_dir: site",
                "serve:",
                "  port: 3000"
              ].join("\n") + "\n", "utf-8");
            }

            // 2. errorのあとにreloadが届いたら検証完了
            if (messages.some((m) => m.type === "error") && messages.some((m) => m.type === "reload")) {
              clearTimeout(timer);
              ws.close();
              resolve();
            }
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });

        ws.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });

        ws.on("open", async () => {
          try {
            await sleep(300);
            // 壊れたYAMLにしてビルドエラーを起こす
            fs.writeFileSync(path.join(root, "mkdocsgen.yml"), "site:\n  title: [\nbad\n", "utf-8");
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });
      });

      expect(messages.some((m) => m.type === "error")).toBe(true);
      expect(messages.some((m) => m.type === "reload")).toBe(true);
    } finally {
      // サーバーを停止してからディレクトリを安全に削除
      if (handle) {
        await handle.close();
      }
      safeRmSync(root);
    }
  }, 30000);
});
