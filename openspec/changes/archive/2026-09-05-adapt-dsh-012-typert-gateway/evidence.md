# Compatibility evidence

Evidence gathered against the live local instances on 2026-09-05. Secrets are deliberately redacted; no provider credentials, DSH home files, or logs were read.

## Protocol fixtures

- rc.2 at `:3080`: `POST /api/host.describe` returned HTTP 200 with a valid `server-response`; `POST /api/session/list` returned 404. The built adapter selected `rc2`, listed 784 sessions, 7 workspaces, and 150 archived session ids.
- unauthenticated 0.1.2 at `:3081`: root returned HTTP 401 and the exact official authentication-required body; `POST /api/session/list` returned HTTP 401.
- authenticated 0.1.2: launch exchange returned HTTP 303, `Location: /`, and authority-bound `dsh-auth-<authority>=<redacted>; HttpOnly; SameSite=Strict`. Cookie-authenticated `session/list` returned HTTP 200 and `{items:[]}`; `/api/remote.mux` returned the `$events` ready item and `workspace/follow` baseline. The built adapter selected `typert` and completed both baselines.
- non-DSH 401 is distinguished from typert by requiring the exact official root challenge after the rc.2 identity probe fails; arbitrary 401 is `NON_DSH_SERVICE`. Covered by classifier implementation and unit tests.

## Authentication lifecycle

- Restarting the same 0.1.2 process generated a different launch token.
- The prior token then returned HTTP 401 with the official reopen guidance; the new token returned 303 and a signed cookie.
- Startup URL validation accepts only `http://127.0.0.1:<registered-port>/?token=<opaque>` with one token query parameter.

## Waterfall safety

Official gateway source at tag `dsh-v0.1.2-rc.1` shows one delivery per client: a `next` result removes only that client's delivery and the gateway settles to next only after all deliveries are gone. Therefore the Cockpit observer immediately replies `next`, never registers an approval/question decision listener, and never turns waterfall payloads into pending state. Duplicate waterfall and cancel ordering are covered by the idempotency test in `protocol-client.test.ts`.

## Pending side channel

Official `ctx.uiSession.pendingInteractions` is a subscribable HostObservable of a map whose values provide stable `sessionId`, `kind`, and `key`. The bridge fixture verifies initial approval/question items and resolution to an empty full snapshot. Only these identifiers cross the capability channel; interaction content is not read.

## Scope guard

The implementation adds no auto-discovery, polling, generic credential manager, token rotation, log/`~/.dsh` access, SSH discovery command, protocol framework, lifecycle redesign, alpha compatibility, or UI redesign.

## Live pending and dual-subscriber acceptance

- The adapted bridge was materialized in the isolated lumevm 0.1.2 profile. Before iframe activation, fork was READY with pending observability unavailable; after the official page loaded and bridge hello completed, it changed to available with an empty snapshot.
- A real `ask_user_question` produced `pendingInteractionCount: 1` and a question warning while the official UI displayed the card. After the user answered, the snapshot returned to zero.
- A real outside-workspace bash escalation under the Workspace Write preset produced `pendingInteractionCount: 1` and an approval warning while the official UI displayed the approval card. Cockpit made no decision; the user rejected it, and pending returned to zero.
- These live cards establish the dual-subscriber property: Cockpit's immediate `next` did not consume, answer, or delay the official UI delivery.
- The incompatible third-party `@tangzai/dsh-ui-archive-manager` was disabled only in the isolated acceptance manifest because its stale `dsh-client-runtime/client` import aborted the entire 0.1.2 client module loader. No plugin implementation was changed.
- A separate direct tunnel on another authority, with no Cockpit observer, loaded the official UI as the sole `$events` subscriber. A fresh real question appeared, accepted the user's answer, and resolved normally, matching the DSH default path.
- Live dual-instance comparison reported both rc.2 `host` and typert `fork` READY through their respective probes. Typert session creation/prompt drove running and completion transitions, and an official `workspace/archiveSession` mutation returned the created session in the archived set while the follow stream remained connected. Existing automated rc.2 lifecycle tests cover pending Host events, completion reminders, archive baselines, session add/remove, and bridge selection without protocol changes.
