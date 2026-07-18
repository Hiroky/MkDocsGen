import pc from "picocolors";

/** ログレベル。debugはverbose時のみ出力する */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** テスト時に出力先を差し替えるためのライター群 */
export interface LoggerWriters {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

/**
 * ビルド全体で共有するロガー。警告数をカウントし、strict判定とサマリ表示に使う
 */
export class Logger
{
  private verbose: boolean;
  private warnCount: number = 0;
  private writeStdout: (line: string) => void;
  private writeStderr: (line: string) => void;

  /**
   * verbose指定と任意の出力先注入でロガーを初期化する
   */
  constructor(verbose: boolean, writers: LoggerWriters = {})
  {
    // verboseがtrueのときだけdebugを出す
    this.verbose = verbose;
    // 未指定なら実コンソールへ書き出す（本番・CLI用のデフォルト）
    this.writeStdout = writers.stdout ?? ((line) => console.log(line));
    this.writeStderr = writers.stderr ?? ((line) => console.error(line));
  }

  /**
   * verbose時のみ標準出力へ詳細ログを出す
   */
  debug(message: string): void
  {
    // 通常ビルドではノイズになるため、明示的なverbose時だけ出す
    if (!this.verbose) {
      return;
    }
    this.writeStdout(message);
  }

  /**
   * 標準出力へ通常の進捗メッセージを出す
   */
  info(message: string): void
  {
    this.writeStdout(message);
  }

  /**
   * 標準エラーへ警告を出し、警告カウントを加算する
   */
  warn(message: string): void
  {
    // strict判定とサマリ表示のため、警告のたびに数える
    this.warnCount += 1;
    // 色付きプレフィックスで警告であることを視覚的に伝える
    this.writeStderr(`${pc.yellow("warn:")} ${message}`);
  }

  /**
   * 標準エラーへエラーメッセージを出す（警告カウントは増やさない）
   */
  error(message: string): void
  {
    this.writeStderr(`${pc.red("error:")} ${message}`);
  }

  /**
   * これまでに出した警告の件数を返す
   */
  getWarnCount(): number
  {
    return this.warnCount;
  }
}
