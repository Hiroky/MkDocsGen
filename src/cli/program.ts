import { Command } from "commander";
import { BuildError, runBuild } from "../build/pipeline.js";
import { ConfigError } from "../config/load.js";
import { Logger } from "../logger.js";
import { PluginError } from "../plugin/load.js";
import { runServe } from "../server/serve.js";
import { runInit } from "./init.js";

/**
 * MkDocsGen CLIのコマンド定義（init / build / serve）を構築して返す
 */
export function createProgram(): Command
{
  // ルートコマンドを作成し、CLI全体の名前と説明を設定する
  const program = new Command();
  program
    .name("mkdocsgen")
    .description("Markdownファイル群から静的ドキュメントサイトを生成するドキュメントビルダー")
    .version("0.1.0");

  // initコマンド: 設定ファイルとドキュメントの雛形をカレントディレクトリに生成する
  program
    .command("init")
    .description("mkdocsgen.yml とドキュメントの雛形を生成する")
    .action(() => {
      const logger = new Logger(false);
      // カレントディレクトリへ雛形を書き出す（既存はスキップ）
      runInit(process.cwd(), logger);
    });

  // buildコマンド: 設定を読み込み、静的サイトを出力ディレクトリへ生成する
  program
    .command("build")
    .description("静的サイトをビルドする")
    .option("--config <path>", "設定ファイルのパス", "./mkdocsgen.yml")
    .option("--strict", "警告をエラーとして扱い、終了コード1で失敗させる", false)
    .option("--clean", "出力ディレクトリを事前に空にする", false)
    .option("--verbose", "デバッグログを出力する", false)
    .action(async (options: {
      config: string;
      strict: boolean;
      clean: boolean;
      verbose: boolean;
    }) => {
      const logger = new Logger(options.verbose);
      try {
        // パイプラインへ委譲し、成功時はサマリがlogger経由で出る
        await runBuild({
          configPath: options.config,
          strict: options.strict,
          clean: options.clean,
          verbose: options.verbose
        }, logger);
      } catch (error) {
        // ConfigError / BuildError / PluginErrorはメッセージのみ、想定外はスタック付き
        if (
          error instanceof ConfigError ||
          error instanceof BuildError ||
          error instanceof PluginError
        ) {
          // PluginErrorはスタックに元例外を埋め込んでいるので、あればそれを優先する
          logger.error(error instanceof PluginError && error.stack ? error.stack : error.message);
        } else if (error instanceof Error) {
          logger.error(error.stack ?? error.message);
        } else {
          logger.error(String(error));
        }
        process.exitCode = 1;
      }
    });

  // serveコマンド: 開発用HTTPサーバーを起動し、変更監視とライブリロードを行う
  program
    .command("serve")
    .description("開発用サーバーを起動する")
    .option("--port <number>", "待ち受けポート番号")
    .option("--config <path>", "設定ファイルのパス", "./mkdocsgen.yml")
    .option("--verbose", "デバッグログを出力する", false)
    .action(async (options: {
      port?: string;
      config: string;
      verbose: boolean;
    }) => {
      const logger = new Logger(options.verbose);
      try {
        // --port未指定時は設定のserve.portを使う。指定時は数値へ変換する
        const port = options.port !== undefined ? Number(options.port) : undefined;
        if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
          throw new ConfigError(`不正なポート番号です: ${options.port}`);
        }
        await runServe({
          configPath: options.config,
          ...(port !== undefined ? { port } : {}),
          verbose: options.verbose
        }, logger);
        // サーバーは常駐するため、ここではreturnせずイベントループを維持する
      } catch (error) {
        if (
          error instanceof ConfigError ||
          error instanceof BuildError ||
          error instanceof PluginError
        ) {
          logger.error(error instanceof PluginError && error.stack ? error.stack : error.message);
        } else if (error instanceof Error) {
          logger.error(error.stack ?? error.message);
        } else {
          logger.error(String(error));
        }
        process.exitCode = 1;
      }
    });

  return program;
}
