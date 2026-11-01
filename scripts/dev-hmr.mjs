#!/usr/bin/env node
// dsh-web-search-minimax :: dev-hmr.mjs — 项目级 hmr 接线：把全部插件包的 lib/ 注册进本机 DSH 的 hmr watch 根
//
// 用途：开发时「保存 → pnpm dev 重建 → 实例内热重载（免重启、PID 不变）」。
//   pnpm dev:hmr            注册全部 packages/*/lib（幂等；add 新插件后重跑一次即可）
//   pnpm dev:hmr --remove   注销本仓的全部注册
//
// 机制：DSH 的 hmr 行住在本机 home patch（$DSH_HOME/cordis.patch.yml，机器本地产物，
// 不进任何 git）。本脚本只往该行 config.root 数组里增删**本仓** packages/*/lib 的
// 绝对路径，不触碰 root 里的其它行（各家脚本互不干扰、各自管理自己的行）。
// 变更 watch 根需重启实例一次生效；之后的改动随 pnpm dev 重建即时热重载。
//
// 固有限制（DSH hmr 机制）：只认 change 事件（删除文件不触发 reload）、实例启动
// 窗口内的改动被丢弃、macOS FSEvents 注册窗口。client 半边不用注册：DSH 的
// client-hmr 自动盯着 lib/client.js（若存在），重建即热替换。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(repo, 'packages')
const remove = process.argv.includes('--remove')
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const homePatch = join(dshHome, 'cordis.patch.yml')

const packageDirs = existsSync(packagesDir)
  ? readdirSync(packagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(packagesDir, e.name))
  : []
// 本仓的 lib 目录集合（存在的才算：没构建的包注册了也没有产物可热重载）
const libDirs = packageDirs.filter((d) => existsSync(join(d, 'lib'))).map((d) => join(d, 'lib'))

if (!remove && libDirs.length === 0) {
  console.error('[dev-hmr] packages/*/lib 都不存在:先构建一次：pnpm build')
  process.exit(1)
}

// js-yaml 是各插件包的 devDep（pnpm 严格隔离，根 node_modules 没有它），从包里借
let yaml
for (const pkg of packageDirs) {
  try {
    yaml = createRequire(join(pkg, 'package.json'))('js-yaml')
    break
  } catch {}
}
if (!yaml) {
  console.error('[dev-hmr] 缺 js-yaml 依赖:先 pnpm install')
  process.exit(1)
}

// ⚠ home patch 是 DSH 的 YAML 方言：允许 `!!js <表达式>`（DSH 读取时求值出本机路径）。
// js-yaml 默认 schema 不认识这个标签（unknown tag 直接抛错），这里注册一个**透传**类型：
// 读进来包成占位对象、写出去原样还原，标签与表达式逐字节保留。
// ⚠ 刻意不在本脚本求值表达式：求值是 DSH 的职责（它才有 dshHomePath 的定义域），
// 在这里求值等于执行配置里的任意 JS。
// （固有限制：js-yaml 的 round-trip 不保留注释:注释会丢，语义与标签不丢。）
class JSExpression {
  constructor(source) {
    this.source = source
  }
}
const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: () => true,
  construct: (data) => new JSExpression(data),
  predicate: (obj) => obj instanceof JSExpression,
  represent: (obj) => obj.source,
})
const PATCH_SCHEMA = yaml.DEFAULT_SCHEMA.extend({ explicit: [jsTag] })

let rows = []
if (existsSync(homePatch)) {
  const loaded = yaml.load(readFileSync(homePatch, 'utf8'), { schema: PATCH_SCHEMA })
  rows = Array.isArray(loaded) ? loaded : []
}
let hmr = rows.find((r) => r && r.id === 'hmr')
if (!hmr) {
  hmr = { id: 'hmr', config: { root: [] } }
  rows.push(hmr)
}
hmr.config ??= {}
if (hmr.config.root !== undefined && !Array.isArray(hmr.config.root)) {
  // root 若被写成 !!js 表达式（非数组），覆盖它会静默抹掉表达式:宁可失败
  console.error('[dev-hmr] hmr 行的 config.root 不是数组（可能是 !!js 表达式），为避免覆盖请手工处理')
  process.exit(1)
}
if (!Array.isArray(hmr.config.root)) hmr.config.root = []

// 本脚本家族的管理范围：本仓 packages/*/lib 形态的条目（别的仓 / 别家工具的行不动）
const isOurs = (r) => typeof r === 'string' && r.startsWith(packagesDir + sep) && r.endsWith(sep + 'lib')
const oursBefore = hmr.config.root.filter(isOurs)

if (remove) {
  hmr.config.root = hmr.config.root.filter((r) => !isOurs(r))
} else {
  // 先清掉本仓已失效的条目（包被删 / lib 被清），再补齐现存集合
  hmr.config.root = hmr.config.root.filter((r) => !isOurs(r) || libDirs.includes(r))
  for (const dir of libDirs) {
    if (!hmr.config.root.includes(dir)) hmr.config.root.push(dir)
  }
}

const oursAfter = hmr.config.root.filter(isOurs)
writeFileSync(homePatch, `${yaml.dump(rows, { schema: PATCH_SCHEMA, lineWidth: -1 })}\n`)

if (remove) {
  console.log(oursBefore.length > 0
    ? `[dev-hmr] 已注销 ${oursBefore.length} 个注册（本仓 packages/*/lib；重启实例生效）`
    : '[dev-hmr] 本来就未注册，无需操作')
} else {
  const added = oursAfter.filter((r) => !oursBefore.includes(r)).length
  const summary = oursAfter.map((r) => r.slice(repo.length + 1)).join(', ')
  console.log(added > 0
    ? `[dev-hmr] 已注册 ${added} 个 watch 根：${summary}\n[dev-hmr] 重启实例一次生效；之后 pnpm dev 的重建即热重载（PID 不变）`
    : `[dev-hmr] 已在 hmr watch 根中（幂等，未改动）：${summary}`)
}
