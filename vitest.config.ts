// dsh-web-search-minimax :: vitest.config.ts — 单测配置（workspace 根）
// include 通配全部插件包（后续 add 新插件无需改本文件）。
// ⚠ setupFiles 不吃 glob（写 'packages/*/tests/setup.ts' 会被当成字面路径直接
//   ENOENT），这里按目录展开：每个带 tests/setup.ts 的插件包一份。多份 setup
//   重复设置 DSH_HOME 幂等无害（各自 mkdtemp 各自清理）。
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

const ROOT = import.meta.dirname
const setupFiles = existsSync(join(ROOT, 'packages'))
  ? readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'packages', e.name, 'tests', 'setup.ts')))
      .map((e) => `packages/${e.name}/tests/setup.ts`)
  : []

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    environment: 'node',
    // 全局隔离护栏：DSH_HOME 指向临时目录 + 密钥类环境变量清零（见各包 tests/setup.ts）。
    // 本仓用例全部自带 fetch stub（vi.stubGlobal），无需全局出网拦截。
    setupFiles,
    testTimeout: 60_000,
  },
})
