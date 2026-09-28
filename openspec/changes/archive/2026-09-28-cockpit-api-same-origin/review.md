## Review Metadata

- **Review round**: 1
- **Prior round**: none（拆分前在 device-forward-registry 内经 3 轮 review，round 3 APPROVE_WITH_CHANGES 已应用）
- **Reviewer context**: fresh-context subagent (same model family; cross-model CLI not used for data locality)
- **Tool restrictions**: read-only inspection of artifacts and source (grep / bounded sed windows); the only write is this file. Non-destructive runtime probes were run: the real `AppModule` was started via tsx against an empty temp `DSH_COCKPIT_HOME`, with probe scripts under `/tmp/v2-review/probe/`. No repository file was modified.
- **Artifacts reviewed**: proposal.md, design.md, specs/cockpit-api-auth/spec.md, .openspec.yaml; current specs (cockpit-workbench, cockpit-device-port-forward, cockpit-pwa); downstream change device-forward-registry (design.md, port-forward delta) for the cross-capability contract; source: `cockpit-server/src/auth/token.middleware.ts`, `auth/bootstrap.controller.ts`, `auth/auth.module.ts`, `main.ts`, `devices/devices.controller.ts` (route list and bridge capability handling), `tests/app-auth.e2e.test.ts`, `cockpit-web/src/api/{client,stream}.ts`, `cockpit-web/vite.config.ts`, `cockpit-web/public/sw.js`, `bin/cockpit` (fetch helper), `dsh-cockpit-bridge/src/client/index.ts` (seamFetch / post). Note: `/tmp/dfr-v1/review.md` did not exist, so the pre-split review could not be consulted.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Findings

### 🔴 Critical (blocking)

**C1. The whole guard is keyed on a case-sensitive `/api/` prefix, but Express matches routes case-insensitively. A mixed-case path bypasses the Host check, the source check and the token check (reproduced).**
- Evidence: `token.middleware.ts:63-65` `requiresToken = pathname.startsWith('/api/') && …`, and `isBridgeCallback` (:75-81) uses exact matches. Express/Nest are case-insensitive by default (`case sensitive routing` is off). Live probe of the real `AppModule` with no cookie:
  - `GET /API/devices` → **200** `{"device":[]}`;
  - `POST /API/devices/x/workbench-launch` and `PUT /Api/devices/x` → reach the controller (404 `unknown-device`, not 401). With a real device ID they would run the business logic.
  - Under the current global CORS, `Origin: http://127.0.0.1:1` gets `ACAO` reflected plus `ACAC: true`, so the response is also readable cross-origin.
- Impact: D1's claim that "Host is checked before every exemption, guaranteed by code order" cannot be achieved. It is gated on `path starts with /api/`, which is the same case-sensitive test.
  - A DNS rebinding page only needs to request `/API/devices`. A device page does not even need a cookie to call `/API/devices/<any>/workbench-launch` and read the launch token.
  - Every Goal in the proposal/design fails. Every scenario in the spec only tests lowercase paths, so a green test run would give false assurance.
  - The design Context states it was "confirmed by reading the code" but misses this. The Why section also underestimates the existing exposure: it is not only "with a cookie" but "without any cookie at all".
- Why APPROVE_WITH_CHANGES rather than REVISE: the fix is small, the direction is unique, and it can be fully specified (see RC1). It does not affect any human decision.

### 🟡 Moderate

**M1. The cross-capability wording "declared by the capability that defines the bridge seam" does not match the current specs, and there is no mechanism to keep the list in sync after downstream changes it.**
- The current `openspec/specs/cockpit-workbench` and `cockpit-device-port-forward` contain no `/api/bridge/*` path, and neither declares "bridge callback routes". Today the declarations the spec claims exist only as the snapshot inside this spec (spec.md:12), and the proposal says "Modified Capabilities: none".
- Downstream device-forward-registry only adds a delta to `cockpit-device-port-forward`. It declares acquire/release, "removes publishable-port/publish-port from the list" (downstream port-forward spec:394, 448), and has **no** `cockpit-api-auth` delta.
- Once both changes are archived, `cockpit-api-auth` would still say "the list when this capability lands includes publishable-port/publish-port (cockpit-device-port-forward)". That contradicts the port-forward spec, and a current spec should not contain a historical snapshot.
- Test ambiguity: is the authoritative list the enumeration in api-auth, or the union of declarations across capabilities? Should a test assert against the api-auth snapshot or the union?
- Fix: see RC2 (choose one model and make it consistent).

**M2. Having `main.ts` and the e2e test both call `configureHttpSecurity(app)` does not prove that production actually calls it, and D5's middleware order is not written down as a constraint.**
- Today `app-auth.e2e.test.ts:40-41` builds the app with `NestFactory.create` + `listen` itself. After the extraction, if `main.ts` misses the call, or calls it in the wrong position, the tests still pass.
- For `frame-ancestors` to appear on every response, the header middleware must be registered before `enableCors`. Otherwise the 204 response that the cors package short-circuits for a bridge preflight (`preflightContinue:false`) goes out without the header. It must also be registered before `listen()`/`init()`, so it runs before the Nest middleware (TokenMiddleware). The design only says "the earliest-running middleware" and does not pin down the relative order against CORS.
- Fix: see RC3.

### 📌 Suggestions

1. **Host scenarios cannot be built with `fetch`.** A probe showed Node/undici silently replaces a custom `Host` header with the real value, while `Origin` and `Sec-Fetch-Site` can be set freely. The DNS rebinding scenario and the Vite dev-proxy scenario (`Host: 127.0.0.1:5173`) should use `node:http.request` in the e2e test. "Missing Host" can only be sent over a raw socket with HTTP/1.0: Node rejects HTTP/1.1 without Host with 400, while HTTP/1.0 reaches the app with `host=undefined`. It is worth adding a missing-Host scenario to lock in the fail-closed behaviour.
2. Make the THEN of "bridge callbacks are not subject to the source check" concrete: with a forged capability plus a device origin, the response should be **400 `bridge-capability-invalid`** (not 403 `cross-origin-rejected`). That is mechanically assertable today; see `app-auth.e2e.test.ts:104-106`.
3. Add scenarios for `Sec-Fetch-Site: cross-site` and `Origin: null` (sandboxed iframe or redirect) being rejected, to cover the fail-closed branches.
4. The THEN of "a device page with a cookie modifying or deleting a device is rejected" includes "the connection is unchanged". The e2e registry is empty, so this cannot be asserted as written. Either narrow it to "403 and the registry is unchanged as read by a follow-up GET /api/devices", or seed a device in GIVEN.
5. The invariant "routes with side effects MUST NOT use GET/HEAD" has no scenario. Consider a unit test that enumerates controller route metadata and asserts that GET routes ⊆ {devices, devices/stream, runtime/status, bootstrap}.
6. D2 says the Host hostname is "compared after URL parsing". WHATWG URL normalises `127.1` and `0x7f.1` to `127.0.0.1`. That is harmless (they really are loopback), but the spec should say whether the whitelist compares the literal string or the normalised form, so implementations and tests don't diverge.
7. The scenario "shell response carries frame-ancestors" (`GET /`) returns 404 in e2e, because `webDist` may not be built. The header still appears, so the assertion holds, but it is not really the shell HTML. You could mark it as "any response for a non-/api/ path".
8. `tokens.resolve()` (token.middleware.ts:30) runs before the bridge exemption. Once the guard is placed first, a rejection path never reaches it, which satisfies "no side effects". Suggest the design D1 say this explicitly.

Other attack points checked, no issues found:
- **Standalone after the split.** None of the three artifacts contains leftover references to the forwarding table, leases or `forwards`. The Why section (cross-device privilege escalation plus DNS rebinding) holds on its own. The only mention of downstream is a one-way dependency note.
- **Middleware order.** Placing the Host check before `requiresToken`, the bootstrap exemption, and the 401 path that sets `Set-Cookie` is correct in both D1 and the spec, apart from C1.
- **Existing callers.**
  - The web client (`client.ts:14` same-origin), EventSource (`stream.ts:16`, same-origin GET), the SW (`sw.js:76,101` re-fetch of the same request), the Vite proxy (`changeOrigin:false`), and the CLI (probe: only `sec-fetch-mode: cors`, no Origin or `Sec-Fetch-Site`) all pass.
  - Both bridge fetches (`index.ts:136, 260`) carry the capability header and no cookie. The bridge preflight is handled by cors before TokenMiddleware, so it is not blocked by the Host or source checks.
- **CORS `origin:false`.** The cors package calls `next()` directly, and the request then gets 403 from TokenMiddleware. This satisfies "no ACAC".
- **Human decisions.** The five items (legacy 403, non-loopback 403 with no reserved config, frame-ancestors on every response, no `::1`, bridge `credentials:true` as an Open Question) are expressed consistently across proposal, design, and spec. Only the `::1` decision is not written into the spec as a scenario; the spec's whitelist wording already excludes it, which is sufficient.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

APPROVE WITH CHANGES: C1 is a real, reproducible bypass, but the fix is small and fully specified. M1 and M2 are wording/structure fixes.

## Required Changes (if APPROVE WITH CHANGES)

1. **(C1) Case-insensitive path matching.**
   - Spec: add under the requirement "The cockpit's cookie-authenticated API only accepts same-origin cockpit requests": "The decision of whether a request is an `/api/` request, and exact matching against the bridge callback list, SHALL use the same case-insensitive semantics as the HTTP router. Implementations may, for example, lowercase the pathname before matching, or enable case-sensitive routing so that router and guard agree. A variant path that the router dispatches to an `/api/` handler MUST NOT bypass the Host, source, or token checks."
   - Spec: add a scenario: GIVEN no cookie / `Host: evil.example:3090`; WHEN `GET /API/devices` and `POST /Api/devices/<id>/workbench-launch`; THEN 401 or 403 respectively (the Host-violation case is 403 `cross-origin-rejected`), no `Set-Cookie`, and the body contains no device data or token.
   - Design D1: state the normalisation approach. Correct the Context/Why description of `requiresToken` to note this existing no-cookie bypass.
   - The CORS delegate in D4 must use the same normalised matching function.
2. **(M1) Choose a single authoritative model for the bridge callback list.**
   - Either (a) make `cockpit-api-auth` the sole authoritative list: remove the wording "declared by each capability", and require any change that adds or removes a bridge callback route to ship a MODIFIED delta for `cockpit-api-auth`. The downstream device-forward-registry would then need a `cockpit-api-auth` delta.
   - Or (b) keep the "declared by the owning capability" model: this change adds deltas to `cockpit-workbench` and `cockpit-device-port-forward` declaring their respective routes, and `cockpit-api-auth` changes to "the list is the union of those declarations" with the "list when this lands" snapshot demoted to a non-normative example. Update the proposal's Modified Capabilities accordingly.
   - Whichever is chosen, tell the author of device-forward-registry so their spec stays in sync.
3. **(M2) Write down the shared bootstrap and order constraints.**
   - Design D4/D5: change the extraction target to a factory shared by `main.ts` and the e2e test, e.g. `createCockpitApp()`, which contains `NestFactory.create` + security configuration. Alternatively, keep `configureHttpSecurity` but add a test asserting that `main.ts#bootstrap` calls it.
   - State explicitly: "the frame-ancestors middleware is registered before `enableCors`, and both before `listen`/`init`".
   - Add a scenario: a bridge preflight (OPTIONS) response also carries `frame-ancestors 'self'`.

CHANGES_APPLIED: yes

## Rebuttals

<!-- Author responds to findings: fixed (cite change) or rebutted (reasoning). -->

**Re-check of Required Changes (round 1, reviewer; only these 3 items):**

1. **RC1 / C1 — re-checked: ok.**
   - Spec lines 16-20 add the "path matching semantics" paragraph. It covers `/api/`, bootstrap and the bridge list, requires case-insensitive matching consistent with the router, forbids path variants from bypassing any check, and requires CORS to share the same matching function.
   - Spec line 108 adds the "case-variant paths cannot bypass the checks" scenario (two 401s plus one 403 with no Set-Cookie, and no data or token in any response body). It can be asserted mechanically.
   - Design Context line 18 records the bypass and hotfix `b1ccc9b`. D1 specifies the shared `classifyApiPath`, and D4's CORS logic reuses it.
   - Code check: `token.middleware.ts:29` lowercases the pathname, and `requiresToken` (:68-71) also folds case. The hotfix includes e2e and unit tests. I did not run them in this round.
2. **RC2 / M1 — re-checked: ok (option a).**
   - Spec line 118 adds a standalone requirement for the bridge callback list: it is the only authoritative source, and any change that adds or removes a route MUST update it as a MODIFIED delta.
   - The token/source exemption now references that list (spec line 12), and the old wording "declared by each capability" is gone.
   - Two new scenarios are both assertable: an unlisted path gets 403 with no ACAC, and a case variant is handled the same as the listed path.
   - Downstream follow-up, outside this change: `device-forward-registry/specs/` currently has no `cockpit-api-auth` delta. When that change's artifacts are next revised, it must add a MODIFIED delta for this requirement (remove publishable-port/publish-port, add forwards/acquire and forwards/release). Design line 64 already states this obligation.
3. **RC3 / M2 — re-checked: ok.**
   - D4 (design lines 100-102) switches to a shared `createCockpitApp()` factory containing `NestFactory.create` plus the security configuration, and the e2e test uses the same factory.
   - Registration order is fixed as frame-ancestors, then enableCors, then listen/init, with the reason stated (so the preflight 204 also carries the header).
   - Spec line 154 adds the "bridge preflight response also carries frame-ancestors" scenario.

CHANGES_APPLIED is set to yes.

## Implementation Review (post-apply)

Fresh-context security review of the implementation, three rounds; full report kept outside the repo.

1. **88c0c2d — REVISE.**
   - C1: absolute-form request targets skipped the whole guard.
   - M1: bridge preflights were answered by CORS before the Host check.
   - M2: weak assertions.
   - Fix 653ee6a: a request-target + Host guard (`requestGuard`) mounted in `createCockpitApp()` ahead of CORS.
   - Artifacts amended: spec +2 scenarios, design D1/D4 revised, test-plan +2 rows, tasks 3a.
2. **653ee6a — REVISE.**
   - C1': with `\` + `#`, parseurl's slow path rewrote `\` to `/`, so `/api\devices#x` routed to `/api/devices`.
   - Fix 80146cc: reject RFC 9112-invalid origin-form characters, and reject when the router's reading (`request.path`) differs from the guard's.
   - Artifacts amended: spec origin-form tightened, design D1 layer 0 rewritten, tasks 3b.
3. **80146cc — APPROVE.**
   - Covers the re-review of the amended spec/design (the amendments voided the earlier verdict, per apply rules).
   - About 30 further path variants were probed on a real server; none reached a handler.
   - Two non-blocking suggestions applied in 18b3aef: a generic 400 message, and a comment in `main.ts` stating the static/`api/` constraint.

IMPLEMENTATION_VERDICT: APPROVE

## Merge Amendment Review (post-merge, fresh context)

Scope: uncommitted amendment on top of ef983b6 (`git diff HEAD` + new `specs/cockpit-workbench/spec.md`). Ran `openspec validate cockpit-api-same-origin --strict` (valid), `tests/app-auth.e2e.test.ts` (12/12), `tests/workbench.test.tsx` (33/33), and a raw-HTTP probe of 19 header shapes against the built server (`dist/app-factory.js`).

1. 🟡 **The spec says empty Origin goes to the wrong layer.**
   - The delta says "缺失或空Origin … SHALL由本接口以403 `workbench-origin-forbidden`拒绝" (`specs/cockpit-workbench/spec.md:9`), and the scenario THEN says "缺失/空Origin … 由本接口返回 `workbench-origin-forbidden`" (`:36`).
   - The code does something else. The global guard only skips the check when the header is `undefined`: `origin !== undefined && origin !== \`http://${host}\`` (`token.middleware.ts:55`). So `Origin: ''` is refused there with `cross-origin-rejected`.
   - The e2e agrees with the code, not the spec: `'empty Origin'` is in `globalRejects` (`app-auth.e2e.test.ts:230`). The probe also returned `cross-origin-rejected` for it.
   - Fix: drop "空" from both places so the launch-gate list reads "缺失Origin、`localhost`形式Host等", or move empty Origin into the global-guard list. The proposal and D7 already say "缺失 Origin" only, so they are consistent.
2. 🟡 **Pre-existing, not caused by this amendment: a duplicate Host passes both layers.** The amended text re-asserts "拒绝缺失/重复/非法Origin或Host" (`spec.md:9`), so it is now part of this change.
   - Node's HTTP parser keeps only the first `Host`. If that first value is valid, both `headerValue(request.headers.host)` (`token.middleware.ts:42`) and `exactCockpitOrigin` (`devices.controller.ts:440-452`) see a single valid Host.
   - Probe result for `Host: <cockpit>, Host: 127.0.0.1:1, Origin: <cockpit>`: **404 `unknown-device`**. The request reached `connectivity.workbenchLaunch`, and for an existing device it would reach token access. With the bogus Host first, it is correctly refused with 403.
   - The e2e hides this: the raw `duplicate Host` case (`app-auth.e2e.test.ts:263`) accepts any status from 400 to 499 (`:273`), so 404 passes. The old test had the same hole.
   - Browsers cannot send a duplicate Host, so this is only reachable by a local process, which is already inside the stated trust boundary. It is still a gap between spec and code.
   - Suggested follow-up (small, can be separate): reject a repeated `Host` in `requestGuard` using `request.rawHeaders`, and tighten that raw case to 400 or 403. Or state in the spec that duplicate Host is left to the HTTP parser.
3. 📌 **Check 1 — the delta is a faithful copy.** Diffing `openspec/specs/cockpit-workbench/spec.md:7-100` against the delta shows exactly three changes: the Origin paragraph (line 7→9), the forwarded-scenario THEN (34→36), and the added scenario "来源被拒时Web显示固定文案". No scenario was dropped. The success, no-store/referrer and forwarded-ignore clauses are kept word for word.
4. 📌 **Check 2 — the layering claims match the code.**
   - The probe returned `workbench-origin-forbidden` for: `localhost` Host with a matching Origin, `LOCALHOST` in upper case, `localhost` with no Origin, `127.0.0.1:80`, and a missing Origin.
   - It returned `cross-origin-rejected` for: a mismatched port, `null`, a trailing `/`, a scheme-less Origin, a duplicate Origin (Node joins the values with `, `), an empty Host, and `Sec-Fetch-Site: same-site`.
   - So "a `localhost` Host passes the global guard but is refused by the launch gate" holds. Apart from #2, I found no shape that gets past both layers.
5. 📌 **Check 3 — the rewritten e2e is not weaker.**
   - Every earlier case still asserts 403 and the same leak regex, and the code is now pinned exactly with `JSON.parse(body).code`, which is stricter than the old `toContain`.
   - The new `localhost` case adds coverage.
   - One minor loosening: in the raw cases a 403 now accepts either code instead of only `workbench-origin-forbidden`. It could be pinned per case, but it does not weaken any security check.
6. 📌 **Check 4 — consistent with cockpit-api-auth and design D7.** The cockpit-api-auth scenario "设备页面带 cookie 获取启动 URL 被拒绝 → 403 `cross-origin-rejected`" matches the new layering. D7's reasons hold in the code: the global guard lets a missing Origin through (the CLI needs that), and the inner gate is the only thing that refuses launch without an Origin. The web change (`Workbench.tsx:41`) and its test are correct: the fixed wording is shown, the server message is not, and no tokenized iframe is created.

AMENDMENT_VERDICT: APPROVE_WITH_CHANGES

**Merge amendment — author response:**
- 🟡1 fixed: `specs/cockpit-workbench/spec.md` now says empty Origin is caught by the global guard (`cross-origin-rejected`); only a *missing* Origin reaches the launch gate. Matches code and e2e.
- 🟡2 fixed (not merely documented): `exactCockpitOrigin` counts `rawHeaders` and refuses a repeated Host with 403 `workbench-origin-forbidden`; e2e pins that exact result (was red at 404 `unknown-device`, now green). Spec lists "重复Host" under the launch-gate layer. Global guard unchanged.

CHANGES_APPLIED (amendment): yes
