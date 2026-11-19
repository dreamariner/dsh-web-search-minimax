---
id: 001
type: feat
title: rc.5 适配收尾与生效状态可观测
status: doing
priority: P1
labels: [upgrade, observability]
created: 2026-11-20
updated: 2026-11-20
assignee: jianan
related: []
---

# 001 · rc.5 适配收尾与生效状态可观测

## 背景

宿主 DSH 全批次升到 0.2.2-rc.5 后，本仓机械面（peer / devDeps / engines / lockfile，commit 1087716）已升完且 57 测试全绿，但遗留四类欠账：

1. **发版缺口**：npm 上最新仍是 0.1.2（peer 锚 rc.2），git 里 1087716 等 rc.5 锚提交未发版
2. **上游 rc.5 改了 provider 选择语义**（PR #8707）：`resolveProvider` 加 preferredId 兜底，未显式配置 `searchProvider` 时按模型路由静默选内置 DeepSeek provider，**不再报 `WEB_PROVIDER_AMBIGUOUS`**。显式配置时选择仍是确定性的（configuredId 优先，失败走 `CONFIGURED_MISSING` / `CONFIGURED_UNAVAILABLE`，不静默回落）
3. **状态不可观测**：`available()` 因 `credentials !== undefined` 兜底恒为 true，密钥没配时模型每次调 `web_search` 都撞 `MINIMAX_SEARCH_KEY_MISSING`；没有 `ready?` 实现让 `searchReady()` 链路把工具从模型面前摘掉
4. **文案过时**：`src/index.ts:185`、`README.md:42` 仍讲 AMBIGUOUS 语义；`src/config.ts:47` 的「默认 8」实为 rc.2 起默认 10；`cordis.patch.yml:15` 的 base web 行描述与 rc.5 实况（已无 `searchProvider` 字段）不符

实测证据：设置页「网页搜索与获取」真实存在（provider 菜单显示生效值，当前选 minimax 且显示裸 id）；`settings` 服务 `describe()` 给 volatile 字段实时生效值、`settings/document-updated` 事件可监听（rc.5 `packages/settings/settings/src/index.ts:302`）；插件页有 `plugins.detail.badge` / `plugins.detail.section` 贡献槽位（rc.5 `packages/client/ui-plugin-manager/src/client/slot-contract.ts:133`）。

## 目标

- 密钥没配时 `web_search` 工具不出现（而不是出现但每次调用报错）
- 生效值不是本插件时，日志、probe、插件页三处都能看到，且提示精确到设置页路径
- npm 上出现 rc.5 锚的版本（发版单独确认后执行）
- 仓内文案与 rc.5 语义一致

## 方案

- **A provider 三补**（host 半边，src/index.ts）：补 `ready?(llmProvider)`（复用 `resolveSecret`，纯本地）；补 `title`（静态串）；补 `description`（双语 LocalizedText，装上即配好口径 + 生效值不是 MiniMax 时的切换路径）。`available()` 保持不动（同步接口查不到托管存储，收紧会误报）。
- **B host 生效值自检**（src/index.ts + scripts/dsh-ctl.mjs）：apply 经 `ctx.inject(['settings'], ...)` 调 `describe()` 扫描带 `searchProvider` 字段的 descriptor（不写死 ns），三态判定打 info / warn（warn 带「设置 → 插件 → 内置插件配置 → 网页搜索与获取 → 切到 MiniMax」路径）；监听 `settings/document-updated` 重判；`dsh:probe` 经 settings-controller remote `describe()` 报生效 provider 与判定。settings 不在位降级为一条日志。
- **C 文案修正**：`src/config.ts:47`、`cordis.patch.yml:15`、`src/index.ts:185`、`README.md:42`、`AGENTS.md` 用例数。
- **D 插件页状态显示**（client 半边，decoration 形态）：`src/client/index.tsx` 注册 `plugins.detail.badge`（搜索生效中 / 未接管搜索 / 无法验证）与 `plugins.detail.section`（注册 / 生效值 / 密钥三行 + 指引），按 `subject.kind === 'bundle' && pkg.name === 本包名` 过滤；实时刷新靠 `web/providers-changed` + `settings/document-updated` + `connection/reset`；构建加 `tsdown.client.config.ts` 出 `lib/client.js`（ModuleLoader 包装，机制同 dsh-notify），`package.json` 加 `exports["./client"]`；react / primitives 走宿主模块表外置。
- **E 测试**：ready? 三态；自检三态 + 缺位降级 + 事件重判；client badge/section 过滤与渲染；bundle-shape 断言 `./client` 导出并加 rc.5 防线注释。
- **F 文档**：wiki 变更日志补时间线；README 口径对齐。

关键决策：不做 client 推流 wire 契约（只读面板消费现成 remote 足够）；不改上游 `listProviders` 加 available 字段（牵动 vendored 协议源与全部插件 codegen）；apply 不抛错拦截（插件死掉后用户切回会撞 `CONFIGURED_MISSING`，更糟）。

## 影响面

- provider 对象新增 `title` / `description` / `ready?`：设置页菜单显示人话名字与说明；密钥没配时 `web_search` 不准入
- 新增 client 半边：`files` 白名单与 `exports` 变化，触碰 bundle 形态自守护栏（同步更新断言）
- probe 行为扩展（新增生效值报告），退出码语义不变
- 不涉数据迁移

## 验收标准

- [ ] `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿
- [ ] `pnpm dsh:probe` 报本插件 active 且当前生效 provider 判定 = minimax
- [ ] 设置页 provider 菜单显示 title 与 description（不再裸 id）
- [ ] 插件页本插件详情出现 badge「搜索生效中」；换提供方后变「未接管搜索」并在日志出 warn
- [ ] 发版（bump 0.1.3 + tag + npm publish）单独确认后执行

## 依赖

- 无前置 issue；发版需人工确认

## 进度日志

- 2026-11-20  jianan  创建，开工
