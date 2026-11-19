// dsh-web-search-minimax :: 浏览器半边入口（decoration client，单包形态）
//
// 职责：在插件管理页的本插件详情页上显示「当前是否正在使用 MiniMax 搜索」：
//   · badge（plugins.detail.badge）：标题旁一枚标签，一眼可见（搜索生效中 / 未接管搜索）；
//   · section（plugins.detail.section）：详情页下方三行状态（provider 注册 / 当前生效
//     提供方 / 设置页托管密钥）与未生效时的切换指引。
// 数据全部来自宿主现成 remote（web/listProviders、settings/describe、credentials/
// describe），不做自有 wire 契约；实时刷新靠 web/providers-changed、
// settings/document-updated、connection/reset 三个事件。
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

/** badge 文案映射（纯函数，测试面）。 */
export function badgeText(status: Status): string {
  switch (status.kind) {
    case 'serving':
      return '搜索生效中'
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

/** section 内容（纯函数，测试面）：三行状态 + 未生效时的切换指引。 */
export function sectionContent(snapshot: Snapshot): { rows: SectionRow[]; hint: string | undefined } {
  const s = snapshot.status
  const serving = s.kind === 'serving'
  const effectiveText = s.kind === 'serving'
    ? 'minimax（本插件）'
    : s.kind === 'superseded' ? s.effective
    : s.kind === 'auto' ? '未配置（自动模式：rc.5 起内置 provider 按模型路由接管）'
    : s.kind === 'loading' ? '读取中…'
    : '无法读取'
  const keyText = snapshot.keyConfigured === undefined
    ? '无法查询（设置页托管存储客户端不可达）'
    : snapshot.keyConfigured
      ? `已配置（${snapshot.keyEnv ?? ''}）`
      : '未在设置页托管（.env / 环境变量里的值客户端不可见，不代表密钥缺失）'
  const rows: SectionRow[] = [
    { name: 'provider 注册', value: snapshot.registered ? PROVIDER_ID : '未注册', ok: snapshot.registered },
    { name: '当前网页搜索提供方', value: effectiveText, ok: serving },
    // 密钥行 ok 三态：true = 已配置；undefined = 不可查询（unknown 不给 ✗，别误导成缺失）；
    // false = 确认未在设置页托管（✗ 是合理信号，.env 兜底仍可能可用）
    { name: '密钥（设置页托管）', value: keyText, ok: snapshot.keyConfigured === undefined ? undefined : snapshot.keyConfigured },
  ]
  const hint = !serving && s.kind !== 'loading' && s.kind !== 'unknown'
    ? '到 插件页 → 内置插件配置 → 网页搜索与获取，把「网页搜索提供方」切回 MiniMax'
    : undefined
  return { rows, hint }
}

/** 一轮读取的聚合结果（section 的三行状态）。 */
export interface Snapshot {
  status: Status
  /** provider 是否已注册（listProviders 里有 minimax）。 */
  registered: boolean
  /** 设置页托管密钥的查询结论：undefined = 尚未查询 / 无法查询。 */
  keyConfigured?: boolean
  /** 命中的密钥变量名（keyConfigured 为 true 时有意义）。 */
  keyEnv?: string
}

/** controller 的依赖面（窄化：只声明用到的东西，测试易 mock）。 */
interface ControllerDeps {
  /** 宿主聚合 remote（web / settings / credentials 命名空间 + $on 事件面）。 */
  remote?: {
    web?: { listProviders: () => Promise<any> }
    settings?: { describe: () => Promise<any> }
    credentials?: { describe: (names: readonly string[]) => Promise<any> }
    $on?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | void
  }
  /** cordis 事件（connection/reset 等非转发事件走普通 ctx.on）。 */
  on?: (event: string, cb: (...args: unknown[]) => void) => (() => void) | void
}

function createController(deps: ControllerDeps) {
  let snapshot: Snapshot = { status: { kind: 'loading' }, registered: false }
  const listeners = new Set<() => void>()
  const publish = (next: Snapshot): void => {
    snapshot = next
    for (const l of [...listeners]) l()
  }

  const read = async (): Promise<void> => {
    try {
      const list = await deps.remote?.web?.listProviders()
      const registered = (list?.search ?? []).some((p: any) => p?.id === PROVIDER_ID)
      if (!registered) { publish({ status: { kind: 'not-registered' }, registered: false }); return }
      // 生效值：settings 不可读不算失败，按 unknown 呈现（与「注册了但读不到配置」区分开）
      let effective: { hit: boolean; effective: string | undefined } = { hit: false, effective: undefined }
      try {
        const desc = await deps.remote?.settings?.describe()
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
          else keyConfigured = false
        }
      } catch { keyConfigured = undefined }
      publish({ status, registered: true, keyConfigured, keyEnv })
    } catch {
      publish({ status: { kind: 'unknown' }, registered: false })
    }
  }

  return {
    get snapshot(): Snapshot { return snapshot },
    subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l) } },
    /** 事件订阅；返回清理函数（ctx.effect 的资源纪律）。 */
    start(): () => void {
      void read()
      const disposers = [
        deps.remote?.$on?.('web/providers-changed', () => { void read() }),
        deps.remote?.$on?.('settings/document-updated', () => { void read() }),
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
  if (!isOurBundlePage(props?.subject)) return null
  return <span style={badgeStyle}>{badgeText(snapshot.status)}</span>
}

function StatusSection(props: any): React.ReactElement | null {
  const snapshot = useLive(props.controller)
  if (!isOurBundlePage(props?.subject)) return null
  const { rows, hint } = sectionContent(snapshot)
  return (
    <section aria-label="MiniMax 搜索状态"
      style={{ border: '1px solid currentColor', borderRadius: 8, opacity: 0.92, padding: '10px 14px', margin: '10px 0' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>MiniMax 搜索状态</div>
      {rows.map((row) => <Row key={row.name} {...row} />)}
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

  // 等 web / settings / credentials 三个命名空间就绪再注册槽位（dsh-image-design 同款）；
  // 精简组合缺其中之一时回调不触发，面板不出现（不报错、不影响 host 半边）。
  ctx.inject(['remote.web', 'remote.settings', 'remote.credentials'], (scoped: any) => {
    const controller = createController({ remote: scoped?.remote, on: ctx.on })
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
