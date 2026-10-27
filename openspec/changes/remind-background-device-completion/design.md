## Context

- 官方 `completionUnread` 规则：`running → false` 且**该刻**会话不是页面当前会话时才标记（见 memex `dsh-unread-completed-official-source-of-truth`）。驾驶舱把设备页面放进 keep-alive iframe 并 `display:none`，DSH 页面不知道自己不可见，`current` 仍是 S，所以不标记。
- 回退轮次模型（`DeviceLifecycle.#observeRunning`）同样用 `#bridgeSelection === sessionId` 压制，切走后也会漏。
- 服务端已能观测每个根会话 `running → idle` 边缘（`#observeRunning`，来源为 `session.list` 基线与 `host/session-status` 增量），与是否有官方快照无关。
- 服务端已有「页面」概念：前端 `PAGE_ID` 随 SSE `?page=` 连接，`DeviceEventsService` 记录每页连接数并在断开后 30s 宽限回收 forward holder。

## Goals / Non-Goals

**Goals:** 切走设备期间完成的会话一定出现完成提醒（绿点 + 叮）；切回该设备即清除；官方未读的现有行为一字不改。

**Non-Goals:** 窗口最小化/标签页后台视为切走（用户选择范围 1）；向 DSH 回写已读/未读；修改 bridge 或远端；持久化补记。

## Decisions

1. **前台上报接口**：`POST /api/foreground`，body `{ pageId, deviceId | null }`。驾驶舱同源 + HttpOnly cookie，与其他驾驶舱 API 同一认证边界；**不**进 bridge 回调路由名单（设备页面 origin 调用照常被拒）。`pageId` 用 `isValidOpaqueId` 校验，`deviceId` 须为已注册设备否则 400。前端在 `currentId` 变化时以及 SSE 每次 `onopen`（重连后补报）时调用；失败静默，下一次变化或重连再报。
2. **前台状态存放**：`DeviceEventsService` 增加 `Map<pageId, deviceId>`；页面最后一条 SSE 连接断开时**立即**删除该页前台（不等 30s 宽限——宽限是为了 forward 不抖动，前台判定宁可保守地多补记）。提供 `isForeground(deviceId)`（任一已连接页面以其为前台）与 `onForegroundChanged` 监听。
3. **补记判定位置**：`DeviceLifecycle` 新增 `#backgroundCompleted: Set<sessionId>` 与注入的 `isForeground: () => boolean`。在 `#observeRunning` 的 `true → false` 分支中：若会话非子代理、未归档、且 `!isForeground()`，加入 `#backgroundCompleted`（无论有无官方快照、无论桥接选择）。`false → true` 时删除。
4. **合并口径**：`#completedSessionIds()` 两条分支最后都并上 `#backgroundCompleted`（过滤子代理/归档），用 Set 天然去重，计数口径不变。
5. **清除路径**：
   - `ConnectivityService` 监听前台变化：设备成为前台 → 调 `lifecycle.clearBackgroundCompleted()`。
   - `clearAllCompleted()`（手动清除）、`clearCompleted(id)`（bridge 打开确认）、归档、`session-removed`、lifecycle 重置路径同时清 `#backgroundCompleted` 对应项。
6. **为何不在前端做**：前端只在页面打开时存在，服务端才持续观测边缘；放在服务端也让多个驾驶舱页面一致（任一页面正看该设备即不补记）。

## Risks / Trade-offs

- [DSH 侧栏无此标记] → 两侧短暂不一致；切回设备即清除，可接受，已在 proposal 声明。
- [没有任何驾驶舱页面打开时所有完成都补记] → 下次打开驾驶舱会看到这些提醒（不叮，首帧是基线）；符合「你不在看」的语义。驾驶舱进程重启会丢失补记（易失状态，与既有约定一致）。
- [前台上报失败] → 服务端认为该页无前台，偏向多补记；切到该设备时的上报成功即清除。
- [多页面] → 任一页面正看该设备就不补记。
