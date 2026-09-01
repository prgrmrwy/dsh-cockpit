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

## 桥接插件（可选）：与 DSH 的通信

驾驶舱核心功能**不依赖**任何插件（见「远端要求」）；`packages/dsh-cockpit-bridge`
是一个**可选**的官方 DSH web 客户端插件，运行在**设备自己的 dsh web 页面**里
（同源 cordis bundle），把 DSH 页面中一个纯浏览器本地的信号——「用户点击/打开了
哪个会话」——桥接给驾驶舱。

### 为什么需要它

官方侧栏打开会话（`sessions.list` store 的 `current`，即 `SessionManager.select`）
是**纯浏览器内存状态**，事件流上没有任何「选中」信号；驾驶舱按架构原则不读
iframe DOM，也拿不到它。有了插件后：

- 驾驶舱顶栏显示链条图标（`bridgeSeenAt`）：闭合链条表示桥接已连接，断开链条
  表示未检测到插件，一眼确认该设备连接层活着；
- 完成提醒绿点按**官方 select 语义**精确清除——打开哪个会话就清除哪个会话的绿点。
  不装插件时行为仍然正确：绿点只能靠「重新运行 / 会话删除」清除。

### 与 DSH 的通信

| 信号 | 插件侧（设备 DSH 页面内） | 驾驶舱侧 |
| --- | --- | --- |
| **启动 hello** | 页面加载即 `POST /api/bridge/hello {version}` | 按请求 `Origin` 匹配设备 → 记 `bridgeSeenAt` → 顶栏闭合链条图标 |
| **会话选择** | 订阅官方 `sessions.list` 的 `current`，用户点击会话（250ms 防抖）→ `POST /api/bridge/session-opened {sessionId}` | 按 `Origin` 匹配设备 → `clearCompletedSession(sessionId)`，只清该会话绿点 |

- **设备识别不写死**：插件不需要、也不知道自己是哪台设备——驾驶舱拿请求的
  `Origin`（`127.0.0.1:<隧道端口>`，与设备 endpoint 同源）与各设备实时端点比对
  匹配。插件运行在 DSH 页面内，天然携带正确的同源 Origin。
- **认证**：跨源 fetch 带 `credentials: include`（驾驶舱对 loopback origin 开启
  CORS credentials），凭 HttpOnly cookie 通过 token 门禁；收到 401 时先请求
  `GET /api/bootstrap` 领取 cookie，再重发一次。
- **只传 `sessionId`**：不读、不传会话内容、settings、credentials。
- **静默失败**：驾驶舱不可达时吞掉错误（fire-and-forget），绝不扰动 DSH 页面；
  下一次会话变化会重新上报。

### 安装（设备侧，可选）

每台要享受桥接能力的设备：在其 `dsh.yaml`（ohmydsh manifest）的 bundles 里加入
`"dsh-cockpit-bridge"`，profile dependencies 指向本仓库包路径，`dsh build`
物化到该设备 `~/.dsh/profiles/web`，再重启该设备的 DSH web。详见
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
- 不代理远端 Settings/Subscriptions/Credentials；不读取或同步 provider token；驾驶舱运行时零安装——桥接插件（若部署）由用户在设备侧自行安装，只上报 sessionId。
- 每个 `127.0.0.1:<port>` 均为 secure context，远端 GUI 经隧道原生运行。
- 可捕获信号（SIGINT/SIGTERM）下终结性清理自有 SSH 子进程（无 `ppid=1` 孤儿），不误杀用户其他 SSH 连接。
- 已知边界：驾驶舱离线期间的 approval/question **事件**读不回来（该状态无查询字段，属 rc.2 协议限制）；进入设备后其自身 UI 会正常显示。

## 验证（当前实现已通过的实测）

- server vitest 34/34（注册表原子性/损坏 fail-closed、SSH 身份、隧道终结性、事件转换、设备生命周期、删除确认门禁、排序归一化）
- 四包 typecheck + build 全绿；web vitest 42/42
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
