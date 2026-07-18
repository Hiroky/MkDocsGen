import { Command } from "commander";

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
      // 本体はまだ実装していないため、現段階では案内メッセージのみ表示する
      console.log("init コマンドは未実装です");
    });

  // buildコマンド: 設定を読み込み、静的サイトを出力ディレクトリへ生成する
  program
    .command("build")
    .description("静的サイトをビルドする")
    .option("--config <path>", "設定ファイルのパス", "./mkdocsgen.yml")
    .option("--strict", "警告をエラーとして扱い、終了コード1で失敗させる", false)
    .option("--clean", "出力ディレクトリを事前に空にする", false)
    .action(() => {
      // 本体はまだ実装していないため、現段階では案内メッセージのみ表示する
      console.log("build コマンドは未実装です");
    });

  // serveコマンド: 開発用HTTPサーバーを起動し、変更監視とライブリロードを行う
  program
    .command("serve")
    .description("開発用サーバーを起動する")
    .option("--port <number>", "待ち受けポート番号", "3000")
    .option("--config <path>", "設定ファイルのパス", "./mkdocsgen.yml")
    .action(() => {
      // 本体はまだ実装していないため、現段階では案内メッセージのみ表示する
      console.log("serve コマンドは未実装です");
    });

  return program;
}
