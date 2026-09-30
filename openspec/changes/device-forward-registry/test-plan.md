## Test Plan

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-api-auth/spec.md → bridge 回调路由名单 | 名单外的 bridge 路径不被豁免 | packages/cockpit-server/tests/app-forwards.e2e.test.ts | forwards list: does not exempt an unlisted /api/bridge/ path | 🔴 red |
| specs/cockpit-api-auth/spec.md → bridge 回调路由名单 | 名单内路径的大小写变体按名单匹配 | packages/cockpit-server/tests/app-forwards.e2e.test.ts | forwards list: treats /API/Bridge/Hello and /API/Bridge/Forwards/Acquire as listed routes | 🔴 red |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 已持久化端口仍然可用 | packages/cockpit-server/tests/ssh-tunnel.test.ts | reuses the persisted port so the endpoint origin survives a reconnect | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 已持久化端口被其它进程占用 | packages/cockpit-server/tests/ssh-tunnel.test.ts | falls back to a fresh port and still connects when the persisted port is taken | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 首次连接没有已持久化端口 | packages/cockpit-server/tests/ssh-tunnel.test.ts | assigns a fresh port on a first connection with nothing persisted | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 复用端口在绑定窗口内被抢占 | packages/cockpit-server/tests/ssh-tunnel.test.ts | retries on a fresh port when the reused one is stolen inside the bind window | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 首次尝试因链路原因失败后仍保留已持久化端口 | packages/cockpit-server/tests/ssh-tunnel.test.ts | keeps the persisted port across a link-level failure so the origin does not drift | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 无法归因的提前退出保留已持久化端口 | packages/cockpit-server/tests/ssh-tunnel.test.ts | keeps the persisted port when an early exit cannot be attributed | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 端口漂移可从日志定位 | packages/cockpit-server/tests/ssh-tunnel.test.ts | warns once with attribution when the local port drifts, and stays silent when it does not | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 本机设备不涉及端口复用 | packages/cockpit-server/tests/connectivity.service.test.ts | does not persist a forward port for a local device | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 附加通道端口不被持久化 | packages/cockpit-server/tests/connectivity.service.test.ts | keeps an additional forward on its port across a workbench reconnect and never persists its local port | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 旧记录的单数端口字段仍被识别 | packages/cockpit-server/tests/registry.test.ts | reads a pre-change record with only a singular localPort and no forwards field | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 表中列出主通道与附加条目 | packages/cockpit-server/tests/connectivity.service.test.ts | projects the workbench channel as a system row plus ready additional rows with pids | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 同一设备端口复用条目且并发只建立一次 | packages/cockpit-server/tests/forward-table.test.ts | reuses one entry per device port and spawns once under concurrent acquires | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 并发申请不突破上限 | packages/cockpit-server/tests/forward-table.test.ts | admits exactly one of two concurrent acquires at 7 of 8 | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 非法、保留端口与本机设备被拒绝 | packages/cockpit-server/tests/forward-table.test.ts | rejects invalid, reserved and local-device ports without touching the table | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目只有常驻与随持有者两种寿命 | 持有者全部释放后回收，常驻条目不回收 | packages/cockpit-server/tests/forward-table.test.ts | reclaims a held entry after its last holder and keeps a pinned one | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目只有常驻与随持有者两种寿命 | 删除发生在建立过程中 | packages/cockpit-server/tests/forward-table.test.ts | kills the child that finishes starting after its entry was deleted | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目只有常驻与随持有者两种寿命 | 驾驶舱重启后只恢复常驻条目 | packages/cockpit-server/tests/connectivity.service.test.ts | restores only pinned entries after a cockpit restart | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目只有常驻与随持有者两种寿命 | 禁用设备丢弃持有者、保留常驻 | packages/cockpit-server/tests/connectivity.service.test.ts | drops holders and keeps pinned entries across disable and re-enable | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 设备页面重载后旧实例的持有被释放 | packages/cockpit-web/tests/workbench-forwards.test.tsx | forwards instance-ended from a device iframe to release-instance with the page id | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 主通道端口漂移后，旧实例的结束消息仍被接受 | packages/cockpit-web/tests/workbench-forwards.test.tsx | accepts instance-ended from a previously loaded origin after the iframe drifts | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 非所属来源的实例结束消息被忽略 | packages/cockpit-web/tests/workbench-forwards.test.tsx | ignores instance-ended from a foreign source or an origin never loaded by that iframe | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 释放实例先于同实例的在途申请到达 | packages/cockpit-server/tests/forward-page-reclaim.test.ts | rejects an acquire whose instance was already ended for that page | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 驾驶舱页面关闭后宽限期满回收 | packages/cockpit-server/tests/forward-page-reclaim.test.ts | reclaims a page's holders 30s after its last stream connection closes | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 设备状态流短暂断线，宽限期内重连不触发回收 | packages/cockpit-server/tests/forward-page-reclaim.test.ts | keeps holders when the page reconnects within the grace period | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 设备页面经 bfcache 恢复后以新实例标识申请 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | switches to a fresh instance id on persisted pageshow and acquires with it | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 请求体中的页面标识被忽略 | packages/cockpit-server/tests/forward-page-reclaim.test.ts | takes the holder page id from the capability grant, not the request body | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 持有随所属 bridge 页面实例或驾驶舱页面结束而回收 | 签发请求缺少页面标识被拒绝，无页面标识的状态流不计数 | packages/cockpit-server/tests/forward-page-reclaim.test.ts | rejects capability issue without a page id and serves but does not count a page-less stream | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 转发中途断开后自动重建，期间不交付地址 | packages/cockpit-server/tests/forward-table.test.ts | marks a ready entry retrying without an address and rebuilds it after backoff | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 主通道断开期间不重建附加条目 | packages/cockpit-server/tests/forward-table.test.ts | pauses self-heal while the workbench channel is unavailable and rebuilds on READY | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 主通道断开不终止仍存活的附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | keeps a live additional forward running across a workbench reconnect | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 编辑 SSH 别名后附加转发改连新主机 | packages/cockpit-server/tests/connectivity.service.test.ts | rehosts additional forwards on the new alias only after the workbench is READY | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 申请立即返回，就绪后通知地址 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | returns starting immediately and notifies ready with loopback address and URL | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 条目被删除后持有者收到 removed，且不自动重新申请 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | notifies removed when a snapshot drops the entry and does not re-acquire within 60s | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 地址变化时通知持有者 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | notifies retrying then ready with the new port when the address changes | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 不在驾驶舱中时接缝不可用 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | throws unavailable synchronously without fetching when not configured | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱父页面向设备页面推送转发表快照 | 配置下发后及转发表变化时推送到对应设备 | packages/cockpit-web/tests/workbench-forwards.test.tsx | pushes a snapshot right after config and on each change, only to that device origin | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱父页面向设备页面推送转发表快照 | 伪造来源的快照消息被忽略 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | ignores a forwards snapshot from a non-cockpit origin | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表的投影、标签与诊断受数据卫生约束 | 投影不含实例与页面标识 | packages/cockpit-server/tests/connectivity.service.test.ts | omits instance and page ids from the projection, the snapshot payload and logs | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 转发表的投影、标签与诊断受数据卫生约束 | 非法标签被拒绝，超长诊断被截断 | packages/cockpit-server/tests/forward-table.test.ts | rejects a newline holder and a 65-char label and truncates a 5000-char diagnostic to 300 | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 转发表管理端点仅供驾驶舱自身页面使用 | 驾驶舱页面创建常驻条目 | packages/cockpit-server/tests/app-forwards.e2e.test.ts | creates a pinned 6379 entry from the cockpit page and records it in the registry | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表管理端点仅供驾驶舱自身页面使用 | 只携带能力串的请求不能使用管理端点 | packages/cockpit-server/tests/app-forwards.e2e.test.ts | rejects capability-only calls to the forward management endpoints | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页只读呈现本设备转发清单 | 设置页列出转发 | packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts | lists the system and 3939 rows with 1 / 8 and no mutation controls | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页只读呈现本设备转发清单 | 不在驾驶舱中时显示说明 | packages/dsh-cockpit-bridge/tests/forwards-settings.test.ts | shows not-connected text and no rows outside the cockpit | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 设备禁用时终止全部附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | terminates every forward on disable and keeps the pinned mark | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 主通道重连或认证更新不影响附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | keeps additional forwards across a manual reconnect and a launch URL update | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 驾驶舱退出时清理自有转发 | packages/cockpit-server/tests/runtime-control.test.ts | terminates owned additional forward children on shutdown without touching foreign ssh | 🟢 green |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 能力串无效时以既有响应拒绝 | packages/cockpit-server/tests/forwards.controller.test.ts | rejects an expired, unknown or origin-mismatched capability on acquire with 400 | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 不对应在线设备的 origin 带无效能力串返回 400 | packages/cockpit-server/tests/forwards.controller.test.ts | returns 400, not 409, for an invalid capability from an origin with no live device | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 主通道断开期间释放照常生效 | packages/cockpit-server/tests/forwards.controller.test.ts | releases a holder by the grant device while the workbench channel is reconnecting | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 同源页面只带 cookie 调用申请端点被拒绝 | packages/cockpit-server/tests/app-forwards.e2e.test.ts | rejects a cookie-only same-origin call to forwards/acquire with 401 | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 业务拒绝不触发能力串换发 | packages/dsh-cockpit-bridge/tests/forwards.test.ts | surfaces forward-limit from a 409 without renewing or retrying | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 驾驶舱不进入数据路径 | packages/cockpit-server/tests/forward-table.test.ts | spawns ssh -L to device loopback and never opens the forwarded port itself | 🟢 green |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 面板列出设备转发并实时更新 | packages/cockpit-web/tests/forward-panel.test.tsx | lists system, pinned and held rows and updates to retrying with a diagnostic | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 面板手动创建常驻转发 | packages/cockpit-web/tests/forward-panel.test.tsx | creates a pinned 6379 redis entry and shows 3 / 8 | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 面板创建失败时保留输入 | packages/cockpit-web/tests/forward-panel.test.tsx | keeps 6379 in the input and shows the limit message on forward-limit | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 删除仍有持有者的条目需确认 | packages/cockpit-web/tests/forward-panel.test.tsx | does not send delete when the holder confirmation is cancelled | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 本机设备不提供转发操作 | packages/cockpit-web/tests/forward-panel.test.tsx | shows no-forward text and no controls for a local device | 🔴 red |

### 验收项（人类决策：30 秒宽限期以真实浏览器实测为准）

这一项不对应 spec 场景，所以不计入上表的 59 行，也不替代上表“驾驶舱页面关闭后宽限期满回收”“设备状态流短暂断线，宽限期内重连不触发回收”两行的假计时器测试。它用来确认 30 秒这个常数在真实浏览器中成立。

| Acceptance | Check | Test File | Test Name | Initial State |
|------------|-------|-----------|-----------|---------------|
| design → 人类决策记录：30 秒宽限期真实浏览器实测 | 真实浏览器中 EventSource 断线重连与后台节流不触发回收；关闭页面后 30–40 秒内回收 | scripts/acceptance/forward-grace.mjs | `node scripts/acceptance/forward-grace.mjs --device <id>` exits 0 | N/A — non-executable |

## Coverage Notes

- **共享夹具（server）**
  - **fake ssh / TunnelManager**：沿用 `ssh-tunnel.test.ts` 的 `FakeProcess`，以及 `connectivity.service.test.ts` 中 `vi.mock` 替换的 `FakeTunnelManager`。
    - `FakeTunnelManager` 需要扩展：记录每次 spawn 的 argv 与 pid；能主动触发“就绪后退出”回调（design D5）；能让某条通道停在 `starting`，再手动完成。
    - `forward-table.test.ts` 直接对 `forward-table.ts` 注入一个假的 channel spawner（design D2 的接缝），不经 `ConnectivityService`。
  - **fake timers**：
    - 宽限回收（30 秒）与自愈退避（1 秒起加倍、上限 60 秒、带抖动）一律用 `vi.useFakeTimers()`。
    - 抖动源须可注入：测试传入固定随机数，使退避时刻可断言。
    - “60 秒内不自动重新申请”（bridge）同样用 fake timers 推进 60 秒，再断言没有 fetch。
  - **页面连接计数**：`forward-page-reclaim.test.ts` 直接驱动 `DeviceEventsService` 的 `subscribe(pageId)` / 退订，并与转发表组装；不起 HTTP。签发 400 `invalid-page` 通过 `DevicesController` 断言。
  - **不带 `page` 的状态流**：在同一文件中，用控制器的 SSE handler 加一个假 `response` 断言“照常收到推送但不计数”。
  - **e2e（`app-forwards.e2e.test.ts`）**：
    - 经前置 change 引入的共享工厂 `createCockpitApp()` 启动真实 NestJS 应用，使用临时 `DSH_COCKPIT_HOME`，`listen(0, '127.0.0.1')`，与 `app-same-origin.e2e.test.ts` 相同。
    - 凡是需要自定义 `Host` 的请求，一律用 `node:http.request`，因为 Node `fetch` 会静默覆盖 `Host`。
    - `Origin`、`Sec-Fetch-Site` 与能力串头都由测试直接构造。
  - **设备状态 fixture**：e2e 中没有真实 ssh。需要在线设备的用例，通过 `ConnectivityService` 的测试替身，或在临时 home 中放一台 `local` 设备来构造（取决于用例是否需要主通道端点）。管理端点只校验鉴权与转发表不变，因此 e2e 不启动子进程。
- **共享夹具（bridge）**：沿用 `client.test.ts` 的 `FakeWindow`、`fakeCtx` 与 `fetchMock`。
  - `FakeWindow` 需扩展：支持 `pagehide` / `pageshow` 事件（带 `persisted`），并记录 `parent.postMessage` 的 `targetOrigin`。
  - `fakeCtx` 需扩展：`ctx.slots.inject/register`，用于设置区块。
  - `forwards-settings.test.ts` 只断言区块的渲染描述（行数据、占用、是否有控件），不引入 DOM 库，因为 bridge 包的测试环境是 `node`。
- **共享夹具（web）**：
  - `workbench-forwards.test.tsx` 沿用 `workbench.test.tsx` 的 `device()` 工厂与 jsdom。
  - 父页面收到的 `MessageEvent` 用 `new MessageEvent('message', { source: iframe.contentWindow, origin })` 构造。
  - “origin 漂移”用例先渲染 endpoint O1、再换成 O2，然后从 O1 派发消息。
  - `forward-panel.test.tsx` 沿用 `device-panel.test.tsx` 的渲染方式，并 mock `api/client.ts`。
- **跨包边界**：
  - 三个包各自只测本包的边界，并在共享契约处对齐：
    - server 断言 HTTP 契约（状态码、`code`、转发表）；
    - bridge 用 `fetchMock` 断言请求形状，并按 409 `{code}` 分层处理；
    - web 断言 postMessage 与 cookie 路由调用。
  - 契约类型在 `@dsh-cockpit/shared`：快照、实例结束消息、投影、错误码。`packages/shared/tests/device-contracts.test.ts` 增加额外测试，断言快照类型不含 `pid`、`instanceId`、`pageId`（不占场景行）。
  - 跨包的端到端行为（iframe → 父页面 → 服务端 → 快照 → bridge）没有自动化测试，由验收项与收尾的手工浏览器检查覆盖。
- **沿用的既有测试**：
  - connectivity 中 8 个场景是 MODIFIED 块必须原样携带的旧场景：“已持久化端口仍然可用”到“本机设备不涉及端口复用”。
  - 它们已有测试（`ssh-tunnel.test.ts`、`connectivity.service.test.ts`），本 change 不改其行为。
  - 这些行仍按统一规则初始为 🔴，含义是“本 change 中尚未复核”。它们不可能先失败，所以 tasks 对它们只安排“重跑并确认通过”的单步任务，不伪造红阶段。
  - “旧记录的单数端口字段仍被识别”写成新的回归测试：注册表带 `forwards` 字段后，旧记录仍能读取。
- **cockpit-api-auth 的两行**：场景名与前置 change 相同。测试名加 `forwards list:` 前缀，放在本 change 的 `app-forwards.e2e.test.ts` 中，避免与 `app-same-origin.e2e.test.ts` 的同名测试冲突。大小写用例同时覆盖 `/API/Bridge/Hello` 与新路由 `/API/Bridge/Forwards/Acquire`。
- **名单一致性**：沿用前置 change 的额外单测（逐条对照 spec 名单与 `isBridgeCallback`），更新为新名单。
- **不进入数据路径**：“驾驶舱不进入数据路径”由两点断言：
  - spawn 的 argv 是 `-L 127.0.0.1:<local>:127.0.0.1:<devicePort>`，只绑定回环；
  - 转发表模块不创建任何 `net.Server` / `net.Socket`，用 `vi.spyOn(net, 'createServer')` 与 `'connect'` 断言未被调用。
- **日志卫生**：“投影不含实例与页面标识”一行中，日志部分通过替换 Nest `Logger` 的 `log/warn/error` 收集输出，再断言不含 I1、P1。
- **驾驶舱退出**：“驾驶舱退出时清理自有转发”扩展 `runtime-control.test.ts` 的 shutdown 用例，断言附加通道的 fake 子进程收到 `SIGTERM`，而非自有的 ssh 替身不被触碰。“不遗留 `ppid=1` 孤儿”依赖 `TunnelManager` 既有的进程组清理，由既有 `ssh-tunnel.test.ts` 覆盖，不另起真实进程。
- **N/A — 验收项“30 秒宽限期真实浏览器实测”**：
  - 为什么没有代码测试：它要验证的是真实浏览器的 EventSource 自动重连间隔与后台标签页节流。jsdom 与 fake timers 不能复现，仓库也没有 Playwright 等浏览器驱动。引入浏览器驱动超出本 change 范围。
  - 门禁检查是一个会失败的脚本 `scripts/acceptance/forward-grace.mjs`，在 tasks 中新建。它按 `bin/cockpit` 的方式从 `DSH_COCKPIT_HOME/token` 读 cookie，然后每秒轮询 `GET /api/devices`，读取目标设备转发表投影。
  - 前置条件由脚本检查，不满足就失败：目标设备投影中存在非常驻条目 3939，且恰有 1 个持有者。
    - 持有者由任一 bridge 消费方在设备页面中建立，例如以本地 pin 装载的下游 memex shim。
    - 脚本不自己伪造持有者，因为它拿不到浏览器页面的 `pageId`；按数据卫生规定，投影中也不出现 `pageId`。
  - 脚本依次提示操作者完成三步，并对每一步自动判定：
    1. 在 DevTools 中把驾驶舱标签页设为 Offline 5 秒再恢复，让 EventSource 以同一 URL 自动重连：此后 60 秒内 3939 的 pid 不变。
    2. 把驾驶舱标签页切到后台 5 分钟再切回：pid 不变，覆盖后台节流。
    3. 关闭驾驶舱标签页：3939 在关闭后 30–40 秒之间从投影中消失，不早于 30 秒，不晚于 40 秒。
  - 任一步不满足，脚本就以非零退出码结束并打印实测时间。操作者只负责浏览器操作，是否通过由脚本判定，不是口头签字。
  - 不测“刷新驾驶舱页面”：刷新会生成新的 `pageId`，旧页面的持有按设计本就应在 30 秒后回收（design Open Questions），不属于宽限期要覆盖的情形。
