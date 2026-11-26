# AGENTS.md · dsh-web-search-minimax

> Agent 进仓先读本文：项目定位、形态不变量、门禁与红线。人向的安装与配置说明在 [README.md](README.md)。

## 项目定位

**@dreamariner/dsh-web-search-minimax**：DeepSeek Harness（DSH）的 MiniMax 联网搜索
provider，实现 `WebSearchProvider` seam（`id / available / search` 三成员），走
MiniMax Coding Plan 搜索接口（`POST {基址}/v1/coding_plan/search`）。以**自挂载 bundle**
（官方「一包既是 bundle 又是 plugin」形态）发行，已发布 npm。

- 工程说明（安装 / 配置 / 发布）：[README.md](README.md)
- 密钥与 DSH「设置 → 模型」里的 MiniMax 提供商共用同一变量名

## 文档机制

- 需求与迭代跟踪：[docs/issues/AGENTS.md](docs/issues/AGENTS.md)（唯一索引 / 状态真相源，新 issue 走其工作流）
- 系统现状：[docs/wiki/00-变更日志.md](docs/wiki/00-变更日志.md)（结构变化在此留时间线）

## 形态速记

- **单包布局 host 插件 + decoration client 半边**（create-dsh-plugin 生成，client 段后补）：
  根即插件包，`src/index.ts` 是 provider 实现与生效值自检，`src/config.ts` 是配置 schema
  与派生逻辑；`src/client/index.tsx` 是插件页状态面板（badge + section，数据走宿主现成
  remote，无自有 wire 契约），构建分 host（`tsdown.config.ts`）与 client
  （`tsdown.client.config.ts`，CJS + ModuleLoader 包装）两段。
- **双区支持**：`region` 切 `cn` / `global`，两区域名与密钥变量互不通用
  （`api.minimaxi.com` / `MINIMAX_CN_API_KEY`，`api.minimax.io` / `MINIMAX_GLOBAL_API_KEY`）；
  `searchKeyEnv` 空串 = 按 region 派生默认名。
- **凭据解析双层**（`createKeyResolver`，src/index.ts）：凭据 seam 优先
  （**每次调用现取** `ctx.get('credentials')`，读设置页托管密钥），环境层兜底
  （`resolveKey` → `@deepseek-ai/dsh-launch-environment` 的启动快照，process > project `.env`
  > home `.env` 三层，零网络）。变量名不合 credentialRef 语法时跳过 seam，不报错。
  seam 不在场是 headless 的正常形态（密钥由启动环境注入），不是故障。
- **环境变量一律走 `dsh-launch-environment`，不自己解析 `.env`**：那是 DSH 的规范入口
  （上游 `web-search-deepseek` / `llm-deepseek` / `web-deepseek-api` 三个同类插件都这么用，
  且都声明为 peer）。自己解析会漏层（手写版只读 home `.env`，漏掉 `<运行目录>/.env`），
  也重复维护一份解析逻辑。
- **装载条件是 `inject = ['web']`**：credentials 不进 inject（硬依赖会让 headless 永不装载），
  仅在它缺席时登记一个 `ctx.inject(['credentials'])` 就绪回调写日志，不阻塞装载。
- **失败面**：错误一律抛接缝的 `WebError` 带机器可读 code
  （`MINIMAX_SEARCH_KEY_MISSING / _TRANSPORT / _HTTP / _REJECTED / _BAD_RESPONSE / _EMPTY`），
  不静默返回空结果；单次上限 10 条且无分页，如实置 `truncated`。

## 常用命令

```sh
pnpm build          # tsdown 单文件构建（lib/index.js）
pnpm test           # 107 用例（provider 契约 / 失败分支 / 生效自检 / 状态面板（纯事件驱动，无定时器）/ 配置守卫 / 展示元数据 / headless 装载条件）
pnpm typecheck
pnpm dev            # watch 重建
pnpm dev:hmr        # host 半边热重载接线
pnpm profile:add    # link: 安装进 ~/.dsh/profiles/desktop（装前构建 + 登记名单 + 自检）
pnpm profile:add --npm   # 从 npm 装（发布态）

# ── DSH 实例管理 ──
pnpm dsh:status     # 实例在跑与否 + 访问地址
pnpm dsh:start [前台|后台]   # 启动实例（打包版带 --inspect；启动前有构建门）
pnpm dsh:restart    # 优雅停止后重启（默认后台）
pnpm dsh:stop       # 优雅停止（inspector 自动应答退出；兜底属主圈定）
pnpm dsh:probe      # 连实例验证本插件装载且 active，并报当前生效的网页搜索提供方判定
```

## 红线

- **lib 不入库**：`.gitignore` 锚定为 `/lib/`（勿改回裸 `lib/`，会任意深度匹配误伤子目录里的 lib）。
- **发布面不含 src**：`files` 白名单与 `exports` 都不带源码；**client 构建不得开 sourcemap**（`lib/*.js.map` 的 `sourcesContent` 会把 `.tsx` 全文打进包，`tests/bundle-shape.spec.ts` 有机械检查）。
- **`inject` 不得包含 `credentials`**：cordis 的 inject 是硬依赖，任一服务缺席即永不调 `apply()`。headless 模板把该服务显式 `disabled`，硬 inject 会让插件停在 `pending (waiting for service: credentials)`（2026-11-26 实测）。凭据服务由 `createKeyResolver` 每次现取，`tests/bundle-shape.spec.ts` 有静态断言。
- **凭据不得在 `apply()` 捕获一次**：捕获的 `undefined` 会被闭包永久记住（2026-11-25 实测的缺陷形态）。所有判定必须现取：headless 这类没有该服务的组合靠它退回环境层，服务重启/装卸靠它恢复。
- **client 半边不得引入定时轮询**：读链前置条件都有结构性保证（`ctx.inject` 就绪门等命名空间、cordis 的 strict `ctx.get` 过滤非 ACTIVE fiber、boot 等 `loader.await()` 后才 listen）。状态变化用事件订阅，`tests/client-status.spec.ts` 断言 `start()` 不注册 interval。外部直接改 profile 文件不在保证范围内（DSH settings 服务没有文件 watcher）。
- **并发读必须领序号**：`read()` 跨多个 remote await，期间可能被事件再触发；只有最新一轮能 publish，否则过期答案会覆盖新状态。与上游官方卡片的 `providerReadSequence` 同款，`tests/client-status.spec.ts` 有乱序回归。
- **badge 只说事实，不说结论**：client 只看得见 `searchProvider` 配置指向，看不见密钥可用性（那是 host 侧 `ready?()`，`WebProviderInfo` 只投影 id / title / description）。所以文案是「已接管搜索」而不是「搜索生效中」；改回「生效中」等于宣称客户端证明不了的事。
- **`ok: false` 不等于「没有」**：remote 调用失败时状态必须是 `unknown`（无法确认），不能推进成 `not-registered` / 密钥缺失一类的确定结论。
- **available() 只判结构，不判密钥**：密钥有无归 `ready?()`（每模型步骤重算）。否则启动窗口内凭据未就绪时，patch 里钉死的 `searchProvider: minimax` 会让 seam 抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。这条与上游 web-search-deepseek 同构。
- **available() / ready? 不得发网络请求**：接口明写的契约，检查只走本地（ready? 的密钥判定走 resolveSecret，同样零网络）。
- **密钥值不进配置**：配置只存变量名，值只在 `~/.dsh/.env`、启动环境或设置页托管存储。
- **DSH 版本锚 `0.2.2-rc.5`**：peer（dsh-web / dsh-credentials / schemastery）与 engines 都锚在此。
- **日志字段语义固定**：`init` 行的 `envKey` = 环境层此刻能否同步读到；`credentials` = 凭据服务此刻在不在场（false 可能是本组合没有，也可能是尚未 init 完）；`available` = 结构检查结果，不含密钥。三者不可混用，混淆会把排查引向反方向。
- **依赖决策表**：peer = 外置（宿主供给同一实例，运行期共享）；dependencies = 内联自带；devDependencies = 只许 `import type`。唯一事实源是 `package.json`（`@dreamariner/dsh-ctl/manifest-deps` 派生 tsdown 三件套），源码导入纪律由 `tests/import-guard.spec.ts` 机械执行。本插件不消费 cordis（无任何 cordis 导入），无 cordis 条目。
- **行文不用破折号「——」**（zero 知识库行文规范，2026-11-01 起）。
