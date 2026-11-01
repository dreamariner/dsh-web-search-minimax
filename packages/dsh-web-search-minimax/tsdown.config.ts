import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'
import { hostDeps, readManifest } from '../../scripts/lib/manifest-deps.mjs'

// host 半边构建：dev 与安装/发布都跑本产物（lib/index.js 是装载入口）。
//
// 依赖策略（不变式）：peer 必须外置——运行期由宿主拦截层供给与
// DSH 同一实例；其余依赖自带一份（内联）。名单只写在 package.json 一处。
const manifest = readManifest(fileURLToPath(new URL('.', import.meta.url)))

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'lib',
  dts: false,
  // tsdown 0.22 对 node 平台默认 fixedExtension=true（强制 .mjs）；关掉它按包内
  // type: module 出 .js，与 DSH/社区包的 lib/index.js 形态一致。
  fixedExtension: false,
  // clean: false —— 构建**失败时不能毁掉上一份产物**。
  // tsdown 的 clean 在构建开始时执行（先删 outDir 再构建），所以 clean: true（默认）
  // 遇到编译错误 = 「旧产物没了 + 新产物没出来」= 什么产物都不剩。
  // ③-12 的兜底假设「沿用已入库的 lib/ 产物」依赖构建失败时产物还在。
  // （另两个包设 clean: false 是因为 host 与 client 共用 lib/，理由不同，但结论一致。）
  clean: false,
  deps: hostDeps(manifest),
})
