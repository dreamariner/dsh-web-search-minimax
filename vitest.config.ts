// dsh-web-search-minimax :: vitest.config.ts — 单测配置（外部 DSH 定制仓 单档形态的独立版）
// 本仓只有 Node 侧逻辑，单档足够：pnpm test / pnpm test:watch
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // 全局隔离护栏：DSH_HOME 指向临时目录 + 密钥类环境变量清零（见 tests/setup.ts）。
    // 与 外部 DSH 定制仓 根配置的差异：本仓用例全部自带 fetch stub（vi.stubGlobal），
    // 不需要 外部 DSH 定制仓 那套「出网即抛错」的默认拦截。
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 60_000,
  },
})
