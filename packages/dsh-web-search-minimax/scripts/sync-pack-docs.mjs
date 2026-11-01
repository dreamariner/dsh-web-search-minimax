// create-dsh-plugin :: sync-pack-docs.mjs — 把仓根 README / LICENSE 同步进插件包目录
//
// npm 只在「包目录内」自动收录 README 与 LICENSE：workspace 布局下这两份文件住在
// 仓根，不拷贝就进不了 tarball（npm 页面没文档、license 字段没有文本）。
// 挂在 prepublishOnly（只在 pack / publish 时跑），产物被根 .gitignore 忽略：
// 真源永远在仓根，避免双真源漂移。
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本脚本在 packages/<id>/scripts/：向上一级是包目录，向上一级是仓根
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(pkgDir, '..', '..')

for (const name of ['README.md', 'LICENSE']) {
  const src = join(root, name)
  if (existsSync(src)) copyFileSync(src, join(pkgDir, name))
}
