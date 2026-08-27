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
