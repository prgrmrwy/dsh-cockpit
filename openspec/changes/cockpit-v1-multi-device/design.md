## Context

前期可行性已由真实 `lumevm` 实测证明（详见 ohmydsh 仓库 `docs/adr/ADR-0003` 附录）：远端标准 `dsh web` 双事件流可经回环隧道消费、`session.list` 的 `running` 可直接查询、真实浏览器打开远端 GUI 期间外部订阅者两条流全程未被踢出（rc.2 单消费者语义在浏览器端 `ConnectionHandle`，不在服务端事件流）、远端 GUI 无 X-Frame-Options/CSP 限制可 iframe 嵌入、每个 `127.0.0.1:<port>` 均为 secure context。因此外壳方案的全部核心假设已验证。

## Goals / Non-Goals

**Goals:**
- 一个本地服务 + 浏览器页面即可管理多台 DSH 设备
- 操作面零协议耦合：用户选中设备后直接使用该设备原生 DSH 工作台
- 统筹面只读：常驻消费官方事件流聚合「几个在跑 / 有无等待人决策」
- 采用社区可靠的底座（NestJS/React/shadcn/Base UI），自研仅限确实无社区方案的连接层与壳

**Non-Goals:**
- 全局搜索（V1 不做，架构留位）
- usage 聚合（各设备自身 DSH 内可见；usage 是远端插件路由，非官方 API，与「远端零改造」冲突）
- 跨设备操作、系统托盘通知
- 远端设置代理（永久不做）

## Decisions

### D1: 独立本地服务，而非 DSH 插件

驾驶舱运行在 `127.0.0.1:3090`（被占则递增），与本机 DSH 解耦：本机 DSH 不可用时驾驶舱仍可用，且不改本机 sidebar（Avoid 联邦那种与 5 个 UI 插件的兼容回归）。

- Alternatives: DSH 插件（会绑定本机 DSH 生命周期与版本）、桌面壳（多一套构建链）。
- Choice: 独立服务。理由：远端一个 shell 页面 + 一个本地小服务足够，复杂度最低。

### D2: 连接层全权托管 SSH 隧道，复用 `~/.ssh/config` 免密

驾驶舱 add 设备时用系统 OpenSSH 仅 BatchMode 验证；隧道由驾驶舱建立、跟踪、重连、清理。凭据仅复用用户的 SSH Agent / `~/.ssh/config`（公钥），**不保存**密码/私钥/passphrase。

- Alternatives: 用户手工建隧道（连接层无法诊断）、ssh2 库（需重造 host-key/ProxyJump，违反社区优先）。
- Choice: 系统 OpenSSH + `--` 严格 argv/option boundary 防注入。理由：与 `dsh-tunnel` skill 及联邦已验证的 SSH 层一致，利用系统 alias/ProxyJump/host-key 能力。

### D3: 只读事件流聚合，不建立持久待办账本

驾驶舱对每设备常驻消费官方双流 + 一次 `session.list` 基线；增量更新。`approval/requested` 等只有事件、无查询字段（`SessionSummary` 无 pending interaction），因此**驾驶舱离线期间的 approval 读不回来**（进入设备后设备自身 UI 会显示）。接受此边界，不引入持久化账本（避免制造第二个真相源）。

### D4: 使用 NestJS 而非 Express

连接层涉及 ssh 子进程/ws 生命周期，长期维护需要框架层面约束模块边界、生命周期钩子与 DI。已知社区对 NestJS/Express 选型有充分讨论，按长期维护选择 NestJS。

### D5: 顶栏 + 全屏面板

唯一常驻 UI 是顶栏；所有页面级内容以覆盖式全屏面板展示。设备项左键切换、右键菜单；状态点复用官方 session row 语义 + 数字角标（不发明映射、不加动画）。

### D6: iframe 懒加载、建了不销毁

工作台点击时才建 iframe；建了不销毁以保留输入/滚动/连接。跨域（端口不同）导致父页面读不到 iframe DOM，但架构上不需要；两通道（状态聚合 vs 工作台）独立，互不故障传染。

### D7: 认证仅回环 + token

服务仅监听 `127.0.0.1` 并要求 token（前端页面访问时附带），防其他本地进程/恶意网页读取机器信息。与 DSH web 相同的信任边界，但多一层本地防护。

### D8: 数据存储

驾驶舱设备注册表与其他状态存 `~/.dsh-cockpit/`（用户目录下自有目录），与 `~/.dsh` 隔离。文件写采用原子性（临时文件 + rename）、0600、父目录 0700，损坏/异常不覆盖原文件。

### D9: 架构分层与职责

```
┌──────────────────────────────────────────────┐
│ 壳层 (shell cockpit-web)                       │
│  顶栏 · 面板 · 设备项交互 · 离线遮罩           │
├──────────────────────┬────────────────────────┤
│ 状态聚合             │ 工作台承载               │
│ (awareness)          │ (workbench iframe)      │
│ ws 常驻 · 快照 · 增量 │ 懒加载 · 建了不销毁       │
├──────────────────────┴────────────────────────┤
│ 连接层 (cockpit-server / connectivity)         │
│  设备注册表 · SSH 隧道 · 探测 · 状态 · 重连       │
└──────────────────────────────────────────────┘
       每设备一条回环隧道 → 标准 dsh web (零改造)
```

### D10: 社区件与自研边界

- 复用：NestJS、React、Vite、shadcn/Base UI、`ws`
- 参考但不依赖：dsh-ssh-tunnel（多机 SSH 主机库/凭据分离/授权模型——但它是给模型用的 exec/SFTP，不含 DSH Web LocalForward，故不作为连接层复用件）
- 自研仅限：连接层（LocalForward 到 DSH Web）、状态聚合、壳 UI —— 这三件经调研确无现成社区方案

## Risks / Trade-offs

- [R1: 官方状态 icon 复用细节未验证] → 实现阶段先确认官方 row 状态点/图标的真实呈现方式；若无法复用则退化为「语义等价的自定义圆点」（不发明新映射，只在实在不可复用时）。
- [R2: 5 台 iframe 内存未实测] → 实现阶段先做 5 台内存基准；若超标，改 LRU 保留最近 3 台（建了不销毁退化为 LRU）。
- [R3: 长时间 ws 稳定性] → 依赖 keepalive + 重连自动重查快照作兜底；不承诺秒级纠偏。
- [R4: 跨域 iframe 与工作台独立性] → 父页面无法读 iframe DOM，接受为故障隔离；工作台内部错误不影响状态聚合。
- [R5: 驾驶舱离线期间的 approval 不可回读] → 接受为协议限制；进入设备后其 UI 正常显示，不为此引入持久待办账本。

## Migration Plan

- 驾驶舱为全新独立项目，无部署回滚负担；开发期与现有 DSH 生态隔离。
- 部署采用 `pnpm build` + 独立启动脚本，与 DSH 无关；后续若需要，可在 `~/.dsh` 外提供启动入口。

## Open Questions

- 无（所有会改变 spec/approach/tasks 的决策已在上述 D1-D10 定死；实现期遗留的属于 Risks，可用实测回答而不改变方向。」
