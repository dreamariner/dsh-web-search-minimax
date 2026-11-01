// dsh-web-search-minimax :: 全局测试隔离护栏
//  1) DSH_HOME 指向本次运行的临时目录 —— config.ts 的 dshHome() 与 resolveKey() 回落路径
//     因此永远落在临时目录，测试既读不到真实密钥、也不会写进真实运行时目录。
//  2) 密钥类环境变量清零 —— resolveKey() 先读 process.env 再读 ~/.dsh/.env；在 DSH 会话内
//     跑测试时（日常场景）测试进程会继承生产配置，「未配置」类用例会读到真实值而红。
//     各用例需要的密钥在 beforeEach 里显式设置。

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'

let testHome: string

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-web-search-minimax-test-home-'))
  process.env.DSH_HOME = testHome
  for (const key of ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY']) delete process.env[key]
})

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})
