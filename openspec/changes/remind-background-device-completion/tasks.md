## 1. 前台状态

- [x] 1.1 写失败测试：`DeviceEventsService` 记录每页前台设备，`isForeground` 在任一已连接页面以其为前台时为真；页面最后连接断开立即撤销；变化触发监听
- [x] 1.2 实现 `DeviceEventsService` 前台 map、`setForeground(pageId, deviceId|null)`、`isForeground`、`onForegroundChanged`
- [x] 1.3 写失败测试并实现 `POST /api/foreground`：校验 pageId/deviceId，未知设备 400；确认不在 bridge 路由名单（设备 origin 被拒）

## 2. 补记与合并

- [x] 2.1 写失败测试（device-lifecycle）：有官方快照且 S 为桥接选择、设备非前台时 `running → idle` → `completed ×1`；设备为前台时不补记；官方与补记同会话只计一次；重新运行清除；手动清除/归档/detach 清除；子代理不补记
- [x] 2.2 实现 `#backgroundCompleted`、注入 `isForeground`、`#completedSessionIds` 并集、各清除路径
- [x] 2.3 `ConnectivityService` 接线：创建 lifecycle 时注入 `isForeground`；前台变化时对新前台设备调用 `clearBackgroundCompleted()` 并发布 facts；补测试

## 3. 前端

- [x] 3.1 `api.setForeground(deviceId|null)`；`main.tsx` 在 `currentId` 变化时上报，`subscribeDevices` 每次 `onopen` 后补报；补单测

## 4. 验证

- [x] 4.1 `pnpm build && pnpm typecheck && pnpm test && pnpm lint` 全绿
- [ ] 4.2 实测：在 A 打开正在运行的 S → 切到 B → S 完成时 A 亮绿点并叮；切回 A 绿点消失；停留在 A 时完成不补记
