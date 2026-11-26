---
id: 002
type: fix
title: headless 装载与发布面收口
status: done
priority: P1
labels: [headless, packaging, credentials]
created: 2026-11-26
updated: 2026-11-26
assignee: jianan
related: [001]
---

# 002 · headless 装载与发布面收口

## 背景

发版前审查（2026-11-26）发现四个问题，前三个同源于「凭据服务被当成硬依赖」，第四个是发布面泄露。

### 1. headless 里插件永不装载（实测）

`inject = ['web', 'credentials']`（commit b4a18e6）在 headless 下失效。

cordis 的 `inject` 是硬依赖：`Inject.resolve` 把数组每一项都当必需（`vendor/cordis/src/registry.ts:71-86`），`_refresh()` 只要有一项不在 store 里就把 epoch 置 INACTIVE（`vendor/cordis/src/fiber.ts:618-628`），`apply()` 永不执行。

而 headless 模板显式关掉该服务（`packages/bundle/headless/cordis.patch.yml:38-40`）：

```yaml
# One-shot jobs use launch-time credentials instead of the interactive store.
- id: credentials
  disabled: true
```

隔离环境实测（`DSH_HOME=/tmp/hltest`，装 0.1.3 tarball）：

```
dsh: warning: 1 entry did not activate
dsh-web-search-minimax (@dreamariner/dsh-web-search-minimax): pending (waiting for service: credentials)
```

插件日志一行不产生（`apply()` 未执行）。在 profile 里补 `- id: credentials / disabled: false` 后立刻恢复正常，因果确认。

官方设计如此：headless 的凭据来自启动环境（`process env` → `<运行目录>/.env` → `$DSH_HOME/.env`，由 `loadLayeredEnv` 建快照并物化进 `process.env`，见 `packages/boot/app-boot/src/index.ts:256-278`），不读 GUI 托管存储。上游内置 provider 同样不 inject credentials（`packages/web/web-search-deepseek/src/index.ts:49` 是 `inject = ['web']`），而是惰性 `ctx.get('credentials')`（`packages/llm/llm-deepseek/src/credential.ts:15-21`）。

### 2. 注意：不能简单回退（apply 时捕获凭据会把 undefined 固化）

这不是「简单回退」：`b4a18e6` 观察到的现象是真实的，只是修法选错了层。

`dsh-credentials-local` 的 init 是异步的（`async* [Service.init]()`，先 `loadInitial()` 再挂 chokidar watcher，`packages/credentials/credentials-local/src/index.ts:587`）。旧实现在 `apply()` 里捕获一次 `ctx.get('credentials')`，若那一刻服务还没 ACTIVE，`undefined` 会被闭包永久记住 → `available()` 恒 false → provider 从设置页消失。

更麻烦的是本插件 patch 把 `searchProvider` 显式钉成 `minimax`（`cordis.patch.yml` 末行）。`available()` 一旦答 false，seam 选择会立刻抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`（`packages/web/web/src/index.ts:312-313`，「注册了但不可用」），表现为启动后首批搜索异常。

### 3. `ready?()` 未兜存储异常

`credentials.resolve()` 会抛（`credentials-local` 在凭据文档损坏时抛 `invalid document at ...`，同文件 :200）。异常会沿 `searchReady` → `registration.when(context)`（`packages/core/tools/src/index.ts:273`）→ `ToolActivationError`（同文件 :276），最终在 `packages/core/agent-loop/src/agent.ts:422` 变成整个 turn 的 `TOOL_ACTIVATION_FAILED`。即凭据文件一坏，每轮对话都失败。

### 4. 插件页状态被定时轮询掩盖（client 半边）

面板原有一个 `setInterval` 轮询（2s 起步、15s 封顶，条件为 `status.kind !== 'unknown'` 即停），理由写作「api-remotes 异步 $mount，读早了会 unknown」。轮询是补丁式做法：它在等一个本可以用结构保证消除的时序。

核查后的实际保证链（2026-11-26）：

- **凭据服务可见即数据就绪**：cordis 的 `ctx.get(name, strict=true)` 过滤非 ACTIVE fiber（`vendor/cordis/src/reflect.ts:247-257`），而 fiber 转 ACTIVE 的条件是 init 生成器跑完（`vendor/cordis/src/fiber.ts:395-401`）；`credentials-local` 的 init 顺序是 `await loadInitial()` → 挂 watcher → 结束，因此拿到句柄时 `this.values` 必然已加载
- **boot 返回时全部 entry 已落定**：`packages/boot/app-boot/src/index.ts:1253` 的 `await ctx.get('loader')?.await()`，`fiber.await()` 会等完所有 `inertia`
- **客户端连接发生在 listen 之后**：`packages/host/webserver/src/index.ts:621`
- **三个 remote 命名空间的挂载竞态**已由 `apply()` 的 `ctx.inject(['remote.web', 'remote.settings', 'remote.credentials'])` 就绪门覆盖

即首次 `read()` 时三个数据源都必返回确定结论。轮询没有要等的东西。

> 备注：审查过程中曾误判为「凭据服务晚 init 导致面板永久显示无法查询」，并用一个自造的「describe 先抛 absent 后成功」mock 复现。该 mock 不对应真实场景（服务不在场只发生在 headless 这类没有 Host 的组合，而它没有插件页）。结论已按上述核查更正。

### 5. 面板状态的另外三处错误（client 半边）

轮询删除后继续审查 `read()` 的剩余路径，实测出三处会产出错误状态：

**5a. 读失败被误报成「未注册」**。`listProviders` 返回 `ok: false` 时旧实现把结果当空列表，算出 `registered = false`，badge 显示「provider 未注册」。一次网关错误或连接抖动就足以把人引去查安装。修法：`ok !== true` 时发布 `unknown`（无法确认），provider 注册行显示「无法确认」且不给 ✗。

**5b. 并发读乱序**。`read()` 跨三次 remote await，期间可被事件再触发一轮；没有序号时慢的旧轮晚回来会覆盖新状态。实测：连发两次 `settings/document-updated`（第一次慢、答案 minimax；第二次快、答案 deepseek-official），最终快照停在 `serving`（过期答案）。修法：每次 `read()` 领序号，`publish` 只在序号仍是最新时生效，与上游官方卡片的 `providerReadSequence` 同款。

**5c. 自定义 `searchKeyEnv` 被误标 ✗**。client 只查两个默认变量名（`DEFAULT_KEY_ENVS`），用户配自定义名时两个默认名都未配置 → 旧实现置 `keyConfigured = false` → 渲染成 ✗。修法：默认名都未托管时置 `undefined`（不可判定），文案说明自定义名与环境层客户端不可见，不再给 ✗。

**关于「实时同步」的边界**（已与林老师确认）：外部直接改 profile 的 `cordis.patch.yml` 不要求实时。DSH 的 settings 服务没有文件 watcher，`settings/document-updated` 是 `describe()` 内部的比对副作用（`packages/settings/settings/src/index.ts:302-317`），靠「有人调用 describe → 发现变化 → emit → 再调用」的自激循环维持；文件改动要等下一次 describe 才被发现。正常操作路径（设置页切提供方、Models 页填 key、插件装卸、重连）都有主动事件，能实时同步。

### 5d. badge 文案越界（宣称了客户端证明不了的结论）

badge 的判据只有 `searchProvider === 'minimax'`，但文案写的是「搜索生效中」。「生效」是结论，需要密钥可用才成立；而密钥可用性是 host 侧 `ready?()` 的判断，客户端拿不到（`WebProviderInfo` 只投影 `id / title / description`，见 `packages/web/web/src/types.ts:178-186`）。结果：密钥缺失时 badge 显示「生效中」，模型侧却没有 `web_search` 工具。

修法选了最小成本的一条（与林老师确认的 A 方案）：**badge 改说事实**，文案「搜索生效中」→「已接管搜索」；并在已接管时于 section 补一句「可用性以 host 判定为准，看插件日志的『生效自检』行或 `pnpm dsh:probe`」。

未采用的方案与理由：

- **等上游给 `WebProviderInfo` 加就绪字段**：要改上游类型 + typert 协议 + 6 个插件重跑 codegen，还需上游接受与发布，不在本仓控制内
- **自建 typert remote 暴露 `ready()`**：兄弟仓（dsh-notify / dsh-image-design）有此形态，但成本是把本仓从「单包布局、2 段构建」升级成「带 wire 契约、3 段构建 + codegen」，且与 issue 001「不做 client 推流 wire 契约」的决策冲突。为一个 badge 准确性引入全链路，性价比不成立。若将来上游 `WebProviderInfo` 演进，再评估

### 6. sourcemap 把源码打进 npm 包

`tsdown.client.config.ts` 开着 `sourcemap: true`，`files` 白名单收的是 `lib` 整个目录，`lib/client.js.map` 的 `sourcesContent` 带完整 `src/client/index.tsx`。0.1.3 已发布的 tarball 实测：

```
package/lib/client.js.map  sources: ['../src/client/index.tsx']  sourcesContent: 13195 字节
```

撞 AGENTS.md 红线「发布面不含 src」。同问题存在于 dsh-notify 与 dsh-image-design（各自的 `tsdown.client.config.ts` 也是 `sourcemap: true`）。

## 目标

- headless（无凭据服务）里插件正常装载，密钥走启动环境
- desktop（有凭据服务）里行为不回退：设置页托管 key 正常解析，不进启动窗口异常态
- 凭据服务晚就绪 / 重启后自动恢复，不需要任何启动期等待
- 凭据存储异常只让当步 `web_search` 不准入，不打挂整轮对话
- web / desktop 的插件页状态纯事件驱动，不依赖定时轮询
- 发布面不含源码

## 方案

### A `inject` 去掉 credentials（`src/index.ts`）

`export const inject = ['web']`。理由与上游同构，注释里写明「别改回硬 inject」及 2026-11-26 实测证据。

### B 凭据全程惰性（`createKeyResolver`）

签名从 `(ctx, credentials)` 改为 `(ctx)`，内部每次调用现取 `ctx.get?.('credentials')`（try/catch 包住，取不到即 undefined）。有 seam 走 seam，没有退回 `resolveKey` 环境层。

替代方案对比：

- 「保留 inject 但 patch 里条件化 searchProvider」：cordis patch 无条件语法，且解决不了缺服务时整插件不装载
- 「apply 里加 setTimeout 轮询等 credentials」：引入竞态与不必要的延迟，且与 cordis 的生命周期语义对抗
- 选定：**惰性现取 + 每步重算**，与上游一致

### C 判定职责拆分

- `available()`：改为 `URL.canParse(effectiveSearchBaseUrl(cfg))`，只做结构检查，**不判密钥**。与上游 `web-search-deepseek` 的 `available()` 同构（它只校验配置形状与常量合法性，见 `packages/web/web-search-deepseek/src/provider.ts:227-233`）。这样启动窗口内不会因凭据未就绪而答 false，避开 `CONFIGURED_UNAVAILABLE`
- `ready?()`：唯一判密钥的地方，每模型步骤重算（`packages/web/tool-web/src/search.ts:419` 的 `when` 回调），try/catch 后异常答 false

### D 凭据层观测（不改装载条件）

`apply()` 末尾，若装载时凭据服务不在场且 `ctx.inject` 可用，登记 `ctx.inject(['credentials'], () => log(...))`：这是**子 fiber 的就绪回调**，晚到不阻塞本插件，只在服务迟到时补一条日志说明已恢复。与 `inject` 声明（硬依赖）的区别在注释里写明。

注意这是 `ctx.inject`（运行时方法，创建子 fiber）而非 `export const inject`（插件静态依赖），两者语义完全不同，命名相近容易误读。

### E 面板改纯事件驱动，删除定时轮询（client 半边）

- 删掉 `start()` 里的 `setInterval` / `setTimeout` 与 `unknown` 自愈逻辑
- 保留并补齐四个事件订阅：`web/providers-changed`、`settings/document-updated`、`credentials/reference-updated`（新增：设置页填/清 key 的唯一写入信号，凭据值不属于任何 settings namespace）、`connection/reset`
- 加一条测试断言 `start()` 不注册任何 interval（防止轮询被重新引入）
- `read()` 领序号，`publish(seq, ...)` 只在序号最新时生效（修 5b）
- `listProviders` 的 `ok !== true` 按 `unknown` 处理（修 5a）
- 默认密钥变量名都未托管时 `keyConfigured = undefined` 而非 `false`（修 5c）
- 注释里写明四项结构性保证，避免后人再以「怕读早了」为由加回轮询

headless 不适用：该组合没有 Host 与浏览器层，不存在插件页。

### F 发布面收口

`tsdown.client.config.ts` 的 `sourcemap` 改 `false`。

`tests/bundle-shape.spec.ts` 加两条机械护栏：

1. `inject` 不含 `credentials`（读 `src/index.ts` 静态断言）
2. client 构建不得开 `sourcemap`（正则扫 `tsdown.client.config.ts`）

### G 测试

- `available()` 语义变更的三条断言改写（缺密钥仍 true、seam 在场仍 true）
- 新增：无 seam（headless 形态）时 provider 照常注册、`ready()` 看环境层
- 新增：凭据服务晚到自愈（apply 后才出现 seam，下一轮 `ready()` 即生效）
- 新增：凭据缺席时登记就绪回调并写日志
- `effectiveness.spec.ts` 的 inject 断言改为按 key 查找（apply 现在登记两个回调）

### H 文档

README 补「headless / CI 环境的密钥来源」小节（两组合对照表、环境变量写法、恢复 credentials 的 patch 写法）；README/AGENTS 清理失效的 `scripts/` 路径；AGENTS 红线补四条（inject 不含 credentials / 凭据不得 apply 时捕获 / available 只判结构 / 日志字段语义）。

## 影响面

- `available()` 语义收窄：不再因缺密钥返回 false。依赖它判密钥的调用方应改用 `ready?()`
- 日志 `init` 行的 `available` 字段语义跟进（现在等于结构检查结果）
- 新增支持 headless / 无凭据服务的组合
- 发布包文件数 11 → 10（少 `lib/client.js.map`）
- 不涉数据迁移；不触碰 bundle 形态（patch 未改）与 client 边界

## 验收标准

- [x] `pnpm typecheck` / `pnpm test` 全绿（102 用例，2026-11-26）
- [x] headless 隔离环境实测：装 0.1.4 build 后无 `pending` 警告，日志出现 `init： {..."credentials":false,...,"available":true}` 与 `provider 已注册`
- [x] desktop 形态仍正常（凭据 seam 优先路径有单测覆盖；晚到自愈有专门用例）
- [x] `npm pack --dry-run` 产物不含 `.map`，10 个文件
- [x] 两条新护栏在 `tests/bundle-shape.spec.ts` 生效
- [x] 面板不再注册定时器（断言 `setInterval` 未被调用）、读失败不误报未注册、并发乱序不覆盖、密钥行不误标 ✗，均有回归测试；106 用例全绿

## 依赖

- 无前置 issue；001 的发版欠账由本次 0.1.4 一并结清
- 同问题的 dsh-notify / dsh-image-design 的 sourcemap 收口**不在本 issue 范围**，需各自仓单独处理

## 进度日志

- 2026-11-26  jianan  创建并完成：inject 去 credentials、凭据全程惰性、available/ready 职责拆分、ready 兜异常、client 关 sourcemap、两条护栏、文档与 0.1.4 版本号
- 2026-11-26  jianan  补第 5d 项（badge 文案越界）：按 A 方案改为「已接管搜索」+ section 边界说明，未引入 wire 契约
- 2026-11-26  jianan  补第 5 项（面板另三处错误：读失败误报未注册 / 并发乱序 / 自定义 keyEnv 误标 ✗），各配回归测试
- 2026-11-26  jianan  补第 4 项（插件页）：先误判为凭据服务晚 init 的启动窗口并加了轮询，核查 cordis 的 strict get + ACTIVE 语义、app-boot 的 loader.await、webserver listen 时序后确认该窗口不存在，撤回轮询改为纯事件驱动，补 credentials/reference-updated 订阅与「不得注册定时器」的断言
- 2026-11-26  jianan  实测记录：headless（DSH_HOME=/tmp/hltest）装 0.1.3 得 `pending (waiting for service: credentials)`；恢复 credentials 行即恢复；0.1.4 build 装进全新 headless profile 后无 pending，日志 credentials:false / available:true
