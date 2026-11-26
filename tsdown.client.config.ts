import { defineConfig } from 'tsdown'

// client 段：src/client/index.tsx → lib/client.js（CJS + __ModuleLoader__ 包装，
// 宿主渲染进程经 package.json 的 dsh.client 声明自动发现并装载；机制与 dsh-notify /
// dsh-image-design 的 decoration client 同款）。host 段（默认 tsdown.config.ts）先跑，
// 本段只追加 client.js，不碰 host 产物。
//
// EXTERNALS 是宿主渲染进程模块表的 baseline 供给（react 系），绝不打包；清单外的
// 裸 import 一律内联，onlyImport 让清单外的裸 import 构建期直接报错。
// ⚠ 官方 practices：不 require 任何 @deepseek-ai/dsh-client-* 包；样式只引用主题
//   token（本面板只用 currentColor，零 token 依赖）；本包子路径不从 src/ 值导入。
const EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

export default defineConfig({
  entry: ['src/client/index.tsx'],
  outDir: 'lib',
  clean: false,
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  // sourcemap 必须关：files 白名单收的是 lib 整个目录，map 里的 sourcesContent
  // 会带上完整的 src/client/index.tsx，等于把源码塞进 npm 包。
  // AGENTS.md 红线「发布面不含 src」；0.1.3 曾因此把 13KB 源码发出去（2026-11-26 发现）。
  // 需要本地调试时临时改 true，别提交。
  sourcemap: false,
  deps: {
    neverBundle: EXTERNALS,
    alwaysBundle: (specifier: string) => !EXTERNALS.includes(specifier),
    onlyImport: EXTERNALS,
  },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
  },
  // : ModuleLoader 包装，与 DSH 运行时期望的字节形态一致 :
  // ⚠ CJS 格式下 rolldown 会跳过独立的 intro（产物缺 var exports = module.exports
  //   → 浏览器 exports is not defined），故 intro 并进 banner。
  banner: [
    `window.__ModuleLoader__.load({ id: '@dreamariner/dsh-web-search-minimax', factory: (require) => {`,
    'var module = { exports: {} };',
    'var exports = module.exports;',
  ].join('\n'),
  footer: 'return module.exports; } });',
})
