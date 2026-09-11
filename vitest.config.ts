import { defineConfig } from "vitest/config";

// Vitestのテスト設定。tests/ 配下の *.test.ts をテスト対象とする
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Node環境で実行する（ブラウザAPIは使用しない）
    environment: "node",
    // CI環境（特にWindows runnerのプロセス生成遅延）でのタイムアウトを防止するため15秒に設定
    testTimeout: 15000
  }
});
