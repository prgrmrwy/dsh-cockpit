## Why

用户在设备 A 打开会话 S（S 正在运行），然后在驾驶舱切到设备 B。S 跑完时，A 上那页 DSH 虽然已被驾驶舱隐藏（keep-alive iframe），但它自己仍把 S 当作「正在打开」，于是官方 `completionUnread` 不标记；驾驶舱以官方标记为准，结果既不亮绿点也不响提示音——用户恰恰是在「切走去干别的」时最需要这条提醒。

DSH 无法知道自己被宿主隐藏，这个事实只有驾驶舱知道；驾驶舱也能独立观测到 S 的 `running → idle` 边缘。因此由驾驶舱在官方未读之外补记一条「后台设备完成」提醒。

## What Changes

- 驾驶舱页面向服务端上报「本页当前显示的设备」（前台设备）；页面切换设备、关闭或断开时随之更新。
- 服务端在观测到根会话 `running → idle` 时，若该会话所在设备**不是任何已连接驾驶舱页面的前台设备**，为该会话补记一条驾驶舱侧完成提醒。
- 设备的完成未读集合 = 官方未读 ∪ 驾驶舱补记；计数与提示音（`add-completion-chime`）沿用同一 `completed` 组，无需前端区分来源。
- 补记在以下情况清除：该设备成为某页前台设备；该会话重新运行；用户手动清除该设备完成提醒；会话归档或 detach。
- 驾驶舱窗口最小化或标签页在后台**不**视为「切走」（用户选择范围 1）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-device-shell`: 「完成提醒按运行轮次可靠收敛」增加「后台设备完成补记」规则与场景；官方真相源优先的既有场景全部保留。

## Impact

- `packages/cockpit-server`：新增 `POST /api/devices/:id/foreground`（驾驶舱同源 + cookie，与其他驾驶舱 API 同一认证边界，不是 bridge 路由）；`DeviceEventsService` 记录每页前台设备；`DeviceLifecycle` 增加补记集合与清除路径。
- `packages/cockpit-web`：选中设备变化时上报前台设备。
- bridge、shared 类型、远端 DSH 均不变；DSH 侧栏不会出现驾驶舱补记的标记（两侧短暂不一致是已知取舍，切回设备即收敛）。
