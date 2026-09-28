## 1. 共享应用工厂（design D4）

- [x] 1.1 Write failing test: `main.ts#bootstrap` creates the app through `createCockpitApp()` (unit test; fails because the factory does not exist)
- [x] 1.2 Implement: extract `createCockpitApp()` (NestFactory.create + frame-ancestors + CORS, in that order) and call it from `main.ts`; switch `app-auth.e2e.test.ts` to the factory; to pass 1.1
- [x] 1.3 Refactor; full suite stays green (hotfix `b1ccc9b` case-folding tests included)

## 2. 路径分类与 bridge 名单（spec: bridge 回调路由名单；design D1）

- [x] 2.1 Write failing test: `does not exempt an unlisted /api/bridge/ path` (assert it fails for the right reason)
- [x] 2.2 Implement: export `classifyApiPath(originalUrl)` (lowercased; api / bootstrap / bridge-callback) and route every path decision in `TokenMiddleware` through it to pass 2.1
- [x] 2.3 Refactor; full suite stays green
- [x] 2.4 Write failing test: `matches a mixed-case listed bridge path as the listed route` (assert it fails for the right reason)
- [x] 2.5 Implement: case-folded exact matching against the list to pass 2.4
- [x] 2.6 Refactor; full suite stays green

## 3. Host 层（design D1 第 1 层）

- [x] 3.1 Write failing test: `rejects a rebinding Host on /api/devices and /api/bootstrap without Set-Cookie` (assert it fails for the right reason)
- [x] 3.2 Implement: unconditional Host check before `requiresToken`/bootstrap and before the 401 `Set-Cookie`; 403 `cross-origin-rejected` to pass 3.1
- [x] 3.3 Refactor; full suite stays green
- [x] 3.4 Write failing test: `gates mixed-case /api/ paths for both the token and the Host checks` (assert it fails for the right reason)
- [x] 3.5 Implement: Host check keyed on the classified (case-folded) path to pass 3.4
- [x] 3.6 Refactor; full suite stays green

## 3a. 实现审查修订：请求目标层与 Host 层前置（design D1 修订，review C1/M1）

- [x] 3a.1 Write failing test: `rejects absolute-form and other non-origin-form request targets before any routing` (raw socket; assert it fails for the right reason — 200 with device data)
- [x] 3a.2 Implement: factory middleware after frame-ancestors, before CORS: non-origin-form `originalUrl` → 400 `bad-request-target`; to pass 3a.1
- [x] 3a.3 Write failing test: `applies the Host check to bridge preflights and grants them no CORS` (assert it fails for the right reason — 204 with ACAO)
- [x] 3a.4 Implement: move the Host check from `TokenMiddleware` to a factory middleware before `enableCors`; to pass 3a.3
- [x] 3a.5 Refactor: tighten Host port to 1–65535; tighten weak assertions (self-page → 400 `device-command-failed`, bridge → exact controller code, non-bridge preflight → 403); full suite stays green

## 3b. 二次审查修订：请求目标与 router 读法一致（design D1 第 0 层，review C1'）

- [x] 3b.1 Write failing test: backslash + `#` targets (`/api\devices#x`, `DELETE /api\devices\<id>?confirmed=true#`) in the non-origin-form e2e (assert it fails for the right reason — 200 with device data)
- [x] 3b.2 Implement: reject RFC 9112-invalid origin-form characters, and reject when the router's reading (`request.path`) differs from the guard's; to pass 3b.1
- [x] 3b.3 Unit test that the reading comparison alone rejects a divergent target (mutation-checked: removing either defense turns a test red)
- [x] 3b.4 Refactor: fix design/test-plan stale `isBridgeCallback` references and duplicated sentence; full suite stays green

## 4. 来源层（design D1 第 2 层、D2、D3、D6）

- [x] 4.1 Write failing test: `accepts the cockpit page itself (Origin == http://Host, same-origin)` (assert it fails for the right reason)
- [x] 4.2 Implement: Origin must equal `http://` + Host to pass 4.1
- [x] 4.3 Refactor; full suite stays green
- [x] 4.4 Write failing test: `accepts the dev-proxy page (Host 127.0.0.1:5173 preserved, matching Origin)` (assert it fails for the right reason)
- [x] 4.5 Implement: Host-derived self origin (no configured-port comparison) to pass 4.4
- [x] 4.6 Refactor; full suite stays green
- [x] 4.7 Write failing test: `accepts a CLI request with cookie and no Origin/Sec-Fetch-Site` (assert it fails for the right reason)
- [x] 4.8 Implement: absent Origin falls through to the token check to pass 4.7
- [x] 4.9 Refactor; full suite stays green
- [x] 4.10 Write failing test: `rejects workbench-launch from a device-page origin with 403 and no launch url` (assert it fails for the right reason)
- [x] 4.11 Implement: reject mismatched Origin before any handler runs to pass 4.10
- [x] 4.12 Refactor; full suite stays green
- [x] 4.13 Write failing test: `rejects PUT and DELETE device from a device-page origin and leaves the registry unchanged` (assert it fails for the right reason)
- [x] 4.14 Implement: same guard covers PUT/DELETE; assert registry file unchanged to pass 4.13
- [x] 4.15 Refactor; full suite stays green
- [x] 4.16 Write failing test: `rejects Sec-Fetch-Site: same-site without Origin` (assert it fails for the right reason)
- [x] 4.17 Implement: Sec-Fetch-Site must be same-origin or none to pass 4.16
- [x] 4.18 Refactor; full suite stays green
- [x] 4.19 Write failing test: `lets a capability-bearing bridge callback past the origin check` (assert it fails for the right reason)
- [x] 4.20 Implement: origin-layer exemption for listed bridge callbacks carrying the capability header to pass 4.19
- [x] 4.21 Refactor; full suite stays green
- [x] 4.22 Write failing test: `rejects a capability-less bridge callback from a device origin` (assert it fails for the right reason)
- [x] 4.23 Implement: no exemption without the capability header to pass 4.22
- [x] 4.24 Refactor; full suite stays green

## 5. CORS 按路由分流（design D4）

- [x] 5.1 Write failing test: `omits Access-Control-Allow-Credentials on a non-bridge preflight` (assert it fails for the right reason)
- [x] 5.2 Implement: `CorsOptionsDelegate` using `classifyApiPath`; non-bridge routes get `origin: false` to pass 5.1
- [x] 5.3 Refactor; full suite stays green
- [x] 5.4 Write failing test: `reflects the device origin and allows the capability header on a bridge preflight` (assert it fails for the right reason)
- [x] 5.5 Implement: bridge routes keep loopback reflection, credentials and the capability header (no `::1`) to pass 5.4
- [x] 5.6 Refactor; full suite stays green

## 6. frame-ancestors（spec: 驾驶舱页面只允许被驾驶舱自身嵌入；design D5）

- [x] 6.1 Write failing test: `sends frame-ancestors 'self' on GET /` (assert it fails for the right reason)
- [x] 6.2 Implement: global header middleware registered first in the factory to pass 6.1
- [x] 6.3 Refactor; full suite stays green
- [x] 6.4 Write failing test: `sends frame-ancestors 'self' on a 403 rejection` (assert it fails for the right reason)
- [x] 6.5 Implement: header set before the guard can end the response to pass 6.4
- [x] 6.6 Refactor; full suite stays green
- [x] 6.7 Write failing test: `sends frame-ancestors 'self' on a bridge preflight` (assert it fails for the right reason)
- [x] 6.8 Implement: header middleware registered before `enableCors` to pass 6.7
- [x] 6.9 Refactor; full suite stays green
- [x] 6.10 Write failing test: `sends a CSP with only the frame-ancestors directive` (assert it fails for the right reason)
- [x] 6.11 Implement: CSP value is exactly `frame-ancestors 'self'` to pass 6.10
- [x] 6.12 Refactor; full suite stays green

## 6a. 合并修订：与 workbench-launch 自身 Origin gate 分层（design D7）

- [x] 6a.1 Spec drift: 合并 `fix-new-browser-workbench-auth` 后 e2e `rejects every non-exact workbench launch Origin and Host before secret access` 失败（`cross-origin-rejected` ≠ `workbench-origin-forbidden`）；新增 `specs/cockpit-workbench` MODIFIED delta 表述分层，更新 proposal / design D7 / test-plan
- [x] 6a.2 Rewrite the e2e matrix per layer: mismatched Origin → `cross-origin-rejected`; missing Origin and `localhost` Host → `workbench-origin-forbidden`; no leak in any case
- [x] 6a.3 Write failing test: `shows the fixed origin wording for both the global and the launch-gate origin rejection`（fails: fallback text shown for `cross-origin-rejected`）
- [x] 6a.4 Implement: `Workbench.tsx` maps `cross-origin-rejected` to the same fixed wording; to pass 6a.3
- [x] 6a.6 Review 🟡1: spec 把空 Origin 归到了内层；改为“含空Origin → 全局守卫”
- [x] 6a.7 Review 🟡2 — write failing test: duplicate Host on workbench-launch → 403 `workbench-origin-forbidden` (failed: 404 unknown-device, i.e. reached the handler)
- [x] 6a.8 Implement: `exactCockpitOrigin` refuses a repeated Host via `rawHeaders`; to pass 6a.7
- [x] 6a.5 Fresh-context re-review of the amended artifacts (verdict voided by the spec edit); record in review.md

## 7. 收尾验证

- [x] 7.1 Run `pnpm build && pnpm typecheck && pnpm lint && pnpm test`; confirm all pass
- [x] 7.2 Run `openspec validate cockpit-api-same-origin --strict`; confirm it passes and every test-plan row is 🟢
- [x] 7.3 Manual browser check (design Migration 2): cockpit page, `pnpm dev` proxy, device iframe bridge hello/session-opened, PWA offline shell, `bin/cockpit status/stop` all work（2026-09-28 降级验收，所有者要求尽早收尾：已激活新构建 pid 62989，对真实 3 台设备跑 20/20 黑盒检查——跨源 launch/PUT/DELETE 403 且注册表不变、无 Origin/localhost/重复 Host 由内层拒绝、rebinding Host 无 Set-Cookie、`/API/`大小写与 `\`目标被拒、CSP 在 shell/403 上、bridge 预检放行而非 bridge 预检无 CORS、精确 Origin 3/3 签发 no-store/no-referrer URL、日志无 token；真实浏览器驾驶舱页面在线且 host 设备 bridge 回调于重启后持续到达、日志无 bridge 路由拒绝；`bin/cockpit status/restart` 正常。未手工复测：`pnpm dev` 代理（由 e2e `accepts the dev-proxy page` 覆盖）、PWA 离线壳（本 change 未改 SW/静态托管，且 SW 仅同源 GET）、跨电脑访问（无第二台机器环境，所有者确认后续需要时再查）。所有者确认不以此为阻塞）
