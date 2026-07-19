import path from "node:path";
import { loadConfig, ConfigError } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import { fullBuild, rebuildDocs, type DevBuildState } from "./rebuild.js";
import { startStaticServer } from "./static-server.js";
import { startWatcher, type WatchEvent, type WatcherHandle } from "./watcher.js";

/** serveコマンドのオプション */
export interface ServeOptions {
  configPath: string;
  /** CLIの--port。未指定なら設定のserve.portを使う。0はエフェメラル */
  port?: number;
  verbose: boolean;
}

/** 起動中サーバーのハンドル */
export interface ServeHandle {
  host: string;
  port: number;
  url: string;
  /**
   * 監視とHTTPサーバーを停止する
   */
  close(): Promise<void>;
}

/**
 * 開発サーバーを起動する（初回ビルド → HTTP/WS → ファイル監視）
 */
export async function runServe(options: ServeOptions, logger: Logger): Promise<ServeHandle>
{
  // 初回は設定読込とフルビルドを同期的に成功させる（失敗時は起動しない）
  let config = loadConfig(options.configPath);
  logger.info("初回ビルドを実行しています...");
  let state: DevBuildState = await fullBuild(config, logger);

  // CLI --port があれば設定値より優先する（0はテスト用の空きポート）
  const listenPort = options.port !== undefined ? options.port : config.serve.port;
  const staticServer = await startStaticServer(config.outputDirAbs, listenPort);

  // 再ビルドの直列化用（連打保存で競合しないようにする）
  let rebuildChain: Promise<void> = Promise.resolve();
  let watcher = attachWatcher(config, (events) => {
    rebuildChain = rebuildChain
      .then(() => handleWatchEvents(events))
      .catch((error) => {
        // チェーンが途切れないようエラーはここで握り、次のイベントへ進む
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`再ビルド処理で予期しないエラー: ${message}`);
      });
  });

  /**
   * 監視イベントを種別ごとに処理する
   */
  async function handleWatchEvents(events: WatchEvent[]): Promise<void>
  {
    // 設定変更が含まれる場合はフルビルド（設定再読込）を優先する
    const hasConfig = events.some((event) => event.category === "config");
    const hasThemeOrPydoc = events.some((event) => event.category === "theme" || event.category === "pydoc");
    const docsEvents = events.filter((event) => event.category === "docs");

    try {
      if (hasConfig) {
        logger.info("設定ファイルの変更を検出したためフルビルドします");
        config = loadConfig(options.configPath);
        state = await fullBuild(config, logger);
        // 監視対象パスが変わった可能性があるためウォッチャを張り直す
        await watcher.close();
        watcher = attachWatcher(config, (nextEvents) => {
          rebuildChain = rebuildChain
            .then(() => handleWatchEvents(nextEvents))
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`再ビルド処理で予期しないエラー: ${message}`);
            });
        });
        staticServer.broadcast({ type: "reload" });
        return;
      }

      if (hasThemeOrPydoc) {
        logger.info("テーマまたはpydocソースの変更を検出したためフルビルドします");
        // 変換設定は変わらないため既存コンバータを再利用する
        // テーマ/pydoc変更時は設定は同じなのでプラグインも再利用する
        state = await fullBuild(config, logger, state.converter, state.plugins);
        staticServer.broadcast({ type: "reload" });
        return;
      }

      if (docsEvents.length > 0) {
        const changed = docsEvents
          .map((event) => event.docsRelativePath)
          .filter((value): value is string => value !== null);
        const result = await rebuildDocs(state, changed, logger);
        state = result.state;
        staticServer.broadcast({ type: "reload" });
      }
    } catch (error) {
      // ビルドエラーでもプロセスは落とさず、ブラウザへエラーを通知する
      const message = formatServeError(error);
      logger.error(message);
      staticServer.broadcast({ type: "error", message });
    }
  }

  const url = `http://${staticServer.host}:${staticServer.port}/`;
  logger.info(`開発サーバーを起動しました: ${url}`);

  return {
    host: staticServer.host,
    port: staticServer.port,
    url,
    async close() {
      // 進行中の再ビルドが終わってから監視とHTTPを止める
      await rebuildChain.catch(() => undefined);
      await watcher.close();
      await staticServer.close();
    }
  };
}

/**
 * 現在の設定でファイル監視を開始する
 */
function attachWatcher(
  config: ResolvedConfig,
  onEvents: (events: WatchEvent[]) => void
): WatcherHandle
{
  return startWatcher(config, onEvents);
}

/**
 * serve中のエラー表示用にメッセージを整形する
 */
function formatServeError(error: unknown): string
{
  if (error instanceof ConfigError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
