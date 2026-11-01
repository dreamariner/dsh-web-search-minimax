// dsh-web-search-minimax 配置
// 校验语义：默认值填充 + 带路径的类型报错。

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** 优先读 DSH_HOME，测试隔离靠它把 HOME 指向临时目录。 */
const dshHome = (): string => process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * MiniMax 两个发行区：国内版与国际版的**域名和密钥都不通用**（两家 key 各自签发）。
 * region 是主配置：域名与默认密钥变量名都按它派生。
 */
export type MiniMaxRegion = 'cn' | 'global'

export const REGIONS: readonly MiniMaxRegion[] = ['cn', 'global']

/** 各发行区的搜索接口基址（Coding Plan 搜索接口所在域）。 */
export const REGION_BASE_URLS: Record<MiniMaxRegion, string> = {
  cn: 'https://api.minimaxi.com',
  global: 'https://api.minimax.io',
}

/** 各发行区的默认密钥环境变量名（值仍只放 ~/.dsh/.env，配置里只存名字）。 */
export const REGION_KEY_ENVS: Record<MiniMaxRegion, string> = {
  cn: 'MINIMAX_CN_API_KEY',
  global: 'MINIMAX_GLOBAL_API_KEY',
}

export interface WebSearchMinimaxConfig {
  /** 发行区：cn（国内，api.minimaxi.com）| global（国际，api.minimax.io）。决定域名与默认密钥变量名 */
  region: MiniMaxRegion
  /**
   * 搜索接口基址。**空串 = 按 region 派生**（见 REGION_BASE_URLS）；非空 = 显式覆盖
   * （自部署网关 / 反代场景）。与 logPath 同款空串哨兵：派生值在运行时取，不进 schema 默认。
   */
  searchBaseUrl: string
  /**
   * 存密钥的环境变量名（**只存变量名**；值留在 ~/.dsh/.env）。
   * **空串 = 按 region 派生默认名**（cn → MINIMAX_CN_API_KEY，global → MINIMAX_GLOBAL_API_KEY）。
   * 密钥来自 MiniMax Coding Plan（对话密钥与它无关，别混用）。
   */
  searchKeyEnv: string
  /** 单次搜索的请求超时（工具侧另有 60s 预算，这里留出余量） */
  searchTimeoutMs: number
  // 刻意不提供「来源条数」配置：条数由工具层 tool-web.searchMaxResults 决定（默认 8），
  // provider 侧再设一个同名旋钮只会与它争主权且永远不生效。
  /**
   * 插件日志落盘路径；空串 = 在 apply() 时按 DSH_HOME 惰性派生。
   * 刻意不做成 schema 默认值：默认表达式在**模块加载时**求值，而测试隔离护栏是在
   * beforeAll 里才设 DSH_HOME —— 早于它求值就会回落到真实 ~/.dsh，测试日志直接写进
   * 真实运行时目录。惰性求值才能让隔离真正生效。
   */
  logPath: string
}

export const Config: z<WebSearchMinimaxConfig> = z.object({
  region: z.union(['cn', 'global']).default('cn'),
  searchBaseUrl: z.string().default(''),
  searchKeyEnv: z.string().default(''),
  // 刻意不加 step()：默认值若不是任何固定步长的倍数，配置校验会在插件加载期就抛错，
  // 而 loader 静默吞掉——加载期就炸的配置错误最难排查，宁可不要这个约束。
  searchTimeoutMs: z.number().min(1000).default(30_000),
  logPath: z.string().default(''),
})

/** 日志默认路径。必须在 apply() 时调用，不能在模块顶层求值（见 logPath 字段注释）。 */
export const defaultLogPath = (): string => join(dshHome(), 'logs', 'dsh-web-search-minimax.log')

/** 生效的搜索接口基址：显式配置优先，否则按 region 派生。 */
export function effectiveSearchBaseUrl(cfg: WebSearchMinimaxConfig): string {
  return cfg.searchBaseUrl !== '' ? cfg.searchBaseUrl : REGION_BASE_URLS[cfg.region]
}

/** 生效的密钥环境变量名：显式配置优先，否则按 region 派生。 */
export function effectiveSearchKeyEnv(cfg: WebSearchMinimaxConfig): string {
  return cfg.searchKeyEnv !== '' ? cfg.searchKeyEnv : REGION_KEY_ENVS[cfg.region]
}

/** 已知键（schemastery 的 Schema 类型不暴露 properties，故显式列出）。 */
export const KNOWN_KEYS = ['region', 'searchBaseUrl', 'searchKeyEnv', 'searchTimeoutMs', 'logPath'] as const

export function resolveConfig<T>(schema: z<T>, raw: unknown, plugin: string): T {
  const result = (schema as any)['~standard'].validate(raw) as any
  if (typeof result?.then === 'function') throw new TypeError(`[${plugin}] 不支持异步配置校验`)
  if (result?.issues) {
    const detail = (result.issues as any[]).map((i: any) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message}`).join('；')
    throw new Error(`[${plugin}] 配置校验失败 —— ${detail}`)
  }
  return result.value as T
}
