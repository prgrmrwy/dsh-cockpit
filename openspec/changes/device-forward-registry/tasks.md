<!-- 依赖顺序：server 转发表 → 端点 → bridge 接缝 → web → 迁移 → 收尾验证。每个场景按 test-plan 的测试名做红 → 绿 → 重构三步；沿用既有测试的场景只重跑确认。 -->

## 0. 前置条件

- [x] 0.1 确认 `cockpit-api-same-origin` 已实现并归档：`openspec/specs/cockpit-api-auth/spec.md` 含 requirement“bridge 回调路由名单”，`createCockpitApp()` 已存在；未满足则停止，不开始本 change
- [x] 0.2 Run `pnpm test` on the base commit; confirm the suite is green before any change

## 1. 服务端所有权切分（design D1、Migration 1）

- [x] 1.1 Write failing test: `keeps an additional forward on its port across a workbench reconnect and never persists its local port` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 1.2 Implement: `TunnelManager` 就绪后退出回调与 pid；`DeviceLifecycle` 只处置主通道；`#detach` 拆为 `#replaceLifecycle` / `#terminateDevice` to pass 1.1
- [x] 1.3 Refactor; full suite stays green
- [x] 1.4 Write failing test: `keeps a live additional forward running across a workbench reconnect` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason) — 注：基线上即为绿（退避重连路径本就只替换同通道，不调用 `disposeNode`），作为特征测试保留；1.1 / 1.7 在基线上按预期失败
- [x] 1.5 Implement: 主通道重连不再终止附加通道 to pass 1.4
- [x] 1.6 Refactor; full suite stays green
- [x] 1.7 Write failing test: `keeps additional forwards across a manual reconnect and a launch URL update` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 1.8 Implement: 手动重连与启动 URL 更新走 `#replaceLifecycle`，转发表保留 to pass 1.7
- [x] 1.9 Refactor; full suite stays green
- [x] 1.10 Re-run existing test `reuses the persisted port so the endpoint origin survives a reconnect` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.11 Re-run existing test `falls back to a fresh port and still connects when the persisted port is taken` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.12 Re-run existing test `assigns a fresh port on a first connection with nothing persisted` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.13 Re-run existing test `retries on a fresh port when the reused one is stolen inside the bind window` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.14 Re-run existing test `keeps the persisted port across a link-level failure so the origin does not drift` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.15 Re-run existing test `keeps the persisted port when an early exit cannot be attributed` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.16 Re-run existing test `warns once with attribution when the local port drifts, and stays silent when it does not` in `packages/cockpit-server/tests/ssh-tunnel.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)
- [x] 1.17 Re-run existing test `does not persist a forward port for a local device` in `packages/cockpit-server/tests/connectivity.service.test.ts` after the ownership split; confirm it passes and flip its test-plan row 🟢 (behavior unchanged, no red phase)

## 2. 转发表核心（design D1–D3、D5；新文件 `connectivity/forward-table.ts`）

- [x] 2.1 Write failing test: `reuses one entry per device port and spawns once under concurrent acquires` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.2 Implement: 按设备端口单飞建立、持有者三元组幂等 to pass 2.1
- [x] 2.3 Refactor; full suite stays green
- [x] 2.4 Write failing test: `admits exactly one of two concurrent acquires at 7 of 8` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.5 Implement: 上限 8 在同步段内占位，失败者以 `forward-limit` 拒绝 to pass 2.4
- [x] 2.6 Refactor; full suite stays green
- [x] 2.7 Write failing test: `rejects invalid, reserved and local-device ports without touching the table` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.8 Implement: `invalid-port` / `reserved-port`（主通道远端端口）/ `local-device` 校验 to pass 2.7
- [x] 2.9 Refactor; full suite stays green
- [x] 2.10 Write failing test: `reclaims a held entry after its last holder and keeps a pinned one` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.11 Implement: “常驻或至少一个持有者”存续规则；释放幂等 to pass 2.10
- [x] 2.12 Refactor; full suite stays green
- [x] 2.13 Write failing test: `kills the child that finishes starting after its entry was deleted` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason) — 注：2.2 的 generation 围栏已使其在写成时即为绿；以变异检查（`#stale` 恒 false → 失败于 `disposed` 断言）确认测试能抓到该缺陷
- [x] 2.14 Implement: 删除时标记条目已移除，建立完成后立即终止子进程 to pass 2.13
- [x] 2.15 Refactor; full suite stays green
- [x] 2.16 Write failing test: `marks a ready entry retrying without an address and rebuilds it after backoff` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.17 Implement: 就绪后退出 → `retrying`，退避 1s 起加倍、上限 60s、可注入抖动；非 ready 不带地址 to pass 2.16
- [x] 2.18 Refactor; full suite stays green
- [x] 2.19 Write failing test: `pauses self-heal while the workbench channel is unavailable and rebuilds on READY` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.20 Implement: 主通道不可用时 `paused` 且暂停新建，`READY` 后重建 to pass 2.19
- [x] 2.21 Refactor; full suite stays green
- [x] 2.22 Write failing test: `rejects a newline holder and a 65-char label and truncates a 5000-char diagnostic to 300` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason)
- [x] 2.23 Implement: 持有者标签 / 常驻标签校验（`invalid-holder` / `invalid-label`），诊断截断到 300 字符 to pass 2.22
- [x] 2.24 Refactor; full suite stays green
- [x] 2.25 Write failing test: `spawns ssh -L to device loopback and never opens the forwarded port itself` in `packages/cockpit-server/tests/forward-table.test.ts` (assert it fails for the right reason) — 注：`TunnelManager` 已满足 argv 约束，写成时即为绿；以两处变异（表内打开 `net.createServer`；`-L` 去掉 `127.0.0.1` 绑定）确认测试均失败
- [x] 2.26 Implement: 子进程只以 `-L 127.0.0.1:<local>:127.0.0.1:<devicePort>` 启动，转发表不打开任何 socket to pass 2.25
- [x] 2.27 Refactor; full suite stays green

## 3. 转发表接入 ConnectivityService 与注册表（design D1、D3、D5、D6）

- [x] 3.1 Write failing test: `reads a pre-change record with only a singular localPort and no forwards field` in `packages/cockpit-server/tests/registry.test.ts` (assert it fails for the right reason)
- [x] 3.2 Implement: `DeviceRecord.forwards?`（仅常驻 `{devicePort,label?}`）进入 `validateDevice` 白名单；单个非法条目忽略并告警 to pass 3.1
- [x] 3.3 Refactor; full suite stays green
- [x] 3.4 Write failing test: `projects the workbench channel as a system row plus ready additional rows with pids` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 3.5 Implement: 投影合成 `kind: system` 行并附 pid，附加条目 ready 时带本地端口 to pass 3.4
- [x] 3.6 Refactor; full suite stays green
- [x] 3.7 Write failing test: `restores only pinned entries after a cockpit restart` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 3.8 Implement: 启动时只从注册表重建常驻条目；随持有者条目不落盘 to pass 3.7
- [x] 3.9 Refactor; full suite stays green
- [x] 3.10 Write failing test: `drops holders and keeps pinned entries across disable and re-enable` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 3.11 Implement: `#terminateDevice` 调用 `forwards.terminate()`，重新启用后重建常驻 to pass 3.10
- [x] 3.12 Refactor; full suite stays green
- [x] 3.13 Write failing test: `terminates every forward on disable and keeps the pinned mark` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 3.14 Implement: 禁用期间不启动新子进程，注册表保留常驻标记 to pass 3.13
- [x] 3.15 Refactor; full suite stays green
- [x] 3.16 Write failing test: `rehosts additional forwards on the new alias only after the workbench is READY` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 3.17 Implement: 别名变更触发 `#replaceLifecycle` 与 `forwards.rehost()` to pass 3.16
- [x] 3.18 Refactor; full suite stays green
- [x] 3.19 Write failing test: `terminates owned additional forward children on shutdown without touching foreign ssh` in `packages/cockpit-server/tests/runtime-control.test.ts` (assert it fails for the right reason) — 注：既有 `disposeAll` 已终止全部自有通道，写成时即为绿；以变异（去掉 `terminate()` 与 `disposeAll()`）确认测试失败
- [x] 3.20 Implement: `onApplicationShutdown` 经 `disposeAll` 终止附加子进程 to pass 3.19
- [x] 3.21 Refactor; full suite stays green
- [x] 3.22 Write failing test (extra, no test-plan row): 删除常驻条目时写盘失败，请求失败且内存表、持有者、子进程不变（`fails a pinned delete whose disk write fails and leaves the table, holders and child unchanged`） (assert it fails for the right reason)
- [x] 3.23 Implement: 删除常驻条目先经 `mutateDevice` 写盘，成功后才改内存与终止子进程（design D3），to pass 3.22
- [x] 3.24 Refactor; full suite stays green

## 4. 页面与实例回收（design D4）

- [ ] 4.1 Write failing test: `rejects capability issue without a page id and serves but does not count a page-less stream` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [ ] 4.2 Implement: 能力串签发要求 `pageId`（`[A-Za-z0-9_-]{16,64}`，否则 400 `invalid-page`），写入 grant；SSE `?page=` 按 pageId 计数，缺失或非法照常推送不计数 to pass 4.1
- [ ] 4.3 Refactor; full suite stays green
- [ ] 4.4 Write failing test: `reclaims a page's holders 30s after its last stream connection closes` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [ ] 4.5 Implement: pageId 连接数归零起 30s 宽限，期满移除该 pageId 全部持有者并清空已结束实例集合；无连接的 acquire 同样起宽限 to pass 4.4
- [ ] 4.6 Refactor; full suite stays green
- [ ] 4.7 Write failing test: `keeps holders when the page reconnects within the grace period` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [ ] 4.8 Implement: 宽限期内同 pageId 重连取消回收 to pass 4.7
- [ ] 4.9 Refactor; full suite stays green
- [ ] 4.10 Write failing test: `takes the holder page id from the capability grant, not the request body` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [ ] 4.11 Implement: 持有者 pageId 只取自 grant；grant 缺 pageId 视为无效 to pass 4.10
- [ ] 4.12 Refactor; full suite stays green
- [ ] 4.13 Write failing test: `rejects an acquire whose instance was already ended for that page` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [ ] 4.14 Implement: `release-instance {instanceId,pageId}` 记入已结束实例集合，同 pageId + instanceId 的 acquire 以 `invalid-holder` 拒绝 to pass 4.13
- [ ] 4.15 Refactor; full suite stays green

## 5. 投影与数据卫生（design D7 快照、spec 数据卫生）

- [ ] 5.1 Write failing test: `omits instance and page ids from the projection, the snapshot payload and logs` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [ ] 5.2 Implement: 投影与快照载荷只含标签与持有者数，日志不输出 instanceId / pageId；快照不含 pid to pass 5.1
- [ ] 5.3 Refactor; full suite stays green

## 6. 服务端端点（design D7；cockpit-api-auth 名单）

- [ ] 6.1 Write failing test: `rejects a cookie-only same-origin call to forwards/acquire with 401` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [ ] 6.2 Implement: `POST /api/bridge/forwards/acquire|release` 复用 `requireBridgeCapability`，缺头 401 且先于其它校验 to pass 6.1
- [ ] 6.3 Refactor; full suite stays green
- [ ] 6.4 Write failing test: `rejects an expired, unknown or origin-mismatched capability on acquire with 400` in `packages/cockpit-server/tests/forwards.controller.test.ts` (assert it fails for the right reason)
- [ ] 6.5 Implement: 按 grant 自身判定 400 `bridge-capability-invalid`，不经 `#lifecycleByOrigin` to pass 6.4
- [ ] 6.6 Refactor; full suite stays green
- [ ] 6.7 Write failing test: `returns 400, not 409, for an invalid capability from an origin with no live device` in `packages/cockpit-server/tests/forwards.controller.test.ts` (assert it fails for the right reason)
- [ ] 6.8 Implement: 判定顺序 401 → 400 → 409 `device-unavailable`（仅 acquire）→ 业务校验 to pass 6.7
- [ ] 6.9 Refactor; full suite stays green
- [ ] 6.10 Write failing test: `releases a holder by the grant device while the workbench channel is reconnecting` in `packages/cockpit-server/tests/forwards.controller.test.ts` (assert it fails for the right reason)
- [ ] 6.11 Implement: release 按 grant 的 deviceId 定位转发表 to pass 6.10
- [ ] 6.12 Refactor; full suite stays green
- [ ] 6.13 Write failing test: `forwards list: does not exempt an unlisted /api/bridge/ path` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [ ] 6.14 Implement: `isBridgeCallback` 名单改为 hello / session-opened / pending-snapshot / forwards/acquire / forwards/release to pass 6.13
- [ ] 6.15 Refactor; full suite stays green
- [ ] 6.16 Write failing test: `forwards list: treats /API/Bridge/Hello and /API/Bridge/Forwards/Acquire as listed routes` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [ ] 6.17 Implement: 新路由参与既有大小写折叠匹配 to pass 6.16
- [ ] 6.18 Refactor; full suite stays green
- [ ] 6.19 Write failing test: `creates a pinned 6379 entry from the cockpit page and records it in the registry` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [ ] 6.20 Implement: cookie 路由 `POST /api/devices/:deviceId/forwards`、`DELETE .../forwards/:devicePort`、`POST .../forwards/release-instance` to pass 6.19
- [ ] 6.21 Refactor; full suite stays green
- [ ] 6.22 Write failing test: `rejects capability-only calls to the forward management endpoints` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [ ] 6.23 Implement: 管理端点不列入 bridge 名单，只接受驾驶舱 cookie to pass 6.22
- [ ] 6.24 Refactor; full suite stays green

## 7. bridge 接缝 `cockpitBridge.forwards`（design D4(a)、D7）

- [ ] 7.1 Write failing test: `throws unavailable synchronously without fetching when not configured` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.2 Implement: 提供 `forwards` 服务；未握手或不在 iframe 中同步抛出不可用 to pass 7.1
- [ ] 7.3 Refactor; full suite stays green
- [ ] 7.4 Write failing test: `returns starting immediately and notifies ready with loopback address and URL` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.5 Implement: acquire 携带 `{devicePort, holder, instanceId}`，立即返回 `starting`，据快照通知 ready 地址与 URL to pass 7.4
- [ ] 7.6 Refactor; full suite stays green
- [ ] 7.7 Write failing test: `notifies retrying then ready with the new port when the address changes` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.8 Implement: 按条目比对快照的状态与本地端口，依次通知 retrying、ready to pass 7.7
- [ ] 7.9 Refactor; full suite stays green
- [ ] 7.10 Write failing test: `ignores a forwards snapshot from a non-cockpit origin` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.11 Implement: 快照消息校验 `event.origin` 等于已握手驾驶舱 origin to pass 7.10
- [ ] 7.12 Refactor; full suite stays green
- [ ] 7.13 Write failing test: `notifies removed when a snapshot drops the entry and does not re-acquire within 60s` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.14 Implement: 条目从快照消失时通知 `removed`，不自动重新申请 to pass 7.13
- [ ] 7.15 Refactor; full suite stays green
- [ ] 7.16 Write failing test: `surfaces forward-limit from a 409 without renewing or retrying` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.17 Implement: `seamRequest` 对 409 不换发、不重试，透传 `code`（含 `device-unavailable`） to pass 7.16
- [ ] 7.18 Refactor; full suite stays green
- [ ] 7.19 Write failing test: `switches to a fresh instance id on persisted pageshow and acquires with it` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [ ] 7.20 Implement: 每次 effect 启动与 `pageshow`（persisted）生成新 instanceId；`pagehide` / dispose 发送 `bridge-instance-ended`；旧标识不再使用，本地持有记录丢弃并通知 `removed` to pass 7.19
- [ ] 7.21 Refactor; full suite stays green

## 8. bridge 只读设置区块（design D9）

- [ ] 8.1 Write failing test: `lists the system and 3939 rows with 1 / 8 and no mutation controls` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason)
- [ ] 8.2 Implement: `ctx.slots.inject('settings.section', …)` 注入只读区块：行、状态、持有者标签、常驻标识、`N / 8` to pass 8.1
- [ ] 8.3 Refactor; full suite stays green
- [ ] 8.4 Write failing test: `shows not-connected text and no rows outside the cockpit` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason)
- [ ] 8.5 Implement: 未握手时显示“未连接驾驶舱” to pass 8.4
- [ ] 8.6 Refactor; full suite stays green

## 9. web 父页面（design D4(a)、D7 快照；`Workbench.tsx`、`api/stream.ts`）

- [ ] 9.1 Write failing test: `pushes a snapshot right after config and on each change, only to that device origin` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [ ] 9.2 Implement: 每页加载生成 pageId，用于 SSE 与签发；配置消息后立即推送快照，投影变化时再推，targetOrigin 精确为设备 origin to pass 9.1
- [ ] 9.3 Refactor; full suite stays green
- [ ] 9.4 Write failing test: `forwards instance-ended from a device iframe to release-instance with the page id` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [ ] 9.5 Implement: 接收 `bridge-instance-ended` 并以 cookie 调用 `release-instance {instanceId, pageId}` to pass 9.4
- [ ] 9.6 Refactor; full suite stays green
- [ ] 9.7 Write failing test: `accepts instance-ended from a previously loaded origin after the iframe drifts` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [ ] 9.8 Implement: 按设备维护已下发配置的 origin 集合，iframe 卸载或设备移除时清空；按 `event.source` 归属 to pass 9.7
- [ ] 9.9 Refactor; full suite stays green
- [ ] 9.10 Write failing test: `ignores instance-ended from a foreign source or an origin never loaded by that iframe` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [ ] 9.11 Implement: source 非该设备 iframe 或 origin 不在集合中时不发请求 to pass 9.10
- [ ] 9.12 Refactor; full suite stays green

## 10. web 设备面板转发清单（`panels/Panels.tsx`）

- [ ] 10.1 Write failing test: `lists system, pinned and held rows and updates to retrying with a diagnostic` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [ ] 10.2 Implement: 清单展示 system / 常驻 / 随持有者行、状态、诊断，随状态流更新 to pass 10.1
- [ ] 10.3 Refactor; full suite stays green
- [ ] 10.4 Write failing test: `creates a pinned 6379 redis entry and shows 3 / 8` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [ ] 10.5 Implement: 创建表单调用 `POST /api/devices/:deviceId/forwards` to pass 10.4
- [ ] 10.6 Refactor; full suite stays green
- [ ] 10.7 Write failing test: `keeps 6379 in the input and shows the limit message on forward-limit` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [ ] 10.8 Implement: 409 `code` 映射为表单说明且保留输入 to pass 10.7
- [ ] 10.9 Refactor; full suite stays green
- [ ] 10.10 Write failing test: `does not send delete when the holder confirmation is cancelled` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [ ] 10.11 Implement: 有持有者时删除前确认，取消不发请求 to pass 10.10
- [ ] 10.12 Refactor; full suite stays green
- [ ] 10.13 Write failing test: `shows no-forward text and no controls for a local device` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [ ] 10.14 Implement: `local` 设备显示“本机设备无需转发” to pass 10.13
- [ ] 10.15 Refactor; full suite stays green

## 11. 迁移（design D8、Migration 2、4、5）

- [ ] 11.1 Write failing test (extra): `publishable-port` / `publish-port` 路由返回 404，且 `COCKPIT_PORT_FORWARD_SERVICE` 不再由 bridge 提供（assert it fails for the right reason）
- [ ] 11.2 Implement: 删除旧端点、`#publishablePorts`、`#publishedChannels`、bridge `portForward` 与 shared 旧类型，to pass 11.1
- [ ] 11.3 Refactor; full suite stays green (旧 `publishable port registration and publishing` 测试组随之删除)
- [ ] 11.4 Bump `packages/dsh-cockpit-bridge` 到 0.6.0（`package.json` 与 `PLUGIN_VERSION`）；run `pnpm --filter dsh-cockpit-bridge build`，confirm the bundle builds
- [ ] 11.5 改写 README 端口发布段落与 BACKLOG 相关条目（design D10）；run `grep -rn "publish-port\|publishable-port\|已登记端口" README.md BACKLOG.md packages/*/src`，confirm no stale hit
- [ ] 11.6 发布说明写明：驾驶舱与 bridge 必须同时回滚；回滚后常驻条目在旧版本下次写盘时丢失

## 12. 收尾验证

- [ ] 12.1 Run `pnpm build && pnpm typecheck && pnpm lint && pnpm test`; confirm all pass
- [ ] 12.2 Run `openspec validate device-forward-registry --strict`; confirm it passes and every test-plan row is 🟢
- [ ] 12.3 新建 `scripts/acceptance/forward-grace.mjs`（test-plan 验收项）：读 token、轮询 `GET /api/devices`、按三步判定，不满足则非零退出
- [ ] 12.4 Run `node scripts/acceptance/forward-grace.mjs --device <id>` against a real browser session; confirm it exits 0（人类决策：30 秒宽限期真实浏览器实测），并记录实测时间
- [ ] 12.5 Manual browser check: 设备面板创建 / 删除常驻、设备页面重载释放持有、DSH 设置区块只读显示均符合 spec
