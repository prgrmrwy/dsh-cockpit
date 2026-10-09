## Why

驾驶舱的「已完成未读」现在是**推导**出来的（按运行轮次 + 打开确认），而 DSH 自己持有**权威标记** `uiSession.sessionStatus` 的 `completionUnread`。两套东西必然对不上：

- **没观测到就不显示**：规格写明「第一次观测只建立运行基线」，所以驾驶舱重启（或离线、休眠）期间完成的会话，DSH 侧栏有「已完成」绿点、驾驶舱什么都没有。2026-10-09 实测：驾驶舱重启后 lumevm 的定时磁盘清理会话在 DSH 显示「已完成」，驾驶舱 `running ×1` 无 completed。
- **推导模型本身脆弱**：同一天修掉的两个缺陷都出在这套推导上——把 `retainedBy.mainView`（保留计数）当成当前选择（bridge 侧），以及运行期间的选择上报把整轮预授权为已读（服务端侧）。桥接插件在 0.2.0 上本来就能读到官方标记，继续自行推导等于把权威源放着不用。
- 桥接是**可选**的（远端零改造），所以推导模型不能删——本次是「有桥接走权威源 + 无桥接保留推导」的双路径，而不是替换。

## What Changes

- **bridge**：新增每会话官方状态快照上报（`sessionId` + `running` + `completionUnread` 两个布尔值，仅标识符，不含会话内容/settings/credentials/token），沿用既有 capability、去重、有界重试与恢复机会机制；协议版本递增（seam 能力新增，不破坏旧消费方）。
- **cockpit-server**：设备报告官方状态快照时，完成未读以官方 `completionUnread` 为准（`N / 上限` 与计数口径不变）；未报告的设备继续用现有运行轮次模型。手动「清除完成提醒」仍只清本机呈现，并在官方标记翻转前保持清除（不得下一帧又跳回来）。
- **规格**：`cockpit-workbench` 新增「可选桥接上报官方完成未读状态」；`cockpit-device-shell` 的「完成提醒按运行轮次可靠收敛」改为双源（权威优先、推导回退），既有场景全部保留。
- 零 UI 变更预期：顶栏的完成图标、清除按钮与数量口径不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-workbench`: 新增桥接只读上报官方每会话状态（`running` / `completionUnread`）的要求；既有「可选桥接无损上报会话打开事实」不动。
- `cockpit-device-shell`: 「完成提醒按运行轮次可靠收敛」改为「有官方快照以官方标记为准，否则回退到运行轮次模型」，并补手动清除在权威源下的抑制语义。

## Impact

- `packages/dsh-cockpit-bridge/src/client/`（新增状态快照上报、协议版本、去重与重试）与其 tests。
- `packages/cockpit-server/src/connectivity/`（官方标记的接收、缓存与呈现；本地清除抑制；推导模型保留为回退）。
- `packages/cockpit-web/`：预期无改动（`sessionStatuses` 口径不变）。
- 发布：协议新增能力 → bridge 需**发包 + ohmydsh pin**（按仓库流程，不手打补丁）；未升级的设备保持回退路径，不阻塞。
