// dsh-web-search-minimax :: client 半边状态面板
//
// 覆盖三层：纯函数（subject 过滤 / badge 文案 / settings 生效值读取 / section 内容）、
// controller（读链与事件重判）、apply 接线（槽位注册与资源纪律）。组件本体带 hooks，
// 不直接调用（hooks 只能在 React 渲染上下文里跑）；展示文案经由 badgeText /
// sectionContent 两个纯函数验证。
import { describe, expect, it, vi } from 'vitest'
import {
  apply,
  badgeText,
  isOurBundlePage,
  PLUGIN_PACKAGE,
  PROVIDER_ID,
  readEffective,
  sectionContent,
  type Snapshot,
} from '../src/client/index.tsx'

const serving: Snapshot = { status: { kind: 'serving' }, registered: true, keyConfigured: true, keyEnv: 'MINIMAX_CN_API_KEY' }
const superseded: Snapshot = { status: { kind: 'superseded', effective: 'deepseek-official' }, registered: true }
const auto: Snapshot = { status: { kind: 'auto' }, registered: true }
const loading: Snapshot = { status: { kind: 'loading' }, registered: false }

describe('isOurBundlePage（subject 过滤）', () => {
  it('本插件的 bundle 详情页 → true', () => {
    expect(isOurBundlePage({ kind: 'bundle', pkg: { name: PLUGIN_PACKAGE } })).toBe(true)
  })
  it('别的插件 / row 视图 / 空 subject → false', () => {
    expect(isOurBundlePage({ kind: 'bundle', pkg: { name: '@other/pkg' } })).toBe(false)
    expect(isOurBundlePage({ kind: 'row', pkg: { name: PLUGIN_PACKAGE }, row: {} })).toBe(false)
    expect(isOurBundlePage(undefined)).toBe(false)
  })
})

describe('badgeText（三态文案）', () => {
  it('serving → 搜索生效中；superseded / auto → 未接管搜索；not-registered / unknown / loading → 对应文案', () => {
    expect(badgeText(serving.status)).toBe('搜索生效中')
    expect(badgeText(superseded.status)).toBe('未接管搜索')
    expect(badgeText(auto.status)).toBe('未接管搜索')
    expect(badgeText({ kind: 'not-registered' })).toBe('provider 未注册')
    expect(badgeText({ kind: 'unknown' })).toBe('状态未知')
    expect(badgeText({ kind: 'loading' })).toBe('状态未知')
  })
})

describe('readEffective（settings describe 投影读取）', () => {
  it('value 带 searchProvider → 命中并取值', () => {
    expect(readEffective([{ ns: 'web', value: { searchProvider: 'minimax', fetchProvider: 'http' } }]))
      .toEqual({ hit: true, effective: 'minimax' })
  })
  it('未设值时键被整体省略（只剩 fetchProvider）→ 命中且 effective undefined（自动模式）', () => {
    expect(readEffective([{ ns: 'web', value: { fetchProvider: 'http' } }]))
      .toEqual({ hit: true, effective: undefined })
  })
  it('value 缺键但 schema 声明 searchProvider → 命中', () => {
    expect(readEffective([{ ns: 'web', schema: { dict: { searchProvider: {} } }, value: {} }]))
      .toEqual({ hit: true, effective: undefined })
  })
  it('无 web 条目 / 非数组 → 未命中', () => {
    expect(readEffective([{ ns: 'ui-theme', value: { theme: 'dark' } }])).toEqual({ hit: false, effective: undefined })
    expect(readEffective(undefined)).toEqual({ hit: false, effective: undefined })
  })
})

describe('sectionContent（三行状态 + 指引）', () => {
  it('serving：三行全 ✓，无指引', () => {
    const { rows, hint } = sectionContent(serving)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.ok === true)).toBe(true)
    expect(rows[1].value).toBe('minimax（本插件）')
    expect(rows[2].value).toContain('MINIMAX_CN_API_KEY')
    expect(hint).toBeUndefined()
  })
  it('superseded：当前提供方带出对方名字，指引带精确设置页路径', () => {
    const { rows, hint } = sectionContent(superseded)
    expect(rows[1]?.value).toBe('deepseek-official')
    expect(rows[1]?.ok).toBe(false)
    expect(hint).toContain('网页搜索与获取')
    expect(hint).toContain('切回 MiniMax')
  })
  it('auto：说明自动模式语义', () => {
    const { rows, hint } = sectionContent(auto)
    expect(rows[1]?.value).toContain('自动模式')
    expect(hint).toContain('网页搜索与获取')
  })
  it('loading / unknown：不给指引（还没判定，别误导）', () => {
    expect(sectionContent(loading).hint).toBeUndefined()
    expect(sectionContent({ status: { kind: 'unknown' }, registered: false }).hint).toBeUndefined()
  })
  it('密钥不可查询时如实呈现（不代表缺失）', () => {
    const { rows } = sectionContent({ status: { kind: 'serving' }, registered: true })
    expect(rows[2]?.value).toContain('无法查询')
    expect(rows[2]?.ok).toBeUndefined()
  })
})

describe('apply 接线（槽位注册 + controller 生命周期）', () => {
  const okRemotes = () => ({
    web: { listProviders: vi.fn(async () => ({ ok: true, value: { search: [{ id: PROVIDER_ID }, { id: 'deepseek-official' }] } })) },
    settings: { describe: vi.fn(async () => ({ ok: true, value: { namespaces: [{ ns: 'web', value: { searchProvider: 'minimax' } }] } })) },
    credentials: { describe: vi.fn(async () => ({ ok: true, value: { MINIMAX_CN_API_KEY: { configured: true } } })) },
  })

  function mountClient(remotes: any) {
    const registered: Array<any> = []
    const effectCleanups: Array<() => void> = []
    const remoteEvents: Record<string, Array<() => void>> = {}
    const ctxEvents: Record<string, Array<() => void>> = {}
    // cordis 语义：scoped.remote 与 ctx.remote 是同一聚合命名空间对象（$on 在其上，
    // 返回的清理函数真退订）
    const remoteWithEvents = {
      ...remotes,
      $on: (event: string, cb: () => void) => {
        ;(remoteEvents[event] ??= []).push(cb)
        return () => { const arr = remoteEvents[event]; const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) }
      },
    }
    const ctx: any = {
      slots: {
        inject: (_owner: string, register: () => void) => { register() },
        register: (def: any, comp: any) => registered.push({ ...def, component: comp }),
      },
      remote: remoteWithEvents,
      on: (event: string, cb: () => void) => {
        ;(ctxEvents[event] ??= []).push(cb)
        return () => { const arr = ctxEvents[event]; const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) }
      },
      inject: (_keys: string[], cb: (scoped: any) => void) => cb({ remote: remoteWithEvents }),
      effect: (fn: () => (() => void) | void) => { const d = fn(); if (typeof d === 'function') effectCleanups.push(d) },
    }
    apply(ctx)
    const settle = () => new Promise((r) => setTimeout(r, 0))
    return { registered, effectCleanups, remoteEvents, ctxEvents, settle }
  }

  it('注册 badge + section 两个槽位，inject 面带 controller', () => {
    const { registered } = mountClient(okRemotes())
    expect(registered.map((r) => r.name).sort()).toEqual(['plugins.detail.badge', 'plugins.detail.section'])
    const badge = registered.find((r) => r.name === 'plugins.detail.badge')
    expect(badge.id).toBe('web-search-minimax-badge')
    expect(typeof badge.inject?.().controller.subscribe).toBe('function')
  })

  it('首轮读取：serving 快照带托管密钥结论（事件订阅已挂三项）', async () => {
    const { registered, remoteEvents, ctxEvents, settle } = mountClient(okRemotes())
    await settle()
    const controller = registered[0].inject().controller
    expect(controller.snapshot.status.kind).toBe('serving')
    expect(controller.snapshot.keyConfigured).toBe(true)
    expect(Object.keys(remoteEvents).sort()).toEqual(['settings/document-updated', 'web/providers-changed'])
    expect(ctxEvents['connection/reset']).toHaveLength(1)
  })

  it('未注册（listProviders 无 minimax）→ not-registered', async () => {
    const remotes = okRemotes()
    remotes.web.listProviders = vi.fn(async () => ({ ok: true, value: { search: [{ id: 'deepseek-official' }] } }))
    const { registered, settle } = mountClient(remotes)
    await settle()
    expect(registered[0].inject().controller.snapshot.status.kind).toBe('not-registered')
  })

  it('document-updated 事件重判：设置页切走后快照变 superseded', async () => {
    const remotes = okRemotes()
    const { registered, remoteEvents, settle } = mountClient(remotes)
    await settle()
    remotes.settings.describe = vi.fn(async () => ({ ok: true, value: { namespaces: [{ ns: 'web', value: { searchProvider: 'deepseek-official' } }] } }))
    for (const cb of remoteEvents['settings/document-updated']) cb()
    await settle()
    const controller = registered[0].inject().controller
    expect(controller.snapshot.status).toEqual({ kind: 'superseded', effective: 'deepseek-official' })
    expect(sectionContent(controller.snapshot).hint).toContain('切回 MiniMax')
  })

  it('settings / credentials 报错不炸面板：生效值 unknown，密钥行降级', async () => {
    const remotes = okRemotes()
    remotes.settings.describe = vi.fn(async () => { throw new Error('boom') })
    remotes.credentials.describe = vi.fn(async () => { throw new Error('boom') })
    const { registered, settle } = mountClient(remotes)
    await settle()
    const snapshot = registered[0].inject().controller.snapshot
    expect(snapshot.status.kind).toBe('unknown')
    expect(snapshot.keyConfigured).toBeUndefined()
    expect(sectionContent(snapshot).rows[2].value).toContain('无法查询')
  })

  it('refresh() 手动重读：设置页切走后组件挂载路径也能自愈旧快照', async () => {
    const remotes = okRemotes()
    const { registered, settle } = mountClient(remotes)
    await settle()
    const controller = registered[0].inject().controller
    expect(controller.snapshot.status.kind).toBe('serving')
    remotes.settings.describe = vi.fn(async () => ({ ok: true, value: { namespaces: [{ ns: 'web', value: { searchProvider: 'deepseek-official' } }] } }))
    controller.refresh()
    await settle()
    expect(controller.snapshot.status.kind).toBe('superseded')
  })

  it('effect 清理函数注销事件订阅（插件卸载资源纪律）', async () => {
    const remotes = okRemotes()
    const { registered, effectCleanups, remoteEvents, settle } = mountClient(remotes)
    await settle()
    const callsBefore = remotes.web.listProviders.mock.calls.length
    effectCleanups[0]?.()
    for (const cb of remoteEvents['web/providers-changed']) cb()
    await settle()
    expect(remotes.web.listProviders.mock.calls.length).toBe(callsBefore)
    expect(registered[0].inject().controller.snapshot.status.kind).toBe('serving')
  })
})
