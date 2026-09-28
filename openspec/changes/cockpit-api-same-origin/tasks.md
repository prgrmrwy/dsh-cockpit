## 1. 共享应用工厂（design D4）

- [ ] 1.1 Write failing test: `main.ts#bootstrap` creates the app through `createCockpitApp()` (unit test; fails because the factory does not exist)
- [ ] 1.2 Implement: extract `createCockpitApp()` (NestFactory.create + frame-ancestors + CORS, in that order) and call it from `main.ts`; switch `app-auth.e2e.test.ts` to the factory; to pass 1.1
- [ ] 1.3 Refactor; full suite stays green (hotfix `b1ccc9b` case-folding tests included)

## 2. 路径分类与 bridge 名单（spec: bridge 回调路由名单；design D1）

- [ ] 2.1 Write failing test: `does not exempt an unlisted /api/bridge/ path` (assert it fails for the right reason)
- [ ] 2.2 Implement: export `classifyApiPath(originalUrl)` (lowercased; api / bootstrap / bridge-callback) and route every path decision in `TokenMiddleware` through it to pass 2.1
- [ ] 2.3 Refactor; full suite stays green
- [ ] 2.4 Write failing test: `matches a mixed-case listed bridge path as the listed route` (assert it fails for the right reason)
- [ ] 2.5 Implement: case-folded exact matching against the list to pass 2.4
- [ ] 2.6 Refactor; full suite stays green

## 3. Host 层（design D1 第 1 层）

- [ ] 3.1 Write failing test: `rejects a rebinding Host on /api/devices and /api/bootstrap without Set-Cookie` (assert it fails for the right reason)
- [ ] 3.2 Implement: unconditional Host check before `requiresToken`/bootstrap and before the 401 `Set-Cookie`; 403 `cross-origin-rejected` to pass 3.1
- [ ] 3.3 Refactor; full suite stays green
- [ ] 3.4 Write failing test: `gates mixed-case /api/ paths for both the token and the Host checks` (assert it fails for the right reason)
- [ ] 3.5 Implement: Host check keyed on the classified (case-folded) path to pass 3.4
- [ ] 3.6 Refactor; full suite stays green

## 4. 来源层（design D1 第 2 层、D2、D3、D6）

- [ ] 4.1 Write failing test: `accepts the cockpit page itself (Origin == http://Host, same-origin)` (assert it fails for the right reason)
- [ ] 4.2 Implement: Origin must equal `http://` + Host to pass 4.1
- [ ] 4.3 Refactor; full suite stays green
- [ ] 4.4 Write failing test: `accepts the dev-proxy page (Host 127.0.0.1:5173 preserved, matching Origin)` (assert it fails for the right reason)
- [ ] 4.5 Implement: Host-derived self origin (no configured-port comparison) to pass 4.4
- [ ] 4.6 Refactor; full suite stays green
- [ ] 4.7 Write failing test: `accepts a CLI request with cookie and no Origin/Sec-Fetch-Site` (assert it fails for the right reason)
- [ ] 4.8 Implement: absent Origin falls through to the token check to pass 4.7
- [ ] 4.9 Refactor; full suite stays green
- [ ] 4.10 Write failing test: `rejects workbench-launch from a device-page origin with 403 and no launch url` (assert it fails for the right reason)
- [ ] 4.11 Implement: reject mismatched Origin before any handler runs to pass 4.10
- [ ] 4.12 Refactor; full suite stays green
- [ ] 4.13 Write failing test: `rejects PUT and DELETE device from a device-page origin and leaves the registry unchanged` (assert it fails for the right reason)
- [ ] 4.14 Implement: same guard covers PUT/DELETE; assert registry file unchanged to pass 4.13
- [ ] 4.15 Refactor; full suite stays green
- [ ] 4.16 Write failing test: `rejects Sec-Fetch-Site: same-site without Origin` (assert it fails for the right reason)
- [ ] 4.17 Implement: Sec-Fetch-Site must be same-origin or none to pass 4.16
- [ ] 4.18 Refactor; full suite stays green
- [ ] 4.19 Write failing test: `lets a capability-bearing bridge callback past the origin check` (assert it fails for the right reason)
- [ ] 4.20 Implement: origin-layer exemption for listed bridge callbacks carrying the capability header to pass 4.19
- [ ] 4.21 Refactor; full suite stays green
- [ ] 4.22 Write failing test: `rejects a capability-less bridge callback from a device origin` (assert it fails for the right reason)
- [ ] 4.23 Implement: no exemption without the capability header to pass 4.22
- [ ] 4.24 Refactor; full suite stays green

## 5. CORS 按路由分流（design D4）

- [ ] 5.1 Write failing test: `omits Access-Control-Allow-Credentials on a non-bridge preflight` (assert it fails for the right reason)
- [ ] 5.2 Implement: `CorsOptionsDelegate` using `classifyApiPath`; non-bridge routes get `origin: false` to pass 5.1
- [ ] 5.3 Refactor; full suite stays green
- [ ] 5.4 Write failing test: `reflects the device origin and allows the capability header on a bridge preflight` (assert it fails for the right reason)
- [ ] 5.5 Implement: bridge routes keep loopback reflection, credentials and the capability header (no `::1`) to pass 5.4
- [ ] 5.6 Refactor; full suite stays green

## 6. frame-ancestors（spec: 驾驶舱页面只允许被驾驶舱自身嵌入；design D5）

- [ ] 6.1 Write failing test: `sends frame-ancestors 'self' on GET /` (assert it fails for the right reason)
- [ ] 6.2 Implement: global header middleware registered first in the factory to pass 6.1
- [ ] 6.3 Refactor; full suite stays green
- [ ] 6.4 Write failing test: `sends frame-ancestors 'self' on a 403 rejection` (assert it fails for the right reason)
- [ ] 6.5 Implement: header set before the guard can end the response to pass 6.4
- [ ] 6.6 Refactor; full suite stays green
- [ ] 6.7 Write failing test: `sends frame-ancestors 'self' on a bridge preflight` (assert it fails for the right reason)
- [ ] 6.8 Implement: header middleware registered before `enableCors` to pass 6.7
- [ ] 6.9 Refactor; full suite stays green
- [ ] 6.10 Write failing test: `sends a CSP with only the frame-ancestors directive` (assert it fails for the right reason)
- [ ] 6.11 Implement: CSP value is exactly `frame-ancestors 'self'` to pass 6.10
- [ ] 6.12 Refactor; full suite stays green

## 7. 收尾验证

- [ ] 7.1 Run `pnpm build && pnpm typecheck && pnpm lint && pnpm test`; confirm all pass
- [ ] 7.2 Run `openspec validate cockpit-api-same-origin --strict`; confirm it passes and every test-plan row is 🟢
- [ ] 7.3 Manual browser check (design Migration 2): cockpit page, `pnpm dev` proxy, device iframe bridge hello/session-opened, PWA offline shell, `bin/cockpit status/stop` all work
