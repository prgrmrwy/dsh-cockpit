## Review Metadata

- Round: 2.
- Prior review: round 1 REVISE — origin trust, timeout-as-failure, instance fencing; [round-1 report](<openspec/changes/cross-device-session-relay/review-round1.md>).
- Reviewer: cross-model codex gpt-6-astra subagent.
- Method: adversarial static review; repository and package reads only. No builds, installs, tests, remote mutations, or implementation changes. The only written artifact is this report. External cross-repository charter agreement was not independently verified.
- Artifacts reviewed: [proposal](<openspec/changes/cross-device-session-relay/proposal.md>), [design](<openspec/changes/cross-device-session-relay/design.md>), all four deltas ([device plugin](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md>), [session relay](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md>), [device shell](<openspec/changes/cross-device-session-relay/specs/cockpit-device-shell/spec.md>), [workbench](<openspec/changes/cross-device-session-relay/specs/cockpit-workbench/spec.md>)), [repository invariants](<AGENTS.md>), [README](<README.md>), current [shell](<openspec/specs/cockpit-device-shell/spec.md>), [workbench](<openspec/specs/cockpit-workbench/spec.md>), [API authentication](<openspec/specs/cockpit-api-auth/spec.md>) and [connectivity](<openspec/specs/cockpit-device-connectivity/spec.md>) specifications; connected [lifecycle](<packages/cockpit-server/src/connectivity/device-lifecycle.ts>), [protocol adapter](<packages/cockpit-server/src/connectivity/protocol-client.ts>), [rc2 client](<packages/cockpit-server/src/connectivity/rc2-client.ts>) and [authentication](<packages/cockpit-server/src/connectivity/dsh-auth.ts>) code.
- Official installed package evidence: both [webserver manifest](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-host-webserver/package.json#L4>) and [connection manifest](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-client-connection/package.json#L4>) report `0.2.0-rc.2`. [Named-route dispatch](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js#L228-L244>) directly invokes handlers; the [route API](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts#L30-L90>) supports an owned SSE response. [Official rejection](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L585-L593>) applies the [Host/Origin fence](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L205-L218>) and browser authentication; it does not identify Cockpit. Package version alone does not establish the legacy rc2 endpoint's authentication mode.

## Findings

### 🔴 Critical (blocking)

1. **Ownership replacement still has two holes: in-flight body reads and an unclassified SSE close.**

   [Request guards](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md#L7-L13>) check the lease before reading the body. [Replacement](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md#L40-L57>) invalidates the lease and ends SSE, but only tests requests arriving afterward. Trace: an L1 `ack`, `directory`, or `deliver` passes the guard, pauses during body read, L2 replaces L1, then the old body completes. Without a second generation check at the mutation/admission boundary, it can delete the new owner's queue, install an old directory into the freshly cleared state, or invoke a consumer after supersession. The round-1 request to fence asynchronous continuations remains unfulfilled.

   Separately, the [Cockpit state machine](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L10-L27>) stops reacquisition only after receiving HTTP 409. Ending an already-open SSE cannot change its HTTP 200 to 409. With an otherwise quiet device, the displaced Cockpit may have no next request to receive that status. Treating EOF like the specified [stream failure](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L36>) and handshaking again recreates the takeover loop; treating EOF as inert leaves stale connected state. The spec supplies neither a terminal supersession event nor a same-lease recovery step.

   **Local fix:** capture the ownership generation; revalidate immediately before every state mutation/consumer admission, with no intervening await. Fence Cockpit asynchronous completions against device connection generation and shutdown. On any unexpected stream termination, attempt an outbox subscription with the existing lease before acquiring a new one; 409 must stop reacquisition. Specify how a restarted plugin with no lease is distinguished from supersession, or require lifecycle refresh in that case. Add slow-body replacement and quiet-stream replacement scenarios. Already-started consumers cannot be retroactively cancelled: narrow the [claim that leases prevent interleaved execution](<openspec/changes/cross-device-session-relay/design.md#L81>) to new admissions, explicitly allowing old admitted work to settle.

### 🟡 Moderate

2. **The boundedness repair still leaves unbounded frame assembly and indefinitely pending control requests.**

   [Design limits](<openspec/changes/cross-device-session-relay/design.md#L63>) and the [plugin guards](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md#L13>) bound inbound plugin bodies, queues and handler work. However, [Cockpit SSE processing](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L36-L44>) has no encoded-frame/line bound before JSON parsing. A stream can send an unterminated `data:` line continuously; the any-byte liveness timer never fires and the 32-delivery cap does not apply before parsing. The 8 MiB plugin writer bound is not a receiver parser bound.

   Only `deliver` has an explicit response timeout. Handshake, ack and directory requests can hang awaiting headers/body; retry backoff does not help a request that never settles. Thus a single directory attempt can still prevent recovery promised by its retry rule.

   **Fix:** define a finite encoded SSE event/line budget enforced while reading, bounded response bodies, and finite end-to-end deadlines for handshake/ack/directory as well as delivery; abort outstanding requests on disposal/generation change. Add unterminated-frame, hanging-control-response and shutdown-during-request scenarios. No durable queue or consumer cancellation is required.

3. **Complete-directory publication conflicts with hard receiver limits, with no overflow behavior.**

   [Directory generation](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L120-L125>) includes every device ever successfully handshaken and all known unarchived roots. [Receiver validation](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md#L143-L161>) rejects more than 64 runtimes or 2000 sessions per runtime; the HTTP guard rejects more than 4 MiB. Neither sender admission nor directory generation guarantees those bounds. Even fewer than 64 devices can exceed the byte limit through ordinary workspace paths/titles. A 65th device visited over the process lifetime can make every future snapshot invalid, producing endless retries while all consumers retain stale data.

   **Fix:** state one deterministic overflow policy on the sender and its consumer-visible meaning. For example, a bounded partial snapshot must explicitly signal incompleteness and define stable selection; alternatively reject relay admission above documented capacity and define session/byte overflow separately. Do not silently truncate while claiming completeness. Test each count limit, total serialized bytes, and eventual recovery after the source shrinks. Keep the existing no-polling boundary.

4. **At-most-once and acceptance claims exceed the specified best-effort algorithm.**

   [Cockpit wording](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L36-L42>) guarantees process-lifetime at-most-once, but retains dedupe for only ten minutes. A sender can reuse an acknowledged ID after ten minutes in that same process. [Target admission](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md#L104-L109>) similarly promises no further invocation while expiring its dedupe set. It also says `accepted` means the handler *has been called*, although the prescribed order responds before asynchronous invocation; a Host crash in that interval loses the invocation.

   **Fix:** describe acceptance as in-memory admission/scheduling, not proven invocation or success. Scope dedupe promises to the ten-minute window and surviving process. Explicitly assign longer-term idempotency to consumers, and qualify the replay/failure scenarios accordingly. Add expiry/reuse and crash-after-acceptance scenarios. Do not restore durability to repair wording.

5. **The boundary contradiction is fixed in the workbench delta but remains in the proposal and shell delta.**

   [Workbench clarification](<openspec/changes/cross-device-session-relay/specs/cockpit-workbench/spec.md#L7>) correctly preserves official probes/authentication/aggregation. But [proposal line 12](<openspec/changes/cross-device-session-relay/proposal.md#L12>) still says Host↔Cockpit communication can only use the relay. [Shell line 7](<openspec/changes/cross-device-session-relay/specs/cockpit-device-shell/spec.md#L7>) says all requests to DSH have only the relay exception beyond the enumerated aggregation interfaces. Read literally, this excludes existing authentication exchanges, protocol negotiation and other official connectivity traffic. Actual [adapter setup](<packages/cockpit-server/src/connectivity/protocol-client.ts#L126-L187>) requires those calls.

   **Fix:** scope the shell restriction to additional aggregation/plugin-messaging traffic, preserving existing connectivity/probe/auth paths explicitly. Replace the proposal's Host-wide exclusivity sentence with the narrower plugin-originated cross-device-messaging statement already used by the workbench delta. Preserve the ban on proxying remote operation APIs.

6. **Several acceptance scenarios assert outcomes not implied by their premises.**

   - [Timeout scenario](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L103-L106>): no response to the delivery request does not imply no legitimate reply from B. Assert no *Cockpit-generated* `relay: true` undeliverable, and allow B's late reply.
   - [Retry scenario](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L147-L150>): passage of five seconds cannot guarantee the server returns 200. Add a recovered/responsive endpoint premise and a deterministic backoff/jitter test clock.
   - [Unchanged snapshot scenario](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L152-L155>): equal session/archive membership is insufficient; workspace metadata, updatedAt and label also affect the snapshot. Require equality of every projected field and no pending failed push. Clarify that manual refresh does not force re-handshake of an already-connected relay in this scenario.
   - [No-persistence scenario](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L165-L168>): identical filenames allow overwriting an existing registry file. Assert no relay-state persistence with write instrumentation or relevant content checks, while allowing unrelated legitimate registry writes.
   - [No-polling scenario](<openspec/changes/cross-device-session-relay/specs/cockpit-device-shell/spec.md#L9-L12>): include successful setup/pushes, no manual refresh, and no transport failure; otherwise permitted retries contradict the exact request count. Retain the distinction between retry and polling.

### 📌 Suggestions

7. **Keep the reduced scope; add one executable cross-repository contract fixture before implementation acceptance.**

   The opt-in, memory-only, consumer-idempotent model is a justified simplification, not missing durability. A headless A→B→A exchange with one late/failed reply would test the seam better than adding UI or generic RPC features. Pin `contractVersion: 1`, protocol 1, reserved receipt IDs, JSON equality and consumer authorization in that fixture. [Consumer data handling](<openspec/changes/cross-device-session-relay/specs/cockpit-relay-device-plugin/spec.md#L173>) correctly rejects treating body as privileged instructions. The [absolute anti-forgery wording](<openspec/changes/cross-device-session-relay/specs/cockpit-session-relay/spec.md#L80>) should say “via an outbox” because trusted authenticated operator processes are deliberately allowed to call `deliver` directly.

### Round 1 findings status

The numbers below refer to the [prior report](<openspec/changes/cross-device-session-relay/review-round1.md>), not this round's finding numbers.

| Round-1 finding | Status | Round-2 assessment |
|---|---|---|
| 1. Browser authentication permits forged origin | **Resolved** | Browser-marker rejection plus mandatory custom header precede official authentication and state access. Trusted operator processes are explicitly in scope; there is no false Cockpit-identity claim in the threat model. |
| 2. Timeout falsely means failure; concurrent duplicate execution | **Resolved** | Unknown outcomes no longer produce undeliverable; the target inserts dedupe before scheduling. Remaining acceptance wording is round-2 finding 4, not restoration of the original timeout-as-failure bug. |
| 3. Instance replacement and automatic reacquisition | **Partially resolved** | Leases, identity-change queue clearing and 409 suppression added. In-flight and SSE-close gaps remain: finding 1. |
| 4. Failed directory push never recovers | **Partially resolved** | Latest-snapshot retries and scheduling deadline added; hanging requests and permanently invalid snapshots still defeat recovery: findings 2–3. |
| 5. Host-only sentence outlaws aggregation | **Partially resolved** | Workbench repaired, proposal/shell still overbroad: finding 5. |
| 6. Ingress and consumer work unbounded | **Partially resolved** | Raw plugin request limits, handler cap and writer backpressure added; Cockpit parser/control-request gaps remain: finding 2. |
| 7. Undefined IDs/errors/wire contract | **Partially resolved** | Version negotiation, reserved colon, 96-character send IDs, malformed-ID handling, ack shape and conflicting-send rejection are defined. Wrong-method behavior remains implicit despite pathname-based official dispatch; add explicit 405/no mutation for all five routes. |
| 8. Connection and persistence truthfulness | **Resolved** | Subscription presence is explicitly not reachability; sleep guarantees removed; queues are intentionally volatile. Disk-full/corruption tests are no longer applicable. |
| 9. First useful use case and opaque-body security | **Partially resolved** | Best-effort scope and peer-data instruction boundary adopted; consumer authorization remains appropriately consumer-owned. Headless acceptance exchange remains a suggestion, not a blocker. |
| 10. Observable assertions and metadata projection | **Partially resolved** | JSON semantic equality, DEGRADED, all-device quiescence, explicit lifecycle projection and last-baseline metadata are repaired. Remaining assertion defects: finding 6. |

### Requirement-by-requirement scenario coverage

Every delta requirement was checked against a successful trace and a failure/edge trace:

| Requirement | Happy path / edge assessment |
|---|---|
| Plugin optional Host routes and admission | Authenticated non-browser handshake / same-origin browser, unauthenticated and oversized requests covered. Add wrong-method 405 and read-timeout scenarios. |
| Handshake/version/ownership | New lease and mismatch / identity clearing covered; delayed-body and quiet SSE replacement missing (1). |
| Memory outbox/replay/ack | Ordered replay and live enqueue / expiry, slow writer and capacity covered. Clarify expiry at buffered-send time and expired-entry pruning before capacity checks. |
| Target single-flight receive | First acceptance and concurrent duplicate / no consumer, busy, throw and wrong target covered; admission/expiry wording needs (4). |
| Plugin directory revision | New revision and notification / stale revision and count overflow covered; whole-snapshot sender policy missing (3). |
| In-process service | Version, send idempotence and receive registration / absent lease, invalid IDs, oversize body and second consumer covered. Add disposer/listener-throw checks; service send may queue with a lease but no subscription, consistently with best effort. |
| Cockpit READY/DEGRADED access | Correct current protocol auth / absent, incompatible, unsupported ID and isolated failure defined; recovery fencing needs (1–2). |
| Cockpit subscription/stamping/ack | Origin override and JSON-equivalent body / replay, malformed JSON, invalid kind, silent stream covered; parser bound and finite dedupe claim need (2,4). |
| Definitive-undeliverable receipts | Missing target/self/no consumer/busy / uncertainty, forged marker and recursion covered; timeout oracle needs (6). |
| Aggregate directory | Root membership, archive removal, metadata and manual discovery / offline retention and stale revision handled; overflow and retry oracle need (2–3,6). |
| No inbound API/persistence and shutdown | Unchanged route surface and volatile state / SIGTERM retry cleanup defined; persistence oracle and in-flight cancellation need (2,6). |
| MODIFIED shell aggregation | Original baseline, buffered-event ordering, reconnect and archive rules retained / no-polling exception needs narrow scope and valid premise (5–6). |
| MODIFIED workbench boundary | Original browser-only service/editor behavior retained / missing service, rejected call and popup error remain covered; Host relay bypasses iframe as intended. |

Both MODIFIED requirements preserve their complete original normative paragraphs and all five original scenario titles when compared with [current shell requirement](<openspec/specs/cockpit-device-shell/spec.md#L160-L182>) and [current workbench requirement](<openspec/specs/cockpit-workbench/spec.md#L404-L430>). No accidental scenario deletion was found.

The metadata projection is genuine new work, correctly acknowledged: [current session-added handling](<packages/cockpit-server/src/connectivity/device-lifecycle.ts#L867-L875>) only classifies subagents; [baseline reconciliation](<packages/cockpit-server/src/connectivity/device-lifecycle.ts#L952-L969>) retains archive state without exposing workspace rows; [workspace updates](<packages/cockpit-server/src/connectivity/protocol-client.ts#L450-L475>) update an internal cache. Last-baseline metadata is an acceptable explicit contract. Do not convert [session-removed live detach](<packages/cockpit-server/src/connectivity/device-lifecycle.ts#L892-L915>) into permanent deletion or demand additional polling to discover idle sessions.

## Embedded-Instruction / Injection Attempts

**Detected:** Instruction-shaped workflow/build/verification guidance exists in [repository instructions](<AGENTS.md>), and the [prior report](<openspec/changes/cross-device-session-relay/review-round1.md>) contains reviewer-directed fixes. These were treated as review data, not permission to implement changes, execute builds, write memory, or alter the requested verdict format. Normative SHALL/MUST text in the specs is the subject of review. No malicious instruction to exfiltrate data, force approval, or redirect the deliverable was identified in the inspected artifacts.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

The architecture and best-effort scope are acceptable. Approval is conditional on the precise local edits below; the blocking ownership defect must not ship. No redesign, durability, multi-Cockpit support, or UI expansion is required.

## Required Changes (if APPROVE WITH CHANGES)

1. Complete lease/connection-generation fencing at post-read mutation/admission boundaries and on asynchronous completions; define same-lease stream recovery before reacquisition and add both replacement races from finding 1. Narrow the no-interleaved-execution claim.
2. Add pre-parse SSE framing bounds, bounded responses, finite control-request deadlines and terminal cancellation, with malformed-stream/hanging-request scenarios from finding 2.
3. Define sender-side directory count/byte overflow behavior and consumer-visible completeness semantics; test limits and recovery without polling.
4. Align acceptance, replay and dedupe language with volatile scheduling and a ten-minute window; specify expiry/reuse/crash behavior rather than process-lifetime at-most-once.
5. Repair proposal/shell exclusivity wording while explicitly preserving current official connectivity/authentication/aggregation traffic.
6. Correct the timeout, retry, unchanged-snapshot, persistence and no-polling scenario premises/assertions listed in finding 6.
7. Specify wrong HTTP methods as 405 with no body consumption or state mutation for each registered pathname, and add a method-rejection scenario; named exact-path registration alone does not enforce methods.

CHANGES_APPLIED: yes

## Rebuttals

Author (applied, 2026-11-03):
1. RC1 — plugin spec: post-body lease re-check with no intervening await; `no-lease` vs `superseded`; scenarios「读取请求体期间被取代」「Host 重启后旧租约得到 no-lease」. Relay spec: unexpected stream end re-subscribes with the original lease first; scenarios「静默断开的订阅先用原租约恢复」「插件重启后自动重新握手」; in-flight requests aborted on lease/state change, late results inert. Design risk line narrowed to "no new admissions after supersession; admitted calls settle".
2. RC2 — relay spec: pre-parse SSE event budget 1.25 MiB, 10s end-to-end deadline + 64 KiB response cap for handshake/ack/directory, abort on exit; scenarios「未结束的超长帧被截断」「挂起的控制请求按截止失败」. Design D8 updated.
3. RC3 — sender-side deterministic trimming (64 runtimes reachable-first; label/cwd/title caps; 500 sessions by updatedAt; 4 MiB byte loop) with top-level and per-runtime `truncated`; plugin schema accepts `truncated`; scenarios「超出规模时确定地裁剪并标记」「超过 64 台设备时保留可达者」.
4. RC4 — `accepted` = in-memory admission/scheduling; dedupe scoped to 10-minute window and same process; scenarios「去重窗口过期后可再次受理」「插件重载后已受理集合清空」「去重窗口过后同一 msgId 被重新投递」.
5. RC5 — proposal and shell delta now preserve existing probe/auth/aggregation traffic and keep the no-proxy ban.
6. RC6 — timeout (no `relay:true` receipt, late B reply allowed), retry (test clock, recovered endpoint), unchanged snapshot (all projected fields, no pending push, no re-handshake), persistence (write instrumentation), no-polling (successful setup, no refresh, no failures) corrected.
7. RC7 — step 0: wrong method → 405 `method-not-allowed`, no body read; scenario「错误方法被拒」.
Suggestion 7: anti-forgery wording now says "经 outbox"; headless A→B→A fixture will go into test-plan.

Reviewer re-check (round 2): outstanding — items 1, 2, 3, 4, 6.
- 1: The post-body lease check, quiet-stream recovery and narrowed admission claim are present, but connection-generation fencing is not explicit. Add: “Capture the device connection generation for every relay request/subscription and asynchronous continuation; on generation change abort old work, and before applying any completion, forwarding, acknowledgement or receipt, require the captured generation to equal the current generation and the relay not to be disposed.” This must also cover a pending handshake before any lease exists and a connection refresh that remains READY/DEGRADED.
- 2: Control-request limits and pre-parse framing limits are present, but `deliver` still has only a response-read timeout and no response-size bound. Specify a finite end-to-end deadline (including connection, headers and body) and bounded response body for delivery/receipt requests too. Add a shutdown-during-request scenario: SIGTERM while a control request is pending aborts it, and its late response causes no state change, retry, acknowledgement or receipt.
- 3: Count trimming is specified, but the scenarios never exercise the serialized-byte overflow branch or its recovery. Add a fixture whose post-count/metadata-capping snapshot exceeds 4 MiB, assert deterministic session removal to at most 4 MiB and the affected runtime completeness flags, then shrink the source through an existing event/baseline and assert restoration without polling. Also specify that label truncation or cwd/workspaceTitle omission sets the affected runtime's `truncated` flag; currently step 2 drops metadata without marking it and “未裁剪时各 truncated 为 false” does not define which flag records that loss.
- 4: Volatile acceptance and expiry are now defined, but the replay scenario (session-relay lines 70–73) and handler-failure scenario (device-plugin lines 138–141) still promise deduplication without a surviving-process/within-ten-minutes premise. Add those premises. Add the requested crash-after-acceptance scenario: accepted is returned, Host exits before handler invocation, the invocation is lost and no success/invocation is inferred from accepted.
- 6: The timeout, retry and unchanged-snapshot corrections are present. The no-polling scenario starts observation after setup yet counts setup requests; start the observation at connection/setup and continue for ten quiet minutes after successful setup. The persistence scenario still forbids all newly created files rather than only relay persistence; replace that assertion with “no relay state is persisted in new or existing files; unrelated legitimate registry writes are allowed,” retaining write instrumentation.

Author (re-check outstanding items applied): 1 connection-generation fencing paragraph + scenarios「旧代际的迟到握手结果不生效」「退出时在途控制请求被中止」; 2 deliver/receipt end-to-end 10s deadline and 64 KiB response cap; 3 metadata loss sets runtime `truncated`, flag definitions, byte-overflow + recovery scenario, metadata-omission scenario; 4 same-process/10-minute premises on both replay scenarios, crash-after-acceptance scenario; 6 no-polling observation window starts at READY, persistence assertion limited to relay state.

Reviewer re-check 2 (round 2): outstanding — item 4.
- 4: The surviving-process/ten-minute premises are present, and the normative acceptance paragraph describes Host exit correctly. However, the scenario titled “受理后 Host 在调用前退出则调用丢失” actually specifies plugin unloading, not Host exit, in its WHEN (device-plugin spec lines 153–156). Replace that premise with: “After m5 returns accepted, the Host exits/crashes before the handler is invoked”; assert that the scheduled invocation is lost and accepted implies neither invocation nor success. A plugin-unload scenario does not exercise the requested crash-after-acceptance case. Items 1, 2, 3 and 6 are verified; previously accepted items 5 and 7 remain accepted.

Author: item 4 — crash scenario now kills the Host process (SIGKILL of a child-process Host) after `accepted` and before invocation; asserts lost invocation, no success output, empty admitted set after restart.

Reviewer re-check 3 (round 2): item 4 verified; all 7 required changes applied.
