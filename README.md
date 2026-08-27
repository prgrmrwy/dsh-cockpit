# dsh-cockpit

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

**标准 `dsh web` 即可，零改造、零插件。**

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

## 运行

```bash
# 方式一:bin 命令(推荐,可装到 ~/.local/bin)
./bin/cockpit bootstrap      # 初始化依赖(幂等)
./bin/cockpit install        # 安装 cockpit 命令到 ~/.local/bin(可选)
cockpit start                # 构建(如需要)+ 后台启动 + 打开 UI
cockpit restart              # 重启
cockpit stop                 # 停止(严格校验 3090 端口归属后才 kill)
cockpit status               # 查看运行状态
cockpit build                # 只构建
cockpit start --dev          # 开发模式(tsx watch + vite,前台)
# 其他:--no-open 不自动开浏览器;--foreground 前台调试;-b 强制重新 build

# 方式二:手动(等价于 cockpit start 的前半段)
pnpm install
pnpm build
node packages/cockpit-server/dist/main.js
```

打开 `http://127.0.0.1:3090/`。首次访问经 HttpOnly cookie 完成本机 token
认证（token 持久化在数据目录，仅供本机防其他本地进程/恶意网页）。

## 数据目录

`~/.dsh-cockpit/`（可用 `DSH_COCKPIT_HOME` 覆盖）：

| 文件 | 用途 |
| --- | --- |
| `devices.json` | 设备注册表（0600，原子写，损坏 fail-closed 不覆盖） |
| `token` | 驾驶舱本机 token（0600） |

驾驶舱**不读取、不写入** `~/.dsh`；本机 DSH 完全无感。

## 安全与边界

- 驾驶舱服务只监听 `127.0.0.1`，凭据仅复用系统 OpenSSH 免密，**不保存**密码/私钥/passphrase。
- 不代理远端 Settings/Subscriptions/Credentials；不读取或同步 provider token；不向远端安装任何插件。
- 每个 `127.0.0.1:<port>` 均为 secure context，远端 GUI 经隧道原生运行。
- 可捕获信号（SIGINT/SIGTERM）下终结性清理自有 SSH 子进程（无 `ppid=1` 孤儿），不误杀用户其他 SSH 连接。
- 已知边界：驾驶舱离线期间的 approval/question **事件**读不回来（该状态无查询字段，属 rc.2 协议限制）；进入设备后其自身 UI 会正常显示。

## 验证（当前实现已通过的实测）

- server vitest 13/13（注册表原子性/损坏 fail-closed、SSH 身份、隧道终结性、事件转换、设备生命周期）
- 三包 typecheck + build 全绿
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

MIT
