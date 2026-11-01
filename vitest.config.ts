// dsh-web-search-minimax :: vitest.config.ts — 单测配置
// 本仓只有 Node 侧逻辑，单档足够：pnpm test / pnpm test:watch
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // 全局隔离护栏：DSH_HOME 指向临时目录 + 密钥类环境变量清零（见 tests/setup.ts）。
    // 本仓用例全部自带 fetch stub（vi.stubGlobal），无需全局出网拦截。
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 60_000,
  },
})
