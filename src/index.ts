// dsh-web-search-minimax：用 MiniMax 的联网搜索实现 DSH 的 WebSearchProvider
//
// 设计：直调 MiniMax API（复用已配置的 MiniMax 密钥，与对话同一个），不自起进程、
// 不落密钥副本——密钥只从 ~/.dsh/.env（或进程环境）按变量名读取。
//
// 本插件是**完全独立**的发行单元：
//   · 不依赖任何第三方插件包，唯一 peer 是 @deepseek-ai/schemastery（宿主供给同一实例）；
//   · 独立安装：dsh plugin --profile <p> add @dreamariner/dsh-web-search-minimax。
//
// 依赖硬约束（改动前必读）：
//   · 依赖策略（不变式）：peer（schemastery）必须外置——运行期由宿主拦截层供给
//     与 DSH 同一实例；其余依赖自带一份（tsdown deps 内联）。名单只写在 package.json。
//   · 不跨包运行期导入 —— @deepseek-ai/dsh-web 只做 import type（编译期擦除）。运行期
//     需要的一切（fetch、错误类型）用本地实现，否则 pnpm 隔离布局下解析不到该包。
//
// 接口契约见 DSH packages/web/web/src/types.ts:102-108（id / available / search 三个成员）。

import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { Config, KNOWN_KEYS, defaultLogPath, resolveConfig, type WebSearchMinimaxConfig } from './config.ts'

export const name = 'dsh-web-search-minimax'
// web 是注册入口（ctx.web.registerSearchProvider）。inject 是白名单，漏写则 ctx.web 为
// undefined，而 loader 静默吞掉插件异常 —— 表现为「插件静默失效」而非报错（坑位 11）。
export const inject = ['web']
export { Config }

/** provider 在 web 行里的 id。 */
export const PROVIDER_ID = 'minimax'

/** MiniMax 接口的硬上限：单次最多 10 条，不支持分页。 */
export const API_HARD_CAP = 10

/** 插件日志。路径来自配置（默认经 DSH_HOME 派生），**不可硬编码** —— 否则测试会写进
 *  真实运行时目录，污染 实际运行日志（tests/setup.ts 的隔离护栏就靠 DSH_HOME 生效）。 */
const makeLog = (path: string) => (level: 'info' | 'warn', msg: string): void => {
  try {
    appendFileSync(path, `${new Date().toISOString()} [${level}] ${msg}\n`)
  } catch {
    // 日志失败不能影响搜索本身
  }
}

/** 带机器可读 code 的错误。DSH 的 seam 不包装 provider 抛出的错误，原样上抛给工具层取 code。 */
class SearchProviderError extends Error {
  code: string

  // 历史注记：本插件装载走编译产物（lib/index.js），无 strip-only 语法约束；
  // 保留普通字段赋值写法只是风格延续。
  constructor(message: string, code: string) {
    super(message)
    this.name = 'SearchProviderError'
    this.code = code
  }
}

interface MiniMaxOrganic {
  title?: string
  link?: string
  snippet?: string
  date?: string
}

interface MiniMaxSearchResponse {
  organic?: MiniMaxOrganic[]
  base_resp?: { status_code?: number; status_msg?: string }
}

/**
 * 映射 MiniMax 的 organic 条目 → DSH 可引用来源。
 * `link` 为空的条目直接丢弃（WebSearchSource.url 是必填，缺了就只能整条丢）。
 */
export function mapSources(organic: readonly MiniMaxOrganic[]): WebSearchSource[] {
  const out: WebSearchSource[] = []
  for (const item of organic) {
    const url = typeof item.link === 'string' ? item.link.trim() : ''
    if (url === '') continue
    out.push({
      url,
      ...typeof item.title === 'string' && item.title !== '' ? { title: item.title } : {},
      ...typeof item.snippet === 'string' && item.snippet !== '' ? { snippet: item.snippet } : {},
      ...typeof item.date === 'string' && item.date !== '' ? { publishedAt: item.date } : {},
    })
  }
  return out
}

/**
 * 解析密钥：进程环境优先（由 ~/.dsh/.env 注入），回落到该文件本身。
 * `available()` 依赖它，因此必须是纯本地读取——接口明写该检查不得发网络请求。
 */
export function resolveKey(envName: string): string | undefined {
  const fromProcess = process.env[envName]
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess
  try {
    const raw = readFileSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const at = trimmed.indexOf('=')
      if (at <= 0) continue
      if (trimmed.slice(0, at).trim() !== envName) continue
      const value = trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '')
      if (value !== '') return value
    }
  } catch {
    // .env 不存在或不可读 → 视为未配置
  }
  return undefined
}

export function apply(ctx: any, rawConfig?: Partial<WebSearchMinimaxConfig> | null): void {
  // patch 里没有配置项时 YAML 会解析出 `config: null`，而默认参数 `= {}` 只对 undefined
  // 生效——真收到 null 时 Object.keys(null) 会抛 TypeError，插件静默不装载。故显式兜底。
  const config: Partial<WebSearchMinimaxConfig> = rawConfig ?? {}
  const unknown = Object.keys(config).filter((k) => !(KNOWN_KEYS as readonly string[]).includes(k))
  if (unknown.length > 0) {
    throw new Error(`[${name}] 未知配置键：${unknown.join('、')}\n可用键：${KNOWN_KEYS.join(', ')}`)
  }
  const cfg: WebSearchMinimaxConfig = resolveConfig(Config, config, name)
  const logPath = cfg.logPath !== '' ? cfg.logPath : defaultLogPath()
  const log = makeLog(logPath)
  // 只打变量名与基址，绝不打密钥值
  log('info', `init： ${JSON.stringify({ id: PROVIDER_ID, searchBaseUrl: cfg.searchBaseUrl, searchKeyEnv: cfg.searchKeyEnv, available: resolveKey(cfg.searchKeyEnv) !== undefined })}`)

  const web = ctx.web
  if (web === undefined || typeof web.registerSearchProvider !== 'function') {
    throw new Error(`[${name}] ctx.web 不可用——inject 声明与服务实际名称不一致`)
  }

  const provider: WebSearchProvider = {
    id: PROVIDER_ID,
    // 接口注释明写：廉价本地可用性检查，不得发网络请求。所以只看密钥在不在。
    available: () => resolveKey(cfg.searchKeyEnv) !== undefined,
    search: (request: WebSearchRequest, signal?: AbortSignal) => runSearch(cfg, request, signal, log),
  }

  web.registerSearchProvider(provider)
  log('info', `provider 已注册：${PROVIDER_ID}。profile 的 web 行必须显式设 searchProvider: ${PROVIDER_ID}，否则与内置 provider 并存会撞 WEB_PROVIDER_AMBIGUOUS`)
}

async function runSearch(
  cfg: WebSearchMinimaxConfig,
  request: WebSearchRequest,
  signal: AbortSignal | undefined,
  log: (level: 'info' | 'warn', msg: string) => void,
): Promise<WebSearchResult> {
  const key = resolveKey(cfg.searchKeyEnv)
  if (key === undefined) {
    throw new SearchProviderError(
      `[minimax] 未找到密钥环境变量 ${cfg.searchKeyEnv}（值应写在 ~/.dsh/.env）`,
      'MINIMAX_SEARCH_KEY_MISSING',
    )
  }
  // 接口硬上限 10 且不支持分页：maxResults 只能向下收，向上要不来。
  // 条数由工具层 tool-web.searchMaxResults 决定（schema 有默认值，恒有值），此处只做接口硬封顶。
  const wanted = Math.min(request.maxResults ?? API_HARD_CAP, API_HARD_CAP)

  const timeout = AbortSignal.timeout(cfg.searchTimeoutMs)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

  let res: Response
  try {
    // 注意 body 字段是 q，不是 query（用 query 会得到 2013 invalid params）
    res = await fetch(`${cfg.searchBaseUrl}/v1/coding_plan/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ q: request.query }),
      signal: composed,
    })
  } catch (e) {
    throw new SearchProviderError(`[minimax] 搜索请求失败：${(e as Error).message}`, 'MINIMAX_SEARCH_TRANSPORT')
  }

  if (!res.ok) {
    throw new SearchProviderError(`[minimax] 搜索返回 HTTP ${res.status}`, 'MINIMAX_SEARCH_HTTP')
  }

  let body: MiniMaxSearchResponse
  try {
    body = (await res.json()) as MiniMaxSearchResponse
  } catch {
    throw new SearchProviderError('[minimax] 搜索返回非 JSON 响应', 'MINIMAX_SEARCH_BAD_RESPONSE')
  }

  const code = body.base_resp?.status_code
  if (code !== undefined && code !== 0) {
    throw new SearchProviderError(
      `[minimax] 搜索被拒绝（${code}）：${body.base_resp?.status_msg ?? '未知原因'}`,
      'MINIMAX_SEARCH_REJECTED',
    )
  }

  const sources = mapSources(body.organic ?? [])
  if (sources.length === 0) {
    throw new SearchProviderError('[minimax] 搜索未返回任何可用来源（organic 为空或全部缺少 link）', 'MINIMAX_SEARCH_EMPTY')
  }

  // 只按接口硬上限预切，**不按 wanted 切**：切到 wanted 会让 DSH 的
  // capSources 判定 `length <= maxResults` 提前成立、truncated 永远置不了位，
  // 单 query 丢掉的结果就被静默吞掉（实测日志「返回 9 条，交付 8 条」却无截断提示）。
  const capped = sources.slice(0, API_HARD_CAP)
  const truncated = capped.length > wanted
  // 如实记录「交付多少 / 工具层会切到多少 / 是否触顶」。不能写成「交付 wanted 条」——
  // 实际交付的是 capped（最多 10 条），由 capSources 再切；日志说谎会把排查引向反方向。
  log('info', `search ok：query=${request.query.slice(0, 40)} API 返回 ${sources.length} 条`
    + `（按硬上限交付 ${capped.length} 条，工具层 maxResults=${request.maxResults ?? '未设'} 会切到 ${wanted} 条`
    + `${truncated ? '，已置 truncated=true' : ''}）`)
  return { sources: capped, truncated }
}
