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
  it('serving → 已接管搜索（不是「生效中」：密钥可用性客户端看不到）；superseded / auto → 未接管搜索', () => {
    expect(badgeText(serving.status)).toBe('已接管搜索')
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
  it('serving：三行全 ✓，无指引，但有「可用性以 host 判定为准」的边界说明', () => {
    const { rows, hint, note } = sectionContent(serving)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.ok === true)).toBe(true)
    expect(rows[1].value).toBe('minimax（本插件）')
    expect(rows[2].value).toContain('MINIMAX_CN_API_KEY')
    expect(hint).toBeUndefined()
    // badge 只说「已接管」，密钥真实可用性归 host 的 ready?()；这里必须给出可查的地方
    expect(note).toContain('dsh:probe')
  })
  it('superseded：当前提供方带出对方名字，指引带精确设置页路径，无可用性说明', () => {
    const { rows, hint, note } = sectionContent(superseded)
    expect(note).toBeUndefined()
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
  it('密钥不可判定时如实呈现（不代表缺失，也不给 ✗）', () => {
    // 语义（2026-11-26）：默认变量名都没在托管存储里查到 -> undefined（不可判定），
    // 不再是 false。因为用户可能配了自定义 searchKeyEnv（非 volatile，client 读不到）
    // 或把值放在 .env 环境层（远程面不暴露）。false 会渲染成 ✗，误导成「密钥缺失」。
    const { rows } = sectionContent({ status: { kind: 'serving' }, registered: true })
    expect(rows[2]?.value).toContain('客户端不可见')
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

  it('首轮读取：serving 快照带托管密钥结论（事件订阅已挂四项）', async () => {
    const { registered, remoteEvents, ctxEvents, settle } = mountClient(okRemotes())
    await settle()
    const controller = registered[0].inject().controller
    expect(controller.snapshot.status.kind).toBe('serving')
    expect(controller.snapshot.keyConfigured).toBe(true)
    // credentials/reference-updated：设置页填/清 key 后当场刷新
    expect(Object.keys(remoteEvents).sort()).toEqual(
      ['credentials/reference-updated', 'settings/document-updated', 'web/providers-changed'],
    )
    expect(ctxEvents['connection/reset']).toHaveLength(1)
  })

  it('没有定时器：start() 只挂事件、不做轮询', async () => {
    // 轮询曾被用来「等凭据服务就绪」，但那个窗口不存在：
    //   · cordis 的 ctx.get 默认 strict，过滤非 ACTIVE fiber；credentials-local 的 init
    //     生成器先 await loadInitial()，所以拿到句柄时数据已就绪；
    //   · boot 在返回前 await loader.await() 等全部 entry 落定；客户端连接发生在
    //     webServer listen 之后；
    //   · 三个 remote 命名空间的挂载竞态由 apply() 的 ctx.inject 就绪门覆盖。
    // 状态变化全部由事件驱动，定时重读只是噪音（还会在卸载后继续跑）。
    const spy = vi.spyOn(globalThis, 'setInterval')
    try {
      const { registered, effectCleanups } = mountClient(okRemotes())
      expect(registered.length).toBeGreaterThan(0)
      expect(spy).not.toHaveBeenCalled()
      // 清理函数能正常退订（资源纪律不受影响）
      for (const d of effectCleanups) d()
    } finally {
      spy.mockRestore()
    }
  })

  it('凭据变更事件触发重读：设置页填 key 后面板当场刷新', async () => {
    const remotes = okRemotes()
    // 首轮：默认名都未托管 -> 不可判定（undefined，不是 false）
    remotes.credentials.describe = vi.fn(async () => ({ ok: true, value: { MINIMAX_CN_API_KEY: { configured: false } } }))
    const { registered, remoteEvents, settle } = mountClient(remotes)
    await settle()
    const controller = registered[0].inject().controller
    expect(controller.snapshot.keyConfigured).toBeUndefined()
    remotes.credentials.describe = vi.fn(async () => ({ ok: true, value: { MINIMAX_CN_API_KEY: { configured: true } } }))
    for (const cb of remoteEvents['credentials/reference-updated']) cb()
    await settle()
    expect(controller.snapshot.keyConfigured).toBe(true)
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
    expect(sectionContent(snapshot).rows[2].value).toContain('客户端不可见')
  })

  it('读失败不误报「未注册」：listProviders 返回 ok:false → unknown，不是 not-registered', async () => {
    // 回归 2026-11-26：旧实现把 ok:false 当成「列表为空」，于是算 registered=false，
    // badge 显示「provider 未注册」。一次网络抖动 / 网关错误就会把人引去查安装。
    const remotes: any = okRemotes()
    remotes.web.listProviders = vi.fn(async () => ({ ok: false, error: { code: 'gateway/internal' } }))
    const { registered, settle } = mountClient(remotes)
    await settle()
    const snapshot = registered[0].inject().controller.snapshot
    expect(snapshot.status.kind).toBe('unknown')
    expect(snapshot.registered).toBe(false)
    // provider 注册行不给 ✗（无法确认 ≠ 未注册）
    expect(sectionContent(snapshot).rows[0].value).toBe('无法确认')
    expect(sectionContent(snapshot).rows[0].ok).toBeUndefined()
  })

  it('并发读乱序：旧轮的慢响应不得覆盖新一轮的状态', async () => {
    // 回归 2026-11-26：read() 跨多个 await，期间可被事件再触发一轮。没有序列号时
    // 慢的旧轮晚回来会用过期答案覆盖新状态（实测把 superseded 盖回 serving）。
    const remotes = okRemotes()
    let call = 0
    remotes.settings.describe = vi.fn(async () => {
      const n = ++call
      // 第一轮慢：答案是 minimax（serving）；第二轮快：答案是 deepseek-official
      if (n === 1) {
        await new Promise((r) => setTimeout(r, 60))
        return { ok: true, value: { namespaces: [{ ns: 'web', value: { searchProvider: 'minimax' } }] } }
      }
      return { ok: true, value: { namespaces: [{ ns: 'web', value: { searchProvider: 'deepseek-official' } }] } }
    })
    const { registered, remoteEvents, settle } = mountClient(remotes)
    await new Promise((r) => setTimeout(r, 5))
    // 此时第一轮还在飞；触发事件开启第二轮
    for (const cb of remoteEvents['settings/document-updated'] ?? []) cb()
    await new Promise((r) => setTimeout(r, 150))
    await settle()
    const controller = registered[0].inject().controller
    // 最终必须是第二轮（最新）的答案
    expect(controller.snapshot.status).toEqual({ kind: 'superseded', effective: 'deepseek-official' })
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
