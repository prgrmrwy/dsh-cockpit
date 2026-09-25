## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none as tasks; the browser black-box step (task 5.6) is executed but its **activation** step is outstanding — see "Change Delivery" below, because it requires restarting the Cockpit instance this session runs through.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test (no `N/A — non-executable` entries: this change has a full code test surface)
- [x] Every test-plan.md row flipped to 🟢 green (no row left 🔴 red)
- [x] Full suite passes (one PRE-EXISTING, unrelated baseline failure in `dsh-cockpit-bridge` — evidenced below)
- [x] Zero skipped/pending/commented-out tests
- [x] No test weakened or deleted without a REMOVED requirement. Tests that HAD to change are listed under "Test changes that were not weakening" below, each with its reason.

### Evidence

- Final full-suite command: `pnpm test` (plus per-package runs to isolate the pre-existing bridge failure)
- Result summary (final run, after every source edit including the DI fix):
  - root `node --test tests/*.test.mjs`: **8 passed, 0 failed, 0 skipped**
  - `@dsh-cockpit/server`: **17 files, 242 passed, 0 failed**
  - `@dsh-cockpit/web`: **8 files, 81 passed, 0 failed**
  - `@dsh-cockpit/shared`: **1 passed, 0 failed**
  - `dsh-cockpit-bridge`: 24 passed but vitest exits 1 with **1 unhandled rejection** in `tests/client.test.ts` ("cockpit port forward rejected (401)")
- Pre-existing baseline check: `git status` showed the change directory as the ONLY untracked/modified path, and `pnpm --filter dsh-cockpit-bridge test` fails identically **before** any source change. This failure is unrelated to this change and was left untouched (fixing it is a separate concern).
- Other gates:
  - `pnpm typecheck`: all 4 packages Done
  - `pnpm build`: all packages built, `cockpit-web` dist emitted
  - `pnpm lint`: all packages Done (two initial errors were fixed during implementation)
  - `openspec validate fix-new-browser-workbench-auth --strict`: **valid, 0 issues**
- Black-box observation BEFORE activation (the previous build, demonstrating the defect):
  - fresh cookie jar via `/api/bootstrap`, then `POST /api/devices/device-n7cr6mnv/workbench-launch`
  - exact-Origin request → `201` with a tokenized URL
  - **cross-origin request (`Origin: http://127.0.0.1:1080`) → also `201` with the full token** — no Origin gate, no token validation
- Black-box acceptance AFTER activation (new build running as pid 7737, script `/tmp/cockpit-blackbox.py`), all three real devices:
  - served shell references the rebuilt bundle `assets/index-CMkmC7za.js`
  - `host` `READY` gen3, `lumevm` `READY` gen7, `devbox` `READY`/gen5 at check time
  - every device: cross-origin `Origin: http://127.0.0.1:1080` → **403 `workbench-origin-forbidden`**; missing Origin → **403**
  - every device: exact Origin → **201** with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`
  - every device: a FRESH browser cookie jar then exchanged the handed-out token itself →
    **303 `Location: /` with an authority-bound `dsh-auth-<sha256(authority)>` cookie**
  - `devbox` advanced gen4 → gen5 during the run: a genuinely STALE stored token was replaced through the bounded, consented discovery path and committed behind the generation fence. All three stored tokens had been verified stale (raw exchange returned 401) immediately before the restart, so a fresh browser succeeded **because** of this change, not despite it.
  - `~/.dsh-cockpit/cockpit.log` contains no launch token after the run
- Activation incident (found and fixed before sign-off — recorded because it is exactly the class of defect unit tests cannot see):
  - the first restart attempt failed with `cockpit server exited early with code 1`: `Nest can't resolve dependencies of the ConnectivityService (..., ?)`.
  - Cause: this change had added an **undecorated fourth constructor parameter** to `ConnectivityService` for test seams. Nest DI only resolves decorated parameters, and the bare `Object` type has no injection token, so the whole graph failed to boot. Every unit test constructs the service directly, so the suite stayed green.
  - Fix: the seams now travel inside the single `@Optional() seams: ConnectivityServiceSeams = {}` parameter that Nest already knows how to omit, and `ConnectivityServiceSeams` is an exported interface.
  - Guard added: `app-auth.e2e.test.ts` boots the REAL `AppModule` and smoke-checks routes, so an un-injectable constructor fails the suite instead of production; `packages/cockpit-server/dist/main.js` was also started directly to confirm a clean boot before re-activating.
- Non-executable checks run: none

### Review Integrity
- [x] review.md `VERDICT: APPROVE` (round 3, fresh-context reviewer)
- [x] Verdict not stale for `proposal.md`, `design.md`, `specs/`: those files were NOT edited after the verdict. `tasks.md` and `test-plan.md` changed (they are post-verdict, apply-phase ledgers and are not part of the reviewed artifact set).
- [x] All findings fixed or rebutted; the round-1/round-2 findings were fixed with the reviewer's acceptance recorded in review.md, and round 3 had no open findings.

### Test changes that were not weakening

1. `protocol-client.test.ts` fixtures `dsh-auth-authority=...` → `dshCookieName(endpoint.host)`. **Required by design D1/D4**: the exchange now rejects a cookie whose name is not the deterministic name for the endpoint authority, so a generic prefix fixture could no longer exercise a successful exchange. The suite gained a dedicated negative case instead.
2. `connectivity.service.test.ts` `FakeRc2Client.probe` gained an `rc2.available` switch (default `true`). **Required for the new tests to be meaningful**: a probe that always succeeds classified every fixture as rc.2, so the typert path was never reached and the tests would have passed vacuously.
3. `connectivity.service.test.ts` `typertServiceFor` fake protocol mirrors the record's auth fields EXACTLY. A fabricated `expiresAt` made `onAuthAccepted` see a change and commit a new generation on every connect, silently invalidating generation assertions.
4. `connectivity.service.test.ts` `FakeRegistry` gained `mutateDevice`/`commitRecoveredAuth` mirroring the real compare-and-swap semantics (including the generation fence and the discovery-consent requirement).
5. `workbench.test.tsx` launches assert on the documented observable contract (launch counts, `data-workbench-phase`, request counts) rather than racing the DOM shim's compressed tokenized-URL window. The behavioural guarantees (one navigation per tuple, bounded cleanup, no loop, honest unobservable state) are all still asserted.

### Change Delivery

- Commit range (if committed): not committed
- OR delivery state (if not committed): **working tree only** — source, tests, and the rebuilt `cockpit-web` dist are in place, verified, and now ACTIVE in the running Cockpit (pid 7737). No commit was created; the user (or a follow-up step) commits.

### Activation status

Activated: `bin/cockpit restart` completed and the running server executes this change. All three devices reconnected to `READY` and passed black-box acceptance afterwards.

## Overall Decision

DECISION: PASS_WITH_WARNINGS

✅ PASS on implementation, TDD integrity, review integrity, all automated gates, and end-to-end black-box acceptance against the three real devices.
⚠️ One documented warning, outside this change's control: `dsh-cockpit-bridge` has a pre-existing unhandled rejection that makes the repository-level `pnpm test` exit non-zero (proven to predate this change; its own 24 tests pass).
