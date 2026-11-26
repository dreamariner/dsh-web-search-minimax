# Changelog

面向使用者的版本级变更记录（工程内部的时间线在 [docs/wiki/00-变更日志.md](docs/wiki/00-变更日志.md)）。
格式参考 Keep a Changelog，版本号遵循 semver；用户可感知的版本级变更随发版写入对应条目与 GitHub release 说明。

## [Unreleased]

（空）

## [0.1.4] - 2026-11-26

### 修复

- **headless 环境不再装不上**：`inject` 去掉 `credentials`。cordis 的 inject 是硬依赖，任一服务缺席即永不调 `apply()`，而 headless 模板按设计把该服务 `disabled`（一次性任务用启动环境注入密钥）→ 此前插件停在 `pending (waiting for service: credentials)`，日志一行不产生。现在 `inject = ['web']`，凭据服务改由 `createKeyResolver` 每次现取，缺席时退回环境层
- **`available()` 语义收窄，密钥判定归 `ready?()`**：`available()` 改为只做结构检查（`URL.canParse(baseUrl)`），与上游内置 provider 同构。此前它同时判密钥有无，而本插件 patch 把 `searchProvider` 显式钉成 `minimax`，二者叠加会让 seam 在 provider 报不可用时抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。密钥判定统一归 `ready?()`（每个模型步骤重算）
- **凭据存储异常不再打挂整轮对话**：`ready?()` 捕获解析异常返回 false。此前异常会沿 `searchReady` → 工具准入 → `ToolActivationError` 变成整个 turn 的 `TOOL_ACTIVATION_FAILED`
- **发布面不再带源码**：client 构建关掉 `sourcemap`。`files` 收的是 `lib` 整个目录，map 的 `sourcesContent` 会把 `src/client/index.tsx` 全文打进 npm 包（0.1.3 实测外泄 13195 字节）
- **插件页并发读不再互相覆盖**：`read()` 现在领序号，只有最新一轮能发布快照。此前它跨三个 remote 多次 await，期间被事件再触发时，慢的旧轮晚回来会用过期答案盖掉新状态（实测：把 superseded 盖回 serving，面板停在错值直到下一个事件）
- **读失败不再误报「provider 未注册」**：`listProviders` 返回 `ok: false`（网关错误 / 连接抖动）时按「无法确认」处理，此前被当成列表为空，badge 直接显示「provider 未注册」
- **密钥行不再误标 ✗**：两个默认变量名都未在设置页托管时标为「不可判定」而非「缺失」。用户可能配了自定义 `searchKeyEnv` 或把值放在 `.env` 环境层，两者客户端都看不见
- **badge 文案改说事实而非结论**：「搜索生效中」→「已接管搜索」。badge 的判据只有 `searchProvider` 配置指向，答不了密钥能不能解析（那是宿主侧 `ready?()` 的判断，客户端拿不到）。原文案会让人看着「生效中」却找不到 `web_search` 工具。面板补一句「可用性以 host 判定为准，看插件日志 / `dsh:probe`」
- **插件页状态改为纯事件驱动，删掉定时轮询**：面板不再靠 `setInterval` 定时重读。读链的前置条件都由结构性保证覆盖（三个 remote 命名空间由 `ctx.inject` 门等待；凭据服务在 cordis 里只有 ACTIVE 才可见，而 ACTIVE 意味着 `loadInitial()` 已完成；boot 在返回前 `await loader.await()` 等全部 entry 落定，客户端连接发生在 webServer listen 之后）。状态变化由四个事件覆盖：`web/providers-changed`、`settings/document-updated`、新增的 `credentials/reference-updated`（设置页填/清 key 唯一的写入信号）、`connection/reset`

### 变更

- 插件日志 `init` 行的 `available` 字段语义变更：现在等于 `provider.available()` 的同一判定（结构检查，不含密钥）；密钥与凭据服务状态分别由 `envKey` / `credentials` 两个字段记录

### 文档

- README 补「headless / CI 环境的密钥来源」小节：两种组合的密钥路径对照、环境变量写法、恢复 `credentials` 服务的 patch 写法
- README 与 AGENTS 清理失效的 `scripts/` 路径（工具面已迁 `@dreamariner/dsh-ctl`）

### 兼容性

- 需要 DSH >= 0.2.2-rc.5 < 0.3.0-0（不变）
- `available()` 语义收窄：不再因缺密钥而返回 false。依赖它做密钥判定的调用方应改用 `ready?()`
- 新增支持：headless / 无凭据服务的组合（密钥走启动环境）

## [0.1.3] - 2026-11-20

### 新增

- provider 补 `title` / `description`：DSH 设置页「网页搜索提供方」菜单显示「MiniMax Web Search」与双语说明（此前显示裸 id `minimax`）；说明含「装上即配好」口径与生效值不是本插件时的切换路径
- 实现 seam 的 `ready?(llmProvider)`：密钥未配置时 `web_search` 不再准入模型步骤（模型看不到该工具），而不是反复调用反复报 `MINIMAX_SEARCH_KEY_MISSING`
- 插件日志新增「生效自检」：注册与设置变更时判定当前网页搜索提供方（本插件生效 / 被其他 provider 接管 / 自动模式未配置），未生效时附设置页切换路径
- 新增浏览器半边（decoration 形态）：插件管理页本插件详情实时显示状态，标题旁 badge（搜索生效中 / 未接管搜索 / provider 未注册 / 状态未知）与三行状态（provider 注册、当前生效提供方、设置页托管密钥），切换提供方当场刷新，未生效时附指引
- `pnpm dsh:probe` 扩展：连接实例后报告当前生效的网页搜索提供方判定

### 变更

- DSH 版本锚升 0.2.2-rc.5（peerDependencies：`@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-credentials`；`engines.dsh`）
- 修正过时文案：0.2.2-rc.5 起未显式配置 `searchProvider` 时，内置 provider 会按模型路由静默接管搜索（不再报 `WEB_PROVIDER_AMBIGUOUS`）；本插件 patch 始终显式配置，安装路径不受影响

### 兼容性

- 需要 DSH >= 0.2.2-rc.5 < 0.3.0-0
- `available()` 语义不变；`ready?` 为新增可选成员，旧宿主行为不受影响

## [0.1.2] - 2026-11-15

### 变更

- DSH 版本锚升 0.2.2-rc.2（peerDependencies / devDependencies / `engines.dsh` 跟进）
- patch 注释跟进 `tool-web.searchMaxResults` 默认条数变化（rc.2 起 8 → 10；本插件刻意不设该旋钮的语义不变）

## [0.1.1] - 2026-11-03

### 变更

- **破坏性**：撤 git 直装与 lib 出库（对齐脚手架新约定），安装改走 npm 包或 profile 登记
- 发布面收口：产物去掉 src 源码；README 安装方式改写（`profile:add` 一条命令装包、登记、自检）

### 修复

- `.gitignore` 锚定为 `/lib/`（裸 `lib/` 会任意深度匹配误伤 `scripts/lib/`）

## [0.1.0] - 2026-11-02

### 新增

- 首发：DSH 的 MiniMax 联网搜索 provider（`POST {基址}/v1/coding_plan/search`，国内 / 国际版 region 切换），自挂载 bundle 形态，密钥与 DSH MiniMax 模型提供商共用同一变量名
