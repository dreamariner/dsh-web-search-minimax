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
  （`ctx.get('credentials')` 读设置页托管密钥），环境层兜底（process.env → 直读
  `$DSH_HOME/.env` 手工解析，零网络）。变量名不合 credentialRef 语法时跳过 seam，不报错。
- **失败面**：错误一律抛接缝的 `WebError` 带机器可读 code
  （`MINIMAX_SEARCH_KEY_MISSING / _TRANSPORT / _HTTP / _REJECTED / _BAD_RESPONSE / _EMPTY`），
  不静默返回空结果；单次上限 10 条且无分页，如实置 `truncated`。

## 常用命令

```sh
pnpm build          # tsdown 单文件构建（lib/index.js）
pnpm test           # 76 用例（provider 契约 / 失败分支 / 生效自检 / 配置守卫 / 展示元数据）
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

- **lib 不入库**：`.gitignore` 锚定为 `/lib/`（勿改回裸 `lib/`，会任意深度匹配误伤 `scripts/lib/`）。
- **发布面不含 src**：`files` 白名单与 `exports` 都不带源码。
- **available() / ready? 不得发网络请求**：接口明写的契约，检查只走本地（ready? 的密钥判定走 resolveSecret，同样零网络）。
- **密钥值不进配置**：配置只存变量名，值只在 `~/.dsh/.env` 或设置页托管存储。
- **DSH 版本锚 `0.2.2-rc.5`**：peer（dsh-web / dsh-credentials / schemastery）与 engines 都锚在此。
- **依赖决策表**：peer = 外置（宿主供给同一实例，运行期共享）；dependencies = 内联自带；devDependencies = 只许 `import type`。唯一事实源是 `package.json`（`scripts/lib/manifest-deps.mjs` 派生 tsdown 三件套），源码导入纪律由 `tests/import-guard.spec.ts` 机械执行。本插件不消费 cordis（无任何 cordis 导入），无 cordis 条目。
- **行文不用破折号「——」**（zero 知识库行文规范，2026-11-01 起）。
