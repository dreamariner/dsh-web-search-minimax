# Changelog

面向使用者的版本级变更记录（工程内部的时间线在 [docs/wiki/00-变更日志.md](docs/wiki/00-变更日志.md)）。
格式参考 Keep a Changelog，版本号遵循 semver；用户可感知的版本级变更随发版写入对应条目与 GitHub release 说明。

## [Unreleased]

（空）

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
