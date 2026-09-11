import { defineConfig } from "vitest/config";

// Vitestのテスト設定。tests/ 配下の *.test.ts をテスト対象とする
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // 通常のテスト実行からベンチマークテストを除外（npm run test:perf で明示実行）
    exclude: ["**/node_modules/**", "**/dist/**", "tests/perf/**"],
    // Node環境で実行する（ブラウザAPIは使用しない）
    environment: "node",
    // WASM（web-tree-sitter）、子プロセス実行、動的importのモジュール競合を防ぐためプロセス分離を採用
    pool: "forks",
    // CI環境（2 vCPU）でのCPU/メモリサチュレーションを防ぐため並列度を2に制限
    maxWorkers: process.env.CI ? 2 : undefined,
    // CI環境（特にWindows runnerのプロセス生成遅延）でのタイムアウトを防止するため20秒に設定
    testTimeout: 20000,
    // afterEachでのクリーンアップやサーバー終了待ちのタイムアウトを防止
    hookTimeout: 15000
  }
});
