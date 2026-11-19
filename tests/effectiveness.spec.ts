// dsh-web-search-minimax :: 生效值自检
//
// 自检回答「本插件现在是不是生效的网页搜索提供方」。数据源是 settings 服务的
// describe()（volatile 字段实时生效值，条目按 profile entry id 索引）。判定是
// 纯函数（三态 + 一态无法验证）；apply 接线（settings 在位即判 / inject 等就绪 /
// document-updated 重判）在 mock ctx 上验证。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, judgeEffectiveness } from '../src/index.ts'

describe('judgeEffectiveness（纯函数）', () => {
  it('searchProvider = minimax → serving', () => {
    expect(judgeEffectiveness([{ ns: 'web', value: { searchProvider: 'minimax', fetchProvider: 'http' } }]))
      .toEqual({ state: 'serving', provider: 'minimax' })
  })

  it('searchProvider = 其他值 → superseded（带出当前是谁）', () => {
    expect(judgeEffectiveness([{ ns: 'web', value: { searchProvider: 'deepseek-official' } }]))
      .toEqual({ state: 'superseded', provider: 'deepseek-official' })
  })

  it('未设 searchProvider → auto（自动模式）。真实投影里该键被整体省略，value 只剩 fetchProvider', () => {
    // settings 的 projectForm 省略 undefined 键（schema.ts:63），auto 态长这样：
    expect(judgeEffectiveness([{ ns: 'web', value: { fetchProvider: 'http' } }]))
      .toEqual({ state: 'auto', provider: undefined })
    // 防御：键在但空值同样按 auto
    expect(judgeEffectiveness([{ ns: 'web', value: { searchProvider: '' } }]))
      .toEqual({ state: 'auto', provider: undefined })
  })

  it('value 缺键但 schema 声明了 searchProvider → 照样识别为 web 条目', () => {
    expect(judgeEffectiveness([
      { ns: 'web', schema: { type: 'object', dict: { searchProvider: { type: 'string' } } }, value: {} },
    ])).toEqual({ state: 'auto', provider: undefined })
  })

  it('没有带 searchProvider 的条目 → unknown（settings 不在位 / web 未进 settings 视野）', () => {
    expect(judgeEffectiveness([])).toEqual({ state: 'unknown', provider: undefined })
    expect(judgeEffectiveness([{ ns: 'ui-theme', value: { theme: 'dark' } }]))
      .toEqual({ state: 'unknown', provider: undefined })
  })

  it('非数组输入（防御性兜底）→ unknown', () => {
    expect(judgeEffectiveness(undefined)).toEqual({ state: 'unknown', provider: undefined })
    expect(judgeEffectiveness(null)).toEqual({ state: 'unknown', provider: undefined })
  })

  it('不写死条目 id：自定义条目名的 web 行照样命中', () => {
    expect(judgeEffectiveness([{ ns: 'my-web', value: { searchProvider: 'minimax' } }]))
      .toEqual({ state: 'serving', provider: 'minimax' })
  })
})

describe('apply 接线（生效自检 + 变更重判）', () => {
  const logFiles: string[] = []
  const newLogFile = (): string => {
    const lf = join(tmpdir(), `websearch-effect-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
    logFiles.push(lf)
    return lf
  }
  afterEach(() => { for (const f of logFiles) rmSync(f, { force: true }) })

  function mountWith(settings: any, ctxExtra: Record<string, any> = {}) {
    const registered: any[] = []
    const lf = newLogFile()
    const ctx: any = {
      web: { registerSearchProvider: (p: any) => registered.push(p) },
      get: (key: string) => (key === 'credentials' ? undefined : settings),
      on: vi.fn(),
      inject: vi.fn(),
      ...ctxExtra,
    }
    apply(ctx, { logPath: lf })
    return { provider: registered[0], ctx, lf }
  }
  // 日志行格式：`<ISO 时间> [info|warn] <消息>`；保留整行以断言级别
  const logs = (lf: string): string[] => readFileSync(lf, 'utf8').trim().split('\n')

  it('settings 在位且 searchProvider = minimax → info「正在接管搜索」', () => {
    const { lf } = mountWith({ describe: () => [{ ns: 'web', value: { searchProvider: 'minimax' } }] })
    expect(logs(lf).some((l) => l.includes('本插件正在接管搜索'))).toBe(true)
  })

  it('生效值是别的 provider → warn 带当前值与切换路径', () => {
    const { lf } = mountWith({ describe: () => [{ ns: 'web', value: { searchProvider: 'deepseek-official' } }] })
    const warn = logs(lf).find((l) => l.includes('不是本插件'))
    expect(warn).toBeDefined()
    expect(warn).toContain('[warn]')
    expect(warn).toContain('deepseek-official')
    expect(warn).toContain('网页搜索与获取')
  })

  it('生效值为空（自动模式）→ warn 说明 rc.5 路由接管', () => {
    // 真实投影：未设值时 searchProvider 键被省略，value 只剩 fetchProvider
    const { lf } = mountWith({ describe: () => [{ ns: 'web', value: { fetchProvider: 'http' } }] })
    const warn = logs(lf).find((l) => l.includes('自动模式'))
    expect(warn).toBeDefined()
    expect(warn).toContain('[warn]')
    expect(warn).toContain('网页搜索与获取')
  })

  it('describe 抛错 → 降级为一条 info，不炸装载', () => {
    const { lf } = mountWith({ describe: () => { throw new Error('boom') } })
    expect(logs(lf).some((l) => l.includes('settings.describe 抛错'))).toBe(true)
  })

  it('settings 缺位但有 inject → 等服务就绪再判（登记 settings 键），当场不误报', () => {
    const { ctx, lf } = mountWith(undefined)
    expect(ctx.inject).toHaveBeenCalledWith(['settings'], expect.any(Function))
    expect(logs(lf).some((l) => l.includes('生效自检：当前') || l.includes('不是本插件'))).toBe(false)
  })

  it('settings 与 inject 都缺位（精简组合）→ 降级 info，不炸装载', () => {
    const { lf } = mountWith(undefined, { inject: undefined })
    expect(logs(lf).some((l) => l.includes('settings 服务不可用'))).toBe(true)
  })

  it('inject 就绪回调收到 settings（scoped.settings 形态）→ 补判定', () => {
    const { ctx, lf } = mountWith(undefined)
    const cb = ctx.inject.mock.calls[0][1] as (scoped: any) => void
    cb({ settings: { describe: () => [{ ns: 'web', value: { searchProvider: 'minimax' } }] } })
    expect(logs(lf).some((l) => l.includes('本插件正在接管搜索'))).toBe(true)
  })

  it('document-updated 连发被防抖合并：两次触发只多一行重判（读最新值）', async () => {
    const rows = { current: [{ ns: 'web', value: { searchProvider: 'minimax' } }] }
    const settings = { describe: () => rows.current }
    const { ctx, lf } = mountWith(settings)
    const listener = ctx.on.mock.calls.find(([event]: any[]) => event === 'settings/document-updated')?.[1]
    expect(listener).toBeTypeOf('function')
    listener()
    rows.current = [{ ns: 'web', value: { searchProvider: 'deepseek-search-api' } }]
    listener() // 300ms 内连发 → 合并
    await new Promise((r) => setTimeout(r, 420))
    const effect = logs(lf).filter((l) => l.includes('生效自检：'))
    expect(effect.length).toBe(2) // 首判 + 合并后的一次重判（trailing 读最新值）
    expect(effect[1]).toContain('deepseek-search-api')
    expect(effect[1]).toContain('[warn]')
  })
})
