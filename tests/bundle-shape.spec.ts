// dsh-web-search-minimax :: bundle 形态自守护栏
//
// 本包是「一包既是 bundle 又是 plugin」的自挂载形态（官方 decoration 模板同款）。
// 这类包最容易犯的两类错**都不报错**、只是插件静默消失：
//   ① 装载断链：cordis.patch.yml 在，但 manifest 漏了 `dsh.bundle` 声明
//      → profile 的 bundles 列表里没有它 → 那份 patch 永远不被读 → 插件不加载；
//   ② 分发缺文件：patch 没进 `files` 白名单 → npm 包里没有它 → 装完 bundle 是空的。
// 本护栏把这两类错（外加 web 行归属）变成静态可检。
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 单包布局：本 spec 在仓根 vitest 下跑（cwd = 仓根），本包即仓根
const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NAME = '@dreamariner/dsh-web-search-minimax'
const ROW_ID = 'dsh-web-search-minimax'

describe('bundle 形态自守', () => {
  it('manifest 声明 dsh.bundle 指向本包 patch（漏声明 = 装载断链，插件静默消失）', () => {
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(existsSync(join(ROOT, 'cordis.patch.yml'))).toBe(true)
  })

  it('patch 与运行时文件都在 files 白名单里（漏了 = npm 包里没有，装完是空壳）', () => {
    for (const f of ['cordis.patch.yml', 'lib']) {
      expect(pkg.files, `files 白名单必须收录 ${f}`).toContain(f)
    }
  })

  it('自挂载行存在且挂的是本包（- insert: 新增；行 id/name 与包名一致）', () => {
    const text = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    const insertBlock = text.slice(text.indexOf('- insert:'))
    expect(insertBlock).toMatch(new RegExp(`- id: ${ROW_ID}\\s*$`, 'm'))
    expect(insertBlock).toMatch(new RegExp(`name: ["']?${NAME}`))
    // 顶层（顶格）不得出现本插件的行：那是「给已存在行打补丁」的写法，对本行是静默空操作
    expect(text).not.toMatch(new RegExp(`^- id: ${ROW_ID}\\s*$`, 'm'))
  })

  it('web 行住在本包且两个字段写全（整块替换不深合并，漏一个抹一个）', () => {
    // searchProvider 归属跟着本插件走；fetchProvider 必须一起写全，否则 base 的值被抹掉
    const text = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
    expect(text).toMatch(/^- id: web[\s\S]*?searchProvider:\s*minimax/m)
    expect(text).toMatch(/^- id: web[\s\S]*?fetchProvider:\s*http/m)
  })

  it('engines.dsh 声明了支持的 DSH 版本范围', () => {
    expect(pkg.engines?.dsh).toMatch(/^>=/)
  })
})
