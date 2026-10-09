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

- [x] 4.1 Write failing test: `rejects capability issue without a page id and serves but does not count a page-less stream` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [x] 4.2 Implement: 能力串签发要求 `pageId`（`[A-Za-z0-9_-]{16,64}`，否则 400 `invalid-page`），写入 grant；SSE `?page=` 按 pageId 计数，缺失或非法照常推送不计数 to pass 4.1
- [x] 4.3 Refactor; full suite stays green
- [x] 4.4 Write failing test: `reclaims a page's holders 30s after its last stream connection closes` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason) — 注：随 4.2/4.5 一并实现，写成时即为绿；以变异确认测试失败（去掉宽限期满回收的订阅）
- [x] 4.5 Implement: pageId 连接数归零起 30s 宽限，期满移除该 pageId 全部持有者并清空已结束实例集合；无连接的 acquire 同样起宽限 to pass 4.4
- [x] 4.6 Refactor; full suite stays green
- [x] 4.7 Write failing test: `keeps holders when the page reconnects within the grace period` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason) — 注：随 4.2/4.5 一并实现，写成时即为绿；以变异确认测试失败（重连不取消宽限计时）
- [x] 4.8 Implement: 宽限期内同 pageId 重连取消回收 to pass 4.7
- [x] 4.9 Refactor; full suite stays green
- [x] 4.10 Write failing test: `takes the holder page id from the capability grant, not the request body` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason) — 注：随 4.2/4.5 一并实现，写成时即为绿；以变异确认测试失败（持有者 pageId 改取请求体）
- [x] 4.11 Implement: 持有者 pageId 只取自 grant；grant 缺 pageId 视为无效 to pass 4.10
- [x] 4.12 Refactor; full suite stays green
- [x] 4.13 Write failing test: `rejects an acquire whose instance was already ended for that page` in `packages/cockpit-server/tests/forward-page-reclaim.test.ts` (assert it fails for the right reason)
- [x] 4.14 Implement: `release-instance {instanceId,pageId}` 记入已结束实例集合，同 pageId + instanceId 的 acquire 以 `invalid-holder` 拒绝 to pass 4.13
- [x] 4.15 Refactor; full suite stays green

## 5. 投影与数据卫生（design D7 快照、spec 数据卫生）

- [x] 5.1 Write failing test: `omits instance and page ids from the projection, the snapshot payload and logs` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason)
- [x] 5.2 Implement: 投影与快照载荷只含标签与持有者数，日志不输出 instanceId / pageId；快照不含 pid to pass 5.1 — 快照由共享纯函数 `toForwardsSnapshot`（`@dsh-cockpit/shared`）按字段白名单生成（含 system 行、去掉 pid，供 D9 设置区块显示主通道），web 端推送时复用；`device-contracts.test.ts` 追加类型断言：快照不含 `pid`/`instanceId`/`pageId`（改入 `pid` 时编译失败，已变异确认）
- [x] 5.3 Refactor; full suite stays green

## 6. 服务端端点（design D7；cockpit-api-auth 名单）

- [x] 6.1 Write failing test: `rejects a cookie-only same-origin call to forwards/acquire with 401` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [x] 6.2 Implement: `POST /api/bridge/forwards/acquire|release` 复用 `requireBridgeCapability`，缺头 401 且先于其它校验 to pass 6.1
- [x] 6.3 Refactor; full suite stays green
- [x] 6.4 Write failing test: `rejects an expired, unknown or origin-mismatched capability on acquire with 400` in `packages/cockpit-server/tests/forwards.controller.test.ts` (assert it fails for the right reason)
- [x] 6.5 Implement: 按 grant 自身判定 400 `bridge-capability-invalid`，不经 `#lifecycleByOrigin` to pass 6.4
- [x] 6.6 Refactor; full suite stays green
- [x] 6.7 Write failing test: `returns 400, not 409, for an invalid capability from an origin with no live device` in `packages/cockpit-server/tests/forwards.controller.test.ts` (assert it fails for the right reason) — 注：与 6.4 同一实现，写成时即为绿；以变异（先经 `#lifecycleByOrigin` 解析）确认测试失败
- [x] 6.8 Implement: 判定顺序 401 → 400 → 409 `device-unavailable`（仅 acquire）→ 业务校验 to pass 6.7
- [x] 6.9 Refactor; full suite stays green
- [x] 6.10 Write failing test: `releases a holder by the grant device while the workbench channel is reconnecting` in `packages/cockpit-server/tests/forwards.controller.test.ts` (assert it fails for the right reason) — 注：与 6.4 同一实现，写成时即为绿；以变异（release 先按 origin 解析 lifecycle）确认测试失败
- [x] 6.11 Implement: release 按 grant 的 deviceId 定位转发表 to pass 6.10
- [x] 6.12 Refactor; full suite stays green
- [x] 6.13 Write failing test: `forwards list: does not exempt an unlisted /api/bridge/ path` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [x] 6.14 Implement: `isBridgeCallback` 名单改为 hello / session-opened / pending-snapshot / forwards/acquire / forwards/release to pass 6.13；`bridge-route-list.test.ts` 的权威来源改为本 change 的 delta（归档后回落到 current spec）
- [x] 6.15 Refactor; full suite stays green
- [x] 6.16 Write failing test: `forwards list: treats /API/Bridge/Hello and /API/Bridge/Forwards/Acquire as listed routes` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [x] 6.17 Implement: 新路由参与既有大小写折叠匹配 to pass 6.16
- [x] 6.18 Refactor; full suite stays green
- [x] 6.19 Write failing test: `creates a pinned 6379 entry from the cockpit page and records it in the registry` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason)
- [x] 6.20 Implement: cookie 路由 `POST /api/devices/:deviceId/forwards`、`DELETE .../forwards/:devicePort`、`POST .../forwards/release-instance` to pass 6.19
- [x] 6.21 Refactor; full suite stays green
- [x] 6.22 Write failing test: `rejects capability-only calls to the forward management endpoints` in `packages/cockpit-server/tests/app-forwards.e2e.test.ts` (assert it fails for the right reason) — 注：既有同源校验与 token 门禁已拒绝，写成时即为绿；以变异（把管理路由加入 bridge 名单）确认测试失败
- [x] 6.23 Implement: 管理端点不列入 bridge 名单，只接受驾驶舱 cookie to pass 6.22
- [x] 6.24 Refactor; full suite stays green

## 7. bridge 接缝 `cockpitBridge.forwards`（design D4(a)、D7）

- [x] 7.1 Write failing test: `throws unavailable synchronously without fetching when not configured` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.2 Implement: 提供 `forwards` 服务；未握手或不在 iframe 中同步抛出不可用 to pass 7.1 — 注：接缝实现于 `src/client/forwards.ts`，契约类型在 `@dsh-cockpit/shared`；7.4–7.20 的测试同批写出并一次性确认为红（服务缺席），实现后以变异逐项确认（origin 校验、409 换发、消失不 removed、pageshow 不换标识、不做差异通知）；另加一条 release 测试（不占场景行）
- [x] 7.3 Refactor; full suite stays green
- [x] 7.4 Write failing test: `returns starting immediately and notifies ready with loopback address and URL` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.5 Implement: acquire 携带 `{devicePort, holder, instanceId}`，立即返回 `starting`，据快照通知 ready 地址与 URL to pass 7.4
- [x] 7.6 Refactor; full suite stays green
- [x] 7.7 Write failing test: `notifies retrying then ready with the new port when the address changes` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.8 Implement: 按条目比对快照的状态与本地端口，依次通知 retrying、ready to pass 7.7
- [x] 7.9 Refactor; full suite stays green
- [x] 7.10 Write failing test: `ignores a forwards snapshot from a non-cockpit origin` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.11 Implement: 快照消息校验 `event.origin` 等于已握手驾驶舱 origin to pass 7.10
- [x] 7.12 Refactor; full suite stays green
- [x] 7.13 Write failing test: `notifies removed when a snapshot drops the entry and does not re-acquire within 60s` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.14 Implement: 条目从快照消失时通知 `removed`，不自动重新申请 to pass 7.13
- [x] 7.15 Refactor; full suite stays green
- [x] 7.16 Write failing test: `surfaces forward-limit from a 409 without renewing or retrying` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.17 Implement: `seamRequest` 对 409 不换发、不重试，透传 `code`（含 `device-unavailable`） to pass 7.16
- [x] 7.18 Refactor; full suite stays green
- [x] 7.19 Write failing test: `switches to a fresh instance id on persisted pageshow and acquires with it` in `packages/dsh-cockpit-bridge/tests/forwards.test.ts` (assert it fails for the right reason)
- [x] 7.20 Implement: 每次 effect 启动与 `pageshow`（persisted）生成新 instanceId；`pagehide` / dispose 发送 `bridge-instance-ended`；旧标识不再使用，本地持有记录丢弃并通知 `removed` to pass 7.19
- [x] 7.21 Refactor; full suite stays green

## 8. bridge 只读设置区块（design D9）

- [x] 8.1 Write failing test: `lists the system and 3939 rows with 1 / 8 and no mutation controls` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason)
- [x] 8.2 Implement: `ctx.slots.inject('settings.section', …)` 注入只读区块：行、状态、持有者标签、常驻标识、`N / 8` to pass 8.1 — 注：`src/client/settings.ts`；`slots` 经 `ctx.inject(['slots'], …)` 子 fiber 等待，不列入插件 `inject`（缺席时其它能力不受影响）；bridge 新增 `react` peer（^18.2.0）与 dev 依赖（~18.3.1，经 ws promote；lockfile 仅新增 importer 两行），打包时 external，由 DSH profile 提供；快照增加 `local` 标记供“本机设备无需转发”
- [x] 8.3 Refactor; full suite stays green
- [x] 8.4 Write failing test: `shows not-connected text and no rows outside the cockpit` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason)
- [x] 8.5 Implement: 未握手时显示“未连接驾驶舱” to pass 8.4
- [x] 8.6 Refactor; full suite stays green

## 9. web 父页面（design D4(a)、D7 快照；`Workbench.tsx`、`api/stream.ts`）

- [x] 9.1 Write failing test: `pushes a snapshot right after config and on each change, only to that device origin` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [x] 9.2 Implement: 每页加载生成 pageId，用于 SSE 与签发；配置消息后立即推送快照，投影变化时再推，targetOrigin 精确为设备 origin to pass 9.1
- [x] 9.3 Refactor; full suite stays green
- [x] 9.4 Write failing test: `forwards instance-ended from a device iframe to release-instance with the page id` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [x] 9.5 Implement: 接收 `bridge-instance-ended` 并以 cookie 调用 `release-instance {instanceId, pageId}` to pass 9.4
- [x] 9.6 Refactor; full suite stays green
- [x] 9.7 Write failing test: `accepts instance-ended from a previously loaded origin after the iframe drifts` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [x] 9.8 Implement: 按设备维护已下发配置的 origin 集合，iframe 卸载或设备移除时清空；按 `event.source` 归属 to pass 9.7
- [x] 9.9 Refactor; full suite stays green
- [x] 9.10 Write failing test: `ignores instance-ended from a foreign source or an origin never loaded by that iframe` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason)
- [x] 9.11 Implement: source 非该设备 iframe 或 origin 不在集合中时不发请求 to pass 9.10
- [x] 9.12 Refactor; full suite stays green

## 10. web 设备面板转发清单（`panels/Panels.tsx`）

- [x] 10.1 Write failing test: `lists system, pinned and held rows and updates to retrying with a diagnostic` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [x] 10.2 Implement: 清单展示 system / 常驻 / 随持有者行、状态、诊断，随状态流更新 to pass 10.1 — 注：`src/panels/ForwardList.tsx` 挂在每张设备卡片内；10.4–10.13 的测试同批写出并确认为红（清单区域不存在），实现后以变异确认（失败清空输入、跳过确认、诊断按 HTML 渲染、system 行出现删除）；样式只用既有令牌，`styles.test.ts` 追加令牌与窄屏断言
- [x] 10.3 Refactor; full suite stays green
- [x] 10.4 Write failing test: `creates a pinned 6379 redis entry and shows 3 / 8` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [x] 10.5 Implement: 创建表单调用 `POST /api/devices/:deviceId/forwards` to pass 10.4
- [x] 10.6 Refactor; full suite stays green
- [x] 10.7 Write failing test: `keeps 6379 in the input and shows the limit message on forward-limit` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [x] 10.8 Implement: 409 `code` 映射为表单说明且保留输入 to pass 10.7
- [x] 10.9 Refactor; full suite stays green
- [x] 10.10 Write failing test: `does not send delete when the holder confirmation is cancelled` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [x] 10.11 Implement: 有持有者时删除前确认，取消不发请求 to pass 10.10
- [x] 10.12 Refactor; full suite stays green
- [x] 10.13 Write failing test: `shows no-forward text and no controls for a local device` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason)
- [x] 10.14 Implement: `local` 设备显示“本机设备无需转发” to pass 10.13
- [x] 10.15 Refactor; full suite stays green

## 11. 迁移（design D8、Migration 2、4、5）

- [x] 11.1 Write failing test (extra): `publishable-port` / `publish-port` 路由返回 404，且 `COCKPIT_PORT_FORWARD_SERVICE` 不再由 bridge 提供（assert it fails for the right reason） — 测试：`app-forwards.e2e.test.ts` › `removes the publishable-port and publish-port endpoints`（旧路由 401→404）与 `forwards.test.ts` › `replaces the old cockpitBridge.portForward seam (0.6.0)`，写成后先确认为红
- [x] 11.2 Implement: 删除旧端点、`#publishablePorts`、`#publishedChannels`、bridge `portForward` 与 shared 旧类型，to pass 11.1
- [x] 11.3 Refactor; full suite stays green (旧 `publishable port registration and publishing` 测试组随之删除)；group 1 的三条「附加转发跨主通道替换存活」测试改用 `acquireForward` 继续保留；`app-auth.e2e` 的 bridge 名单回归测试改为 forwards 两条路由；bridge 删除 5 条 portForward 测试，并在 forwards 上补一条「400/401 换发一次后重试」
- [x] 11.4 Bump `packages/dsh-cockpit-bridge` 到 0.6.0（`package.json` 与 `PLUGIN_VERSION`）；run `pnpm --filter dsh-cockpit-bridge build`，confirm the bundle builds — 已执行，`lib/client.js` 构建成功，react 保持 external
- [x] 11.5 改写 README 端口发布段落与 BACKLOG 相关条目（design D10）；run `grep -rn "publish-port\|publishable-port\|已登记端口" README.md BACKLOG.md packages/*/src`，confirm no stale hit — 已执行，无命中（exit 1）；同时改写 bridge README 的接缝段落
- [x] 11.6 发布说明写明：驾驶舱与 bridge 必须同时回滚；回滚后常驻条目在旧版本下次写盘时丢失 — 写入 `packages/dsh-cockpit-bridge/README.md`「0.6.0 发布说明（升级与回滚）」

## 12. 收尾验证

- [x] 12.1 Run `pnpm build && pnpm typecheck && pnpm lint && pnpm test`; confirm all pass — exit 0：root 12、shared 8、server 302（24 文件）、web 92（10 文件）、bridge 31（3 文件），全部通过
- [x] 12.2 Run `openspec validate device-forward-registry --strict`; confirm it passes and every test-plan row is 🟢 — `Change 'device-forward-registry' is valid`；59/59 行 🟢（**该结论在 2026-10-08 复核时已失效，原因与修复见 14.1**；行数此后因组 13 增至 65，最终状态见 14.5）
- [x] 12.3 新建 `scripts/acceptance/forward-grace.mjs`（test-plan 验收项）：读 token、轮询 `GET /api/devices`、按三步判定，不满足则非零退出 — 判定逻辑为纯函数，`tests/forward-grace.test.mjs` 固定其判定（前置条件、pid 稳定、30–40 秒窗口、参数）；缺参数或缺 token 时非零退出；eslint 覆盖 `scripts/**/*.mjs`
- [x] 12.4 Run `node scripts/acceptance/forward-grace.mjs --device <id>` against a real browser session; confirm it exits 0（人类决策：30 秒宽限期真实浏览器实测），并记录实测时间 — **2026-10-08 实测 PASS**：`--device device-wr3r7ako --device-port 3939`（lumevm，持有者由设备页的 memex「打开卡片」经 shim 建立，1 holder，pid 69907）。脚本判定输出 `PASS  offline-watch=60s background=360s reclaim=30.2s`：① 驾驶舱标签页 `set offline on` 6 秒后恢复（`navigator.onLine=false→true` 已核对离线确实生效），pid 在 60 秒观察窗内不变；② 切到另一标签页后台 **360 秒**，pid 不变；③ 关闭驾驶舱标签页后条目在 **30.2 秒** 被回收（落在 30–40 秒窗口内，早于窗口即失败）。首轮曾因 `agent-browser offline` 不是顶层命令（应为 `set offline`）而得到空洞通过，已中止重跑，上面是真实离线的那次
- [x] 12.5 Manual browser check: 设备面板创建 / 删除常驻、设备页面重载释放持有、DSH 设置区块只读显示均符合 spec（含 13.17 的深浅色核对） — **2026-10-08 三项里两项已在真机核对**：
  - ✅ 设备面板创建 / 删除常驻：驾驶舱设备管理面板建 6379「redis」→ 面板 `1 / 8`、子进程 pid 67399、标签与「常驻」徽标齐全；DSH 区块**同步**出现该行（`1 / 8` + 常驻 + redis）；删除后面板与区块同时回到 `0 / 8`。
  - ✅ DSH 设置区块只读显示：lumevm（0.6.2）区块渲染「说明 + `3080 → 127.0.0.1:54695` + 就绪 + 主通道 + 附加转发 `0 / 8` + 空态引导 + 只读说明」，无任何创建 / 删除 / 释放控件；本机设备（host）显示「本机设备无需转发」+ 同机说明（13.17 的本机态）；导航行显示 transfer 字形，与相邻宿主图标重量一致。
  - ✅ **设备页面重载释放持有：修复后已真机复验通过**（见组 16）。历史记录：owner 首次核对发现条目没有消失，定位为父页面按 `event.source` 归属在跨文档导航后必然失败（详见组 16 与下方原记录）。原记录：**核对结果 = 条目没有消失（当时不满足）**。证据：核对后 `lumevm` 的 3940 条目上同时挂着**两个不同 bindingId 的持有者**（`memex-browse-3940-a8663e…` 与 `…c696da19…`）；shim 的 bindingId 每次页面加载生成一次，两个绑定即两次页面加载，而重载若按规范释放旧实例，就只应剩最后一次的绑定。我另用 `about:blank` 中转复现也未见释放。因此这是**与 `持有随所属 bridge 页面实例…结束而回收` 不符的一条路径**（`pagehide` 已发，但父页面 → `release-instance` 这一段没有产生效果；根因未定位）。
    - 影响有界：条目在面板与设置区块中始终可见可删；stale 持有者最终由**驾驶舱页面宽限**兜底回收（12.4 第③步实测 30.2 秒），因此不会永久泄漏、也不会误杀他人隧道；隧道活着，地址不会变成死缓存。
    - 尚未决定修还是记为已知限制（owner 待定）；在决定并处理之前，**本 change 不应归档**——归档会把这条已知为假的场景并入主 spec。真机核对需要一次「设备页自身的重载」（Chrome 里在 iframe 内右键 → 重新加载框架，或 DevTools 对 frame 执行 reload）。本次使用的浏览器驱动无法在跨源 frame 内发起 reload（`eval` 只作用于主帧，`iframe.src = iframe.src` 是 no-op）；用 `about:blank` 中转的替代做法**不能**作为证据（它可能让父页面在 iframe 卸载时清掉 origin 集合而拒绝 instance-ended，且释放后 shim 也可能重新持有，两者无法区分）。请人工用一次 frame reload 复核：打开驾驶舱 → lumevm → 设置 → 记忆 → 展开 → 打开卡片（产生 1 个持有者，面板 `1 / 8`）→ 在该设备页内右键「重新加载框架」→ 期望条目在数秒内（远早于 30 秒宽限）从面板消失。

## 13. 设置区块的可读性与样式（design D9；追加范围，owner 决定 2026-10-08）

原 8.x 只做到「有行、有占用、无控件」，落地的是一张无样式 `<table>` 加两句 `<p>`：在设置面板里既不像宿主的一部分，也没有一处说明这些隧道是什么、地址在哪台机器上有效、去哪里增删。本组按 D9 的「区块要回答什么」重做呈现。

- [x] 13.1 Write failing test: `explains where the local address is valid and where entries are created and deleted` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason) — 写成后 6 项确认红（视图模型形状、说明文案、令牌映射）
- [x] 13.2 Implement: 视图模型增加说明段（由驾驶舱建立 / 本地地址只在驾驶舱那台机器上有效 / 创建与删除在驾驶舱设备面板）to pass 13.1 — 视图模型输出说明段与 hint
- [x] 13.3 Refactor; full suite stays green
- [x] 13.4 Write failing test: `tells a local device that its components reach local addresses without a tunnel` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason) — 本机设备态改为 title + guidance
- [x] 13.5 Implement: 本机设备态给出同机无需隧道的说明，且不含条目与占用 to pass 13.4 — 本机设备说明同机无需隧道，且不含条目与占用
- [x] 13.6 Refactor; full suite stays green
- [x] 13.7 Write failing test: `invites a next step when the table holds only the main channel` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason) — 空表给出下一步，主通道与附加条目分组
- [x] 13.8 Implement: 主通道与附加条目分组，空表给出「组件申请或驾驶舱添加常驻后出现」的下一步 to pass 13.7 — `main` / `additional` 分组 + 空态引导
- [x] 13.9 Refactor; full suite stays green
- [x] 13.10 Write failing test: `gives every state a word so colour is never the only signal` in `packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts` (assert it fails for the right reason) — 同时把既有行测试改为按「主通道 / 常驻 / 随持有者」与 13.2 的说明段断言 — 同时把既有行测试改为断言主通道/常驻/随持有者与说明段
- [x] 13.11 Implement: 四种状态各有文字，诊断独立成行并带标签 to pass 13.10 — 四种状态文字保留，诊断独立成行并带「诊断」标签
- [x] 13.12 Refactor; full suite stays green
- [x] 13.13 Write failing test: `maps section colours onto host theme tokens without literals or external resources` in `packages/dsh-cockpit-bridge/tests/forwards-styles.test.ts` (assert it fails for the right reason) — 断言令牌命名空间、无字面色值、无外部资源、规则只匹配自有类名
- [x] 13.14 Implement: 新增 `src/client/settings-styles.ts`（自有类名前缀 + 插件标记 + 令牌映射，无字面色值、无 `url(`/`@import`），注册时幂等注入、dispose 时移除 to pass 13.13 — 实现为 `dshcf-` 类名前缀 + `data-dsh-cockpit-forwards` 标记；无 `document` 时静默跳过
- [x] 13.15 Refactor; full suite stays green
- [x] 13.16 重跑 `pnpm --filter dsh-cockpit-bridge build`，确认 `lib/client.js` 仍构建成功且 `react` 保持 external — `pnpm build` 通过；`lib/client.js` 构建成功，`react` 保持 external
- [x] 13.17 用真实 DSH 主题令牌渲染区块截图核对深色与浅色（自有预览夹具，不进入仓库）；把结论并入 12.5 的人工浏览器核对清单 — 用真实 DSH 主题令牌（从 `@deepseek-ai/dsh-client-ui-theme` 提取的 `body` / `body[data-ds-dark-theme]` 两组）渲染真实组件截图：深色与浅色均可读，380px 窄栏不溢出；据此把空槽改用 `state-idle-primary`（原先 `border-l1` 在深色下几乎不可见）、主通道 chip 改用 `border-l2` 填充。预览夹具在仓库外（`/tmp/dshcf-preview`）

## 14. 归档前置修正（MODIFIED 块的场景身份）

`openspec validate --strict` 在 2026-10-08 复核时失败：本 change 的两个 MODIFIED 块改写了主 spec 的场景名，校验器按场景名判定，于是把「改名」判成「丢场景」，归档会被拒绝。12.2 当时通过是因为主 spec 之后又被同步过（`8e2b2bb`）。

- [x] 14.1 把 MODIFIED 块中被改名的场景改回主 spec 的逐字名称：`设备禁用时清理全部附加转发`、`驾驶舱退出清理自有转发`、`能力串无效时拒绝`；并为被整个丢掉的 `附加转发失败不影响工作台` 恢复场景，to pass `openspec validate device-forward-registry --strict` — 已执行，`Change 'device-forward-registry' is valid`
- [x] 14.2 Write failing test: `keeps device status and the workbench channel untouched when an additional forward fails` in `packages/cockpit-server/tests/connectivity.service.test.ts` (assert it fails for the right reason) — 写成即绿（隔离在基线上已成立）
- [x] 14.3 Implement: 需要时让附加转发失败只影响该条目自身，to pass 14.2（若基线上即为绿，按既有惯例以变异确认测试能抓到缺陷，并在 test-plan 注明） — 行为已满足，无实现改动；按惯例以两处变异确认测试有效（去诊断赋值、失败连带 kill 工作台），见 test-plan
- [x] 14.4 Refactor; full suite stays green
- [x] 14.5 更新 `test-plan.md` 的行名与新增行，并按 12.1 全量重跑 `pnpm build && pnpm typecheck && pnpm lint && pnpm test` — 行名与新增行已更新（65 行全 🟢，无 🔴）；全量门禁 exit 0：root 12、shared 8、server 332（25 文件）、web 95（11 文件）、bridge 50（5 文件，组 15 后复跑），无 skipped；`openspec validate device-forward-registry --strict` 报 `is valid`
## 15. 设置导航行图标（design D9；owner 追加 2026-10-08）

`settings.section` 只投影 `id/order/label`，导航行图标由宿主在闭集里按 id 选，第三方区块一律回退齿轮。本组按 ohmydsh `dsh-memex` 已上线的**有界 DOM 适配**范式，为本区块的行画一个转发语义字形。

- [x] 15.1 Write failing test: `marks only the row whose text is this section's label, and unmarks it on disposal` in `packages/dsh-cockpit-bridge/tests/nav-icon.test.ts` (assert it fails for the right reason) — jsdom 环境；同时覆盖「label 变化后重新标记」与「没有 document 时不注册」 — 与实现同批写出（4 个用例），改用变异确认灵敏度：①把「文案比对」改成恒真（标记所有导航行）→ 3 例失败；②dispose 不摘标记 → 2 例失败；③定位失败改为抛错 → 2 例失败；另含「无 document 时不注册」
- [x] 15.2 Implement: 新增 `src/client/nav-icon.ts`，把标记写到「可见文案 === 当前 label」的那一个导航按钮上（MutationObserver + 幂等 reconcile），dispose 时移除全部标记，to pass 15.1 — `nav-icon.ts`：只标记 `[role="dialog"] nav button` 中文案等于当前 label 的那一个，MutationObserver + 幂等 reconcile
- [x] 15.3 Refactor; full suite stays green
- [x] 15.4 Write failing test: `stays silent when its row cannot be located` in `packages/dsh-cockpit-bridge/tests/nav-icon.test.ts` (assert it fails for the right reason) — 见 15.1 的变异③与「定位失败」用例
- [x] 15.5 Implement: 定位失败不抛错、不写标记、保留宿主官方图标 to pass 15.4 — 找不到行时不抛错、不写标记，宿主官方图标原样保留
- [x] 15.6 Refactor; full suite stays green
- [x] 15.7 Implement: `settings-styles.ts` 增加导航标记 + 字形（两个端口 + 指向右侧的箭头）的 mask 规则；`::before` 显式 `inline-block`，隐藏官方 svg（design D9 的失败面分析），并在 `forwards-styles.test.ts` 追加断言（标记只作用于自己的行、mask 用 `currentColor`、无字面色值/外部资源） — 字形与标记规则落在 `settings-styles.ts`（`NAV_MARKER` + mask）；`forwards-styles.test.ts` 追加「规则只匹配自有类名或本标记」「mask 用 currentColor」「标记规则隐藏官方 svg」，并以变异（把规则放宽成裸 `svg`）确认断言有效
- [x] 15.8 在 `index.ts` 的 settings 子 fiber 内注册适配（label 与槽复用同一 `SECTION_LABEL`），dispose 时随 effect 回收 — 与样式注入并列注册在 settings 子 fiber 内，label 复用同一 `SECTION_LABEL`
- [x] 15.9 依赖变化：`dsh-cockpit-bridge` 新增 devDependency `jsdom@^30.0.1`（jsdom 测试环境）。**只加 importer 一行**——`pnpm add` 会把 rolldown/oxc 等无关包上浮（1.2.9→1.2.13），故回滚 lockfile 后手工补 3 行并 `pnpm install --frozen-lockfile` 验证；lockfile 最终 diff 仅 3 行 — `pnpm add` 会把 rolldown/oxc 无关上浮（1.2.9→1.2.13），故回滚 lockfile 后手工补 importer 3 行，`pnpm install --frozen-lockfile` 通过（jsdom 链接到 bridge/node_modules）
- [x] 15.10 重跑 `pnpm --filter dsh-cockpit-bridge build`，确认 `lib/client.js` 仍构建成功且 `react` 保持 external — `pnpm build` 通过，`lib/client.js` 构建成功，react 保持 external
- [x] 15.11 仓外预览夹具里搭一个假的设置导航行，截图核对字形在深浅色下的可读性与对齐；把结论并入 12.5 的人工核对清单 — 假设置导航（记忆 / 驾驶舱转发 / 订阅）中标记只落在「驾驶舱转发」行；字形在 5x 缩放下深浅色均可读。**过程修正（owner 反馈后重做）**：初版「两个端口 + 箭头」在 16px 下挤成一团；二版「端口 + 离场箭头」虽重量相当但形似另一图标家族。终版按 owner 要求改为 **transfer（相向双箭头）**，并把风格对齐宿主自身标准——从 `dsh-client-ui-settings-shell` 的 `navIcon(id)` 追到 `dsh-client-ui-primitives` 的 `Icon*OutlineMedium`：`stroke-width 1.3`（`ICON_MEDIUM_STROKE`）、`viewBox 0 0 16 16`、`fill:none`、`stroke:currentColor`、圆头圆角取自 `IconChevronsUpDownOutlineMedium`、几何落在 1.5–14.5 框内。预览夹具的相邻行改用**真实** DSH 图标路径（齿轮与 chevrons）对比，深浅色下重量与风格一致（design D9 已更新）

## 16. 修复：设备页重载不释放旧实例的持有者（12.5 真机发现）

**根因（已实测定位）**：bridge 确实在 `pagehide` 发出了实例结束消息，父页面也收到了，但**按 `event.source` 判定归属的那一步必然失败**——设备页完成跨文档导航后发送方窗口消失，父页面处理消息时 `event.source` 已是 `null`（浏览器控制台实测 `sourceIsNull: true`），于是消息被拒、`release-instance` 从未被调用；旧实例的持有者只能等驾驶舱页面的 30 秒宽限兜底（实测重载后持续存在，直到驾驶舱页断开 + 30 秒才回收）。

- [x] 16.1 Instrument: 临时打点（服务端按「pageId+instanceId 的 sha256 前 8 位」记录指纹，避免把标识写进日志；父页面与 bridge 打 `console.debug`）→ 复现一次设备页导航，定位到 `event.source === null` — 证据：服务端只有 `[fwd-trace] acquire … fp=14db7a53` 而无任何 `release-instance`；浏览器控制台 `[fwd-trace-parent] instance-ended arrived {origin: …}` 紧接 `rejected: no mounted iframe owns this source {sourceIsNull: true}`
- [x] 16.2 Write failing test: `releases the instance when a reloaded device page reports from a gone source` in `packages/cockpit-web/tests/workbench-forwards.test.tsx` (assert it fails for the right reason) — 外加 `ignores a gone-source message from an origin no mounted device was configured at`
- [x] 16.3 Implement: `event.source` 为 `null` 时，归属到唯一一台「已向该 origin 下发过配置且 iframe 仍挂载」的设备；**非 `null` 的 source 不匹配仍拒绝**（既有测试 `ignores instance-ended from a foreign source…` 立刻抓到了我第一版放宽过度）to pass 16.2
- [x] 16.4 Refactor: 移除两侧临时打点（服务端 `fwd-trace`、父页面与 bridge 的 `console.debug`），全量门禁重跑
- [x] 16.5 真机复验：造持有者（`lumevm:3939:86334105`）→ 导航设备页 → **3 秒内**持有者清零（`11:46:48` 导航，`11:46:51` 起标签集合为空并保持），对比修复前同一条路径持有者一直存活到驾驶舱页断开 + 30 秒
