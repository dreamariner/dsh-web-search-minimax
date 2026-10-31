// dsh-web-search-minimax 配置（issue 004）
// 校验语义与 同代 DSH 插件 一致：默认值填充 + 带路径的类型报错。

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** 与 同代 DSH 插件 同款：优先读 DSH_HOME，测试隔离靠它把 HOME 指向临时目录。 */
const dshHome = (): string => process.env.DSH_HOME || join(homedir(), '.dsh')

export interface WebSearchMinimaxConfig {
  /** 搜索接口基址；按 region 派生（cn → api.minimaxi.com），不写死到完整 host+path */
  searchBaseUrl: string
  /** 存放密钥的环境变量名（**只存变量名**；值留在 ~/.dsh/.env）。默认复用对话的 LLM 密钥 */
  searchKeyEnv: string
  /** 单次搜索的请求超时（工具侧另有 60s 预算，这里留出余量） */
  searchTimeoutMs: number
  // 刻意不提供「来源条数」配置：条数由工具层 tool-web.searchMaxResults 决定（默认 8），
  // provider 侧再设一个同名旋钮只会与它争主权且永远不生效（issue 004 收尾）。
  /**
   * 插件日志落盘路径；空串 = 在 apply() 时按 DSH_HOME 惰性派生。
   * 刻意不做成 schema 默认值：默认表达式在**模块加载时**求值，而测试隔离护栏是在
   * beforeAll 里才设 DSH_HOME —— 早于它求值就会回落到真实 ~/.dsh，测试日志直接写进
   * 真实运行时目录。惰性求值才能让隔离真正生效。
   */
  logPath: string
}

export const Config: z<WebSearchMinimaxConfig> = z.object({
  searchBaseUrl: z.string().default('https://api.minimaxi.com'),
  searchKeyEnv: z.string().default('MINIMAX_CN_API_KEY'),
  // 刻意不加 step()：默认值若不是任何固定步长的倍数，配置校验会在插件加载期就抛错，
  // 而 loader 静默吞掉——症状与排查代价和 issue 003 踩的坑完全一样。
  searchTimeoutMs: z.number().min(1000).default(30_000),
  logPath: z.string().default(''),
})

/** 日志默认路径。必须在 apply() 时调用，不能在模块顶层求值（见 logPath 字段注释）。 */
export const defaultLogPath = (): string => join(dshHome(), 'logs', 'dsh-web-search-minimax.log')

/** 已知键（schemastery 的 Schema 类型不暴露 properties，故显式列出）。 */
export const KNOWN_KEYS = ['searchBaseUrl', 'searchKeyEnv', 'searchTimeoutMs', 'logPath'] as const

export function resolveConfig<T>(schema: z<T>, raw: unknown, plugin: string): T {
  const result = (schema as any)['~standard'].validate(raw) as any
  if (typeof result?.then === 'function') throw new TypeError(`[${plugin}] 不支持异步配置校验`)
  if (result?.issues) {
    const detail = (result.issues as any[]).map((i: any) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`).join('；')
    throw new Error(`[${plugin}] 配置校验失败 —— ${detail}`)
  }
  return result.value as T
}
