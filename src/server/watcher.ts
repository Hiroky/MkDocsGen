import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { ResolvedConfig } from "../config/schema.js";
import { classifyPath, type WatchCategory } from "./rebuild.js";

/** 監視イベント */
export interface WatchEvent {
  category: WatchCategory;
  absPath: string;
  /** docs配下ならdocs_dirからの相対POSIXパス */
  docsRelativePath: string | null;
}

/** ウォッチャのハンドル */
export interface WatcherHandle {
  /**
   * 監視を停止する
   */
  close(): Promise<void>;
}

/**
 * docs / 設定 / テーマ / pydoc を監視し、デバウンス後にコールバックする
 */
export function startWatcher(
  config: ResolvedConfig,
  onEvents: (events: WatchEvent[]) => void,
  options: { debounceMs?: number } = {}
): WatcherHandle
{
  const debounceMs = options.debounceMs ?? 120;
  const watchPaths = collectWatchPaths(config);

  // 出力ディレクトリへの書き込みで再ビルドが連鎖しないようignoreする
  const watcher: FSWatcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 80,
      pollInterval: 40
    },
    ignored: (watchPath) => isInsideOutput(watchPath, config)
  });

  let pending = new Map<string, WatchEvent>();
  let timer: NodeJS.Timeout | null = null;

  /**
   * イベントを溜めてデバウンス発火する
   */
  const enqueue = (absPath: string): void => {
    const category = classifyPath(absPath, config);
    if (category === "ignore") {
      return;
    }
    const docsRelativePath = category === "docs"
      ? toDocsRelative(absPath, config.docsDirAbs)
      : null;
    pending.set(path.resolve(absPath), { category, absPath: path.resolve(absPath), docsRelativePath });
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const events = Array.from(pending.values());
      pending = new Map();
      timer = null;
      if (events.length > 0) {
        onEvents(events);
      }
    }, debounceMs);
  };

  watcher.on("add", enqueue);
  watcher.on("change", enqueue);
  watcher.on("unlink", enqueue);

  return {
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return watcher.close();
    }
  };
}

/**
 * 監視対象パス一覧を組み立てる
 */
function collectWatchPaths(config: ResolvedConfig): string[]
{
  const paths = [
    config.configPath,
    config.docsDirAbs,
    config.overridesDirAbs
  ];
  // pydocソースディレクトリも監視対象に含める（未設定なら空）
  for (const rel of config.pydoc.source_dirs) {
    paths.push(path.resolve(config.configDir, rel));
  }
  return paths;
}

/**
 * docs_dirからの相対POSIXパスへ変換する
 */
function toDocsRelative(absPath: string, docsDirAbs: string): string
{
  return path.relative(docsDirAbs, absPath).split(path.sep).join("/");
}

/**
 * 出力ディレクトリ配下かどうか
 */
function isInsideOutput(absPath: string, config: ResolvedConfig): boolean
{
  const relative = path.relative(config.outputDirAbs, path.resolve(absPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
