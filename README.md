# @dreamariner/dsh-web-search-minimax

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 MiniMax 联网搜索 provider，以**自挂载 bundle**（官方「一包既是 bundle 又是 plugin」形态）发布，可用 `dsh plugin` 独立安装。

本仓是**单包布局**（脚手架 [create-dsh-plugin](https://github.com/dreamariner/create-dsh-plugin) 的 host 形态）：根即插件包，构建、发布、安装都以本仓为单位。

## 功能

- 实现 DSH 的 `WebSearchProvider` seam：`id / available / search` 三成员。
- 走 MiniMax Coding Plan 的搜索接口 `POST {基址}/v1/coding_plan/search`。密钥与 DSH「设置 → 模型」里的 MiniMax 提供商**共用同一个变量名**（国内版 `MINIMAX_CN_API_KEY`），在设置页填 key 或写进 `~/.dsh/.env` 都生效；支持国内版 / 国际版（`region` 切换，两区的域名与密钥互不通用）。
- 失败一律抛带机器可读 code 的错误（`MINIMAX_SEARCH_KEY_MISSING / _TRANSPORT / _HTTP / _REJECTED / _BAD_RESPONSE / _EMPTY`），不静默返回空结果。
  错误抛的是接缝的 `WebError`（继承 `HarnessError`），code 会进工具结果的结构化错误元数据，路由层能直接按 code 分流。
- MiniMax 单次最多 10 条且不支持分页：只按接口硬上限封顶并如实置 `truncated`，条数截断责任在 DSH 工具层的 `tool-web.searchMaxResults`。

## 安装

**想用**（npm）：

- desktop 应用：Plugin Manager 里直接装
- 任意 profile（含 headless）：`dsh plugin --profile <name> add @dreamariner/dsh-web-search-minimax`（官方 reconcile 登记名单）
- 或统一一条命令：`pnpm profile:add --npm`（同下，多一层自检）

### headless / CI 环境的密钥来源

本插件**不把凭据服务当硬依赖**，两种组合都装载：

| 组合 | 密钥来源 | 说明 |
|---|---|---|
| 挂了 `dsh-credentials-local`（desktop / web / 自建 TUI profile） | 设置页托管的 `$DSH_HOME/.credentials.yaml`，环境层兜底 | 设置页「设置 → 模型」填的 key 即生效 |
| 没挂该服务（headless 默认） | 启动环境注入：`process.env` / `<运行目录>/.env` / `$DSH_HOME/.env` | headless 的设计前提，不读 GUI 存储 |

headless 模板默认把 `credentials` 行 `disabled: true`（一次性任务按设计用启动环境注入密钥，见 DSH 官方 headless README 的 Credentials 一节）。所以 headless 里要么用环境变量提供密钥：

```sh
MINIMAX_CN_API_KEY=sk-... dsh --profile headless "你的任务"
```

要么先恢复该服务再走设置页托管的 key：

```yaml
# $DSH_HOME/profiles/<name>/cordis.patch.yml
- id: credentials
  disabled: false
```

`envKey` 与 `credentials` 两个字段在插件日志的 `init` 行里分别记录（含义见 AGENTS.md），排查「密钥到底从哪来」时先看它们。

**想改**（本地源码态）：

```sh
pnpm profile:add          # link: 本仓装进 ~/.dsh/profiles/desktop；缺依赖自动 install、装前自动构建
pnpm profile:add --remove # 反向卸载（含名单清理）
```

脚本依次做：缺依赖先 `pnpm install`；构建本包（lib/ 不入库，link: 安装不触发 pnpm
lifecycle）；`pnpm add <spec> --dir <profile>`；把包名幂等追加进 profile
`package.json` 的 `dsh.profile.bundles`（DSH 只认这份名单，裸 `pnpm add` 不登记 =
插件静默不挂载）并钉 packageManager；realpath 自检 manifest 带 `dsh.bundle`、包名
一致、入口产物存在。装完**重启实例一次**生效。

> 手动等价：`pnpm add <spec> --dir <profile>` 后，把
> `@dreamariner/dsh-web-search-minimax` 补进 profile `package.json` 的
> `dsh.profile.bundles` 数组。

## 配置

插件自带一行自挂载 patch，其中包含 `web` 行接线（**必须随插件走**：安装即把 `searchProvider` 设为 `minimax`；0.2.2-rc.5 起未显式配置时内置 provider 会按模型路由静默接管搜索，不再报 `WEB_PROVIDER_AMBIGUOUS`）：

```yaml
- id: web
  config:
    searchProvider: minimax
    fetchProvider: http
```

### 状态显示

插件页（左侧栏「插件」→ 已安装 → MiniMax 联网搜索）的详情页有实时状态：标题旁
badge（已接管搜索 / 未接管搜索）与下方三行状态（provider 注册、当前生效提供方、
设置页托管密钥），在设置页切提供方或填 / 清密钥后当场刷新。未接管时附带切换指引。

**badge 说的是「接管」，不是「可用」**。它只反映 `searchProvider` 配置有没有指向本插件，
不反映密钥能不能解析（那是宿主侧 `ready?()` 的判断，决定 `web_search` 是否出现在模型面前，
客户端拿不到）。所以：

- badge 显示「已接管搜索」但模型没有搜索工具：说明配置已指向本插件、密钥没配好。
  看插件日志的「生效自检」行，或运行 `pnpm dsh:probe`
- 密钥行显示「未在设置页托管默认变量名」不等于密钥缺失：自定义 `searchKeyEnv` 或
  `.env` 环境层里的值客户端都读不到

插件自身配置（全有默认值，通常只配 `region` 与密钥）：

| 键 | 默认 | 说明 |
|---|---|---|
| `region` | `cn` | 发行区：`cn`（国内，`api.minimaxi.com`）\| `global`（国际，`api.minimax.io`）。决定域名与默认密钥变量名 |
| `searchBaseUrl` | （空 = 按 region 派生） | 搜索接口基址；自部署网关 / 反代时显式覆盖 |
| `searchKeyEnv` | （空 = 按 region 派生） | **存密钥的环境变量名**（只存名字）；自拟变量名时显式覆盖 |
| `searchTimeoutMs` | `30000` | 单次搜索超时 |
| `logPath` | `$DSH_HOME/logs/dsh-web-search-minimax.log` | 插件日志 |

**密钥首选在 DSH「设置 → 模型」里配置**：添加 MiniMax 模型提供商（如 `minimax-cn`，
填 **MiniMax Coding Plan** 的 key）后，其 `apiKeyEnv` 与插件的 `searchKeyEnv`
默认值是**同一个变量名**（国内版 `MINIMAX_CN_API_KEY`），搜索开箱即用，
无需任何插件侧配置。

插件的密钥解析与内置 provider 同构，**两条路都通**：

| 密钥放在哪 | 谁读得到 |
|---|---|
| 设置页填的 API key（落在 `$DSH_HOME/.credentials.yaml` 托管存储） | 凭据 seam（`ctx.credentials`），插件与模型都读得到 |
| `~/.dsh/.env` 的同名变量、进程环境 | 环境层，插件与模型都读得到 |

所以设置页那一栏**留空**（走环境认证，`.env` 里已有该变量）和**填上 key** 都能用：
前者走环境层，后者走凭据 seam，两条路插件都接上了。

MiniMax 分**国内版**与**国际版**，两区的域名和密钥互不通用，按所用 plan 二选一。
用国际版时两步：

1. 「设置 → 模型」再加一个提供商，`apiKeyEnv` 填 `MINIMAX_GLOBAL_API_KEY`（key 用国际版的）；
2. 给插件行加 `region: global`。在 profile 的 `cordis.patch.yml` 追加（同名行是整块
   替换，`name` 必须带）：

   ```yaml
   - id: dsh-web-search-minimax
     name: "@dreamariner/dsh-web-search-minimax"
     config:
       region: global
   ```

不经模型设置 UI、直接写 `~/.dsh/.env` 也可以（红线：密钥不进任何仓库）：

```sh
MINIMAX_CN_API_KEY=sk-...      # region: cn（默认）
MINIMAX_GLOBAL_API_KEY=sk-...  # region: global
```

> 密钥来自 **MiniMax Coding Plan**；对话 LLM 用哪个提供商与本插件无关，插件只认
> `searchKeyEnv` 指向的那个变量（它在设置页与 `.env` 里同名即可）。

## 验证

```sh
dsh --profile <name> --dump-config   # 能看到本包的插件行与 web 行
pnpm test                            # 本仓单测（provider 契约 / 失败分支 / 配置守卫 / 展示元数据）
```

## 发布

```sh
pnpm publish
# 走 prepare 构建出 lib/ 再打包；scoped 包已配 publishConfig.access=public
```

## 开发

以下命令都在仓根执行：

```sh
pnpm install
pnpm test           # vitest run（tests/）
pnpm typecheck      # tsc --noEmit（src 与 tests）
pnpm build          # tsdown → lib/
```

### 热重载开发循环（可选）

```sh
pnpm dev            # tsdown --watch：保存 → 重建 lib/
pnpm dev:hmr        # 把本包 lib/ 注册进本机 DSH 的 hmr watch 根（$DSH_HOME/cordis.patch.yml）
                    # 注册后**重启实例一次**生效，之后的改动即「保存 → 实例内热重载」（免重启、PID 不变）
pnpm dev:hmr --remove   # 注销本仓全部注册
```

- 注册写的是**本机 home patch** 里本包 lib 的路径，不触碰 root 里其它产品的行
  （本机其他工具的脚本各自管理自己的行、互不干扰）。
- 固有限制（DSH hmr 机制）：只认 change 事件（删除文件不触发 reload）、实例启动窗口内的
  改动被丢弃、macOS FSEvents 注册窗口。生产/分发场景不需要 hmr。

仓内没有 `scripts/` 目录：工具面统一走 `@dreamariner/dsh-ctl`（`dev-hmr` / `profile-add` /
`start|restart|stop|status|probe` 都是它的子命令，经 `package.json` 的 scripts 调用），
`tsdown` 的依赖策略从它的 `@dreamariner/dsh-ctl/manifest-deps` 子路径导入。

依赖纪律（不变式 I1/I2）：`peerDependencies`（schemastery、dsh-web、dsh-credentials）外置由宿主供给同一实例，其余运行期依赖内联进产物；名单唯一来源是 `package.json`，tsdown 的 `deps` 三件套由 `@dreamariner/dsh-ctl/manifest-deps` 从它派生。

`@deepseek-ai/dsh-web` 必须在 peer 名单里：DSH 的模块解析器按 `peerDependencies` 判定，把 peer 的导入拦截并路由到宿主自己的那份实例。
这条是「错误码能进工具层结构化元数据」的前提，工具层取 code 的判定是 `error instanceof HarnessError`，认的是**类实例身份**。
`@deepseek-ai/dsh-credentials` 同理：插件要用宿主的凭据 seam 读设置页保存的密钥，
`credentialRef` 必须与宿主那份是同一个实现，否则引用名与托管存储对不上。
跨包运行期导入只限 peer 名单内的包（`fetch` 等一律本地实现），否则 pnpm 隔离布局下解析不到。
