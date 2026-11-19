// dsh-web-search-minimax：用 MiniMax 的联网搜索实现 DSH 的 WebSearchProvider
//
// 设计：直调 MiniMax Coding Plan 的搜索 API（国内 / 国际版按 region 切换），
// 不自起进程、不落密钥副本：密钥按变量名交给宿主的凭据层解析，插件不保存密钥值本身。
//
// 本插件是**完全独立**的发行单元：
//   · 不依赖任何第三方插件包，peer 只有宿主供给的公共包（名单在 package.json）；
//   · 独立安装：dsh plugin --profile <p> add @dreamariner/dsh-web-search-minimax。
//
// 依赖硬约束（改动前必读）：
//   · 依赖策略（不变式）：peer（schemastery、dsh-web、dsh-credentials）必须外置：
//     运行期由宿主拦截层供给与 DSH 同一实例；其余依赖自带一份（tsdown deps 内联）。
//     名单只写在 package.json。
//   · 跨包运行期导入只限 peer 名单内的包：DSH 的解析器按 peerDependencies 判定，把
//     peer 的导入拦截并路由到宿主自己的那份实例（app-boot 的 resolver）。所以
//     @deepseek-ai/dsh-web 的运行期导入能拿到与宿主同一个 WebError 类（判类型的前提），
//     @deepseek-ai/dsh-credentials 的 credentialRef 用的也是宿主那一份实现。
//   · 不在 peer 名单里的包不许运行期导入：那些用本地实现（fetch 等），否则 pnpm 隔离
//     布局下解析不到。
//
// 密钥解析（与内置 web-search-deepseek 同构）：
//   · 凭据 seam 优先：DSH「设置 → 模型」保存的密钥落在托管存储，只有 seam 读得到；
//   · 环境层兜底：启动环境 / $cwd/.env / $DSH_HOME/.env（launcher 提供的快照）；
//   · available() 是同步接口（seam 的 resolve 是异步的），只能查环境层与
//     「seam 是否在场」，真正的缺失留到 search() 报更具体的 MINIMAX_SEARCH_KEY_MISSING。
//
// 接口契约见 DSH packages/web/web/src/types.ts:102-108（id / available / search 三个成员）。

import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'
import { credentialRef, isCredentialRefName, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import {
  Config,
  KNOWN_KEYS,
  defaultLogPath,
  effectiveSearchBaseUrl,
  effectiveSearchKeyEnv,
  resolveConfig,
  type WebSearchMinimaxConfig,
} from './config.ts'

export const name = 'dsh-web-search-minimax'
// web 是注册入口（ctx.web.registerSearchProvider）。inject 是白名单，漏写则 ctx.web 为
// undefined，而 loader 静默吞掉插件异常 —— 表现为「插件静默失效」而非报错（坑位 11）。
export const inject = ['web']
export { Config }

/** provider 在 web 行里的 id。 */
export const PROVIDER_ID = 'minimax'

/** MiniMax 接口的硬上限：单次最多 10 条，不支持分页。 */
export const API_HARD_CAP = 10

/** provider 展示名（设置页 provider 菜单用：第三方 provider 显示 title ?? id，不补就是裸 id）。
 *  静态串只能选一种语言，公开仓面向 npm 用英文。 */
export const PROVIDER_TITLE = 'MiniMax Web Search'

/** provider 说明（双语 LocalizedText，选中本插件时显示在设置页 provider 菜单下方）。
 *  口径：装上即配好（patch 随插件走）；生效值不是本插件时给出精确到设置页的切换路径。 */
export const PROVIDER_DESCRIPTION = {
  en: 'Uses the MiniMax Coding Plan search API, sharing the key with the MiniMax model provider in settings. Installing this plugin automatically sets the search provider to MiniMax via its bundled patch; no manual profile editing needed. If the effective provider is not MiniMax (switched in settings, or a profile overlay overrides the web row), open the Plugins page → Built-in plugin configuration → Web search and fetch, and set the web search provider back to MiniMax.',
  zh: '走 MiniMax Coding Plan 搜索接口，密钥与「设置 → 模型」的 MiniMax 提供商共用。安装本插件即自动把搜索提供方设为 MiniMax（patch 随插件生效），无需手动改 profile。若当前生效值不是 MiniMax（在设置页换过提供方，或 profile 有覆盖 web 行的 overlay），到 插件页 → 内置插件配置 → 网页搜索与获取，把「网页搜索提供方」切回 MiniMax。',
} as const

/** 生效自检的统一切换指引（warn 日志与 description 同口径）。 */
const SWITCH_HINT = '插件页（左侧栏「插件」）→ 内置插件配置 → 网页搜索与获取 → 把「网页搜索提供方」切回 MiniMax'

/** 生效自检的判定结果。 */
export type Effectiveness =
  | { state: 'serving'; provider: 'minimax' }
  | { state: 'superseded'; provider: string }
  | { state: 'auto'; provider: undefined }
  | { state: 'unknown'; provider: undefined }

/**
 * 从 settings.describe() 的 descriptor 列表判定当前生效的网页搜索提供方。
 *
 * 识别 web 条目不写死条目 id（防自定义 profile 用别的 id 挂 web）：schema 声明里带
 * searchProvider，或 value 带 searchProvider / fetchProvider 键即算命中。value 识别
 * 尤其必要：settings 的 projectForm 会**整体省略**未设值的键，所以自动模式下 web 条目
 * 的 value 只有 `{fetchProvider: http}`，searchProvider 键根本不存在。
 * 命中后按 searchProvider 生效值三态：minimax = serving；其他非空串 = superseded；
 * 缺省 = auto（rc.5 起按模型路由选内置 provider，本插件不参与）。
 * 找不到任何 web 条目 = unknown（settings 不在位 / web 条目没进 settings 视野）。
 */
export function judgeEffectiveness(descriptors: unknown): Effectiveness {
  const rows = Array.isArray(descriptors) ? descriptors : []
  const valueMentions = (obj: unknown): boolean =>
    obj !== null && typeof obj === 'object'
    && ('searchProvider' in (obj as object) || 'fetchProvider' in (obj as object))
  // 表单 schema 是 JSON 形状（dict 键名），串化后查声明最稳，不依赖具体结构
  const schemaMentions = (schema: unknown): boolean =>
    schema !== null && typeof schema === 'object' && JSON.stringify(schema).includes('"searchProvider"')
  for (const row of rows) {
    const r = row as { value?: unknown; schema?: unknown } | undefined
    if (!valueMentions(r?.value) && !schemaMentions(r?.schema)) continue
    const sp = (r?.value as { searchProvider?: unknown } | undefined)?.searchProvider
    if (sp === PROVIDER_ID) return { state: 'serving', provider: PROVIDER_ID }
    if (typeof sp === 'string' && sp !== '') return { state: 'superseded', provider: sp }
    return { state: 'auto', provider: undefined }
  }
  return { state: 'unknown', provider: undefined }
}

/** 生效自检结果落日志。 */
function logEffectiveness(log: (level: 'info' | 'warn', msg: string) => void, verdict: Effectiveness): void {
  switch (verdict.state) {
    case 'serving':
      log('info', `生效自检：当前网页搜索提供方 = ${PROVIDER_ID}，本插件正在接管搜索`)
      break
    case 'superseded':
      log('warn', `生效自检：当前网页搜索提供方 = ${verdict.provider}，不是本插件；如需 MiniMax：${SWITCH_HINT}`)
      break
    case 'auto':
      log('warn', `生效自检：未显式配置网页搜索提供方（自动模式），0.2.2-rc.5 起按模型路由选内置 provider，本插件不参与；如需 MiniMax：${SWITCH_HINT}`)
      break
    case 'unknown':
      log('info', '生效自检：settings 里找不到带 searchProvider 的条目，无法验证当前提供方；可 pnpm dsh:probe 或到设置页人工确认')
      break
  }
}

/** 插件日志。路径来自配置（默认经 DSH_HOME 派生），**不可硬编码** —— 否则测试会写进
 *  真实运行时目录，污染实际运行日志（tests/setup.ts 的隔离护栏就靠 DSH_HOME 生效）。 */
const makeLog = (path: string) => (level: 'info' | 'warn', msg: string): void => {
  try {
    appendFileSync(path, `${new Date().toISOString()} [${level}] ${msg}\n`)
  } catch {
    // 日志失败不能影响搜索本身
  }
}

/**
 * 带机器可读 code 的错误。DSH 的 seam 不包装 provider 抛出的错误，原样上抛给工具层取 code。
 *
 * 必须是 WebError（它继承 HarnessError）：工具层只在 `error instanceof HarnessError` 时
 * 才把 {name, code} 放进结构化错误元数据（core/tools 的 errorInfo）。抛普通 Error 的话，
 * code 只活在本插件的边界上，模型看到的只有一句 message，路由层拿不到 code。
 */
const searchError = (message: string, code: string): WebError => new WebError(message, code)

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
 * 环境层取值：进程环境优先（launcher 已把 $cwd/.env 与 $DSH_HOME/.env 物化进
 * 进程环境），回落到直读 $DSH_HOME/.env 本身。
 * 纯本地、零网络：接口明写这类检查不得发网络请求。
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

/**
 * 造密钥解析器：凭据 seam 优先，环境层兜底（与内置 web-search-deepseek 同构）。
 *
 * seam 优先是关键：DSH「设置 → 模型」保存的密钥落在托管存储
 * （$DSH_HOME/.credentials.yaml），环境层读不到，只有 seam 读得到。
 * 变量名不合凭据引用语法（用户自拟名可能带短横线）时跳过 seam，
 * 别让 credentialRef 的校验把插件打挂：环境层照样能供值。
 */
export function createKeyResolver(
  ctx: any, credentials: CredentialProvider | undefined,
): (envName: string) => Promise<string | undefined> {
  return async (envName: string): Promise<string | undefined> => {
    if (credentials !== undefined && isCredentialRefName(envName)) {
      const hit = await credentials.resolve(credentialRef(envName))
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }
    return resolveKey(envName)
  }
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
  // 凭据 seam：宿主挂了 credentials 服务时才有。没有它时环境层就是整个凭据面。
  const credentials: CredentialProvider | undefined = ctx.get?.('credentials')
  const resolveSecret = createKeyResolver(ctx, credentials)
  const keyEnv = effectiveSearchKeyEnv(cfg)
  // 只打变量名与基址（生效值），绝不打密钥值
  log('info', `init： ${JSON.stringify({ id: PROVIDER_ID, region: cfg.region, searchBaseUrl: effectiveSearchBaseUrl(cfg), searchKeyEnv: keyEnv, available: resolveKey(keyEnv) !== undefined, credentials: credentials !== undefined })}`)

  const web = ctx.web
  if (web === undefined || typeof web.registerSearchProvider !== 'function') {
    throw new Error(`[${name}] ctx.web 不可用——inject 声明与服务实际名称不一致`)
  }

  const provider: WebSearchProvider = {
    id: PROVIDER_ID,
    // 设置页 provider 菜单的人话名字与说明（第三方 provider 显示 title ?? id，不补就是裸 id）。
    title: PROVIDER_TITLE,
    description: PROVIDER_DESCRIPTION,
    // 接口注释明写：廉价本地可用性检查，不得发网络请求。
    // seam 的 resolve 是异步的，available() 判不了托管存储里的值，所以判「有无途径」：
    // 环境层能同步读到 → 可用；读不到但 seam 在场 → 托管存储里可能有值（设置页填过），
    // 真正的缺失留到 search() 报更具体的 MINIMAX_SEARCH_KEY_MISSING。
    available: () => resolveKey(keyEnv) !== undefined || credentials !== undefined,
    // ready?(llmProvider)：seam 的 searchReady() 只问会被选中的 provider，答案进
    // dsh-tool-web 的注册条件。密钥没配时答 false → web_search 不准入该模型步骤：
    // 工具不出现（模型看不到它），而不是出现但每次调用撞 MINIMAX_SEARCH_KEY_MISSING。
    // 同样纯本地零网络；异步才判得了托管存储，这正是 available()（同步）答不了的部分。
    ready: async () => (await resolveSecret(keyEnv)) !== undefined,
    search: (request: WebSearchRequest, signal?: AbortSignal) => runSearch(cfg, request, signal, log, resolveSecret),
  }

  web.registerSearchProvider(provider)
  log('info', `provider 已注册：${PROVIDER_ID}。搜索提供方已随本插件 patch 自动设为 ${PROVIDER_ID}（装上即配好，无需手动改 profile）；若 profile 无 web 行或被后续 overlay 整块替换，此设置不生效（0.2.2-rc.5 起静默，搜索会走内置 provider）`)

  // 生效值自检：settings 服务在位即判；未就绪经 inject 等它可用（cordis 会挂起回调直至服务出现）。
  const selfCheck = (settings: unknown): void => {
    const s = settings as { describe?: () => unknown } | undefined
    if (s === undefined || typeof s.describe !== 'function') {
      log('info', '生效自检：settings 服务不可用（精简组合？），无法验证当前网页搜索提供方；可 pnpm dsh:probe 或到设置页人工确认')
      return
    }
    let rows: unknown
    try { rows = s.describe() } catch (e) {
      log('info', `生效自检：settings.describe 抛错（${(e as Error).message}），无法验证当前提供方`)
      return
    }
    logEffectiveness(log, judgeEffectiveness(rows))
  }
  const settingsNow: unknown = ctx.get?.('settings')
  if (settingsNow !== undefined) {
    selfCheck(settingsNow)
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (scoped: any) => selfCheck(scoped?.settings ?? scoped))
  } else {
    log('info', '生效自检：settings 服务不可用（精简组合？），无法验证当前网页搜索提供方；可 pnpm dsh:probe 或到设置页人工确认')
  }
  // 配置变更重判：用户在设置页切提供方会触发 settings/document-updated，重读 describe 即可。
  // 跨插件事件用普通 ctx.on 即可收到（dsh-notify 监听 session/event 同款），随插件 fiber 自动注销。
  if (typeof ctx.on === 'function') {
    ctx.on('settings/document-updated', () => {
      const s: unknown = ctx.get?.('settings')
      if (s !== undefined) selfCheck(s)
    })
  }
}

async function runSearch(
  cfg: WebSearchMinimaxConfig,
  request: WebSearchRequest,
  signal: AbortSignal | undefined,
  log: (level: 'info' | 'warn', msg: string) => void,
  resolveSecret: (envName: string) => Promise<string | undefined>,
): Promise<WebSearchResult> {
  const keyEnv = effectiveSearchKeyEnv(cfg)
  const key = await resolveSecret(keyEnv)
  if (key === undefined) {
    throw searchError(
      `[minimax] 未找到密钥 ${keyEnv}（region=${cfg.region}）：值可在 DSH「设置 → 模型」的 MiniMax 提供商里填，`
      + '或写进 ~/.dsh/.env 的同名变量',
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
    res = await fetch(`${effectiveSearchBaseUrl(cfg)}/v1/coding_plan/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ q: request.query }),
      signal: composed,
    })
  } catch (e) {
    throw searchError(`[minimax] 搜索请求失败：${(e as Error).message}`, 'MINIMAX_SEARCH_TRANSPORT')
  }

  if (!res.ok) {
    throw searchError(`[minimax] 搜索返回 HTTP ${res.status}`, 'MINIMAX_SEARCH_HTTP')
  }

  let body: MiniMaxSearchResponse
  try {
    body = (await res.json()) as MiniMaxSearchResponse
  } catch {
    throw searchError('[minimax] 搜索返回非 JSON 响应', 'MINIMAX_SEARCH_BAD_RESPONSE')
  }

  const code = body.base_resp?.status_code
  if (code !== undefined && code !== 0) {
    throw searchError(
      `[minimax] 搜索被拒绝（${code}）：${body.base_resp?.status_msg ?? '未知原因'}`,
      'MINIMAX_SEARCH_REJECTED',
    )
  }

  const sources = mapSources(body.organic ?? [])
  if (sources.length === 0) {
    throw searchError('[minimax] 搜索未返回任何可用来源（organic 为空或全部缺少 link）', 'MINIMAX_SEARCH_EMPTY')
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
