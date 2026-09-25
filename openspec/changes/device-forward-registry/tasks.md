## 0. 前置

- [ ] 0.1 运行 `openspec list --json` 并阅读 proposal/design/specs；确认 test-plan.md 所有行为 🔴 red 或 🟢 green (existing)
- [ ] 0.2 在基线上运行 `pnpm build && pnpm typecheck && pnpm test && pnpm lint`，记录全绿基线

## 1. 服务端第 0 步：全局同源校验（cockpit-api-auth，D11）

> 实现注意（review round 3）：Host 主机名校验必须先于既有的 `requiresToken` 与 bootstrap 豁免判断执行，否则 rebinding 请求仍会拿到 `Set-Cookie`。

- [ ] 1.1 编写守卫测试（test-plan 中标为 🟢 guard 的 3 行：驾驶舱自身页面、开发代理、bridge 回调），确认它们在基线上就是绿色的，并保证本组改动全程保持绿色
- [ ] 1.2 编写失败测试「设备页面带 cookie 获取启动 URL 被拒绝」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › origin guard › rejects workbench-launch from device origin with 403 cross-origin-rejected and no token in body（确认它因为正确的原因失败）
- [ ] 1.3 实现：使 1.2 通过（驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求）
- [ ] 1.4 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 1.5 编写失败测试「设备页面带 cookie 修改或删除设备被拒绝」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › origin guard › rejects PUT and DELETE device from device origin without side effects（确认它因为正确的原因失败）
- [ ] 1.6 实现：使 1.5 通过（驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求）
- [ ] 1.7 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 1.8 编写失败测试「跨站点提示头被拒绝」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › origin guard › rejects Sec-Fetch-Site same-site without Origin（确认它因为正确的原因失败）
- [ ] 1.9 实现：使 1.8 通过（驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求）
- [ ] 1.10 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 1.11 编写失败测试「非 bridge 路由不再获得凭据 CORS 许可」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › cors › preflight for non-bridge route from device origin has no Access-Control-Allow-Credentials（确认它因为正确的原因失败）
- [ ] 1.12 实现：使 1.11 通过（驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求）
- [ ] 1.13 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 1.14 编写失败测试「DNS rebinding 的同源读取被拒绝」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › origin guard › rejects non-loopback Host without Origin on /api/devices and /api/bootstrap, no Set-Cookie（确认它因为正确的原因失败）
- [ ] 1.15 实现：使 1.14 通过（驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求）
- [ ] 1.16 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 2. 服务端第 1 步：主通道与附加转发的所有权切分（D1）

- [ ] 2.1 为 `TunnelHandle` 增加 pid，`TunnelManager` 增加就绪后退出回调与 `avoidLocalPorts`；现有测试保持绿色
- [ ] 2.2 把 `#detach` 拆为 `#replaceLifecycle` 与 `#terminateDevice`，`removeDevice` 改用 `mutateDevices`；现有测试保持绿色
- [ ] 2.3 编写失败测试「主通道断开不终止仍存活的附加转发」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › main channel reconnect leaves live extras running（确认它因为正确的原因失败）
- [ ] 2.4 实现：使 2.3 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 2.5 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 2.6 编写失败测试「设备禁用时终止全部附加转发」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › disable terminates all extra children（确认它因为正确的原因失败）
- [ ] 2.7 实现：使 2.6 通过（附加转发只在宿主机回环监听并随设备生命周期回收）
- [ ] 2.8 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 2.9 编写失败测试「主通道手动重连不影响附加转发」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › manual reconnect of main channel keeps extras（确认它因为正确的原因失败）
- [ ] 2.10 实现：使 2.9 通过（附加转发只在宿主机回环监听并随设备生命周期回收）
- [ ] 2.11 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 2.12 编写失败测试「更新启动 URL 不影响附加转发」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › launch URL update keeps extras（确认它因为正确的原因失败）
- [ ] 2.13 实现：使 2.12 通过（附加转发只在宿主机回环监听并随设备生命周期回收）
- [ ] 2.14 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 2.15 编写失败测试「附加转发失败不影响工作台」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › extra failure leaves device READY（确认它因为正确的原因失败）
- [ ] 2.16 实现：使 2.15 通过（附加转发只在宿主机回环监听并随设备生命周期回收）
- [ ] 2.17 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 2.18 编写失败测试「驾驶舱退出清理自有转发」：`packages/cockpit-server/tests/ssh-tunnel.test.ts` › forwards › shutdown disposes every extra child (pid gone)（确认它因为正确的原因失败）
- [ ] 2.19 实现：使 2.18 通过（附加转发只在宿主机回环监听并随设备生命周期回收）
- [ ] 2.20 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 3. 服务端第 2 步（a）：ForwardTable 核心——表、租约、自愈、卫生（D1/D3/D5）

- [ ] 3.1 新建 `packages/cockpit-server/tests/forward-table.test.ts` 的共享 fixture：`fakeForwardSpawner`、`fakeClock`、`mainChannelState` 桩、`persistStub`
- [ ] 3.2 编写失败测试「附加转发重建后复用原本地端口」：`packages/cockpit-server/tests/forward-table.test.ts` › port stability › rebuilt extra reuses its persisted localPort（确认它因为正确的原因失败）
- [ ] 3.3 实现：使 3.2 通过（设备本地转发端口在生命周期内保持稳定）
- [ ] 3.4 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.5 编写失败测试「附加转发原端口被占用时漂移并可见」：`packages/cockpit-server/tests/forward-table.test.ts` › port stability › drifts to a fresh port when taken, persists it and warns with attribution（确认它因为正确的原因失败）
- [ ] 3.6 实现：使 3.5 通过（设备本地转发端口在生命周期内保持稳定）
- [ ] 3.7 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.8 编写失败测试「回收的附加条目不保留端口」：`packages/cockpit-server/tests/forward-table.test.ts` › port stability › reclaimed entry drops its persisted localPort（确认它因为正确的原因失败）
- [ ] 3.9 实现：使 3.8 通过（设备本地转发端口在生命周期内保持稳定）
- [ ] 3.10 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.11 编写失败测试「同一设备端口不产生第二个子进程」：`packages/cockpit-server/tests/forward-table.test.ts` › table › second acquire on same devicePort adds a holder, spawns no child（确认它因为正确的原因失败）
- [ ] 3.12 实现：使 3.11 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 3.13 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.14 编写失败测试「并发申请同一端口只建立一次」：`packages/cockpit-server/tests/forward-table.test.ts` › table › concurrent acquires of one port are single-flight（确认它因为正确的原因失败）
- [ ] 3.15 实现：使 3.14 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 3.16 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.17 编写失败测试「并发申请不突破上限」：`packages/cockpit-server/tests/forward-table.test.ts` › table › concurrent acquires never exceed cap 8（确认它因为正确的原因失败）
- [ ] 3.18 实现：使 3.17 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 3.19 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.20 编写失败测试「超过上限被拒绝」：`packages/cockpit-server/tests/forward-table.test.ts` › table › ninth port is rejected with 409 forward-limit（确认它因为正确的原因失败）
- [ ] 3.21 实现：使 3.20 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 3.22 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.23 编写失败测试「不允许为主通道端口建立附加条目」：`packages/cockpit-server/tests/forward-table.test.ts` › table › acquire of the remote DSH port is rejected with reserved-port（确认它因为正确的原因失败）
- [ ] 3.24 实现：使 3.23 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 3.25 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.26 编写失败测试「非法端口被拒绝」：`packages/cockpit-server/tests/forward-table.test.ts` › table › rejects out-of-range or non-integer devicePort with invalid-port（确认它因为正确的原因失败）
- [ ] 3.27 实现：使 3.26 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 3.28 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.29 编写失败测试「租约全部释放后回收」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › reclaims when last lease released and not pinned（确认它因为正确的原因失败）
- [ ] 3.30 实现：使 3.29 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.31 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.32 编写失败测试「租约到期后回收」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › reclaims after TTL without renew (fake timers)（确认它因为正确的原因失败）
- [ ] 3.33 实现：使 3.32 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.34 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.35 编写失败测试「常驻条目不因租约归零而回收」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › pinned entry survives zero leases（确认它因为正确的原因失败）
- [ ] 3.36 实现：使 3.35 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.37 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.38 编写失败测试「续约延长到期时间」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › renew pushes expiry to now + TTL（确认它因为正确的原因失败）
- [ ] 3.39 实现：使 3.38 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.40 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.41 编写失败测试「主通道长时间断开期间租约不过期」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › leases are frozen while main channel unavailable and get recovery + TTL（确认它因为正确的原因失败）
- [ ] 3.42 实现：使 3.41 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.43 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.44 编写失败测试「手动删除撤销租约且不被续约复活」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › delete revokes leases; later renew returns revoked（确认它因为正确的原因失败）
- [ ] 3.45 实现：使 3.44 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.46 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.47 编写失败测试「删除发生在建立过程中」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › delete during starting disposes the in-flight child and bumps generation（确认它因为正确的原因失败）
- [ ] 3.48 实现：使 3.47 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.49 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.50 编写失败测试「未知租约的续约与释放」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › unknown lease renew → lease-expired, release is idempotent success（确认它因为正确的原因失败）
- [ ] 3.51 实现：使 3.50 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.52 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.53 编写失败测试「驾驶舱面板提升 DSH 常驻来源」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › cockpit pin promotes pinnedBy dsh → cockpit（确认它因为正确的原因失败）
- [ ] 3.54 实现：使 3.53 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.55 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.56 编写失败测试「常驻相关操作幂等」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › repeated pin/unpin are idempotent（确认它因为正确的原因失败）
- [ ] 3.57 实现：使 3.56 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 3.58 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.59 编写失败测试「转发中途断开后自动重建」：`packages/cockpit-server/tests/forward-table.test.ts` › self-heal › post-ready exit rebuilds with backoff（确认它因为正确的原因失败）
- [ ] 3.60 实现：使 3.59 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 3.61 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.62 编写失败测试「断开期间不交付旧地址」：`packages/cockpit-server/tests/forward-table.test.ts` › self-heal › projection has no url while retrying（确认它因为正确的原因失败）
- [ ] 3.63 实现：使 3.62 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 3.64 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.65 编写失败测试「首次建立失败进入重试而不静默消失」：`packages/cockpit-server/tests/forward-table.test.ts` › self-heal › first-start failure enters retrying with diagnostic（确认它因为正确的原因失败）
- [ ] 3.66 实现：使 3.65 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 3.67 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.68 编写失败测试「主通道断开期间不重建附加条目」：`packages/cockpit-server/tests/forward-table.test.ts` › self-heal › no new spawns while main channel unavailable（确认它因为正确的原因失败）
- [ ] 3.69 实现：使 3.68 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 3.70 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.71 编写失败测试「页面关闭后租约到期回收」：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › lease without renew after holder gone is reclaimed at TTL（确认它因为正确的原因失败）
- [ ] 3.72 实现：使 3.71 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 3.73 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.74 编写失败测试「非法条目标签被拒绝」：`packages/cockpit-server/tests/forward-table.test.ts` › hygiene › non-printable or >64 char label rejected with invalid-label（确认它因为正确的原因失败）
- [ ] 3.75 实现：使 3.74 通过（转发表的投影、标签与诊断受数据卫生约束）
- [ ] 3.76 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 3.77 编写失败测试「超长诊断被截断」：`packages/cockpit-server/tests/forward-table.test.ts` › hygiene › diagnostic truncated to 300 chars（确认它因为正确的原因失败）
- [ ] 3.78 实现：使 3.77 通过（转发表的投影、标签与诊断受数据卫生约束）
- [ ] 3.79 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 4. 服务端第 2 步（b）：持久化与端口稳定（D6）

- [ ] 4.1 回归守卫「已持久化端口仍然可用」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › reuses the persisted port so the endpoint origin survives a reconnect，确认保持绿色
- [ ] 4.2 回归守卫「已持久化端口被其它进程占用」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › falls back to a fresh port and still connects when the persisted port is taken，确认保持绿色
- [ ] 4.3 回归守卫「首次连接没有已持久化端口」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › assigns a fresh port on a first connection with nothing persisted，确认保持绿色
- [ ] 4.4 回归守卫「复用端口在绑定窗口内被抢占」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › retries on a fresh port when the reused one is stolen inside the bind window，确认保持绿色
- [ ] 4.5 回归守卫「首次尝试因链路原因失败后仍保留已持久化端口」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › keeps the persisted port across a link-level failure so the origin does not drift，确认保持绿色
- [ ] 4.6 回归守卫「无法归因的提前退出保留已持久化端口」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › keeps the persisted port when an early exit cannot be attributed，确认保持绿色
- [ ] 4.7 回归守卫「端口漂移可从日志定位」：在本组改动后运行 `packages/cockpit-server/tests/ssh-tunnel.test.ts` › tunnel manager local port reuse › warns once with attribution when the local port drifts, and stays silent when it does not，确认保持绿色
- [ ] 4.8 回归守卫「本机设备不涉及端口复用」：在本组改动后运行 `packages/cockpit-server/tests/connectivity.service.test.ts` › does not persist a forward port for a local device，确认保持绿色
- [ ] 4.9 编写失败测试「附加条目不抢占其它设备的主通道端口」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › extras avoid every device's persisted main-channel port including disabled devices（确认它因为正确的原因失败）
- [ ] 4.10 实现：使 4.9 通过（设备本地转发端口在生命周期内保持稳定）
- [ ] 4.11 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 4.12 编写失败测试「旧记录的单数端口字段仍被识别」：`packages/cockpit-server/tests/registry.test.ts` › forwards › legacy singular forward-port field still maps to the main channel（确认它因为正确的原因失败）
- [ ] 4.13 实现：使 4.12 通过（设备本地转发端口在生命周期内保持稳定）
- [ ] 4.14 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 4.15 编写失败测试「损坏的转发记录不阻塞设备」：`packages/cockpit-server/tests/registry.test.ts` › forwards › malformed forwards entries are skipped with a warning, device still loads（确认它因为正确的原因失败）
- [ ] 4.16 实现：使 4.15 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 4.17 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 5. 服务端第 2 步（c）：ConnectivityService 集成（别名、远端端口、重启、禁用、投影）

- [ ] 5.1 编写失败测试「表中列出主通道与附加条目」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › projection lists main channel and extras with state mapped from DeviceState（确认它因为正确的原因失败）
- [ ] 5.2 实现：使 5.1 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 5.3 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.4 编写失败测试「编辑远端 DSH 端口与附加条目冲突被拒绝」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › updateDevice remoteDshPort onto an extra's port fails with forward-port-conflict（确认它因为正确的原因失败）
- [ ] 5.5 实现：使 5.4 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 5.6 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.7 编写失败测试「本机设备没有转发表」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › local device has no table and acquire returns local-device（确认它因为正确的原因失败）
- [ ] 5.8 实现：使 5.7 通过（每台设备的转发表是其全部 SSH 转发的唯一真相源）
- [ ] 5.9 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.10 编写失败测试「驾驶舱重启后被撤销租约的续约不复活条目」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › after restart, renew of a deleted entry's lease cannot recreate it（确认它因为正确的原因失败）
- [ ] 5.11 实现：使 5.10 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 5.12 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.13 编写失败测试「写盘失败时回滚且不启动子进程」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › persist failure returns persist-failed, memory unchanged, no spawn（确认它因为正确的原因失败）
- [ ] 5.14 实现：使 5.13 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 5.15 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.16 编写失败测试「驾驶舱重启后恢复常驻与租约」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › restart restores pinned entries and leases from registry（确认它因为正确的原因失败）
- [ ] 5.17 实现：使 5.16 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 5.18 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.19 编写失败测试「禁用设备丢弃租约、保留常驻」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › disabling drops leases, keeps pins, stops children（确认它因为正确的原因失败）
- [ ] 5.20 实现：使 5.19 通过（附加条目的寿命由常驻标记与租约共同决定）
- [ ] 5.21 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.22 编写失败测试「编辑 SSH 别名后附加转发改连新主机」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › alias edit replaces lifecycle, pauses extras, rebuilds on new alias after READY（确认它因为正确的原因失败）
- [ ] 5.23 实现：使 5.22 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 5.24 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.25 编写失败测试「编辑远端 DSH 端口与申请同一端口并发」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › concurrent remoteDshPort edit and acquire of same port: exactly one succeeds（确认它因为正确的原因失败）
- [ ] 5.26 实现：使 5.25 通过（附加条目按期望状态自愈，且只在就绪时交付地址）
- [ ] 5.27 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 5.28 编写失败测试「他设备的租约标识无效」：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › lease id from another device → lease-expired, no effect（确认它因为正确的原因失败）
- [ ] 5.29 实现：使 5.28 通过（转发表的投影、标签与诊断受数据卫生约束）
- [ ] 5.30 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 6. 服务端第 2 步（d）：bridge 端点、管理端点、旧端点承载与共享契约（D7/D8/D11）

- [ ] 6.1 在 `packages/shared` 中定义转发投影与错误码契约（错误码包含 `forward-limit`、`reserved-port`、`invalid-port`、`invalid-holder`、`invalid-label`、`revoked`、`lease-expired`、`managed-by-cockpit`、`forward-port-conflict`、`persist-failed`、`forward-not-ready`、`local-device`）
- [ ] 6.2 编写失败测试「DSH 侧不能删除驾驶舱面板建立的常驻条目」：`packages/cockpit-server/tests/devices.controller.test.ts` › bridge forwards › delete of cockpit-pinned entry returns 409 managed-by-cockpit（确认它因为正确的原因失败）
- [ ] 6.3 实现：使 6.2 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 6.4 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.5 编写失败测试「非法持有者标签被拒绝」：`packages/cockpit-server/tests/devices.controller.test.ts` › bridge forwards › invalid holder rejected with invalid-holder（确认它因为正确的原因失败）
- [ ] 6.6 实现：使 6.5 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 6.7 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.8 编写失败测试「投影不含租约标识」：`packages/shared/tests/device-contracts.test.ts` › forward projection › schema has no lease id field; server projection omits it（确认它因为正确的原因失败）
- [ ] 6.9 实现：使 6.8 通过（转发表的投影、标签与诊断受数据卫生约束）
- [ ] 6.10 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.11 编写失败测试「驾驶舱页面可以管理转发」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › forwards management › same-origin cockpit page can create/delete forwards（确认它因为正确的原因失败）
- [ ] 6.12 实现：使 6.11 通过（转发表管理端点仅接受驾驶舱同源请求）
- [ ] 6.13 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.14 编写失败测试「设备页面带 cookie 调用管理端点被拒绝」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › forwards management › device origin with cookie → 403 cross-origin-rejected, no spawn（确认它因为正确的原因失败）
- [ ] 6.15 实现：使 6.14 通过（转发表管理端点仅接受驾驶舱同源请求）
- [ ] 6.16 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.17 编写失败测试「仅携带能力串的请求不能使用管理端点」：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › forwards management › capability-only request rejected (403 from device origin / 401 without Origin)（确认它因为正确的原因失败）
- [ ] 6.18 实现：使 6.17 通过（转发表管理端点仅接受驾驶舱同源请求）
- [ ] 6.19 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.20 编写失败测试「旧版 bridge 不再得到死链接」：`packages/cockpit-server/tests/devices.controller.test.ts` › legacy publish-port › legacy endpoint routes through the forward table and returns a live url or forward-not-ready（确认它因为正确的原因失败）
- [ ] 6.21 实现：使 6.20 通过（驾驶舱为设备提供端口发布接缝）
- [ ] 6.22 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.23 编写失败测试「有效能力串的申请被接受」：`packages/cockpit-server/tests/devices.controller.test.ts` › bridge forwards › valid capability acquire accepted（确认它因为正确的原因失败）
- [ ] 6.24 实现：使 6.23 通过（端口发布请求须经既有 capability 校验）
- [ ] 6.25 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.26 编写失败测试「能力串无效时以既有响应拒绝」：`packages/cockpit-server/tests/devices.controller.test.ts` › bridge forwards › invalid capability → 400 bridge-capability-invalid, table unchanged（确认它因为正确的原因失败）
- [ ] 6.27 实现：使 6.26 通过（端口发布请求须经既有 capability 校验）
- [ ] 6.28 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 6.29 编写失败测试「驾驶舱不进入数据路径」：`packages/cockpit-server/tests/devices.controller.test.ts` › bridge forwards › returned url is http://127.0.0.1:<localPort> and no proxy route exists（确认它因为正确的原因失败）
- [ ] 6.30 实现：使 6.29 通过（端口发布请求须经既有 capability 校验）
- [ ] 6.31 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 7. web：设备管理面板转发清单与快照推送（D7）

- [ ] 7.1 编写失败测试「转发表变化推送到对应设备页面」：`packages/cockpit-web/tests/workbench.test.tsx` › forward snapshot › projection change posts snapshot to that device iframe with exact targetOrigin（确认它因为正确的原因失败）
- [ ] 7.2 实现：使 7.1 通过（驾驶舱父页面向设备页面推送转发表快照）
- [ ] 7.3 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.4 编写失败测试「配置下发后立即推送快照」：`packages/cockpit-web/tests/workbench.test.tsx` › forward snapshot › snapshot posted right after each bridge config message（确认它因为正确的原因失败）
- [ ] 7.5 实现：使 7.4 通过（驾驶舱父页面向设备页面推送转发表快照）
- [ ] 7.6 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.7 编写失败测试「面板列出设备转发」：`packages/cockpit-web/tests/device-panel.test.tsx` › forwards list › renders entries with source cockpit/dsh as plain text（确认它因为正确的原因失败）
- [ ] 7.8 实现：使 7.7 通过（设备管理面板呈现并管理每台设备的转发清单）
- [ ] 7.9 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.10 编写失败测试「转发状态变化实时反映」：`packages/cockpit-web/tests/device-panel.test.tsx` › forwards list › stream update re-renders state（确认它因为正确的原因失败）
- [ ] 7.11 实现：使 7.10 通过（设备管理面板呈现并管理每台设备的转发清单）
- [ ] 7.12 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.13 编写失败测试「面板手动创建常驻转发」：`packages/cockpit-web/tests/device-panel.test.tsx` › forwards list › create posts pin and shows N / 8（确认它因为正确的原因失败）
- [ ] 7.14 实现：使 7.13 通过（设备管理面板呈现并管理每台设备的转发清单）
- [ ] 7.15 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.16 编写失败测试「面板创建失败保留输入」：`packages/cockpit-web/tests/device-panel.test.tsx` › forwards list › error code shown inline, input retained（确认它因为正确的原因失败）
- [ ] 7.17 实现：使 7.16 通过（设备管理面板呈现并管理每台设备的转发清单）
- [ ] 7.18 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.19 编写失败测试「删除持有租约的条目需确认」：`packages/cockpit-web/tests/device-panel.test.tsx` › forwards list › deleting an entry with leases asks confirmation（确认它因为正确的原因失败）
- [ ] 7.20 实现：使 7.19 通过（设备管理面板呈现并管理每台设备的转发清单）
- [ ] 7.21 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 7.22 编写失败测试「本机设备不提供转发操作」：`packages/cockpit-web/tests/device-panel.test.tsx` › forwards list › local device shows no forward actions（确认它因为正确的原因失败）
- [ ] 7.23 实现：使 7.22 通过（设备管理面板呈现并管理每台设备的转发清单）
- [ ] 7.24 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 8. bridge 0.6.0：forwards 接缝、续约、错误分层、portForward 适配、设置区块（D7/D8/D9）

- [ ] 8.1 新建 `packages/dsh-cockpit-bridge/tests/settings-section.test.ts` 的测试脚手架（`settings.section` 插槽桩）
- [ ] 8.2 编写失败测试「申请立即返回并在就绪后通知地址」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › acquire resolves immediately, notifies url on ready snapshot（确认它因为正确的原因失败）
- [ ] 8.3 实现：使 8.2 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.4 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.5 编写失败测试「租约在页面存活期间自动续约」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › renews each lease at ≤60s interval（确认它因为正确的原因失败）
- [ ] 8.6 实现：使 8.5 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.7 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.8 编写失败测试「主通道断开期间续约被拒仍保持租约」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › 400 bad-request / network errors on renew are silent retries（确认它因为正确的原因失败）
- [ ] 8.9 实现：使 8.8 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.10 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.11 编写失败测试「同页重复申请不产生第二个租约」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › duplicate acquire (including in-flight) reuses one lease（确认它因为正确的原因失败）
- [ ] 8.12 实现：使 8.11 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.13 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.14 编写失败测试「删除条目后持有者收到撤销通知且不自动重新申请」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › revoked notifies holder once and does not reacquire（确认它因为正确的原因失败）
- [ ] 8.15 实现：使 8.14 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.16 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.17 编写失败测试「地址变化通知持有者」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › url change in snapshot notifies holder（确认它因为正确的原因失败）
- [ ] 8.18 实现：使 8.17 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.19 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.20 编写失败测试「不在驾驶舱中时接缝不可用」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › outside cockpit, acquire rejects with not-in-cockpit（确认它因为正确的原因失败）
- [ ] 8.21 实现：使 8.20 通过（bridge 提供转发申请接缝 `cockpitBridge.forwards`）
- [ ] 8.22 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.23 编写失败测试「伪造来源的快照消息被忽略」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › snapshot from non-cockpit origin is ignored（确认它因为正确的原因失败）
- [ ] 8.24 实现：使 8.23 通过（驾驶舱父页面向设备页面推送转发表快照）
- [ ] 8.25 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.26 编写失败测试「设置页列出转发」：`packages/dsh-cockpit-bridge/tests/settings-section.test.ts` › settings section › lists entries with source and state as plain text（确认它因为正确的原因失败）
- [ ] 8.27 实现：使 8.26 通过（bridge 在 DSH 设置页呈现本设备转发清单）
- [ ] 8.28 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.29 编写失败测试「在设置页手动创建常驻转发」：`packages/dsh-cockpit-bridge/tests/settings-section.test.ts` › settings section › create pins with pinnedBy dsh（确认它因为正确的原因失败）
- [ ] 8.30 实现：使 8.29 通过（bridge 在 DSH 设置页呈现本设备转发清单）
- [ ] 8.31 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.32 编写失败测试「设置页创建超限时原位提示」：`packages/dsh-cockpit-bridge/tests/settings-section.test.ts` › settings section › forward-limit shown inline, input kept（确认它因为正确的原因失败）
- [ ] 8.33 实现：使 8.32 通过（bridge 在 DSH 设置页呈现本设备转发清单）
- [ ] 8.34 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.35 编写失败测试「不在驾驶舱中时不提供操作」：`packages/dsh-cockpit-bridge/tests/settings-section.test.ts` › settings section › outside cockpit shows read-only hint, no actions（确认它因为正确的原因失败）
- [ ] 8.36 实现：使 8.35 通过（bridge 在 DSH 设置页呈现本设备转发清单）
- [ ] 8.37 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.38 编写失败测试「本机设备不提供操作」：`packages/dsh-cockpit-bridge/tests/settings-section.test.ts` › settings section › local device shows no actions（确认它因为正确的原因失败）
- [ ] 8.39 实现：使 8.38 通过（bridge 在 DSH 设置页呈现本设备转发清单）
- [ ] 8.40 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.41 编写失败测试「兼容接缝经转发表发布」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › portForward compat › publish acquires with legacy holder (≤64 chars) and resolves on ready within 8s（确认它因为正确的原因失败）
- [ ] 8.42 实现：使 8.41 通过（驾驶舱为设备提供端口发布接缝）
- [ ] 8.43 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.44 编写失败测试「新版 bridge 搭配旧版驾驶舱时回退旧端点」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › portForward compat › 401 on forwards endpoint falls back to legacy endpoints without capability renewal（确认它因为正确的原因失败）
- [ ] 8.45 实现：使 8.44 通过（驾驶舱为设备提供端口发布接缝）
- [ ] 8.46 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.47 编写失败测试「未 register 的用途标识不可发布」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › portForward compat › publish of unregistered id rejects（确认它因为正确的原因失败）
- [ ] 8.48 实现：使 8.47 通过（驾驶舱为设备提供端口发布接缝）
- [ ] 8.49 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.50 编写失败测试「无驾驶舱时消费方仍可工作」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › portForward compat › outside cockpit publish rejects cleanly, consumer falls back（确认它因为正确的原因失败）
- [ ] 8.51 实现：使 8.50 通过（驾驶舱为设备提供端口发布接缝）
- [ ] 8.52 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.53 编写失败测试「本机设备无需转发」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › portForward compat › local device publish returns direct loopback url（确认它因为正确的原因失败）
- [ ] 8.54 实现：使 8.53 通过（驾驶舱为设备提供端口发布接缝）
- [ ] 8.55 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢
- [ ] 8.56 编写失败测试「业务拒绝不触发能力串换发」：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › 409 business codes are surfaced without capability renewal（确认它因为正确的原因失败）
- [ ] 8.57 实现：使 8.56 通过（端口发布请求须经既有 capability 校验）
- [ ] 8.58 重构；全量测试保持绿色；在 test-plan.md 中把该行翻为 🟢

## 9. 实现期加固（review round 3 📌，额外测试，非 scenario 行）

- [ ] 9.1 编写失败测试：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › in-flight renew after release that returns lease-expired does not notify the holder（📌5）
- [ ] 9.2 实现：release 与 renew 的竞态处理，使 9.1 通过
- [ ] 9.3 编写失败测试：`packages/dsh-cockpit-bridge/tests/client.test.ts` › portForward compat › legacy holder label replaces non-printable-ASCII and truncates by code point to ≤64（📌6）
- [ ] 9.4 实现：清洗 legacy 标签，使 9.3 通过
- [ ] 9.5 编写失败测试：`packages/cockpit-server/tests/forward-table.test.ts` › lifetime › entry held only by legacy leases is never persisted（📌7）
- [ ] 9.6 实现：只有 legacy 租约的条目不写盘，使 9.5 通过
- [ ] 9.7 编写失败测试：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › extras avoid the cockpit's own listen port（📌8）
- [ ] 9.8 实现：`avoidLocalPorts` 纳入驾驶舱端口，使 9.7 通过
- [ ] 9.9 编写失败测试：`packages/cockpit-server/tests/connectivity.service.test.ts` › forwards › alias edit while an extra is starting disposes the old-alias child immediately（📌10）
- [ ] 9.10 实现：generation 失效时立即 dispose 在途子进程，使 9.9 通过
- [ ] 9.11 编写失败测试：`packages/cockpit-server/tests/app-auth.e2e.test.ts` › shell › static shell responses carry `Content-Security-Policy: frame-ancestors 'self'`（📌1）
- [ ] 9.12 实现：给 shell 响应加 `frame-ancestors 'self'`，使 9.11 通过
- [ ] 9.13 重构；全量测试保持绿色

## 10. 补充校验、文档与收尾

- [ ] 10.1 编写失败测试：`packages/dsh-cockpit-bridge/tests/client.test.ts` › forwards › lease stays alive under throttled timers（fake timers，60s clamp）（确认它因为正确的原因失败）
- [ ] 10.2 实现：让续约调度能容忍后台定时器节流，使 10.1 通过
- [ ] 10.3 重构；全量测试保持绿色
- [ ] 10.4 真实浏览器手工验收：设备页置于后台 tab（开启 Memory Saver）15 分钟，确认租约未被回收；把结果记入 verify
- [ ] 10.5 README：替换端口发布段落，写明 forwards 接缝、上限 N / 8，以及“被转发端口对本机进程无认证可达”
- [ ] 10.6 BACKLOG：关闭或更新相关条目；新增 bridge 0.5.x 旧端点的移除计划（另起 change）
- [ ] 10.7 发布说明：写明回滚后 `forwards` 常驻条目会丢失；发布顺序为驾驶舱先于 bridge 0.6.0；非回环主机名访问会被 403
- [ ] 10.8 运行 `pnpm build && pnpm typecheck && pnpm test && pnpm lint`，确认全部通过
- [ ] 10.9 运行 `openspec validate device-forward-registry --strict`，确认通过；确认 test-plan.md 没有剩余 🔴 行
