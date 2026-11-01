# @dreamariner/dsh-web-search-minimax

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 MiniMax 联网搜索 provider，以**自挂载 bundle**（官方「一包既是 bundle 又是 plugin」形态）发布，可用 `dsh plugin` 独立安装。

## 功能

- 实现 DSH 的 `WebSearchProvider` seam：`id / available / search` 三成员。
- 走 MiniMax `POST {searchBaseUrl}/v1/coding_plan/search`，**复用对话的 LLM 密钥**，不为搜索单开账号。
- 失败一律抛带机器可读 code 的错误（`MINIMAX_SEARCH_KEY_MISSING / _TRANSPORT / _HTTP / _REJECTED / _BAD_RESPONSE / _EMPTY`），不静默返回空结果。
- MiniMax 单次最多 10 条且不支持分页：只按接口硬上限封顶并如实置 `truncated`，条数截断责任在 DSH 工具层的 `tool-web.searchMaxResults`。

## 安装

```sh
dsh plugin --profile <name> add @dreamariner/dsh-web-search-minimax   # npm
# 或从 git：
dsh plugin --profile <name> add github:dreamariner/dsh-web-search-minimax
```

git 安装拉的是源码，pnpm 会在装后跑本包的 `prepare`（`tsdown`）构建 `lib/`；pnpm ≥10 需要在 profile 的 `pnpm-workspace.yaml` 里放行构建（`allowBuilds: { "@dreamariner/dsh-web-search-minimax": true }`）。

> ⚠ **desktop profile** 会拒绝 `dsh plugin` 的 pnpm 转发（CLI 限制）：在该类 profile 安装需手动两步——
> 在 profile 目录 `pnpm add @dreamariner/dsh-web-search-minimax`（本地开发态可用 `link:<本仓路径>`），
> 再把包名加进该 profile `package.json` 的 `dsh.profile.bundles`。

## 配置

插件自带一行自挂载 patch，其中包含 `web` 行接线（**必须随插件走**：不显式配 `searchProvider` 会与内置 provider 并存撞 `WEB_PROVIDER_AMBIGUOUS`，搜索全废）：

```yaml
- id: web
  config:
    searchProvider: minimax
    fetchProvider: http
```

插件自身配置（3+1 项，全有默认值，通常零配置即可用）：

| 键 | 默认 | 说明 |
|---|---|---|
| `searchBaseUrl` | `https://api.minimaxi.com` | 搜索接口基址 |
| `searchKeyEnv` | `MINIMAX_CN_API_KEY` | **存密钥的环境变量名**（只存名字） |
| `searchTimeoutMs` | `30000` | 单次搜索超时 |
| `logPath` | `$DSH_HOME/logs/dsh-web-search-minimax.log` | 插件日志 |

密钥值放 `~/.dsh/.env`（红线：密钥不进任何仓库）：

```sh
MINIMAX_CN_API_KEY=sk-...
```

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
pnpm publish        # 走 prepare 构建出 lib/ 再打包；scoped 包已配 publishConfig.access=public
```

## 开发

```sh
pnpm install
pnpm test           # vitest run
pnpm typecheck      # tsc --noEmit
pnpm build          # tsdown → lib/
```

### 热重载开发循环（可选）

```sh
pnpm dev            # tsdown --watch：保存 → 重建 lib/
pnpm dev:hmr        # 一次性：把本包 lib/ 注册进本机 DSH 的 hmr watch 根（$DSH_HOME/cordis.patch.yml）
                    # 注册后**重启实例一次**生效，之后的改动即「保存 → 实例内热重载」（免重启、PID 不变）
pnpm dev:hmr --remove   # 注销
```

- 注册写的是**本机 home patch** 里本包自己的 lib 路径，不触碰 root 里其它产品的行
  （本机其他工具的脚本各自管理自己的行、互不干扰）。
- 固有限制（DSH hmr 机制）：只认 change 事件（删除文件不触发 reload）、实例启动窗口内的
  改动被丢弃、macOS FSEvents 注册窗口。生产/分发场景不需要 hmr。

依赖纪律（不变式 I1/I2）：`peerDependencies`（schemastery）外置由宿主供给同一实例，其余运行期依赖内联进产物；名单唯一来源是 `package.json`，tsdown 的 `deps` 三件套由 `scripts/lib/manifest-deps.mjs` 从它派生。
