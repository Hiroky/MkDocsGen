import type { IncomingMessage, Server, ServerResponse } from "node:http";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { injectLivereloadScript, LIVERELOAD_CLIENT_JS } from "./livereload.js";

/** 静的サーバーの起動結果 */
export interface StaticServerHandle {
  server: Server;
  wss: WebSocketServer;
  host: string;
  port: number;
  /**
   * 接続中の全クライアントへJSONメッセージを送る
   */
  broadcast(message: { type: string; message?: string }): void;
  /**
   * HTTPとWebSocketを閉じる
   */
  close(): Promise<void>;
}

/** MIMEタイプ対応表 */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json"
};

/**
 * localhost専用の静的ファイルサーバーとWebSocketを起動する
 */
export async function startStaticServer(
  rootDir: string,
  port: number
): Promise<StaticServerHandle>
{
  // セキュリティ要件: 外部公開せず127.0.0.1のみで待ち受ける
  const host = "127.0.0.1";
  const clients = new Set<WebSocket>();

  const server = http.createServer((req, res) => {
    handleHttpRequest(req, res, rootDir).catch((error) => {
      // 想定外の例外でも接続を落としてプロセスは継続する
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end(`Internal Server Error\n${message}`);
    });
  });

  // 同一ポートでWebSocketアップグレードを受け付ける
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    // ライブリロード用パス以外は拒否する
    if (url.pathname !== "/__mkdocsgen/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // port=0ならOSが空きポートを割り当てる（テスト用）
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("サーバーアドレスの取得に失敗しました");
  }

  return {
    server,
    wss,
    host,
    port: address.port,
    broadcast(message) {
      const payload = JSON.stringify(message);
      for (const client of clients) {
        if (client.readyState === client.OPEN) {
          client.send(payload);
        }
      }
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        // 先にWebSocketクライアントを閉じてからHTTPサーバーを止める
        for (const client of clients) {
          client.close();
        }
        wss.close((wsError) => {
          if (wsError) {
            reject(wsError);
            return;
          }
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    }
  };
}

/**
 * 1リクエスト分の静的配信を処理する
 */
async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string
): Promise<void>
{
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  // ライブリロード用クライアントスクリプト
  if (url.pathname === "/__mkdocsgen/livereload.js") {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(LIVERELOAD_CLIENT_JS);
    return;
  }

  // URLパスをルート配下の安全なファイルパスへ解決する
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const candidate = resolveSafePath(rootDir, relativePath === "" ? "index.html" : relativePath);
  if (!candidate) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  let filePath = candidate;
  // ディレクトリ指定ならindex.htmlを探す
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  let body: Buffer | string = fs.readFileSync(filePath);

  // HTMLにはserve専用のライブリロードスクリプトを注入する（ビルド成果物自体は汚さない）
  if (ext === ".html") {
    body = injectLivereloadScript(body.toString("utf-8"));
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

/**
 * rootDir配下に収まるパスだけを許可する（パストラバーサル防止）
 */
function resolveSafePath(rootDir: string, relativePath: string): string | null
{
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}
