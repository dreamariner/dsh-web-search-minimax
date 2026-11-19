// dsh-web-search-minimax :: client 半边边界禁令
//
// client 跑在宿主渲染进程（浏览器环境，无 Node）：src/client/ 下禁止 import node:
// 内建模块（node:fs 等 host 侧的能力在浏览器里不存在，打了也装载即炸）。
// host 半边不受此限（node:fs 等是 host 的正当依赖）。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const CLIENT_DIR = join(ROOT, 'src', 'client')

function clientSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) clientSources(p, out)
    else if (/\.tsx?$/.test(entry)) out.push(relative(join(ROOT, 'src'), p).split(sep).join('/'))
  }
  return out
}

function existsIn(p: string): boolean {
  try { statSync(p); return true } catch { return false }
}

describe('client 半边边界（浏览器无 Node）', () => {
  it('扫到 client 源码（防止目录挪走后护栏空转成绿）', () => {
    expect(existsIn(CLIENT_DIR)).toBe(true)
    expect(clientSources(CLIENT_DIR).length).toBeGreaterThan(0)
  })

  it('src/client/ 不 import node: 内建模块', () => {
    const offenders = clientSources(CLIENT_DIR)
      .map((f) => ({ f, code: readFileSync(join(ROOT, 'src', f), 'utf8') }))
      .filter(({ code }) => /from\s+['"]node:/.test(code) || /require\(\s*['"]node:/.test(code))
      .map(({ f }) => f)
    expect(offenders, `client 源码 import 了 node: 内建模块（浏览器不可用）：\n${offenders.join('\n')}`).toEqual([])
  })
})
