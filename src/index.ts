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

import { appendFileSync } from 'node:fs'
import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@deepseek-ai/dsh-web'
import { credentialRef, isCredentialRefName, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
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
//
// credentials **不进 inject**（2026-11-26 改）：cordis 的 inject 是硬依赖，数组里任一服务
// 缺席就永不调 apply()。实测 headless（模板把 credentials 显式 disabled，一次性任务按设计
// 用启动环境注入密钥）：`pending (waiting for service: credentials)`，插件日志一行不产生。
// 凭据服务改由 resolveSecret 每次现取（createKeyResolver）：
//   · 有 seam 就以它为准（设置页托管的 key 只有它读得到）；
//   · 没有 seam（headless / 精简组合）就退回环境层。
// ⚠ 别改回「apply() 里捕获一次 credentials」：该服务异步 init（读文件 + 挂 watcher），
// 就绪可能晚于本插件，那一刻取到的 undefined 会被闭包永久记住 → available() 永远 false
// → provider 从设置页消失（2026-11-25 实测，commit b4a18e6 的缺陷形态）。
// 现取才能让服务晚到时自愈，这也是上游内置 provider 的写法（惰性 ctx.get）。
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
 * 环境层取值：走 DSH 的启动环境快照（`launchEnvironmentOf`），不自己解析 `.env`。
 *
 * 上游的 `launchEnvironmentOf(ctx)` 就是这个 seam 的规范入口（`@deepseek-ai/dsh-launch-environment`）：
 *   · 有 launcher 快照时，它按 `process` > `project-env` > `user-env` 的固定信任序解析，
 *     即 process.env > `<运行目录>/.env` > `$DSH_HOME/.env` 三层；
 *   · 没有快照时（组合未由产品 CLI 引导）它退化成只看 process.env 的单层快照。
 * 两条路径都是纯本地、零网络，满足接缝「检查不得发网络请求」的契约，且同步可调用
 * （快照在启动时建好），所以 `available()` 这种同步判定也能用。
 *
 * 关键收益：不再重复实现 `.env` 解析。手写版本只读 `$DSH_HOME/.env`，会漏掉
 * `<运行目录>/.env` 那一层（除非 launcher 恰好把它物化进 process.env，那是实现细节）。
 *
 * 变量名不合凭据引用语法（用户自拟名可能带短横线）时这里照样能查，因为快照只是
 * 名字 → 值，不校验格式；格式校验只影响凭据 seam 那条路。
 *
 * `ctx` 可选：不给时按「没有快照」处理（只看 process.env），供不需要上下文的调用点与测试使用。
 */
export function resolveKey(ctx: any, envName: string): string | undefined {
  const entry = launchSnapshot(ctx).get(envName)
  return entry === undefined || entry.value === '' ? undefined : entry.value
}

/** 本次启动的环境快照：优先用 launcher 提供的那份，没有就退化成只看 process.env 的单层。 */
function launchSnapshot(ctx: any): LaunchEnvironmentSnapshot {
  let provided: unknown
  try { provided = ctx?.get?.(DSH_LAUNCH_ENVIRONMENT_KEY) } catch { provided = undefined }
  // 鸭子类型校验：快照必须带 get 方法。不校验的话，测试替身或非常规组合里
  // ctx.get 返回别的东西时会在快照调用处炸（上游 launchEnvironmentOf 假设调用方成立）。
  if (provided !== null && typeof provided === 'object'
    && typeof (provided as LaunchEnvironmentSnapshot).get === 'function') {
    return provided as LaunchEnvironmentSnapshot
  }
  return createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env as Record<string, string> }])
}

/**
 * 造密钥解析器：凭据 seam 优先，环境层兜底（与内置 web-search-deepseek 同构）。
 *
 * seam 优先是关键：DSH「设置 → 模型」保存的密钥落在托管存储
 * （$DSH_HOME/.credentials.yaml），环境层读不到，只有 seam 读得到。
 * 变量名不合凭据引用语法（用户自拟名可能带短横线）时跳过 seam，
 * 别让 credentialRef 的校验把插件打挂：环境层照样能供值。
 *
 * ⚠ **每次调用现取凭据服务，不在 apply() 捕获**：服务就绪可能晚于插件装载，
 * 捕获一次会把 undefined 永久记进闭包，之后判据恒假、provider 从设置页消失
 * （2026-11-25 实测）。现取同时让 headless 这类「没有该服务」的组合照常工作：
 * 退回环境层，密钥由启动环境注入（headless 的设计前提）。
 */
export function createKeyResolver(
  ctx: any,
): (envName: string) => Promise<string | undefined> {
  return async (envName: string): Promise<string | undefined> => {
    let credentials: CredentialProvider | undefined
    try { credentials = ctx.get?.('credentials') } catch { credentials = undefined }
    if (credentials !== undefined && isCredentialRefName(envName)) {
      const hit = await credentials.resolve(credentialRef(envName))
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }
    return resolveKey(ctx, envName)
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
  // **不在这里捕获**，只在日志里探一次当前状态（见 createKeyResolver 的注释）。
  const credentialsAtStart: CredentialProvider | undefined = ctx.get?.('credentials')
  const resolveSecret = createKeyResolver(ctx)
  const keyEnv = effectiveSearchKeyEnv(cfg)
  // 只打变量名与基址（生效值），绝不打密钥值。
  // 三个字段的语义（别混用，排查时会被误导）：
  //   · envKey：环境层此刻能否同步读到（只反映 process.env / 启动环境物化的值）；
  //   · credentials：凭据服务此刻在不在场（false 有两种可能：本组合没有它，
  //     headless 属此；或它还没 init 完，随后就绪会补一条日志）；
  //   · available：provider.available() 的同一判定，即「插件在不在 + 配置形状」，
  //     **不含密钥有无**（密钥归 ready()，每步异步判）。
  log('info', `init： ${JSON.stringify({ id: PROVIDER_ID, region: cfg.region, searchBaseUrl: effectiveSearchBaseUrl(cfg), searchKeyEnv: keyEnv, envKey: resolveKey(ctx, keyEnv) !== undefined, credentials: credentialsAtStart !== undefined, available: URL.canParse(effectiveSearchBaseUrl(cfg)) })}`)

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
    // **只做结构检查，不判密钥**（与上游 web-search-deepseek 的 available() 同构：
    // 它也只校验配置形状，密钥有无留给 ready()）。这条是启动窗口的关键：
    // 凭据服务异步 init，装载时尚不可用时若在这里答 false，而本插件 patch 又把
    // searchProvider 显式钉成 minimax，seam 选择会立刻抛 WEB_PROVIDER_CONFIGURED_UNAVAILABLE
    // （「注册了但不可用」），表现为启动后首批请求的搜索异常。
    // 拆开之后：available() 恒反映「插件在不在、配置合不合法」，ready() 每步异步判密钥。
    available: () => URL.canParse(effectiveSearchBaseUrl(cfg)),
    // ready?(llmProvider)：seam 的 searchReady() 只问会被选中的 provider，答案进
    // dsh-tool-web 的注册条件，且**每个模型步骤重新求值**。密钥没配时答 false →
    // web_search 不准入该模型步骤：工具不出现（模型看不到它），而不是出现但每次
    // 调用撞 MINIMAX_SEARCH_KEY_MISSING。同样纯本地零网络。
    // 存储读不出来时答 false（与内置 provider 一致）：这是「这一步没法认证」，不是
    // 「插件坏了」。抛出会沿 searchReady → 工具准入 → ToolActivationError 变成整轮
    // 对话失败，代价过大。
    // 惰性解析 + 每步重算 = 凭据服务晚就绪/重启后自动恢复，不需要任何启动期等待。
    ready: async () => {
      try { return (await resolveSecret(keyEnv)) !== undefined } catch { return false }
    },
    search: (request: WebSearchRequest, signal?: AbortSignal) => runSearch(cfg, request, signal, log, resolveSecret),
  }

  web.registerSearchProvider(provider)
  log('info', `provider 已注册：${PROVIDER_ID}。搜索提供方已随本插件 patch 自动设为 ${PROVIDER_ID}（装上即配好，无需手动改 profile）；若 profile 无 web 行或被后续 overlay 整块替换，此设置不生效（0.2.2-rc.5 起静默，搜索会走内置 provider）`)

  // 凭据层观测（不改装载条件）：凭据服务缺席时它是 headless 的正常形态（密钥由启动
  // 环境注入），不代表故障。这里只在**它迟到**时补一条日志说明已恢复，方便排查
  // 「启动窗口内的搜索不可用」这类现象。
  // 用 ctx.inject 而非 inject 声明：前者是子 fiber 的就绪回调，晚到不阻塞本插件；
  // 后者是硬依赖，任一服务缺席就永不装载（2026-11-26 headless 实测）。
  if (credentialsAtStart === undefined && typeof ctx.inject === 'function') {
    ctx.inject(['credentials'], () => {
      log('info', '凭据服务已就绪（晚于插件装载）：托管密钥自本次起可解析；未托管时仍回落环境层')
    })
  }
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
  // 事件在启动期会连发（宿主与各客户端的每次 describe 都可能触发 document-updated，
  // 实测 boot 窗口 5ms 内 6 发），trailing 防抖 300ms 合并成一次，日志不再刷屏。
  if (typeof ctx.on === 'function') {
    let recheckTimer: ReturnType<typeof setTimeout> | undefined
    ctx.on('settings/document-updated', () => {
      if (recheckTimer !== undefined) return
      recheckTimer = setTimeout(() => {
        recheckTimer = undefined
        const s: unknown = ctx.get?.('settings')
        if (s !== undefined) selfCheck(s)
      }, 300)
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
