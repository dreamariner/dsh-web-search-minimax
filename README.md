# @dreamariner/dsh-web-search-minimax

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 MiniMax 联网搜索 provider，以**自挂载 bundle**（官方「一包既是 bundle 又是 plugin」形态）发布，可用 `dsh plugin` 独立安装。

本仓是 workspace 布局（照脚手架 [create-dsh-plugin](https://github.com/dreamariner/create-dsh-plugin) 的统一结构）：根壳承载测试与类型检查，插件包在 `packages/dsh-web-search-minimax/`（构建、发布、安装都以它为单位），后续可用脚手架的 `add` 子命令追加更多插件（`npx @dreamariner/create-dsh-plugin add <包名> --type host|client|full`，在仓根执行），结构无需迁移。

## 功能

- 实现 DSH 的 `WebSearchProvider` seam：`id / available / search` 三成员。
- 走 MiniMax Coding Plan 的搜索接口 `POST {基址}/v1/coding_plan/search`。**密钥需自行配置**（MiniMax Coding Plan 的 key，与对话 LLM 密钥无关），支持国内版 / 国际版（`region` 切换，两区的域名与密钥互不通用）。
- 失败一律抛带机器可读 code 的错误（`MINIMAX_SEARCH_KEY_MISSING / _TRANSPORT / _HTTP / _REJECTED / _BAD_RESPONSE / _EMPTY`），不静默返回空结果。
  错误抛的是接缝的 `WebError`（继承 `HarnessError`），code 会进工具结果的结构化错误元数据，路由层能直接按 code 分流。
- MiniMax 单次最多 10 条且不支持分页：只按接口硬上限封顶并如实置 `truncated`，条数截断责任在 DSH 工具层的 `tool-web.searchMaxResults`。

## 安装

**方式一（推荐）：CLI 一条命令 = 装包 + 登记 bundle 名单，一步到位**

```sh
dsh plugin --profile <name> add @dreamariner/dsh-web-search-minimax   # npm（发布后）
```

**方式二：手动 pnpm 装**（desktop profile 不接受 CLI 的 pnpm 转发；git 子目录语法 CLI 不认时）

⚠ 裸 `pnpm add` 只完成「装包」：DSH 的 profile 只认 `dsh.profile.bundles` 名单
（loadProfileDirectory 不扫 dependencies），装完**必须把包名补进 profile
`package.json` 的 `dsh.profile.bundles`**，插件才会挂载。自挂载 bundle 解决的是
「名单里的包怎么挂载」，不解决「哪些包进名单」。

```sh
# ① 装包（三选一）：
pnpm add @dreamariner/dsh-web-search-minimax --dir <profile目录>              # npm（发布后）
pnpm add link:<本仓路径>/packages/dsh-web-search-minimax --dir <profile目录>   # 本地开发态
# git：workspace 仓的 dsh CLI github: 形态装的是仓根壳（无插件面），用 path: 直装子目录
pnpm add "github:dreamariner/dsh-web-search-minimax#path:packages/dsh-web-search-minimax" --dir <profile目录>

# ② 登记：把 "@dreamariner/dsh-web-search-minimax" 加进 profile package.json 的
#    dsh.profile.bundles 数组
```

> git 安装且 pnpm ≥ 10 时，需在 profile 的 `pnpm-workspace.yaml` 放行构建脚本
> （`allowBuilds: { "@dreamariner/dsh-web-search-minimax": true }`，pnpm 10 的
> 键名是 `onlyBuiltDependencies`）。`lib/` 已随仓提交，放行前也能装上，放行是为了
> prepare 能重建到最新源码。放行的键按**实际装出来的包**走：上面三种形态装出的
> 都是插件包，键是 `@dreamariner/dsh-web-search-minimax`。
>
> `dsh plugin add github:` 那种 CLI 形态装的是仓根壳 `dsh-web-search-minimax-workspace`：
> 根壳没有 `dsh.bundle`，插件管理器会跳过它（profile 名单里也没有对应项），
> **装了也不会挂载**，所以别用那种形态。
>
> desktop profile 也可以用 app 内 Plugin Manager（同样两步齐全）。

## 配置

插件自带一行自挂载 patch，其中包含 `web` 行接线（**必须随插件走**：不显式配 `searchProvider` 会与内置 provider 并存撞 `WEB_PROVIDER_AMBIGUOUS`，搜索全废）：

```yaml
- id: web
  config:
    searchProvider: minimax
    fetchProvider: http
```

插件自身配置（全有默认值，通常只配 `region` 与密钥）：

| 键 | 默认 | 说明 |
|---|---|---|
| `region` | `cn` | 发行区：`cn`（国内，`api.minimaxi.com`）\| `global`（国际，`api.minimax.io`）。决定域名与默认密钥变量名 |
| `searchBaseUrl` | （空 = 按 region 派生） | 搜索接口基址；自部署网关 / 反代时显式覆盖 |
| `searchKeyEnv` | （空 = 按 region 派生） | **存密钥的环境变量名**（只存名字）；自拟变量名时显式覆盖 |
| `searchTimeoutMs` | `30000` | 单次搜索超时 |
| `logPath` | `$DSH_HOME/logs/dsh-web-search-minimax.log` | 插件日志 |

MiniMax 分**国内版**与**国际版**，两区的域名和密钥互不通用，按所用 plan 二选一。
密钥值放 `~/.dsh/.env`（红线：密钥不进任何仓库），默认变量名按 region：

```sh
# region: cn（国内版，默认）
MINIMAX_CN_API_KEY=sk-...

# region: global（国际版）—— 配置里设 region: global 后读这个变量名
MINIMAX_GLOBAL_API_KEY=sk-...
```

> 密钥来自 **MiniMax Coding Plan**；对话用的 LLM 密钥与本插件无关，不要混用。

## 验证

```sh
dsh --profile <name> --dump-config   # 能看到本包的插件行与 web 行
pnpm test                            # 本仓单测（provider 契约 / 失败分支 / 配置守卫 / 展示元数据）
```

## 展示元数据

插件管理器、bundle 详情与设置面板里的插件行会显示图标，取自 `package.json` 顶层 `icon` 字段：

```json
{ "icon": "./icon.svg" }
```

`icon.svg` 是自绘的「M」字母加搜索放大镜，取 MiniMax 主题配色（品红 `#E2167E` 到珊瑚 `#FE603C` 横向渐变）：
字母左右竖对称于画布中线，底端切平；镜圈用同一套渐变、镜柄取珊瑚实色。

放大镜压在字母右半部、中线偏右下（镜心 23.2, 22.2，在指定框内略微下移，好让字母右腿干净收在镜圈处），不挂在角上。
镜柄从**镜圈外缘**起笔，不从圆心里伸出来，免得整组图形看着像个字母 Q。

分离靠 mask：挖空区是「镜圈圆 ∪ 镜柄胶囊」的并集，两块都按各自笔画**向外再扩一圈边距**，
于是整个放大镜的外边缘四周都留着等宽空白，不会跟字母笔画连成一块。

画布 36×36、无背景底板、圆角端点，与 DSH 官方插件图标的写法一致（可对照 `dsh-experimental-session-search`、
`dsh-experimental-inspector`）。字母是自绘路径，**不使用 MiniMax 商标图形**，只借用其品牌配色，
避免在第三方插件行里出现「像官方出品」的整体装潢。

DSH 的图标规则（相对路径、SVG/PNG/JPEG/WebP、≤256 KiB、须留在包目录内）由 `tests/display-metadata.spec.ts` 静态守卫，
其中「`files` 白名单收录 `icon.svg`」一条最关键：漏了它，发布产物里就没有图标，插件行会静默退回默认占位图。

图形的几何关系另有 `tests/icon-geometry.spec.ts` 守卫：字母路径不许被顺手改形，镜柄不许退回圆心，
放大镜四周的边距不许归零。

## 发布

```sh
pnpm --filter @dreamariner/dsh-web-search-minimax publish
# 走 prepare 构建出 lib/ 再打包；scoped 包已配 publishConfig.access=public
```

## 开发

以下命令都在仓根执行（根壳按 workspace 递归转发，add 新插件后无需改）：

```sh
pnpm install
pnpm test           # vitest run（根配置通配 packages/*/tests/）
pnpm typecheck      # tsc --noEmit（根 tsconfig 通配全部插件包 src 与 tests）
pnpm build          # pnpm -r build → packages/<id>/lib/
```

### 热重载开发循环（可选）

```sh
pnpm dev            # tsdown --watch：保存 → 重建 lib/
pnpm dev:hmr        # 项目级接线：把全部插件包的 lib/ 注册进本机 DSH 的 hmr watch 根（$DSH_HOME/cordis.patch.yml）
                    # 注册后**重启实例一次**生效，之后的改动即「保存 → 实例内热重载」（免重启、PID 不变）
pnpm dev:hmr --remove   # 注销本仓全部注册
```

- 注册写的是**本机 home patch** 里本仓各插件包的 lib 路径，不触碰 root 里其它产品的行
  （本机其他工具的脚本各自管理自己的行、互不干扰）；add 新插件后重跑一次即可。
- 固有限制（DSH hmr 机制）：只认 change 事件（删除文件不触发 reload）、实例启动窗口内的
  改动被丢弃、macOS FSEvents 注册窗口。生产/分发场景不需要 hmr。

项目共用脚本在根 `scripts/`（一仓一份，add 插件不复制）：`dev-hmr.mjs`（上面的 hmr 接线）、
`lib/manifest-deps.mjs`（tsdown 配置经 `../../` 引用）、`sync-pack-docs.mjs`（发布前把仓根
README / LICENSE 同步进包目录，真源在仓根）。

依赖纪律（不变式 I1/I2）：`peerDependencies`（schemastery、dsh-web）外置由宿主供给同一实例，其余运行期依赖内联进产物；名单唯一来源是 `package.json`，tsdown 的 `deps` 三件套由 `scripts/lib/manifest-deps.mjs` 从它派生。

`@deepseek-ai/dsh-web` 必须在 peer 名单里：DSH 的模块解析器按 `peerDependencies` 判定，把 peer 的导入拦截并路由到宿主自己的那份实例。
这条是「错误码能进工具层结构化元数据」的前提，工具层取 code 的判定是 `error instanceof HarnessError`，认的是**类实例身份**。
跨包运行期导入只限 peer 名单内的包（`fetch` 等一律本地实现），否则 pnpm 隔离布局下解析不到。
