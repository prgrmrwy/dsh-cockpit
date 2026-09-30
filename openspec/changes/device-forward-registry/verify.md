## Verification Results

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md: 175 of 177 are done.
- Remaining open tasks: both need a real browser and a person to drive it, so the agent cannot complete them.
  - **12.4**: run `node scripts/acceptance/forward-grace.mjs --device <id>` against a real browser session. This is a human decision recorded in the design: the 30s grace period must be measured in a real browser. The script decides pass/fail itself.
    - Precondition: the target device has a held (non-pinned) forward on 3939 with exactly one holder. A consumer in the device page must create it; the script cannot, because it has no browser page id.
  - **12.5**: manual browser check. It covers:
    - creating and deleting pinned entries in the device panel;
    - reloading the device page releases its holders;
    - the DSH settings section is read-only.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test. There are 59 scenario rows. The acceptance row is `N/A — non-executable`, and its script is task 12.4 (see Evidence).
- [x] Every test-plan.md row flipped to 🟢 green (59/59; no 🔴 row left).
- [x] Full suite passes.
- [x] Zero skipped/pending/commented-out tests. A grep for `it.skip|it.only|describe.skip|.todo(|xit(` over `packages/*/tests` and `tests/` finds nothing.
- [x] No test weakened or deleted without a REMOVED requirement. The deletions all follow the spec REMOVED requirement "端口发布须经设备侧登记…" and design D8, which removes the old seam in the same release:
  - the server group `publishable port registration and publishing`;
  - five bridge `cockpitBridge.portForward` tests.

  The behaviors that survive were carried over, not dropped:
  - The three group-1 ownership tests ("additional forwards survive workbench connection replacement") now drive `acquireForward`.
  - The `app-auth.e2e` bridge allow-list regression now targets `forwards/acquire|release`.
  - Capability renewal on 400/401 got an equivalent `forwards` test.
- Tests that were green when first written are annotated in tasks.md. Each was confirmed by a mutation that makes it fail: 2.13, 2.25, 3.19, 4.4, 4.7, 4.10, 6.7, 6.10, 6.22, plus the batch-written tests of groups 7 and 10.

### Evidence
- Final full-suite command: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`. It exited 0, run fresh at commit `fc88e40`.
- Result summary (0 failed, 0 skipped):

  | Suite | Files | Passed |
  |---|---|---|
  | root `node --test tests/*.test.mjs` | — | 12 |
  | shared | — | 8 |
  | server | 24 | 302 |
  | web | 10 | 92 |
  | bridge | 3 | 31 |

- `openspec validate device-forward-registry --strict` reports `Change 'device-forward-registry' is valid`.
- Non-executable checks run:
  - `node --test tests/forward-grace.test.mjs`: 4/4 pass. It pins the acceptance script's judgments: precondition, pid stability, the 30–40s reclaim window, argument parsing.
  - `node scripts/acceptance/forward-grace.mjs` with no `--device` exits 1. With a missing token file it also exits 1.
  - The real-browser run itself is task 12.4 and is still open.
- 11.5 stale-reference grep: `grep -rn "publish-port\|publishable-port\|已登记端口" README.md BACKLOG.md packages/*/src` finds nothing (exit 1).
- 11.4 bundle: `pnpm --filter dsh-cockpit-bridge build` produces `lib/client.js`, with `react` external and supplied by the DSH profile.

### Review Integrity
- [x] review.md has `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes`.
- [x] The verdict is not stale. `git log 80589ad..HEAD` shows no commits touching `proposal.md`, `design.md`, `specs/` or `review.md` during implementation.
  - Implementation-time notes live in tasks.md only. One example: the snapshot keeps the system row without pid, so the D9 settings section can show the workbench channel as its spec scenario requires.
- [x] All findings fixed or rebutted. 🟡-1 through 🟡-8 are fixed and accepted by the reviewer. 📌-9, 📌-10 and 📌-11 were deferred by the author as non-blocking; 📌-9 was addressed in code anyway:
  - `release-instance` validates `pageId` → 400 `invalid-page`;
  - it starts the page grace timer, so an ended-instance set cannot stay resident forever.

### Change Delivery
- Commit range on branch `ws/dsh-cockpit-openspec-change-device-forward-regis`: `42e2f31..fc88e40`, 14 implementation commits on top of base `80589ad`, plus this verify commit.
- The branch has not been merged or archived. That needs the owner's approval, together with the outcome of 12.4 and 12.5.
- Dependency change (made after `ws promote`): `dsh-cockpit-bridge` gains a `react` peer (`^18.2.0`) and a dev dependency (`~18.3.1`), plus `@types/react`. The lockfile diff is only the two importer lines, because the versions were already locked by `cockpit-web`.

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ PASS WITH WARNINGS:
1. Tasks 12.4 (real-browser 30s grace acceptance) and 12.5 (manual browser check) are still open. They are human-run and must pass before archive.
2. Release coupling. The cockpit and bridge 0.6.0 must ship and roll back together. Downstream `cockpitBridge.portForward` consumers, such as the ohmydsh memex shim, fall back to local addresses until they migrate. Rolling back drops pinned marks on the old version's next registry write. All of this is documented in the bridge README's "0.6.0 发布说明" (release notes).
