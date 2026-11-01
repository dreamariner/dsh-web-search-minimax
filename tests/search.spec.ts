// dsh-web-search-minimax：provider 契约与失败分支
//
// 重点覆盖三类「错了不会报错、只会静默降级」的地方：
//   1. 请求体字段必须是 q（写成 query 会得到 2013 invalid params）
//   2. available() 必须纯本地判断（接口明写不得发网络请求）
//   3. maxResults 只能向下收（MiniMax 硬上限 10 且不支持分页），条数由工具层决定
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { WebError } from '@deepseek-ai/dsh-web'
import { apply, mapSources, resolveKey, PROVIDER_ID, API_HARD_CAP, name } from '../src/index.ts'
import {
  Config,
  effectiveSearchBaseUrl,
  effectiveSearchKeyEnv,
  KNOWN_KEYS,
  defaultLogPath,
  resolveConfig,
} from '../src/config.ts'

// workspace 布局：本 spec 在根 vitest 下跑（cwd = 仓根），本包在 packages/<id>/
const PKG = process.cwd()
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))

/** 捕获 apply 注册的 provider，并提供可控的 fetch。 */
function mount(config: Record<string, unknown> = {}) {
  const registered: any[] = []
  const ctx = { web: { registerSearchProvider: (p: any) => registered.push(p) } }
  apply(ctx, config as any)
  // 被测代码调用的是全局 fetch，用 beforeEach 装的那个 stub（另建 mock 收不到调用）
  return { provider: registered[0], fetchMock: globalThis.fetch as any, ctx }
}

beforeEach(() => {
  process.env.MINIMAX_CN_API_KEY = 'sk-test-key'
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.MINIMAX_CN_API_KEY
})

const okBody = {
  organic: [
    { title: '结果一', link: 'https://a.example/1', snippet: '摘要一', date: '2026-10-01' },
    { title: '结果二', link: 'https://b.example/2', snippet: '摘要二' },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
}
// 必须用 mockImplementation 而不是 mockResolvedValue：Response 的 body 只能读一次，
// 复用同一个对象会让第二次调用的 res.json() 抛「非 JSON」
const respondWith = (body: unknown, status = 200): void => {
  ;(globalThis.fetch as any).mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

describe('provider 契约', () => {
  it('id 与 web 行的 searchProvider 一致', () => {
    const { provider } = mount()
    expect(provider.id).toBe(PROVIDER_ID)
    expect(PROVIDER_ID).toBe('minimax')
  })

  it('available() 是纯本地检查，不发网络请求', () => {
    const { provider, fetchMock } = mount()
    expect(provider.available()).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('缺密钥时 available() 为 false（不抛错，交由 seam 判定）', () => {
    // 用 .env 里不存在的变量名：resolveKey 会回落到读 ~/.dsh/.env，只删进程变量不够
    const { provider } = mount({ searchKeyEnv: 'DSH_NO_SUCH_ENV_FOR_TEST' })
    expect(provider.available()).toBe(false)
  })

  it('ctx.web 不可用时报错（而不是静默不注册）', () => {
    expect(() => apply({} as any, {})).toThrow(/ctx\.web 不可用/)
  })

  // 回归：patch 里留一个空的 `config:` 会被 YAML 解析成 null，而默认参数 `= {}` 只对
  // undefined 生效——真收到 null 时 Object.keys(null) 抛 TypeError，插件静默不装载。
  // cordis 目前恰好把 null 兜成了 {}，但那不是我们该依赖的契约。
  it('config 传 null 也能装载（不依赖 cordis 的 null→{} 兜底）', () => {
    const registered: any[] = []
    expect(() => apply({ web: { registerSearchProvider: (p: any) => registered.push(p) } } as any, null)).not.toThrow()
    expect(registered[0].id).toBe(PROVIDER_ID)
  })

  it('日志如实记录「交付多少 / 工具层会切到多少」，不说谎', async () => {
    // 回归：收尾改动后实际交付 capped（最多 10），但日志仍写「交付 wanted 条」——
    // 日志说谎会把排查引向反方向（当初正是靠这条日志发现 truncated 被吞的问题）。
    const logFile = join(tmpdir(), 'websearch-log-probe.log')
    rmSync(logFile, { force: true })
    const { provider } = mount({ logPath: logFile })
    respondWith({ organic: Array.from({ length: 10 }, (_, i) => ({ link: `https://x/${i}` })) })

    await provider.search({ query: 'x', maxResults: 8 })
    const line = readFileSync(logFile, 'utf8').trim().split('\n').at(-1) ?? ''
    expect(line).toContain('按硬上限交付 10 条')
    expect(line).toContain('会切到 8 条')
    expect(line).toContain('已置 truncated=true')
    expect(line).not.toContain('交付 8 条')
    rmSync(logFile, { force: true })
  })
})

describe('请求构造', () => {
  it('body 字段是 q 而不是 query（回归：写错得到 2013 invalid params）', async () => {
    const { provider, fetchMock } = mount()
    respondWith(okBody)
    await provider.search({ query: '鸡汤做法' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ q: '鸡汤做法' })
    expect(String(init.body)).not.toContain('"query"')
  })

  it('走 Bearer 鉴权与配置的基址，路径是 /v1/coding_plan/search', async () => {
    const { provider, fetchMock } = mount({ searchBaseUrl: 'https://api.minimaxi.com' })
    respondWith(okBody)
    await provider.search({ query: 'x' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.minimaxi.com/v1/coding_plan/search')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-key')
  })

  it('signal 下传给 fetch（支持取消与超时）', async () => {
    const { provider, fetchMock } = mount()
    respondWith(okBody)
    const ac = new AbortController()
    await provider.search({ query: 'x' }, ac.signal)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })
})

describe('结果映射', () => {
  it('organic 逐字段映射到可引用来源', async () => {
    const { provider } = mount()
    respondWith(okBody)
    const r = await provider.search({ query: 'x' })

    expect(r.sources).toHaveLength(2)
    expect(r.sources[0]).toEqual({
      url: 'https://a.example/1', title: '结果一', snippet: '摘要一', publishedAt: '2026-10-01',
    })
    // 缺 date 的条目不带 publishedAt，而不是补空串
    expect(r.sources[1]).toEqual({ url: 'https://b.example/2', title: '结果二', snippet: '摘要二' })
  })

  it('link 为空的条目被丢弃（url 是必填）', () => {
    expect(mapSources([{ title: '无链接' }, { link: '   ' }, { link: 'https://ok.example' }]))
      .toEqual([{ url: 'https://ok.example' }])
  })

  // 截断责任完全在 DSH 的 capSources：provider 只负责「如实交付 + 正确标记 truncated」，
  // 自身只按接口硬上限封顶。因此请求 3 条时交出的仍是全部 10 条（DSH 再切）。
  it('来源条数只按接口硬上限封顶，截断交由 DSH 的 capSources', async () => {
    const many = { organic: Array.from({ length: 10 }, (_, i) => ({ link: `https://x/${i}` })) }
    const { provider } = mount()
    respondWith(many)

    const r = await provider.search({ query: 'x', maxResults: 3 })
    expect(r.sources).toHaveLength(API_HARD_CAP)
    expect(r.truncated).toBe(true)
  })

  // 回归：插件原先按 wanted 预切并写死 truncated: false，于是
  // capSources 的 `length <= maxResults` 提前成立、永远置不了位——单 query 丢掉的结果
  // 被静默吞掉，模型看不到「还有更多」。
  it('来源多于 maxResults 时置 truncated=true（单 query 也生效）', async () => {
    const many = { organic: Array.from({ length: 9 }, (_, i) => ({ link: `https://x/${i}` })) }
    const { provider } = mount()
    respondWith(many)

    const r = await provider.search({ query: 'x', maxResults: 8 })
    expect(r.truncated).toBe(true)
    // 交给 capSources 截：交 9 条、工具层取 8 条
    expect(r.sources).toHaveLength(9)
  })

  it('来源不多于 maxResults 时 truncated=false', async () => {
    const { provider } = mount()
    respondWith(okBody)

    const r = await provider.search({ query: 'x', maxResults: 8 })
    expect(r.truncated).toBe(false)
    expect(r.sources).toHaveLength(2)
  })
})

describe('失败分支（都带机器可读 code）', () => {
  const codeOf = async (p: any, body: unknown, status = 200): Promise<string | undefined> => {
    respondWith(body, status)
    try {
      await p.search({ query: 'x' })
      return undefined
    } catch (e) {
      return (e as any).code
    }
  }

  it('缺密钥', async () => {
    // 注意：不能只删进程环境变量——resolveKey 会回落到读 ~/.dsh/.env，那里确实有
    // MINIMAX_CN_API_KEY。必须换一个 .env 里也不存在的变量名才会真的缺失。
    const { provider } = mount({ searchKeyEnv: 'DSH_NO_SUCH_ENV_FOR_TEST_AT_ALL' })
    expect(await codeOf(provider, okBody)).toBe('MINIMAX_SEARCH_KEY_MISSING')
  })

  it('HTTP 非 2xx', async () => {
    const { provider } = mount()
    expect(await codeOf(provider, {}, 500)).toBe('MINIMAX_SEARCH_HTTP')
  })

  it('base_resp 非 0（业务拒绝）', async () => {
    const { provider } = mount()
    expect(await codeOf(provider, { base_resp: { status_code: 1004, status_msg: 'login fail' } }))
      .toBe('MINIMAX_SEARCH_REJECTED')
  })

  it('organic 为空 —— 报错而非返回空结果（否则模型无从判断搜索是否成功）', async () => {
    const { provider } = mount()
    expect(await codeOf(provider, { organic: [] })).toBe('MINIMAX_SEARCH_EMPTY')
  })

  it('非 JSON 响应', async () => {
    const { provider } = mount()
    ;(globalThis.fetch as any).mockImplementation(async () => new Response('<html>502</html>', { status: 200 }))
    await expect(provider.search({ query: 'x' })).rejects.toThrow(/非 JSON/)
  })

  it('网络异常映射为 TRANSPORT', async () => {
    const { provider } = mount()
    ;(globalThis.fetch as any).mockRejectedValue(new TypeError('fetch failed'))
    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'MINIMAX_SEARCH_TRANSPORT' })
  })
})

// 这组守的是「错误码能不能离开本插件」。工具层取 code 的方式是
// `error instanceof HarnessError ? {name, code} : undefined`（core/tools 的 errorInfo），
// 判的是**类实例身份**，不是字段在不在：抛普通 Error 时 code 字段照样在，但被判型
// 判否，结构化错误元数据里就没有它，模型只看到一句 message。
describe('错误码到达工具层的结构化元数据', () => {
  /** 复刻工具层 core/tools/src/index.ts 的 errorInfo 判定。 */
  const toolErrorInfo = (error: unknown): { name: string; code: string } | undefined =>
    error instanceof HarnessError ? { name: error.name, code: error.code } : undefined

  it('抛出的错误是宿主 HarnessError 实例', async () => {
    const { provider } = mount()
    respondWith({}, 500)
    const error = await provider.search({ query: 'x' }).then(() => undefined, (e: unknown) => e)
    expect(error).toBeInstanceOf(HarnessError)
    // 同时是接缝自己的 WebError（官方 provider 用的也是它）
    expect(error).toBeInstanceOf(WebError)
  })

  it('工具层的 errorInfo 能提取出 code（不再是 undefined）', async () => {
    const { provider } = mount()
    respondWith({}, 500)
    const error = await provider.search({ query: 'x' }).then(() => undefined, (e: unknown) => e)
    expect(toolErrorInfo(error)).toEqual({ name: 'WebError', code: 'MINIMAX_SEARCH_HTTP' })
  })

  it('dsh-web 声明为 peerDependency（宿主供给同一实例，否则判型必失败）', () => {
    // 少了这条，运行期导入解析不到 → 插件静默失效；或解析到第二份 → instanceof 判否
    expect(pkg.peerDependencies).toHaveProperty('@deepseek-ai/dsh-web')
  })
})

describe('配置', () => {
  it('默认值能通过自身校验（回归：step 约束会让加载期就抛错）', () => {
    expect(() => resolveConfig(Config, {}, name)).not.toThrow()
    const c = resolveConfig(Config, {}, name)
    expect(c.region).toBe('cn')
    expect(c.searchBaseUrl).toBe('') // 空串哨兵 = 按 region 派生
    expect(c.searchKeyEnv).toBe('')
    expect(effectiveSearchBaseUrl(c)).toBe('https://api.minimaxi.com')
    expect(effectiveSearchKeyEnv(c)).toBe('MINIMAX_CN_API_KEY')
    expect(Object.keys(c)).not.toContain('searchMaxResults') // 条数归工具层，不在插件侧暴露
  })

  // 回归：searchMaxResults 曾是合法配置键，但被工具层 tool-web 的同名
  // 配置压住——配大不生效、配小才生效。移除后留下它会变成未知键被守卫拦下，避免误以为可调。
  it('已移除的 searchMaxResults 被未知键守卫拦下', () => {
    expect(() => apply({ web: { registerSearchProvider: () => {} } } as any, { searchMaxResults: 10 } as any))
      .toThrow(/未知配置键：searchMaxResults/)
  })

  it('未知键被守卫拦下并报可用键', () => {
    expect(() => apply({ web: { registerSearchProvider: () => {} } } as any, { apiKey: 'x' } as any))
      .toThrow(/未知配置键：apiKey/)
    expect(KNOWN_KEYS).toContain('searchKeyEnv')
  })

  it('region: global → 派生国际版基址与密钥变量名（两区域名和密钥都不通用）', () => {
    const g = resolveConfig(Config, { region: 'global' }, name)
    expect(effectiveSearchBaseUrl(g)).toBe('https://api.minimax.io')
    expect(effectiveSearchKeyEnv(g)).toBe('MINIMAX_GLOBAL_API_KEY')
  })

  it('显式覆盖优先于 region 派生（自部署网关 / 自拟变量名）', () => {
    const o = resolveConfig(Config, { region: 'global', searchBaseUrl: 'https://gw.example', searchKeyEnv: 'MY_KEY' }, name)
    expect(effectiveSearchBaseUrl(o)).toBe('https://gw.example')
    expect(effectiveSearchKeyEnv(o)).toBe('MY_KEY')
  })

  it('非法 region 被配置校验拦下（带路径报错，而不是运行期才炸）', () => {
    expect(() => resolveConfig(Config, { region: 'cn-global' }, name)).toThrow(/region/)
  })

  it('resolveKey 从进程环境取值', () => {
    expect(resolveKey('MINIMAX_CN_API_KEY')).toBe('sk-test-key')
    expect(resolveKey('DSH_不存在的变量')).toBeUndefined()
  })

  // 回归：logPath 一度硬编码 ~/.dsh/logs，而默认表达式在**模块加载时**求值 —— 早于
  // tests/setup.ts 的 beforeAll 设 DSH_HOME，于是整轮测试的日志都写进了真实的
  // 运行时目录。断言用「显式路径被尊重」而非「真实文件 mtime」：后者在实例运行时
  // 无法区分「测试写的」与「真机写的」，天生有歧义。
  it('显式配置的 logPath 被尊重（测试因此能写到临时目录）', () => {
    const sentinel = join(tmpdir(), 'websearch-logpath-probe.log')
    rmSync(sentinel, { force: true })
    mount({ logPath: sentinel })
    expect(existsSync(sentinel)).toBe(true)
    rmSync(sentinel, { force: true })
  })

  it('未显式配置时 logPath 默认惰性派生（不是模块加载时求值）', () => {
    expect(resolveConfig(Config, {}, name).logPath).toBe('')
    expect(defaultLogPath()).toContain(join('logs', 'dsh-web-search-minimax.log'))
    // 默认路径必须跟随 DSH_HOME，否则隔离护栏形同虚设
    expect(defaultLogPath().startsWith(process.env.DSH_HOME ?? '')).toBe(true)
  })
})
