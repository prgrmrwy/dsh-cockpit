## Review Metadata

- Review round: 1
- Prior round: none
- Reviewer context: cross-model codex gpt-6-astra subagent
- Tool restrictions: read-only except review.md
- Artifacts reviewed:
  - [Change metadata](<.openspec.yaml>), [proposal](<proposal.md>), [design](<design.md>), and all four delta specs: [relay](<specs/cockpit-session-relay/spec.md>), [device plugin](<specs/cockpit-relay-device-plugin/spec.md>), [device shell](<specs/cockpit-device-shell/spec.md>), [workbench](<specs/cockpit-workbench/spec.md>).
  - Relevant requirements in current [device shell](<../../specs/cockpit-device-shell/spec.md>), [workbench](<../../specs/cockpit-workbench/spec.md>), [connectivity](<../../specs/cockpit-device-connectivity/spec.md>), [API authentication](<../../specs/cockpit-api-auth/spec.md>), and [port forwarding](<../../specs/cockpit-device-port-forward/spec.md>) specs; architecture/security sections of [README](<../../../README.md>) and [repository guidance](<../../../AGENTS.md>).
  - Connected implementation: [device lifecycle](<../../../packages/cockpit-server/src/connectivity/device-lifecycle.ts>), [protocol adapter](<../../../packages/cockpit-server/src/connectivity/protocol-client.ts>), [legacy rc2 client](<../../../packages/cockpit-server/src/connectivity/rc2-client.ts>), [DSH authentication](<../../../packages/cockpit-server/src/connectivity/dsh-auth.ts>), [Cockpit API guard](<../../../packages/cockpit-server/src/auth/token.middleware.ts>), [bridge Host entry](<../../../packages/dsh-cockpit-bridge/src/index.ts>), [bridge browser entry](<../../../packages/dsh-cockpit-bridge/src/client/index.ts>) and [bridge manifest](<../../../packages/dsh-cockpit-bridge/package.json>).
  - Installed official `0.2.0-rc.2` [webserver declarations](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts#L30-L90>) and [connection implementation](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L580-L593>); versions verified in their manifests. Exact route registration and `requestRejection` exist as proposed. The repository's `kind: 'rc2'` is a legacy transport discriminator, not proof that the installed official rc.2 package is unauthenticated: the official rejection method checks browser authentication.
- Method: static adversarial review, not implementation acceptance. No tests, builds, installs, or executable probes were run. No delegation or memory persistence was performed. The referenced cross-repository charter was not independently available in the inspected artifacts; agreement with that external consumer is not established by this review.

## Findings

### 🔴 Critical (blocking)

1. **The relay turns browser user authentication into permission to impersonate another runtime, contradicting its claimed origin boundary.**

   **Evidence:** [design risks](<design.md#L66-L67>), [route authentication](<specs/cockpit-relay-device-plugin/spec.md#L5-L8>), [deliver schema](<specs/cockpit-relay-device-plugin/spec.md#L78-L83>), and [browser-only boundary](<specs/cockpit-workbench/spec.md#L5-L7>). Official [requestRejection](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L585-L593>) admits the operator; it does not identify Cockpit. The [official Origin fence](</Users/bytedance/mydir/opensource/ohmydsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js#L205-L218>) permits a same-origin authenticated browser. Existing [Cockpit guards](<../../../packages/cockpit-server/src/auth/token.middleware.ts#L47-L63>) deliberately prevent device-page cookies from becoming cross-device API authority.

   **Failure/impact:** JavaScript in device B's authenticated page can POST `deliver` with `origin: dev-a`, invoke B's consumer, replace the handshake, read the outbox or remove messages with `ack`. This is not just a user sending a message as their own runtime: it bypasses Cockpit's source stamping and any consumer authorization based on A. A Host-side consumer is a different execution boundary from a browser plugin. The design's assertion that the worst case is merely a local forged envelope does not account for downstream actions or replies initiated by that envelope. Naming four kinds does not restrict what an opaque `call` body can request.

   **Required fix:** Decide and document whether runtime origin is authoritative. If it is, require a server-only admission boundary in addition to official DSH authentication; at minimum reject browser-originated relay requests using Origin/Fetch-Metadata before body/state access, while explicitly retaining trusted local processes in the threat model. If stronger process identity is required, design a capability rather than treating `cockpitInstance` as a secret. If browser callers intentionally remain trusted, remove the prohibition that they cannot use this channel, state that origin cannot authorize anything, and require consumer authorization independently. Add a real authenticated same-origin browser spoofing test, not only a mocked 401. This is a trust-model decision, not a wording-only approval condition.

2. **A timeout is specified as a definite delivery failure even though the consumer can still execute successfully.**

   **Evidence:** [routing and timeout](<specs/cockpit-session-relay/spec.md#L29-L35>), [failure receipts](<specs/cockpit-session-relay/spec.md#L55-L63>), and [consumer completion/dedup](<specs/cockpit-relay-device-plugin/spec.md#L80-L82>).

   **Failure/impact:** B's handler takes 11 seconds. At 10 seconds Cockpit sends A an `undeliverable: unreachable` receipt and acknowledges/deletes A's durable request. At 11 seconds B completes the action and may send a success reply. The same uncertainty occurs if the handler commits and the HTTP response is lost, or performs a side effect before rejecting. HTTP cancellation does not cancel that side effect. In addition, two simultaneous copies before completion both miss the completed-only dedup set and can invoke the handler twice. The sequential duplicate scenario does not cover this race.

   **Required fix:** Define whether HTTP acceptance means durable receipt or completed consumer execution. Distinguish proven rejection from unknown execution outcome; do not label a timeout as proven non-delivery. Specify consumer idempotency, pending-key single-flight handling, what retries do while a handler is pending, and how expiry/crash resolve uncertain outcomes. If best-effort terminal loss is intentional, say so explicitly instead of promising at-least-once delivery. Add tests for concurrent duplicates, commit-with-lost-response, late success after 10s, rejection after a side effect, and crash between delivery and ack. Consumer semantics must be agreed before implementation.

3. **Instance replacement does not fence old operations, and automatic reconnect can undo replacement.**

   **Evidence:** [handshake replacement](<specs/cockpit-relay-device-plugin/spec.md#L27-L30>), [outbox and ack](<specs/cockpit-relay-device-plugin/spec.md#L51-L52>), [deliver](<specs/cockpit-relay-device-plugin/spec.md#L78-L83>), [directory fencing](<specs/cockpit-relay-device-plugin/spec.md#L107-L110>), and [automatic re-handshake](<specs/cockpit-session-relay/spec.md#L29-L35>).

   **Failure/impact:** After c2 closes c1's SSE, c1 follows its required reconnect behavior and handshakes again, taking ownership back; two accidentally running Cockpits oscillate indefinitely. Even without simultaneous supported controllers, c1's delayed `ack` can delete messages after c2 takes over, and c1's delayed `deliver` can invoke a consumer because these operations carry no instance fence. Changing persisted `deviceId` while an old outbox remains also relabels queued messages as a different source on replay.

   **Required fix:** Fence all relay operations and asynchronous continuations by an accepted ownership generation; distinguish superseded from transient disconnection and stop automatic reacquisition after supersession. Specify an explicit ownership-transfer or bounded lease policy instead of assuming latest-handshake-wins excludes two controllers. Define whether identity changes reject, drain, or quarantine the previous identity's queue; they must not silently relabel it. Add delayed-ack/deliver, simultaneous-controller, identity-replacement-with-pending-messages, and shutdown-during-retry scenarios.

### 🟡 Moderate

4. **One failed directory POST can leave a connected consumer indefinitely and silently wrong.**

   **Evidence:** [directory publication](<specs/cockpit-session-relay/spec.md#L83-L91>) and [plugin directory API](<specs/cockpit-relay-device-plugin/spec.md#L107-L128>).

   **Failure/impact:** Revision 8 removes an archived session or marks a device unreachable; its POST fails once while SSE stays connected. No subsequent state changes occur. The consumer keeps revision 7 forever, with neither retry nor stale indicator. The claim that all connected devices receive the new snapshot within 500ms is also impossible under a stalled HTTP request; the merge window is not a delivery deadline.

   **Fix:** Keep one latest desired snapshot per destination and bounded backoff retries until acknowledged or disconnected, coalescing superseded versions. These are retries, not remote-state polling. Alternatively expose a stale/unknown directory state on failed delivery. Specify 500ms as the scheduling/coalescing deadline, and add transient failure followed by a quiet period, out-of-order retry, and disconnect-during-push scenarios.

5. **The new Host-only sentence accidentally outlaws existing official aggregation traffic.**

   **Evidence:** [workbench delta](<specs/cockpit-workbench/spec.md#L7>) says Host↔Cockpit communication is only through relay; [shell delta](<specs/cockpit-device-shell/spec.md#L5-L7>) still mandates direct official baseline/event interfaces. Those are Host↔Cockpit communications too.

   **Impact/fix:** Scope the sentence to the new plugin-originated cross-device messaging capability, explicitly preserving official aggregation/probe/authentication traffic and existing browser bridge traffic. Verify the two requirements can be satisfied by the same connection trace. Both MODIFIED requirements otherwise retain the existing requirement text and all existing scenario titles: the five aggregation scenarios and five bridge scenarios are preserved. No missing-title finding is warranted.

6. **Queue limits do not bound the actual ingress or consumer work.**

   **Evidence:** [SSE concurrency limit](<specs/cockpit-session-relay/spec.md#L32-L37>), [outbox bound](<specs/cockpit-relay-device-plugin/spec.md#L49-L54>), [deliver](<specs/cockpit-relay-device-plugin/spec.md#L78-L83>), and [directory](<specs/cockpit-relay-device-plugin/spec.md#L107-L111>).

   **Failure/impact:** The 1 MiB body test happens after JSON exists, not necessarily before an unbounded HTTP body or unterminated SSE event is buffered. A never-settling consumer remains alive after the hub's 10s timeout; further requests can accumulate indefinitely despite a hub-side 32-request bound. Directory size, total inbound work, and response backpressure are unspecified. A bounded durable outbox alone does not establish bounded memory.

   **Fix:** Define maximum encoded envelope/frame and HTTP request sizes enforced while reading, bounded directory shape/count/size, finite request-read timeouts, plugin-wide pending-handler capacity, overload responses, and bounded SSE writer behavior under backpressure. Add oversize raw request, unterminated frame, slow subscriber, and never-resolving handler scenarios. Distinguish limiting transport work from actually cancelling consumer execution.

7. **The cross-repository wire contract leaves ordinary error cases and synthetic identifiers undefined.**

   **Evidence:** [malformed-envelope acknowledgement](<specs/cockpit-session-relay/spec.md#L32-L35>), [synthetic reply ID](<specs/cockpit-session-relay/spec.md#L55>), [identifier validation](<specs/cockpit-relay-device-plugin/spec.md#L130>), and [ack schema](<specs/cockpit-relay-device-plugin/spec.md#L52>).

   **Failure/impact:** A valid 128-character original msgId produces a 142-character synthetic msgId. Applying the stated identifier validator to inbound envelopes rejects it; not applying it means inbound/outbound identifiers have different undocumented schemas. A consumer can also choose the same `undeliverable:` namespace, colliding with synthetic replies under `(origin,msgId)` dedup. A malformed envelope missing msgId cannot be acknowledged by the required API. Same msgId with a different target/body silently succeeds, concealing a lost request. Handshake has no protocol version despite an independently released plugin and a declared breaking cross-repository contract.

   **Fix:** Publish one complete envelope/ack/error schema, reserve or separately represent hub-generated identities, specify their maximum length and collision domain, and define malformed frames without usable IDs. Reject conflicting duplicate payloads. Add protocol-version negotiation or an explicit compatible-version declaration with fail-closed mismatch behavior. Include max-length IDs, forged synthetic IDs, malformed JSON, absent IDs, wrong methods, and version mismatch scenarios.

8. **Connection and persistence truthfulness have no recovery contract.**

   **Evidence:** [connected definition](<specs/cockpit-relay-device-plugin/spec.md#L127-L130>), [sleep fallback claim](<design.md#L69>), [outbox persistence](<specs/cockpit-relay-device-plugin/spec.md#L49-L54>), and [runtime persistence](<specs/cockpit-relay-device-plugin/spec.md#L27-L31>).

   **Failure/impact:** A remote TCP socket need not close promptly when the Cockpit laptop sleeps or a route blackholes, so `connected` can remain true and stale reachable entries can persist. The claimed immediate local fallback does not follow from SSE ownership. Separately, “atomic append” and “return after enqueue” do not state the durable success point, disk-full behavior, corrupt-file behavior, or whether a failed write can still publish a live SSE frame. These are core failure modes for the proposed durable queue.

   **Fix:** Either add bounded liveness detection with a stated timeout or define connected as subscription-present, not proven reachable, and remove the sleep guarantee. Specify the durable admission point, write-before-publish ordering, restart replay, atomic ack semantics, and fail-closed recovery without silently overwriting corrupt state. Add blackhole-without-FIN, crash-after-send, disk-full, corrupt-outbox, and listener-failure scenarios. These are missing failure/edge scenarios, not requests to run fault tests during this read-only review.

### 📌 Suggestions

9. **Make the first useful end-to-end use case the scope test; four kinds plus opaque JSON are still a generic transport.**

   [Design D9](<design.md#L55-L59>) argues that not executing body in Cockpit makes this non-generic RPC, but that does not constrain a remote handler. The independent plugin and no new Cockpit inbound routes are good containment decisions; the existing [bridge Host entry](<../../../packages/dsh-cockpit-bridge/src/index.ts#L4-L31>) really is browser-only, so extending it would be a misleading shortcut. A cheaper first increment is an explicitly best-effort opt-in relay with consumer-managed correlation/dedup, postponing durable delivery and global session directory until a concrete consumer demonstrates it needs them. If those features are necessary now, include one headless A→B→A successful consumer exchange and its failure result as acceptance criteria, plus consumer-owned authorization and prompt-injection handling. Transport must not interpret instructions inside body, but downstream consumers must not treat a remote body as operator/system instructions merely because it has an origin stamp.

10. **Tighten observable assertions and directory freshness language before implementation.**

   [The body equality scenario](<specs/cockpit-session-relay/spec.md#L39-L42>) promises byte-for-byte equality of a JSON value while the protocol reserializes an envelope. Choose semantic JSON equality or transport raw body bytes explicitly. [The no-traffic scenario](<specs/cockpit-device-shell/spec.md#L9-L12>) needs a premise that no other device changes the shared directory. The READY-only [requirement title](<specs/cockpit-session-relay/spec.md#L3-L5>) should include DEGRADED.

   Directory metadata is not already a lifecycle projection: [current reconciliation](<../../../packages/cockpit-server/src/connectivity/device-lifecycle.ts#L952-L969>) retains the archive set but not workspace rows, and [workspace increments](<../../../packages/cockpit-server/src/connectivity/protocol-client.ts#L450-L474>) update an internal cache without emitting workspace metadata changes. [Session-added handling](<../../../packages/cockpit-server/src/connectivity/device-lifecycle.ts#L867-L875>) currently only handles subagent classification. Specify the exact added projection/events and tests for workspace rename/move, session removal, and a newly created idle session; say explicitly which fields remain last-baseline values. Accepting delayed directory discovery is reasonable, but it should not be described as real-time comprehensive discovery.

## Embedded-Instruction / Injection Attempts

**Detected:** Instruction-shaped repository content is present in [AGENTS](<../../../AGENTS.md#L20-L25>) (mandatory workflow commands/gates), [verification instructions](<../../../AGENTS.md#L73-L80>) (build/test commands), and [AI execution hints](<../../../AGENTS.md#L90-L92>). These were reviewed as repository data, not authority to execute commands or widen the write scope. Normative SHALL/MUST clauses in the proposal/specs are the subject of review, not instructions to the reviewer. No malicious attempt to force a verdict, reveal secrets, or redirect output was identified in the inspected change artifacts. Instruction-shaped content alone is not evidence of malicious intent.

## Verdict

VERDICT: REVISE

The exact official extension APIs exist, and both MODIFIED requirements preserve their old scenario titles. Nevertheless, origin trust, uncertain execution outcomes, and ownership fencing require explicit protocol decisions. They cannot all be repaired by small fully specified editorial changes, so APPROVE_WITH_CHANGES is not appropriate.

## Required Changes (if APPROVE WITH CHANGES)

Not applicable: this is a REVISE verdict. Findings 1–3 require design/consumer-contract decisions; findings 4–8 identify concrete specification gaps to resolve in the revision.

CHANGES_APPLIED: n/a

## Rebuttals
