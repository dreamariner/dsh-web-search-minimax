// dsh-web-search-minimax :: 浏览器半边入口（decoration client，单包形态）
//
// 职责：在插件管理页的本插件详情页上显示「搜索是否被本插件接管」：
//   · badge（plugins.detail.badge）：标题旁一枚标签（已接管搜索 / 未接管搜索）。
//     只反映 `searchProvider` 配置指向，不反映密钥可用性（那在 host 侧 ready?()，
//     客户端拿不到），所以文案是「已接管」而非「生效中」，见 badgeText 的注释；
//   · section（plugins.detail.section）：详情页下方三行状态（provider 注册 / 当前生效
//     提供方 / 设置页托管密钥）与未生效时的切换指引。
// 数据全部来自宿主现成 remote（web/listProviders、settings/describe、credentials/
// describe），不做自有 wire 契约；实时刷新靠 web/providers-changed、
// settings/document-updated、credentials/reference-updated、connection/reset 四个事件。
//
// 官方形态（dsh-notify / dsh-image-design 同款）：
//   · 产物 lib/client.js 由 tsdown.client.config.ts 包上 window.__ModuleLoader__.load
//     的 CJS 包装；factory 返回 { inject, apply }；react 来自宿主渲染进程模块表
//     （构建时 EXTERNALS 外置），不打包、不 CDN、不自装；
//   · 不 require 任何 @deepseek-ai/dsh-client-* 包；样式只用 currentColor（零主题
//     token 依赖，避免引用不存在的 --dsw-alias-*）；
//   · 资源（事件订阅）在 ctx.effect 里注册并返回清理函数。
//
// 诚实边界：region / searchKeyEnv 是非 volatile 配置，client 读不到自定义变量名，
// 密钥行只查两个默认名，且只能看到「设置页托管」那一半（.env 环境层的值客户端不可见）。

import { useEffect, useReducer } from 'react'

/** 本包 npm 名（插件页 subject.pkg.name 匹配用）。 */
export const PLUGIN_PACKAGE = '@dreamariner/dsh-web-search-minimax'

/** provider 在 web 行里的 id（与 host 半边 PROVIDER_ID 一致）。 */
export const PROVIDER_ID = 'minimax'

/** 默认密钥变量名（region 派生的两个可能值；自定义 searchKeyEnv 时 client 不可见）。 */
const DEFAULT_KEY_ENVS = ['MINIMAX_CN_API_KEY', 'MINIMAX_GLOBAL_API_KEY']

/** 面板状态。 */
export type Status =
  | { kind: 'loading' }
  | { kind: 'serving' }
  | { kind: 'superseded'; effective: string }
  | { kind: 'auto' }
  | { kind: 'not-registered' }
  | { kind: 'unknown' }

/** section 一行状态（纯数据，测试面；JSX 由 Row 渲染）。 */
export interface SectionRow {
  name: string
  value: string
  ok?: boolean
}

/** 插件页 subject 过滤：只在本插件的 bundle 详情页渲染（纯函数，测试面）。 */
export function isOurBundlePage(subject: unknown): boolean {
  const s = subject as { kind?: string; pkg?: { name?: string } } | undefined
  return s?.kind === 'bundle' && s?.pkg?.name === PLUGIN_PACKAGE
}

/**
 * badge 文案映射（纯函数，测试面）。
 *
 * ⚠ 文案只说**事实**，不说**结论**。badge 的判据只有 `searchProvider === 'minimax'`，
 * 它答得了「配置有没有把搜索指到本插件」，答不了「密钥能不能解析」（那是 host 侧
 * `ready?()` 的判断，客户端拿不到：`WebProviderInfo` 只投影 id / title / description）。
 * 所以这里用「已接管搜索」而不是「搜索生效中」：后者是结论，密钥缺失时并不成立，
 * 用户会看着「生效中」却找不到 web_search 工具（2026-11-26 审查确认的口径不一致）。
 * 真实可用性看插件日志的「生效自检」行与 `pnpm dsh:probe`。
 */
export function badgeText(status: Status): string {
  switch (status.kind) {
    case 'serving':
      return '已接管搜索'
    case 'superseded':
    case 'auto':
      return '未接管搜索'
    case 'not-registered':
      return 'provider 未注册'
    default:
      return '状态未知'
  }
}

/**
 * 从 settings describe 的 namespaces 里取 web 条目的 searchProvider 生效值。
 * 与 host 半边 judgeEffectiveness 同口径：识别 web 条目看 value 键（searchProvider /
 * fetchProvider）或 schema 声明（settings 的 projectForm 会整体省略未设值的键，自动
 * 模式下 value 只剩 fetchProvider），不写死条目 id。
 */
export function readEffective(namespaces: unknown): { hit: boolean; effective: string | undefined } {
  const rows = Array.isArray(namespaces) ? namespaces : []
  const valueMentions = (o: unknown): boolean =>
    o !== null && typeof o === 'object'
    && ('searchProvider' in (o as object) || 'fetchProvider' in (o as object))
  const schemaMentions = (schema: unknown): boolean =>
    schema !== null && typeof schema === 'object' && JSON.stringify(schema).includes('"searchProvider"')
  for (const row of rows) {
    const r = row as { value?: unknown; schema?: unknown } | undefined
    if (!valueMentions(r?.value) && !schemaMentions(r?.schema)) continue
    return { hit: true, effective: (r?.value as { searchProvider?: string } | undefined)?.searchProvider }
  }
  return { hit: false, effective: undefined }
}

/** section 内容（纯函数，测试面）：三行状态 + 未生效时的切换指引 + 已接管时的边界说明。 */
export function sectionContent(snapshot: Snapshot): { rows: SectionRow[]; hint: string | undefined; note: string | undefined } {
  const s = snapshot.status
  const serving = s.kind === 'serving'
  const effectiveText = s.kind === 'serving'
    ? 'minimax（本插件）'
    : s.kind === 'superseded' ? s.effective
    : s.kind === 'auto' ? '未配置（自动模式：rc.5 起内置 provider 按模型路由接管）'
    : s.kind === 'loading' ? '读取中…'
    : '无法读取'
  // 密钥行三态（ok 标记）：
  //   true      = 默认变量名之一在设置页托管存储里有值（✓）
  //   undefined = 不可判定：默认名都未托管，但用户可能用了自定义 searchKeyEnv
  //              （非 volatile，client 读不到）或把值放在 .env 环境层（远程面不暴露）
  //   不给 ✗：「都没查到」不等于「没配」，✗ 会把人引向「密钥缺失」的错误结论
  const keyText = snapshot.keyConfigured === true
    ? `已配置（${snapshot.keyEnv ?? ''}）`
    : '未在设置页托管默认变量名（自定义 searchKeyEnv 或 .env 里的值客户端不可见，不代表密钥缺失）'
  const rows: SectionRow[] = [
    { name: 'provider 注册', value: snapshot.registered ? PROVIDER_ID : (snapshot.status.kind === 'unknown' ? '无法确认' : '未注册'), ok: snapshot.registered ? true : undefined },
    { name: '当前网页搜索提供方', value: effectiveText, ok: serving },
    { name: '密钥（设置页托管）', value: keyText, ok: snapshot.keyConfigured },
  ]
  const hint = !serving && s.kind !== 'loading' && s.kind !== 'unknown'
    ? '到 插件页 → 内置插件配置 → 网页搜索与获取，把「网页搜索提供方」切回 MiniMax'
    : undefined
  // 已接管时补一句边界说明：本面板证明的是「配置已指向本插件」，密钥是否真的能解析
  // 由 host 侧 ready?() 判定，客户端看不到（见 badgeText 注释）。给出可查的地方，
  // 避免用户把「已接管」误读成「一定可用」。
  const note = serving
    ? '密钥真实可用性以 host 判定为准（决定 web_search 是否出现在模型面前）：看插件日志的「生效自检」行，或运行 pnpm dsh:probe'
    : undefined
  return { rows, hint, note }
}

/** 一轮读取的聚合结果（section 的三行状态）。 */
export interface Snapshot {
  status: Status
  /** provider 是否已注册（listProviders 里有 minimax）。 */
  registered: boolean
  /** 读取失败时的诊断信息（仅失败态渲染在面板上，正常态无值）。 */
  debug?: string
  /** 设置页托管密钥的查询结论：undefined = 尚未查询 / 无法查询。 */
  keyConfigured?: boolean
  /** 命中的密钥变量名（keyConfigured 为 true 时有意义）。 */
  keyEnv?: string
}

/** controller 的依赖面（窄化：只声明用到的东西，测试易 mock）。 */
interface ControllerDeps {
  /** 数据面：宿主聚合 remote（web / settings / credentials 命名空间，来自 inject 的 scoped）。 */
  remote?: {
    web?: { listProviders: () => Promise<any> }
    settings?: { describe: () => Promise<any> }
    credentials?: { describe: (names: readonly string[]) => Promise<any> }
  }
  /** 事件面：$on 所在的聚合对象（外层 ctx.remote；scoped 的 narrow face 没有它）。 */
  events?: {
    $on?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | void
  }
  /** cordis 事件（connection/reset 等非转发事件走普通 ctx.on）。 */
  on?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | void
}

function createController(deps: ControllerDeps) {
  let snapshot: Snapshot = { status: { kind: 'loading' }, registered: false }
  const listeners = new Set<() => void>()
  // 读序号：一轮 read() 由多个 await 组成（三个 remote 各一次），期间同一 controller
  // 可能被事件再触发一轮。旧轮晚回来若照样 publish，就会用过期答案盖掉新状态，
  // 面板停在错值直到下一个事件（2026-11-26 实测：连发两次 document-updated，
  // 慢的那次回来后把 superseded 盖回 serving）。每次 read 领号，只有最新号可发布。
  // 与上游官方卡片同款（ui-settings-web-search 的 providerReadSequence）。
  let readSequence = 0
  const publish = (seq: number, next: Snapshot): void => {
    if (seq !== readSequence) return   // 已有更新的读发起过，本轮作废
    snapshot = next
    for (const l of [...listeners]) l()
  }

  const read = async (): Promise<void> => {
    const seq = ++readSequence
    try {
      // listProviders 不可用（命名空间没挂全 / remote 面 unexpected）按 unknown 处理，
      // 别把环境问题误判成「未注册」
      if (typeof deps.remote?.web?.listProviders !== 'function') {
        const keys = deps.remote && typeof deps.remote === 'object' ? Object.keys(deps.remote).join(',') : String(deps.remote)
        publish(seq, { status: { kind: 'unknown' }, registered: false,
          debug: `guard: remote=${typeof deps.remote} keys=[${keys}] web=${typeof deps.remote?.web} list=${typeof deps.remote?.web?.listProviders}` })
        return
      }
      // typert remote 客户端返回信封 { ok, value }（官方卡片 response.ok / response.value
      // 同款）：ok 通过才取 value，否则按读取失败处理，别拿信封当载荷
      const listResponse = await deps.remote.web.listProviders() as { ok?: boolean; value?: any; error?: unknown } | undefined
      // 读失败 ≠ 未注册：ok 为假时答案是「不知道」，不能推进成 not-registered
      // （否则网络抖动 / 网关错误会让 badge 显示「provider 未注册」，把人引向查安装）
      if (listResponse?.ok !== true) {
        publish(seq, { status: { kind: 'unknown' }, registered: false, debug: `listProviders failed: ${JSON.stringify(listResponse?.error ?? null)}` })
        return
      }
      const registered = (listResponse.value?.search ?? []).some((p: any) => p?.id === PROVIDER_ID)
      if (!registered) { publish(seq, { status: { kind: 'not-registered' }, registered: false }); return }
      // 生效值：settings 不可读不算失败，按 unknown 呈现（与「注册了但读不到配置」区分开）
      let effective: { hit: boolean; effective: string | undefined } = { hit: false, effective: undefined }
      try {
        const descResponse = await deps.remote?.settings?.describe() as { ok?: boolean; value?: any } | undefined
        const desc = descResponse?.ok === true ? descResponse.value : undefined
        effective = readEffective(desc?.namespaces)
      } catch { /* 保持 miss */ }
      const status: Status = !effective.hit
        ? { kind: 'unknown' }
        : effective.effective === PROVIDER_ID
          ? { kind: 'serving' }
          : effective.effective === undefined || effective.effective === ''
            ? { kind: 'auto' }
            : { kind: 'superseded', effective: effective.effective }
      // 设置页托管密钥（尽力而为）：只查默认名；自定义 searchKeyEnv 与 .env 环境层的值都不可见
      let keyConfigured: boolean | undefined
      let keyEnv: string | undefined
      try {
        const cred = await deps.remote?.credentials?.describe(DEFAULT_KEY_ENVS)
        if (cred?.ok && cred.value !== null && typeof cred.value === 'object') {
          const hitName = DEFAULT_KEY_ENVS.find((n) => (cred.value as Record<string, any>)[n]?.configured === true)
          if (hitName !== undefined) { keyConfigured = true; keyEnv = hitName }
          // 两个默认名都未配置时不能断言「缺失」：用户可能配了自定义 searchKeyEnv
          // （非 volatile 配置，client 读不到），也可能把值放在 .env 环境层。
          // 所以这里是「不可判定」，不是 false（false 会渲染成 ✗，误导成密钥缺失）。
          else keyConfigured = undefined
        }
      } catch { keyConfigured = undefined }
      publish(seq, { status, registered: true, keyConfigured, keyEnv })
    } catch {
      publish(seq, { status: { kind: 'unknown' }, registered: false })
    }
  }

  return {
    get snapshot(): Snapshot { return snapshot },
    subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } },
    /** 手动触发一轮读取（组件挂载时重读一次，兜住「挂载早于首轮读取完成」的渲染）。 */
    refresh(): void { void read() },
    /**
     * 事件订阅；返回清理函数（ctx.effect 的资源纪律）。
     *
     * 没有轮询，也不需要：读链的每个前置条件都由结构性保证覆盖，不是时间问题。
     *   · 三个 remote 命名空间齐备：apply() 的 ctx.inject(['remote.web', 'remote.settings',
     *     'remote.credentials']) 就绪门（命名空间异步挂载，读早了 $mount 未完成）；
     *   · 凭据服务的数据已就绪：cordis 的 ctx.get 默认 strict，过滤非 ACTIVE fiber
     *     （vendor/cordis/src/reflect.ts 的 _getImpl），而 credentials-local 的 init
     *     生成器先 await loadInitial() 才走到结束；boot 又 await ctx.get('loader').await()
     *     等全部 entry 落定（packages/boot/app-boot/src/index.ts）才返回，客户端连接
     *     发生在 webServer listen 之后。即首次 read() 时 describe() 必返回确定结论。
     * 之后的状态变化由下面四个事件覆盖，无需定时重读。
     */
    start(): () => void {
      void read()
      const disposers = [
        // provider 注册 / 注销（含插件装卸、profile 重算）
        deps.events?.$on?.('web/providers-changed', () => { void read() }),
        // 设置页切提供方、web 行 overlay 变更
        deps.events?.$on?.('settings/document-updated', () => { void read() }),
        // 设置页（Models 页）填 / 清 key。api-remotes 的 remote-events 把
        // credentials/reference-updated 标为 emit，客户端可订阅；这是「密钥写入」
        // 唯一会发出的信号（凭据值不属于任何 settings namespace，不会触发上面那条）。
        deps.events?.$on?.('credentials/reference-updated', () => { void read() }),
        // 客户端重连：换了一个 Host，三面都要重读。
        deps.on?.('connection/reset', () => { void read() }),
      ]
      return () => { for (const d of disposers) if (typeof d === 'function') d() }
    },
  }
}

/** 订阅式快照 hook：控制器 publish 时强制重渲染。 */
function useLive(controller: { snapshot: Snapshot; subscribe: (l: () => void) => () => void }): Snapshot {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => controller.subscribe(force), [controller])
  return controller.snapshot
}

/** 一行状态：名 + 值（✓ / ✗ / 文本）。 */
function Row(props: SectionRow): React.ReactElement {
  const mark = props.ok === undefined ? '' : props.ok ? ' ✓' : ' ✗'
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.7 }}>
      <span style={{ opacity: 0.65, flex: '0 0 auto' }}>{props.name}</span>
      <span style={{ flex: 1 }}>{props.value}{mark}</span>
    </div>
  )
}

const badgeStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid currentColor',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
}

function StatusBadge(props: any): React.ReactElement | null {
  const snapshot = useLive(props.controller)
  // 挂载即重读一次：详情页可能在 controller 首轮读取完成前就渲染了（快照还是 loading），
  // 这里补一轮拿到当前值。不是轮询，只跑一次。
  useEffect(() => { props.controller?.refresh?.() }, [props.controller])
  if (!isOurBundlePage(props?.subject)) return null
  return <span style={badgeStyle}>{badgeText(snapshot.status)}</span>
}

function StatusSection(props: any): React.ReactElement | null {
  const snapshot = useLive(props.controller)
  useEffect(() => { props.controller?.refresh?.() }, [props.controller])
  if (!isOurBundlePage(props?.subject)) return null
  const { rows, hint, note } = sectionContent(snapshot)
  return (
    <section aria-label="MiniMax 搜索状态"
      style={{ border: '1px solid currentColor', borderRadius: 8, opacity: 0.92, padding: '10px 14px', margin: '10px 0' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>MiniMax 搜索状态</div>
      {rows.map((row) => <Row key={row.name} {...row} />)}
      {snapshot.debug !== undefined && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6, wordBreak: 'break-all' }}>debug: {snapshot.debug}</div>
      )}
      {note !== undefined && <div style={{ fontSize: 12, lineHeight: 1.7, marginTop: 6, opacity: 0.75 }}>{note}</div>}
      {hint !== undefined && <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>未生效：{hint}</div>}
    </section>
  )
}

/** ModuleLoader 级注入面：slots（槽位注册）+ remote（宿主聚合 remote 命名空间）。 */
export const inject = ['slots', 'remote']

export function apply(rawCtx: unknown): void {
  const ctx = rawCtx as any
  const { slots, remote } = ctx ?? {}
  if (slots === undefined) throw new Error(`[${PLUGIN_PACKAGE}] ctx.slots 不可用：inject 白名单与宿主实际提供不一致`)
  if (remote === undefined) throw new Error(`[${PLUGIN_PACKAGE}] ctx.remote 不可用：inject 白名单与宿主实际提供不一致`)

  // 等 web / settings / credentials 三个命名空间就绪再注册槽位（就绪门，dsh-image-design
  // 同款）；精简组合缺其中之一时回调不触发，面板不出现（不报错、不影响 host 半边）。
  // 两轮实测定下的取面：**数据走 scoped.remote**（narrow face，listProviders / describe
  // 可用），**事件走外层 ctx.remote**（$on 只在聚合对象上，scoped 没有它；上一版把事件
  // 也挂 scoped 结果 providers-changed 收不到，badge 停在启动窗口的旧快照）。
  ctx.inject(['remote.web', 'remote.settings', 'remote.credentials'], (scoped: any) => {
    const controller = createController({
      remote: scoped?.remote ?? ctx.remote,
      events: scoped?.remote?.$on !== undefined ? scoped.remote : ctx.remote,
      on: ctx.on,
    })
    ctx.effect(() => controller.start(), `${PLUGIN_PACKAGE}: status controller`)
    slots.inject('plugins.detail.badge', () => slots.register(
      { name: 'plugins.detail.badge', id: 'web-search-minimax-badge', inject: () => ({ controller }) },
      StatusBadge,
    ))
    slots.inject('plugins.detail.section', () => slots.register(
      { name: 'plugins.detail.section', id: 'web-search-minimax-section', inject: () => ({ controller }) },
      StatusSection,
    ))
  })
}
