// create-dsh-plugin :: sync-pack-docs.mjs — 把仓根 README / LICENSE 同步进插件包目录
//
// npm 只在「包目录内」自动收录 README 与 LICENSE：workspace 布局下这两份文件住在
// 仓根，不拷贝就进不了 tarball（npm 页面没文档、license 字段没有文本）。
// 挂在各插件包的 prepare（pack / publish / git 安装三条路都会跑），产物被根
// .gitignore 忽略：真源永远在仓根，避免双真源漂移。
//
// 项目共用脚本（<仓根>/scripts/）：包目录取 argv[2]，缺省 = 当前目录
// （pnpm 跑包脚本时 cwd = 包目录，各包 prepare 里直接 `node ../../scripts/sync-pack-docs.mjs`）。
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本脚本在 <仓根>/scripts/：向上一级就是仓根
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = resolve(process.argv[2] ?? process.cwd())

// ⚠ 目的地只许是 packages/ 下的目录：cwd 误定时的最坏情况是把仓根 README 当目的地
// 覆盖掉（真源自毁）。越界即硬错误，宁可失败也不写错地方。
const packagesDir = join(root, 'packages')
if (!pkgDir.startsWith(packagesDir + sep)) {
  console.error(`[sync-pack-docs] 目的地 ${pkgDir} 不在 ${packagesDir} 下（仓根是只读真源），拒绝复制`)
  process.exit(1)
}
if (pkgDir === packagesDir || !existsSync(join(pkgDir, 'package.json'))) {
  console.error(`[sync-pack-docs] 目的地 ${pkgDir} 不是插件包目录（缺 package.json）`)
  process.exit(1)
}

for (const name of ['README.md', 'LICENSE']) {
  const src = join(root, name)
  if (existsSync(src)) copyFileSync(src, join(pkgDir, name))
}
