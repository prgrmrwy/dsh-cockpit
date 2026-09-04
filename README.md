# dsh-cockpit

**简体中文** · [English](README.en.md)

> 一个页面管理多台机器上的 DeepSeek Harness——选中设备，直接用它**原生**的
> DSH 工作台。

[![CI](https://github.com/prgrmrwy/dsh-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/prgrmrwy/dsh-cockpit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a.svg)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10.23-f69220.svg)](pnpm-workspace.yaml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

多设备 DeepSeek Harness 驾驶舱：在一个页面里管理多台机器上的 DSH，选中设备后
直接使用**该设备自己的 DSH 工作台**。

## 它是什么

```
┌────────────────────────────────────────────┐
│ ● 本机  ● VM  ○ devbox            [☰]     │  ← 驾驶舱唯一常驻 UI
├────────────────────────────────────────────┤
│                                            │
│        当前设备的完整原生 DSH                │  ← 其余空间全部给它
│                                            │
└────────────────────────────────────────────┘
```

**核心取舍**：驾驶舱**不接管**任何 workspace/session API。选中设备后承载的是
那台机器原生的 DSH Web，因此远端的 settings、usage、已装插件与未来新增能力
**天然继承**，无需逐个适配。

驾驶舱只做两件事：

1. **设备管理与连接** —— 登记设备、托管 SSH 回环隧道、健康探测、断线重连、
   分级诊断。
2. **只读状态聚合** —— 常驻消费各设备的**官方**事件流，聚合"几个在跑 / 有无
   等待人决策"，让你不进设备也能感知。

## 远端要求

**标准 `dsh web` 即可，零改造。** 下文的[桥接插件（可选）](#桥接插件可选与-dsh-的通信)是设备侧的
可选配套，不装不影响任何核心能力。

驾驶舱只使用 rc.2 官方接口：`host.describe`、`session.list` 与
`/api/events.mux`、`/api/events.host`。所需的状态信号
（`host/session-status`、`approval/requested`、`question/requested` 及其
`*/resolved`）官方事件流已全部覆盖。

前提只有两条：

- 本机到该设备的 **SSH 免密**（公钥或 Agent，复用你的 `~/.ssh/config` 别名）
- 该设备上跑着 `dsh web`

## 设计原则

- **操作面零协议耦合** —— 不代理远端 API，不重写身份，不接管事件。
- **统筹面只读** —— 只消费官方只读接口；不代理 Settings/Subscriptions/
  Credentials，不读取或同步 provider token。这是架构原则，非版本限制。
- **两通道相互独立** —— 状态聚合走驾驶舱直连，工作台走 iframe。一边故障不
  影响另一边。
- **本机与远端对称** —— 本机 DSH 也只是一台设备（无需隧道），其余处理一致。
- **不假装实时** —— 设备离线时保留最后已知状态，但明确标注离线与最后更新
  时间；连接层知道的具体原因（SSH 不通 / 隧道失败 / DSH 未运行 / 非 DSH 服务 /
  版本不兼容）直接呈现，因为远端页面自己说不出来。

## 完成提醒：生成、已读确认与人工兜底

Device Tab 上的绿色「已完成」提醒由驾驶舱服务端按**每个根会话的运行轮次**
（generation）维护：首次观测到的空闲会话不提醒；一次 `running → idle` 边缘
为该轮产生一条提醒；重新运行开始新一轮并解除旧提醒。「用户已经看过这轮结果」
可能来自两个独立来源——桥接插件上报的会话打开事实，或 Device Tab 上的人工清除——
且两者与完成边缘本身可能以任意顺序到达；服务端把它们收敛为「该轮在完成时或
完成后已被看到就不再未读」，同时不让这次确认压制该会话*下一轮*真正的新完成。

- **人工兜底始终可用**：Device Tab 上「已完成」状态图标本身就是一个独立的可
  访问清除控件（键盘可达、不冒泡到设备切换），点击/激活即可清除该设备当前
  全部完成提醒——不依赖桥接插件是否安装或是否处于可靠协议。
- **归档即处置**：会话被归档会清除其当前完成提醒；恢复一个空闲的已归档会话
  不会凭空制造新提醒（除非它之后真的重新运行又空闲）。归档集合在每次连接、
  重连与手动刷新时以官方 `workspace.list` 快照重建基线，因此断线期间发生的
  归档/恢复会在回来时被纠正，而不是留下幽灵提醒。旧版本 DSH 若不提供归档
  事件，驾驶舱也不会仅因一次 `session.list` 刷新中会话暂时缺席就当作已删除。
- **`session-removed` 是 live detach 而非永久删除**：会话离开计数并清除其当前
  提醒，但其运行轮次、已读协调与子代理分类会被保留；会话重新出现时（持久化
  会话会以 cold idle 重新列出）不会制造提醒、也不会开新轮次——只有真正的重新
  运行才会。rc.2 没有权威的「永久删除」事件，驾驶舱永不依据一次 `session.list`
  缺席或 `session-removed` 本身推导删除。
- **已知边界**：断线期间「开始并结束」的一次完成无法回读——事件流没有
  cursor/replay，只能查到最终状态，此时提醒不会出现；顶栏状态点与人工清除
  兜底照常工作。

## 桥接插件（可选）：与 DSH 的通信

驾驶舱核心功能**不依赖**任何插件（见「远端要求」）；`packages/dsh-cockpit-bridge`
是一个**可选**的官方 DSH web 客户端插件，运行在**设备自己的 dsh web 页面**里
（同源 cordis bundle），把 DSH 页面中一个纯浏览器本地的信号——「用户点击/打开了
哪个会话」——无损地桥接给驾驶舱，用于完成提醒的精确按会话已读确认。

### 为什么需要它

官方侧栏打开会话（`sessions.list` store 的 `current`，即 `SessionManager.select`）
是**纯浏览器内存状态**，事件流上没有任何「选中」信号；驾驶舱按架构原则不读
iframe DOM，也拿不到它。有了插件后：

- 驾驶舱顶栏显示链条图标（`bridgeSeenAt`）：闭合链条表示该设备的 DSH 已装桥接
  插件，断开链条表示未检测到插件——它回答「插件装了没有」，不表示连接新鲜度；
- 完成提醒绿点按**官方 select 语义**精确清除——打开哪个会话就清除哪个会话的绿点，
  且**快速连续打开多个会话、打开后立即归档、网络瞬断**等情况下也不丢失确认。
  不装插件、装的是旧版本、或桥接暂不可达时，行为仍然正确：Device Tab 的人工
  清除兜底始终可用。

### 可靠确认协议（v2）

| 信号 | 插件侧（设备 DSH 页面内） | 驾驶舱侧 |
| --- | --- | --- |
| **父页面握手** | iframe `load`、设备被激活、能力刷新时，父页面通过精确 `targetOrigin` 向 iframe `postMessage({ type: 'dsh-cockpit:bridge-config', cockpitOrigin, capability })` | 父页面先以同源 Cookie 认证向 `POST /api/devices/:id/bridge/capability` 换取绑定该设备 Origin、短 TTL 的一次性能力 |
| **启动 hello** | 收到握手后 `POST <cockpitOrigin>/api/bridge/hello {version, protocolVersion, current}`，带 `X-DSH-Cockpit-Bridge-Capability` 头 | 校验能力 → 按 `Origin` 匹配设备 → 记协议版本与最近成功时间 → 顶栏桥接图标 |
| **会话选择** | 订阅官方 `sessions.list.current`，变化时**立即捕获**该 ID 入有界去重 outbox（不是定时器触发时才读），250ms 合并网络请求后逐个 `POST .../session-opened {sessionId, current, protocolVersion}`；仅服务端明确成功后才从 outbox 移除 | 校验能力 → 按 `Origin` 匹配设备 → 确认该会话当前 generation，随乱序到达的完成边缘收敛 |
| **归档后清空** | `current` 变为 `undefined` 时上报 `{ current: null }` 并重置同值去重闩，之后恢复同一 ID 仍可再次确认 | 按会话精确处理，不清除其它会话状态 |
| **失败重试** | 网络异常、401、其它非 2xx 均保留待确认状态，单飞、有上限指数退避重试；新选择、设备激活、成功 hello 都是恢复机会 | 静默失败不影响原生 DSH 页面 |
| **capability 续签** | 收到 401 或结构化 `bridge-capability-invalid` 时，插件重置 hello 状态并向父页面 `postMessage { type: 'dsh-cockpit:capability-expired' }` 请求换发新能力 | 父页面在 **到期前**（15s 宽限）自动换发并重发 `bridge-config`；换发失败按 15s→2min 有上限退避重试，并按设备限频（5s 至多一次）——长时间停留在同一设备也不会静默失去精确已读确认 |

- **端口不写死**：插件不再固定请求 `127.0.0.1:3090`——实际 Cockpit Origin 由
  父页面握手动态提供，因此驾驶舱运行在 `COCKPIT_PORT` 指定的**任意受支持端口**
  上都能正常工作。
- **认证不依赖跨端口 Cookie**：`SameSite=Strict` 的持久 HttpOnly token 从不
  暴露给插件；父页面用自己的会话凭据换取一个绑定设备 Origin、短期有效、
  单一用途的能力串，通过请求头传给桥接调用，驾驶舱据此校验。
- **只传会话标识与协议元数据**：不读、不传会话内容、settings、credentials、
  provider token。
- **静默失败**：桥接不可达时保留待确认队列并按退避重试，绝不扰动 DSH 页面；
  outbox 有固定容量与 TTL，优先保留当前与最近选择，避免驾驶舱长期离线时
  无界增长。
- **旧版插件兼容**：仍运行旧版（协议 1）插件的设备继续按尽力而为方式上报，
  顶栏图标会标注为「已连接但非可靠协议」，并提示可用人工清除兜底。

### 安装（设备侧，可选）

每台要享受桥接能力的设备：在其 `dsh.yaml`（ohmydsh manifest）的 bundles 里加入
`"dsh-cockpit-bridge"`，profile dependencies 指向本仓库包路径，`dsh build`
物化到该设备 `~/.dsh/profiles/web`，再重启该设备的 DSH web。**已安装旧版插件的
设备需要重新 `dsh build` 并重启该设备 DSH web 才能获得 v2 可靠协议**——重启前
仍按旧协议尽力而为工作，不影响原生工作台。详见
`packages/dsh-cockpit-bridge/README.md`。

## 运行

`bin/cockpit` 是零第三方运行时依赖的 Node.js 跨平台命令，不需要 Bash、
PowerShell 脚本或 WSL。仓库通过 `packageManager` 锁定 pnpm 10.23.0；命令会优先
使用 Corepack，找不到时再使用 PATH 中的 pnpm。

```bash
# Linux / macOS
./bin/cockpit bootstrap      # 初始化依赖（幂等）
./bin/cockpit install        # 安装到 ~/.local/bin（可选）
cockpit start                # 构建(如需要)+ 后台启动 + 打开 UI
cockpit restart              # 重启
cockpit stop                 # 认证实例身份后由服务端优雅关闭
cockpit status               # 查看运行状态
cockpit build                # 只构建
cockpit start --dev          # 开发模式(tsx watch + vite,前台)
# 其他:--no-open 不自动开浏览器;--foreground 前台调试;-b 强制重新 build
```

```text
# Windows（CMD 或 PowerShell 均可，调用的是同一份 Node CLI）
node .\bin\cockpit bootstrap
node .\bin\cockpit start
node .\bin\cockpit status
node .\bin\cockpit stop
node .\bin\cockpit start --dev
```

根 `package.json` 已声明 `cockpit` bin；需要 Windows 全局短命令时可运行
`node .\bin\cockpit install`，由 pnpm 的标准 global-bin 机制生成平台 shim。

手动启动仍然可用：

```bash
pnpm install
pnpm build
node packages/cockpit-server/dist/main.js
```

默认打开 `http://127.0.0.1:3090/`。首次访问经 HttpOnly cookie 完成本机 token
认证（token 持久化在数据目录，仅供本机防其他本地进程/恶意网页）。

| 环境变量 | 用途 |
| --- | --- |
| `DSH_COCKPIT_HOME` | 数据、运行实例和日志目录 |
| `COCKPIT_PORT` | 服务端口，默认 `3090`；开发模式的 Vite API 代理同步跟随 |
| `DSH_COCKPIT_PNPM_EXECUTABLE` | pnpm 可执行文件覆盖；默认 Corepack → PATH |
| `DSH_COCKPIT_SSH_EXECUTABLE` | OpenSSH 可执行文件覆盖；默认直接从 PATH 查找 `ssh`/`ssh.exe` |
| `COCKPIT_BIN_DIR` | Unix `install` 目标目录，默认 `~/.local/bin` |

## 数据目录

`~/.dsh-cockpit/`（可用 `DSH_COCKPIT_HOME` 覆盖）：

| 文件 | 用途 |
| --- | --- |
| `devices.json` | 设备注册表（0600，原子写，损坏 fail-closed 不覆盖） |
| `token` | 驾驶舱本机 token（0600） |
| `runtime.json` | 当前实例的最小身份记录；正常关闭后删除，陈旧记录不会被当作 PID 杀进程依据 |
| `cockpit.log` | 后台服务日志 |

驾驶舱**不读取、不写入** `~/.dsh`；本机 DSH 完全无感。

`status` 会交叉验证 `runtime.json`、本机 token 与服务端认证响应。若报告陈旧记录，
且对应端口确实没有监听，下一次 `start` 会安全覆盖；若端口存在未知监听者，命令
fail-closed 拒绝停止或覆盖该进程。

## 安全与边界

- 驾驶舱服务只监听 `127.0.0.1`，凭据仅复用系统 OpenSSH 免密，**不保存**密码/私钥/passphrase。
- 不代理远端 Settings/Subscriptions/Credentials；不读取或同步 provider token；驾驶舱运行时零安装——桥接插件（若部署）由用户在设备侧自行安装，只上报会话选择标识与协议元数据。
- 桥接鉴权使用绑定设备 Origin、短 TTL、单一用途的能力串，从不向插件暴露持久 HttpOnly token；桥接 Origin 由父页面握手动态提供，与 `COCKPIT_PORT` 实际端口保持一致。
- 每个 `127.0.0.1:<port>` 均为 secure context，远端 GUI 经隧道原生运行。
- 可捕获信号（SIGINT/SIGTERM）下终结性清理自有 SSH 子进程（无 `ppid=1` 孤儿），不误杀用户其他 SSH 连接。
- 已知边界：驾驶舱离线期间的 approval/question **事件**读不回来（该状态无查询字段，属 rc.2 协议限制）；进入设备后其自身 UI 会正常显示。
- Token 鉴权中间件挂载在 Express 5（`path-to-regexp` v8）通配路由上；该版本组合下裸 `'*'` 语法已失效，且 Express 会将中间件内部 `request.path` 相对挂载点重写，因此中间件必须读取 `request.originalUrl` 才能正确匹配真实路径——这一实现细节由 `token.middleware.ts` 与配套的真实 HTTP 集成测试（`app-auth.e2e.test.ts`）保证，不需要使用方关心。

## 验证（当前实现已通过的实测）

- server vitest 129/129（注册表原子性/损坏 fail-closed、SSH 身份、隧道终结性、事件转换含归档集合、设备生命周期含 generation 状态机/ack-edge 收敛/归档恢复、**基线-事件盲窗与缓冲回放、workspace.list 归档基线、live detach 软语义**、bridge capability 生命周期与鉴权、删除确认门禁、排序归一化、**真实 NestJS+Express 集成测试确认鉴权中间件对每个 `/api/*` 路由实际生效**）
- web vitest 60/60（含 Device Tab 完成清除控件的鼠标/键盘/不冒泡、桥接已装/未装两态图标形状区分、Workbench 桥接握手与失败降级、**capability 到期前自动续签与失效自愈、切换设备清理续签定时器**）
- bridge vitest 15/15（快速多选无损、archive-before-flush、失败重试、outbox 容量/TTL、activation 重申、**capability 失效识别与父页面续签请求**、DSH 页面不受失败影响）
- 五包 typecheck + build 全绿（含 bridge host/client 双入口与 source map）
- 真实浏览器验收（agent-browser + 隔离 Cockpit 实例 + 真实本机 DSH + 可控 fake DSH）：非默认端口部署、桥接 capability 签发与 Origin 校验、完成→打开、ack-before-edge、edge-before-ack、打开后立即归档、恢复不重新点亮、下一轮真正完成重新点亮、鼠标与键盘人工清除且不切换设备
- 真实 E2E（隔离 home + 真实 lumevm）：add → 自建隧道 → READY → 工作台 HTTP 200 → 真实状态计数
- 故障注入：kill 驾驶舱 ssh → 立即 CONNECTING → 自动重连 READY；启动窗口与活跃隧道下 SIGTERM 均无孤儿
- 5 台 iframe 常驻内存基准：JS heap 增量 ≈ 13KB/台（浏览器原生隔离，驾驶舱机制开销可忽略）

## PWA

前端构建产物自带 PWA 能力（资源在 `packages/cockpit-web/public/`）：

- `manifest.webmanifest` + 图标（192/512/apple-touch）：可安装到桌面/主屏。
  `127.0.0.1` 属于 secure context，满足 PWA 安装前提。
- `sw.js`（仅生产构建注册，见 `src/pwa.ts`；dev 不注册以免干扰 HMR）：
  - 预缓存应用壳，断网也能打开驾驶舱；
  - `/api/*` 网络优先、失败回退最后缓存（离线显示最后已知状态）；
  - SSE 事件流与设备工作台 iframe（跨源端口）永不被缓存。
- 修改 SW 行为后需 bump `sw.js` 顶部的 `CACHE_VERSION`，旧缓存会在激活时被清理。

## 状态

早期开发中。设计与实施计划见 `openspec/`。

本仓库采用规范驱动开发（[OpenSpec](https://github.com/Fission-AI/OpenSpec)）：
`openspec/specs/` 是各能力的当前行为契约，`openspec/changes/archive/` 保留每
一次变更的提案、设计、任务与验证记录。想了解某个行为「为什么是这样」，先看
规范再看代码。

尚未收敛为正式 change 的未来方向记录在 [`BACKLOG.md`](BACKLOG.md)。其中
`C001 · DSH Pet 多设备统筹` 仅保留跨设备聚合/路由/Hub 的探索边界；设备本地
Pet 一期由 ohmydsh 的 `add-dsh-pet` change 负责，当前仓不实现。

## 参与贡献

欢迎 issue 与 PR。开发环境、验证命令与规范驱动流程见
[CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按
[SECURITY.md](SECURITY.md) 私密上报，不要开公开 issue。

## 背景

本项目的前身是 `ohmydsh` 中的 OpenSpec change `federated-dsh-control-plane`
（语义联合 Host：中央接管远端 API，把多机合成一棵
`Node → Workspace → Session` 树）。该路径实施到 77/82 后经重新评估归档为
「已探索但不采用」——它需要两个钉死上游 commit 的 compatibility patch，且
规范上禁止代理远端设置与订阅，因而拿不到 settings/usage/插件继承。

决策记录与实测证据见 `ohmydsh` 仓库的
`docs/adr/ADR-0003-adopt-cockpit-over-semantic-federation.md`。其中一条关键
实测结论是本项目成立的基础：**rc.2 的单消费者语义不抢占服务端事件流**——
真实浏览器打开某台 GUI 期间，外部订阅者的两条流全程未被踢出。

## License

[MIT](LICENSE) © dsh-cockpit contributors
