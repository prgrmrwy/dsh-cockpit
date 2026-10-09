## Context

见 `proposal.md` 的 Why。相关现状（读代码与真机实测得到）：

- 桥接侧：`uiSession.sessionStatus` 是官方 `dsh-client-ui-session` 的 `publishStatus()` 产物——一个 `Map<sessionId, { running, pendingInteraction, completionUnread }>`，桥接**已经**在订阅它（为上报 `pendingInteraction`，见 `pendingSource()`）。`running` 与 `completionUnread` 现在被丢弃。
- 服务端侧：`#observeRunning` / `#sessions`（`observed/running/generation/acknowledgedGeneration/completedGeneration`）+ `#bridgeSelection` 构成推导模型；`archived-sessions-changed` 与 `session-removed` 各自负责归档/detach 的清提醒。
- 2026-10-09 真机：驾驶舱重启后 lumevm 的定时磁盘清理会话在 DSH 侧栏显示「已完成」，驾驶舱 `running ×1` 无 completed（推导模型第一次观测只建立基线，永远补不回这次完成）。
- 桥接是**可选**的：远端零改造，未安装桥接的设备必须继续可用。

## Goals / Non-Goals

**Goals**

- 装了兼容桥接的设备，其完成未读与 DSH 侧栏保持一致——包括驾驶舱未观测到完成边缘、以及驾驶舱重启后仍然存在的未读。
- 未装桥接（或版本不支持）的设备，行为与今天**逐字节一致**（推导模型原样保留）。
- 手动清除在本机层面稳定：清除后不因同一官方标记的下一帧快照跳回来。

**Non-Goals**

- 不替换推导模型（见 D1）；不改顶栏图标/计数口径与清除按钮的交互；不让驾驶舱写远端（操作面零耦合）；不做「已读回写设备」。
- 不覆盖 `pendingInteraction` 的既有语义（它已有独立的 pending-snapshot 通道与「不伪造空快照」约束）。

## Decisions

### D1 权威优先、推导回退（而不是整体替换）

有官方快照的设备以 `completionUnread` 为准；没有的设备继续用运行轮次模型。两套状态在服务端按「该设备是否报告过官方快照」分流，分流点是设备级而非会话级。

- 备选：整体替换成官方标记（否决——远端零改造意味着会有长期未升级的设备，替换会让它们的完成提醒直接消失）。
- 备选：只在桥接可用时把官方标记**并入**推导结果（否决——两个来源对同一会话可能给出相反结论，合并规则无法解释给用户，且「重启后补回」这类场景会被推导侧否决）。

### D2 新增 status-snapshot 上报通道，不复用 pending 通道

桥接新增一条只读上报（`sessionId` + `running` + `completionUnread`），沿用既有的 capability 校验、按内容指纹去重、有界重试与「激活/hello 成功」恢复机会。协议版本递增（新增能力，旧消费方不受影响）。

- 备选：把两个布尔值塞进现有 `pending-snapshot`（否决——该通道的语义是「待人决策的交互」，消费端按交互语义解读；且它带「来源不可观测时不得伪造空快照」的约束，混入状态会让该约束失真）。

### D3 手动清除：本机抑制到官方标记翻转

清除仍然只清本机呈现；服务端为该会话记住「已按此标记清除」，当官方 `completionUnread` 由 false→true（新未读）或该会话重新进入运行态时解除抑制。

- 备选：清除时让设备侧也置为已读（否决——需要写远端，违反操作面零耦合）。

### D4 首帧语义与陈旧快照

官方快照到达前按回退模型呈现；到达后以快照为准，且**首次快照不产生新提醒**——它只是把设备此刻持有的未读照实显示出来。快照按设备级世代接受，乱序/陈旧帧丢弃（与基线缓冲同一闸门）。

## Risks / Trade-offs

- **协议升版要发包**：未升级设备保持回退路径，不阻塞；升级后需要一次 `dsh build` + 刷新页面（客户端半区，无需重启 DSH）。
- **盲区只是被缩小而非消灭**：没有桥接的设备仍看不到「未观测到的完成」——这是没有真相源时的固有限制，规格里明确写成回退分支。
- **两套来源并存**：分流点必须清晰（设备级），实现里禁止按会话混合判定；测试要同时覆盖两条路径与「先回退后升级」的切换。
