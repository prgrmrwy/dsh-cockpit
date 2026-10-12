## Why

DSH 的会话行在「根会话自身已结束、但其子代理仍在运行」时，仍显示进行中（官方 `sessionStatuses` 的 `runningSubagentCount` 额外状态）。驾驶舱当前把所有 `origin=subagent` 的会话整体排除在运行计数之外，于是出现分歧：设备自己的 UI 两处都显示 working，驾驶舱顶栏的设备项（以及设备总览）却显示空闲，用户会误以为该设备无事可做。

## What Changes

- 驾驶舱把「仍有子代理在运行」的根会话计入设备的进行中数量，与官方会话行语义对齐：根会话自身运行，或其子代理有运行中者，即为一个进行中的根会话（按根会话去重，不按子代理个数累加）。
- 子代理会话到根会话的归属由 `session.list` 的 `parentSessionId` 与 `session-added` 帧的 `parentSessionId` 获得；官方每会话状态快照（桥接）中的子代理运行位同样参与归属。
- 子代理仍然 **不** 产生完成提醒、**不** 计入待决策与完成数量（既有行为不变）。
- 离线保留、归档会话排除等既有规则不变；子代理父会话被归档时不再计入。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-device-shell`：设备项「进行中」状态的判定从「仅根会话自身运行」扩展为「根会话自身运行或其子代理在运行」；子代理完成/待决策排除规则保持。

## Impact

- `packages/shared`：`session-added` 事件增加可选 `parentSessionId`。
- `packages/cockpit-server/src/connectivity`：`rc2-client.ts`、`protocol-client.ts`（事件转换保留 parent）、`device-lifecycle.ts`（子代理运行态与父子归属、进行中计数）。
- 测试：`device-lifecycle.test.ts`、`rc2-client.test.ts`、`protocol-client.test.ts`。
- 无远端改造、无新协议字段依赖（`parentSessionId` 已在官方 `session.list` / `api-session/added` 的 SessionSummary 中）。
