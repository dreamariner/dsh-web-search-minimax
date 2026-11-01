// dsh-web-search-minimax :: 展示元数据（icon）自守护栏
//
// DSH 的 Plugin Manager / Settings 用 package.json 的顶层 `icon` 字段取图标：
// 相对路径、SVG/PNG/JPEG/WebP、≤256 KiB、realpath 后必须仍在包目录内
// （DSH 的 readPluginMeta → iconOf 就是这套规则，见 dsh-app-boot/lib/index.js）。
//
// 这类错**同样不报错**：
//   ① icon 没进 `files` 白名单 → npm 包里没有它 → 装完插件行退回默认占位图；
//   ② icon 写成绝对路径 / data URL → DSH 直接抛错，把该包标成 meta.error；
//   ③ 图标超 256 KiB 或不是受支持格式 → 同样抛错，整包元数据降级。
//
// 本护栏把这三类错变成静态可检：字段形状 + 白名单 + 真实字节数 + SVG 可解析。
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// workspace 布局：本 spec 在根 vitest 下跑（cwd = 仓根），本包在 packages/<id>/
const ROOT = join(process.cwd(), 'packages', 'dsh-web-search-minimax')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** DSH 的上限：iconOf() 里 MAX_ICON_BYTES = 256 * 1024。 */
const MAX_ICON_BYTES = 256 * 1024

describe('展示元数据 icon 自守', () => {
  it('顶层 icon 字段指向包内相对路径（绝对路径 / data URL 会被 DSH 判错）', () => {
    expect(pkg.icon).toBe('./icon.svg')
    expect(extname(pkg.icon).toLowerCase()).toBe('.svg')
    // DSH 的 iconOf：绝对路径或带 scheme 一律 throw
    expect(pkg.icon.startsWith('/')).toBe(false)
    expect(/^[A-Za-z][A-Za-z\d+.-]*:/.test(pkg.icon)).toBe(false)
  })

  it('icon 文件真实存在且在 files 白名单里（漏白名单 = 发布产物里没有图标）', () => {
    expect(existsSync(join(ROOT, 'icon.svg'))).toBe(true)
    expect(pkg.files, 'files 白名单必须收录 icon.svg').toContain('icon.svg')
  })

  it('图标在 DSH 的体积与格式限制内（≤256 KiB，SVG）', () => {
    const bytes = statSync(join(ROOT, 'icon.svg')).size
    expect(bytes).toBeGreaterThan(0)
    expect(bytes, `icon.svg 超 DSH 的 ${MAX_ICON_BYTES} 字节上限`).toBeLessThanOrEqual(MAX_ICON_BYTES)
  })

  it('SVG 自包含且可解析（无外链资源 / 无 data URL 逃逸出包）', () => {
    const svg = readFileSync(join(ROOT, 'icon.svg'), 'utf8')
    expect(svg.trimStart().startsWith('<svg')).toBe(true)
    expect(svg).toContain('</svg>')
    // 外链资源（http/https/file:）在 data URL 内联渲染时会失效
    expect(svg).not.toMatch(/(?:href|src)\s*=\s*"(?:https?:|file:)/)
    // 纯内联图形：不得嵌 raster base64（体积暴涨且非矢量）
    expect(svg).not.toContain('data:image/png;base64')
  })
})
