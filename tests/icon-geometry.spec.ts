// dsh-web-search-minimax :: icon.svg 几何守卫
//
// 这三条形状约束都是踩过坑才写下来的，改图标时必须一起满足：
//
//   ① 字母「M」的路径是**锁死**的：用户明确要求「只调搜索图标，不要动 M 字母」。
//      改形等于推翻需求，所以路径与笔画参数逐字断言。
//   ② 镜柄必须从**镜圈外缘**起笔。若从圆心伸出，镜圈加斜线看起来就是字母 Q 的尾巴，
//      不再是搜索图标（用户原话：不要像个字母 Q）。
//   ③ 放大镜整个外边缘都要有边距。实现方式是 mask 里挖「镜圈圆 ∪ 镜柄胶囊」的并集，
//      两者都按各自笔画向外扩一圈，且两圈边距要等宽（否则视觉上有一处贴上了字母）。
//
// 这里只做静态几何断言，不做像素比对：像素比对无法表达「看起来像 Q」这种诉求。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// workspace 布局：本 spec 在根 vitest 下跑（cwd = 仓根），本包在 packages/<id>/
const ROOT = process.cwd()
const svg = readFileSync(join(ROOT, 'icon.svg'), 'utf8')

/** 字母「M」的锁定路径（用户指定，逐字不可改）。 */
const LETTER_PATH = 'M9.3 28.4V8.2L18 21.4L26.7 8.2V28.4'
const LETTER_STROKE = '5.2'
const CANVAS = 36

/** 取第一个匹配的标签文本，匹配不到直接失败（结构变了就得改测试，不是绕过测试）。 */
function tag(re: RegExp): string {
  const m = svg.match(re)
  expect(m, `icon.svg 里没找到 ${re}`).not.toBeNull()
  return m![0]
}

/** 取标签上的某个属性值。 */
function attr(tagText: string, name: string): string {
  const m = tagText.match(new RegExp(`${name}="([^"]+)"`))
  expect(m, `标签里没找到属性 ${name}：${tagText}`).not.toBeNull()
  return m![1]
}

function num(tagText: string, name: string): number {
  return Number(attr(tagText, name))
}

const letterTag = tag(/<path d="M9\.3 [^"]*"[^>]*\/>/)
const lensTag = tag(/<circle cx="[^"]+" cy="[^"]+" r="[^"]+" stroke="url\(#mm-grad\)"[^>]*\/>/)
const handleTag = tag(/<path d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+" stroke="#FE603C"[^>]*\/>/)
const cutCircleTag = tag(/<circle cx="[^"]+" cy="[^"]+" r="[\d.]+" stroke="none"\/>/)
const cutLineTag = tag(/<line x1="[^"]+" y1="[^"]+" x2="[^"]+" y2="[^"]+"[^>]*\/>/)

const lensCx = num(lensTag, 'cx')
const lensCy = num(lensTag, 'cy')
const lensR = num(lensTag, 'r')
const lensSw = num(lensTag, 'stroke-width')

const handleMatch = handleTag.match(/d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)"/)!
const handleX0 = Number(handleMatch[1])
const handleY0 = Number(handleMatch[2])
const handleX1 = Number(handleMatch[3])
const handleY1 = Number(handleMatch[4])
const handleSw = num(handleTag, 'stroke-width')

const cutCx = num(cutCircleTag, 'cx')
const cutCy = num(cutCircleTag, 'cy')
const cutR = num(cutCircleTag, 'r')
const cutX1 = num(cutLineTag, 'x2')
const cutY1 = num(cutLineTag, 'y2')
const cutSw = num(cutLineTag, 'stroke-width')

const dist = (x0: number, y0: number, x1: number, y1: number): number =>
  Math.hypot(x1 - x0, y1 - y0)

/** 镜圈笔画的**外缘**半径（stroke 是画在路径两侧的）。 */
const lensOuter = lensR + lensSw / 2

describe('icon.svg 几何守卫', () => {
  it('字母「M」路径与笔画参数锁定（只调搜索图标，字母不许改）', () => {
    expect(attr(letterTag, 'd')).toBe(LETTER_PATH)
    expect(attr(letterTag, 'stroke-width')).toBe(LETTER_STROKE)
    // 底端切平（butt）免得圆头把字母撑歪，拐角用圆角接缝
    expect(attr(letterTag, 'stroke-linecap')).toBe('butt')
    expect(attr(letterTag, 'stroke-linejoin')).toBe('round')
  })

  it('镜柄从镜圈外缘起笔，不从圆心伸出（否则看着像个字母 Q）', () => {
    const startDist = dist(handleX0, handleY0, lensCx, lensCy)
    expect(
      startDist,
      '镜柄起点落在镜圈笔画内侧，等于从圆心里长出尾巴',
    ).toBeGreaterThanOrEqual(lensOuter - 1e-6)
    // 也不能甩得太远，镜柄必须连着镜圈
    expect(startDist).toBeLessThan(lensOuter + 1.5)
  })

  it('放大镜整个外边缘都有边距，且镜圈与镜柄两侧的边距等宽', () => {
    // mask 里的挖空圆比镜圈外缘更大 ⇒ 镜圈四周有留白
    const lensMargin = cutR - lensOuter
    expect(lensMargin, '镜圈四周没有边距，会跟字母笔画连成一块').toBeGreaterThan(0)
    // mask 里的胶囊比镜柄笔画更粗 ⇒ 镜柄两侧与末端都有留白
    const handleMargin = (cutSw - handleSw) / 2
    expect(handleMargin, '镜柄两侧没有边距').toBeGreaterThan(0)
    // 两处边距必须一致，否则有一处视觉上贴住了字母
    expect(Math.abs(lensMargin - handleMargin)).toBeLessThan(0.01)
    // 留白要看得见，不能是 0.1 单位的假象
    expect(lensMargin).toBeGreaterThan(0.5)
  })

  it('mask 的挖空区与放大镜严格对位（挖空圆同心，胶囊盖住整条镜柄）', () => {
    expect(cutCx).toBeCloseTo(lensCx, 6)
    expect(cutCy).toBeCloseTo(lensCy, 6)
    // 胶囊末端盖过镜柄末端（round cap 往外再扩半宽），镜柄尖端也有留白
    expect(dist(cutX1, cutY1, handleX1, handleY1)).toBeLessThanOrEqual(cutSw / 2)
  })

  it('放大镜（含留白）不超出画布', () => {
    const margin = cutR
    expect(lensCx - margin).toBeGreaterThanOrEqual(0)
    expect(lensCy - margin).toBeGreaterThanOrEqual(0)
    expect(lensCx + margin).toBeLessThanOrEqual(CANVAS)
    expect(lensCy + margin).toBeLessThanOrEqual(CANVAS)
  })

  it('配色仍是 MiniMax 主题渐变：镜圈用渐变，镜柄取珊瑚实色', () => {
    expect(attr(lensTag, 'stroke')).toBe('url(#mm-grad)')
    expect(attr(handleTag, 'stroke')).toBe('#FE603C')
    expect(svg).toContain('stop-color="#E2167E"')
    expect(svg).toContain('stop-color="#FE603C"')
  })
})
