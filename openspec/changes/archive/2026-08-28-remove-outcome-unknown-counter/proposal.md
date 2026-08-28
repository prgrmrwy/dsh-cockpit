## Why

`outcomeUnknownCount` 是前身方案 `federated-dsh-control-plane`（中央接管远端 API）遗留的概念。当前驾驶舱遵循统筹面只读原则，只消费 `host.describe`、`session.list` 与官方事件流，从不代理远端写操作，因此永远不会产生结果未知的写操作。服务端把该计数硬编码为 `0`，删除确认分支在真实使用中不可达，字段只增加协议噪音，还会让人误以为该保护已经生效。

同时，因为该计数恒为 `0`，删除设备当前是一键直删、没有任何确认，误点即丢失设备注册记录。移除孤儿计数时必须同步补上与之无关的、无条件的删除确认。

## What Changes

- 从共享设备事实中移除 `outcomeUnknownCount`，并移除服务端硬编码输出与前端对它的依赖。
- **BREAKING**（仅限驾驶舱本机 API 与内部类型）：`DeviceStatusFacts` 不再包含 `outcomeUnknownCount`；顶栏不再输出 `data-outcome-unknown`。
- 删除设备改为无条件确认：任何设备在删除前都必须获得用户显式确认，取消则不发起删除。
- 更新连接层规范：删除确认不再以「存在 outcome-unknown 写操作」为条件；同时保留删除后不留可关联 rpcId、sessionId 或提示内容的最小诊断要求。
- 不改变 SSH 验证、隧道、重连、状态分级、事件聚合或远端 DSH 行为；不为未来可能出现的写操作预留字段——真正需要时随该需求一起定义。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `cockpit-device-connectivity`: 删除确认由条件式 outcome-unknown 门禁改为对所有设备无条件确认，并移除该计数要求。
- `cockpit-device-shell`: 设备管理面板的删除交互改为无条件确认，不再依赖 outcome-unknown 计数。

## Impact

- 共享类型：`packages/shared/src/index.ts` 及其契约测试。
- 服务端：`packages/cockpit-server/src/connectivity/connectivity.service.ts` 的事实输出。
- Web：`packages/cockpit-web/src/panels/Panels.tsx`、`packages/cockpit-web/src/components/TopBar.tsx` 及相关测试夹具。
- 兼容：仅影响驾驶舱本机 API 与自身 UI；远端 DSH 协议、注册表磁盘格式与连接语义不变。
