## Test Plan

Test names are vitest `describe › it` titles. Paths are relative to the repo root.

Legend:
- 🔴 red — new test, must fail first.
- 🟢 green (existing) — existing regression test, kept unchanged or with its assertions extended; re-run as a guard.
- 🟢 green (guard) — new test for behavior that already holds today; it must stay green through the change. For example, the origin guard must not break the cockpit's own page. It is written before the guard is implemented. It is not TDD evidence: an implementation that breaks it turns it red.

### specs/cockpit-api-auth/spec.md

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 驾驶舱自身页面正常调用 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › accepts same-origin cockpit page (Origin == http://Host, Sec-Fetch-Site same-origin) | 🟢 green (guard) |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 开发代理下的驾驶舱页面正常调用 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › accepts vite dev proxy (Host and Origin 127.0.0.1:5173) | 🟢 green (guard) |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 设备页面带 cookie 获取启动 URL 被拒绝 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › rejects workbench-launch from device origin with 403 cross-origin-rejected and no token in body | 🔴 red |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 设备页面带 cookie 修改或删除设备被拒绝 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › rejects PUT and DELETE device from device origin without side effects | 🔴 red |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 跨站点提示头被拒绝 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › rejects Sec-Fetch-Site same-site without Origin | 🔴 red |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | bridge 回调不受来源校验影响 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › bridge callback with capability header from device origin is not origin-checked | 🟢 green (guard) |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 非 bridge 路由不再获得凭据 CORS 许可 | packages/cockpit-server/tests/app-auth.e2e.test.ts | cors › preflight for non-bridge route from device origin has no Access-Control-Allow-Credentials | 🔴 red |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | DNS rebinding 的同源读取被拒绝 | packages/cockpit-server/tests/app-auth.e2e.test.ts | origin guard › rejects non-loopback Host without Origin on /api/devices and /api/bootstrap, no Set-Cookie | 🔴 red |

### specs/cockpit-device-connectivity/spec.md

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 已持久化端口仍然可用 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › reuses the persisted port so the endpoint origin survives a reconnect | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 已持久化端口被其它进程占用 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › falls back to a fresh port and still connects when the persisted port is taken | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 首次连接没有已持久化端口 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › assigns a fresh port on a first connection with nothing persisted | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 复用端口在绑定窗口内被抢占 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › retries on a fresh port when the reused one is stolen inside the bind window | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 首次尝试因链路原因失败后仍保留已持久化端口 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › keeps the persisted port across a link-level failure so the origin does not drift | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 无法归因的提前退出保留已持久化端口 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › keeps the persisted port when an early exit cannot be attributed | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 端口漂移可从日志定位 | packages/cockpit-server/tests/ssh-tunnel.test.ts | tunnel manager local port reuse › warns once with attribution when the local port drifts, and stays silent when it does not | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 本机设备不涉及端口复用 | packages/cockpit-server/tests/connectivity.service.test.ts | does not persist a forward port for a local device | 🟢 green (existing) |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 附加转发重建后复用原本地端口 | packages/cockpit-server/tests/forward-table.test.ts | port stability › rebuilt extra reuses its persisted localPort | 🔴 red |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 附加转发原端口被占用时漂移并可见 | packages/cockpit-server/tests/forward-table.test.ts | port stability › drifts to a fresh port when taken, persists it and warns with attribution | 🔴 red |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 回收的附加条目不保留端口 | packages/cockpit-server/tests/forward-table.test.ts | port stability › reclaimed entry drops its persisted localPort | 🔴 red |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 附加条目不抢占其它设备的主通道端口 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › extras avoid every device's persisted main-channel port including disabled devices | 🔴 red |
| specs/cockpit-device-connectivity/spec.md → 设备本地转发端口在生命周期内保持稳定 | 旧记录的单数端口字段仍被识别 | packages/cockpit-server/tests/registry.test.ts | forwards › legacy singular forward-port field still maps to the main channel | 🔴 red |

### specs/cockpit-device-port-forward/spec.md

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 表中列出主通道与附加条目 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › projection lists main channel and extras with state mapped from DeviceState | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 同一设备端口不产生第二个子进程 | packages/cockpit-server/tests/forward-table.test.ts | table › second acquire on same devicePort adds a holder, spawns no child | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 并发申请同一端口只建立一次 | packages/cockpit-server/tests/forward-table.test.ts | table › concurrent acquires of one port are single-flight | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 并发申请不突破上限 | packages/cockpit-server/tests/forward-table.test.ts | table › concurrent acquires never exceed cap 8 | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 超过上限被拒绝 | packages/cockpit-server/tests/forward-table.test.ts | table › ninth port is rejected with 409 forward-limit | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 不允许为主通道端口建立附加条目 | packages/cockpit-server/tests/forward-table.test.ts | table › acquire of the remote DSH port is rejected with reserved-port | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 编辑远端 DSH 端口与附加条目冲突被拒绝 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › updateDevice remoteDshPort onto an extra's port fails with forward-port-conflict | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 非法端口被拒绝 | packages/cockpit-server/tests/forward-table.test.ts | table › rejects out-of-range or non-integer devicePort with invalid-port | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 每台设备的转发表是其全部 SSH 转发的唯一真相源 | 本机设备没有转发表 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › local device has no table and acquire returns local-device | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 租约全部释放后回收 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › reclaims when last lease released and not pinned | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 租约到期后回收 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › reclaims after TTL without renew (fake timers) | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 常驻条目不因租约归零而回收 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › pinned entry survives zero leases | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 续约延长到期时间 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › renew pushes expiry to now + TTL | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 主通道长时间断开期间租约不过期 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › leases are frozen while main channel unavailable and get recovery + TTL | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 手动删除撤销租约且不被续约复活 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › delete revokes leases; later renew returns revoked | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 驾驶舱重启后被撤销租约的续约不复活条目 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › after restart, renew of a deleted entry's lease cannot recreate it | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 删除发生在建立过程中 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › delete during starting disposes the in-flight child and bumps generation | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 未知租约的续约与释放 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › unknown lease renew → lease-expired, release is idempotent success | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 写盘失败时回滚且不启动子进程 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › persist failure returns persist-failed, memory unchanged, no spawn | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 驾驶舱面板提升 DSH 常驻来源 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › cockpit pin promotes pinnedBy dsh → cockpit | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 常驻相关操作幂等 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › repeated pin/unpin are idempotent | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 驾驶舱重启后恢复常驻与租约 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › restart restores pinned entries and leases from registry | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 禁用设备丢弃租约、保留常驻 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › disabling drops leases, keeps pins, stops children | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目的寿命由常驻标记与租约共同决定 | 损坏的转发记录不阻塞设备 | packages/cockpit-server/tests/registry.test.ts | forwards › malformed forwards entries are skipped with a warning, device still loads | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 转发中途断开后自动重建 | packages/cockpit-server/tests/forward-table.test.ts | self-heal › post-ready exit rebuilds with backoff | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 断开期间不交付旧地址 | packages/cockpit-server/tests/forward-table.test.ts | self-heal › projection has no url while retrying | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 首次建立失败进入重试而不静默消失 | packages/cockpit-server/tests/forward-table.test.ts | self-heal › first-start failure enters retrying with diagnostic | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 主通道断开期间不重建附加条目 | packages/cockpit-server/tests/forward-table.test.ts | self-heal › no new spawns while main channel unavailable | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 主通道断开不终止仍存活的附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › main channel reconnect leaves live extras running | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 编辑 SSH 别名后附加转发改连新主机 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › alias edit replaces lifecycle, pauses extras, rebuilds on new alias after READY | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加条目按期望状态自愈，且只在就绪时交付地址 | 编辑远端 DSH 端口与申请同一端口并发 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › concurrent remoteDshPort edit and acquire of same port: exactly one succeeds | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 申请立即返回并在就绪后通知地址 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › acquire resolves immediately, notifies url on ready snapshot | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 租约在页面存活期间自动续约 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › renews each lease at ≤60s interval | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 主通道断开期间续约被拒仍保持租约 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › 400 bad-request / network errors on renew are silent retries | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 页面关闭后租约到期回收 | packages/cockpit-server/tests/forward-table.test.ts | lifetime › lease without renew after holder gone is reclaimed at TTL | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 同页重复申请不产生第二个租约 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › duplicate acquire (including in-flight) reuses one lease | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 删除条目后持有者收到撤销通知且不自动重新申请 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › revoked notifies holder once and does not reacquire | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 地址变化通知持有者 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › url change in snapshot notifies holder | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | DSH 侧不能删除驾驶舱面板建立的常驻条目 | packages/cockpit-server/tests/devices.controller.test.ts | bridge forwards › delete of cockpit-pinned entry returns 409 managed-by-cockpit | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 不在驾驶舱中时接缝不可用 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › outside cockpit, acquire rejects with not-in-cockpit | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 提供转发申请接缝 `cockpitBridge.forwards` | 非法持有者标签被拒绝 | packages/cockpit-server/tests/devices.controller.test.ts | bridge forwards › invalid holder rejected with invalid-holder | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱父页面向设备页面推送转发表快照 | 转发表变化推送到对应设备页面 | packages/cockpit-web/tests/workbench.test.tsx | forward snapshot › projection change posts snapshot to that device iframe with exact targetOrigin | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱父页面向设备页面推送转发表快照 | 配置下发后立即推送快照 | packages/cockpit-web/tests/workbench.test.tsx | forward snapshot › snapshot posted right after each bridge config message | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱父页面向设备页面推送转发表快照 | 伪造来源的快照消息被忽略 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › snapshot from non-cockpit origin is ignored | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表的投影、标签与诊断受数据卫生约束 | 投影不含租约标识 | packages/shared/tests/device-contracts.test.ts | forward projection › schema has no lease id field; server projection omits it | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表的投影、标签与诊断受数据卫生约束 | 非法条目标签被拒绝 | packages/cockpit-server/tests/forward-table.test.ts | hygiene › non-printable or >64 char label rejected with invalid-label | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表的投影、标签与诊断受数据卫生约束 | 超长诊断被截断 | packages/cockpit-server/tests/forward-table.test.ts | hygiene › diagnostic truncated to 300 chars | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表的投影、标签与诊断受数据卫生约束 | 他设备的租约标识无效 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › lease id from another device → lease-expired, no effect | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表管理端点仅接受驾驶舱同源请求 | 驾驶舱页面可以管理转发 | packages/cockpit-server/tests/app-auth.e2e.test.ts | forwards management › same-origin cockpit page can create/delete forwards | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表管理端点仅接受驾驶舱同源请求 | 设备页面带 cookie 调用管理端点被拒绝 | packages/cockpit-server/tests/app-auth.e2e.test.ts | forwards management › device origin with cookie → 403 cross-origin-rejected, no spawn | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 转发表管理端点仅接受驾驶舱同源请求 | 仅携带能力串的请求不能使用管理端点 | packages/cockpit-server/tests/app-auth.e2e.test.ts | forwards management › capability-only request rejected (403 from device origin / 401 without Origin) | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页呈现本设备转发清单 | 设置页列出转发 | packages/dsh-cockpit-bridge/tests/settings-section.test.ts | settings section › lists entries with source and state as plain text | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页呈现本设备转发清单 | 在设置页手动创建常驻转发 | packages/dsh-cockpit-bridge/tests/settings-section.test.ts | settings section › create pins with pinnedBy dsh | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页呈现本设备转发清单 | 设置页创建超限时原位提示 | packages/dsh-cockpit-bridge/tests/settings-section.test.ts | settings section › forward-limit shown inline, input kept | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页呈现本设备转发清单 | 不在驾驶舱中时不提供操作 | packages/dsh-cockpit-bridge/tests/settings-section.test.ts | settings section › outside cockpit shows read-only hint, no actions | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → bridge 在 DSH 设置页呈现本设备转发清单 | 本机设备不提供操作 | packages/dsh-cockpit-bridge/tests/settings-section.test.ts | settings section › local device shows no actions | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 设备禁用时终止全部附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › disable terminates all extra children | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 主通道手动重连不影响附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › manual reconnect of main channel keeps extras | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 更新启动 URL 不影响附加转发 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › launch URL update keeps extras | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 附加转发失败不影响工作台 | packages/cockpit-server/tests/connectivity.service.test.ts | forwards › extra failure leaves device READY | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 附加转发只在宿主机回环监听并随设备生命周期回收 | 驾驶舱退出清理自有转发 | packages/cockpit-server/tests/ssh-tunnel.test.ts | forwards › shutdown disposes every extra child (pid gone) | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱为设备提供端口发布接缝 | 兼容接缝经转发表发布 | packages/dsh-cockpit-bridge/tests/client.test.ts | portForward compat › publish acquires with legacy holder (≤64 chars) and resolves on ready within 8s | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱为设备提供端口发布接缝 | 新版 bridge 搭配旧版驾驶舱时回退旧端点 | packages/dsh-cockpit-bridge/tests/client.test.ts | portForward compat › 401 on forwards endpoint falls back to legacy endpoints without capability renewal | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱为设备提供端口发布接缝 | 未 register 的用途标识不可发布 | packages/dsh-cockpit-bridge/tests/client.test.ts | portForward compat › publish of unregistered id rejects | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱为设备提供端口发布接缝 | 无驾驶舱时消费方仍可工作 | packages/dsh-cockpit-bridge/tests/client.test.ts | portForward compat › outside cockpit publish rejects cleanly, consumer falls back | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱为设备提供端口发布接缝 | 旧版 bridge 不再得到死链接 | packages/cockpit-server/tests/devices.controller.test.ts | legacy publish-port › legacy endpoint routes through the forward table and returns a live url or forward-not-ready | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 驾驶舱为设备提供端口发布接缝 | 本机设备无需转发 | packages/dsh-cockpit-bridge/tests/client.test.ts | portForward compat › local device publish returns direct loopback url | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 有效能力串的申请被接受 | packages/cockpit-server/tests/devices.controller.test.ts | bridge forwards › valid capability acquire accepted | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 能力串无效时以既有响应拒绝 | packages/cockpit-server/tests/devices.controller.test.ts | bridge forwards › invalid capability → 400 bridge-capability-invalid, table unchanged | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 业务拒绝不触发能力串换发 | packages/dsh-cockpit-bridge/tests/client.test.ts | forwards › 409 business codes are surfaced without capability renewal | 🔴 red |
| specs/cockpit-device-port-forward/spec.md → 端口发布请求须经既有 capability 校验 | 驾驶舱不进入数据路径 | packages/cockpit-server/tests/devices.controller.test.ts | bridge forwards › returned url is http://127.0.0.1:<localPort> and no proxy route exists | 🔴 red |

### specs/cockpit-device-shell/spec.md

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 面板列出设备转发 | packages/cockpit-web/tests/device-panel.test.tsx | forwards list › renders entries with source cockpit/dsh as plain text | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 转发状态变化实时反映 | packages/cockpit-web/tests/device-panel.test.tsx | forwards list › stream update re-renders state | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 面板手动创建常驻转发 | packages/cockpit-web/tests/device-panel.test.tsx | forwards list › create posts pin and shows N / 8 | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 面板创建失败保留输入 | packages/cockpit-web/tests/device-panel.test.tsx | forwards list › error code shown inline, input retained | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 删除持有租约的条目需确认 | packages/cockpit-web/tests/device-panel.test.tsx | forwards list › deleting an entry with leases asks confirmation | 🔴 red |
| specs/cockpit-device-shell/spec.md → 设备管理面板呈现并管理每台设备的转发清单 | 本机设备不提供转发操作 | packages/cockpit-web/tests/device-panel.test.tsx | forwards list › local device shows no forward actions | 🔴 red |

### Supplementary checks (not scenario rows)

| Check | Where | Initial State |
|-------|-------|---------------|
| Renewal survives 1-per-minute timer throttling (background tab / Memory Saver) | packages/dsh-cockpit-bridge/tests/client.test.ts › forwards › lease stays alive under throttled timers (fake timers, 60s clamp) | 🔴 red |
| Real-browser renewal measurement: background tab for 15 min, lease not reclaimed | tasks.md manual verify task; the outcome is recorded in verify | N/A — manual; backed by the fake-timer test above |
| Change artifacts are consistent | `openspec validate device-forward-registry --strict` | 🟢 green |

## Coverage Notes

- Guard rows (🟢 green (guard)): three rows in api-auth. They verify that the new guard does not misfire on existing callers. They pass the moment they are written, so apply must NOT count them as red→green evidence.
- Any other row whose test unexpectedly passes when written means the scenario was already satisfied. Record it in verify; do not quietly flip it.

- Every `#### Scenario:` across the 4 delta spec files has one row: api-auth 8, connectivity 13, port-forward 69, shell 6.
- The 8 connectivity scenarios that already existed keep their current tests, which serve as regression guards; they are marked green (existing). The 5 new or changed scenarios start red.
- New test files:
  - `packages/cockpit-server/tests/forward-table.test.ts`: pure unit tests for ForwardTable. Uses an injected fake spawner, a fake clock, and a fake persist callback, and spawns no real ssh.
  - `packages/dsh-cockpit-bridge/tests/settings-section.test.ts`: tests for the bridge DSH settings section.
- Shared fixtures:
  - `fakeForwardSpawner`: records spawns, disposes, and pids, and can trigger post-ready exits.
  - `fakeClock`: vitest fake timers.
  - `mainChannelState` stub: switches DeviceState.
  - `persistStub`: can be made to fail, for persist-failed.
- `app-auth.e2e.test.ts` uses the real Nest app with a real TokenMiddleware. Origin, Host, and Sec-Fetch-Site are all set explicitly with supertest.
- A real ssh process is not a CI prerequisite. Pid presence and shutdown cleanup are verified through the fake spawner.
