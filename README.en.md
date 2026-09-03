# dsh-cockpit

[简体中文](README.md) · **English**

> Manage DeepSeek Harness across every machine from one page — pick a device
> and use its **native** DSH workbench directly.

[![CI](https://github.com/prgrmrwy/dsh-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/prgrmrwy/dsh-cockpit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-3c873a.svg)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10.23-f69220.svg)](pnpm-workspace.yaml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A multi-device cockpit for DeepSeek Harness: manage DSH running on several
machines from a single page, and once you select a device, work in **that
machine's own DSH workbench**.

## What it is

```
┌────────────────────────────────────────────┐
│ ● local  ● VM  ○ devbox            [☰]    │  ← the only persistent cockpit UI
├────────────────────────────────────────────┤
│                                            │
│     the selected device's full native DSH  │  ← everything else belongs to it
│                                            │
└────────────────────────────────────────────┘
```

**The core trade-off:** the cockpit **does not take over** any
workspace/session API. Selecting a device embeds that machine's native DSH web,
so its settings, usage, installed plugins and any future capability are
**inherited for free** — nothing has to be adapted one by one.

The cockpit does exactly two things:

1. **Device management and connectivity** — register devices, own the SSH
   loopback tunnels, probe health, reconnect, and report classified diagnostics.
2. **Read-only status aggregation** — continuously consume each device's
   **official** event streams and aggregate "how many are running / is anything
   waiting on a human", so you can sense state without entering a device.

## Remote requirements

**A standard `dsh web` is enough — zero modification.** The optional
[bridge plugin](#bridge-plugin-optional-talking-to-dsh) is a device-side
companion; skipping it costs you no core capability.

The cockpit only uses official rc.2 interfaces: `host.describe`,
`session.list`, `/api/events.mux` and `/api/events.host`. Every status signal it
needs (`host/session-status`, `approval/requested`, `question/requested` and
their `*/resolved` counterparts) is already covered by the official streams.

There are only two prerequisites:

- **Passwordless SSH** from this machine to the device (public key or agent,
  reusing your `~/.ssh/config` aliases)
- `dsh web` running on that device

## Design principles

- **Zero protocol coupling on the operating surface** — no proxying of remote
  APIs, no identity rewriting, no interception of events.
- **Read-only on the coordination surface** — only official read-only
  interfaces are consumed; Settings/Subscriptions/Credentials are never
  proxied, and provider tokens are never read or synced. This is an
  architectural principle, not a version limitation.
- **Two independent channels** — status aggregation goes through a direct
  cockpit connection, the workbench goes through an iframe. A failure on one
  side does not affect the other.
- **Local and remote are symmetric** — the local DSH is just another device (no
  tunnel needed); everything else is handled identically.
- **Never fake real time** — when a device goes offline the last known state is
  kept, but the offline marker and last-update time are shown explicitly. The
  specific reason the connectivity layer knows about (SSH unreachable / tunnel
  failure / DSH not running / non-DSH service / incompatible version) is
  surfaced directly, because the remote page cannot say it itself.

## Completion reminders: generations, acknowledgement, and manual fallback

The green "completed" reminder on a Device Tab is maintained server-side per
**root-session generation**: a session idle at first observation gets no
reminder; one `running → idle` edge arms a reminder for that generation;
re-running starts a fresh generation and disarms the previous one. "The user
already saw this generation's result" can arrive from two independent
sources — the bridge plugin's reported session-open fact, or a manual clear on
the Device Tab — in either order relative to the completion edge itself; the
server converges these so that a generation acknowledged at or after
completion never shows as unread, while that acknowledgement never suppresses
the *next* genuinely new completion on the same session.

- **The manual fallback is always available**: the "completed" status icon on
  the Device Tab is itself an independent, accessible clear control (keyboard
  reachable, does not bubble into switching devices). Activating it clears all
  of that device's current completion reminders — regardless of whether the
  bridge plugin is installed or currently on the reliable protocol.
- **Archiving is an explicit disposition**: archiving a session clears its
  current completion reminder; restoring an idle archived session does not
  manufacture a new reminder out of thin air (unless it genuinely runs and
  goes idle again afterward). Only *permanent* deletion (not archiving) clears
  a session's running, selection, acknowledgement and reminder state entirely.
  On older DSH versions that do not emit an archive event, the cockpit never
  infers deletion merely because a session is momentarily missing from one
  `session.list` refresh.

## Bridge plugin (optional): talking to DSH

Core cockpit functionality **does not depend** on any plugin (see
[Remote requirements](#remote-requirements)). `packages/dsh-cockpit-bridge` is
an **optional** plugin for the official DSH web client. It runs inside **the
device's own dsh web page** (a same-origin cordis bundle) and losslessly
bridges one purely browser-local signal — "which session did the user open" —
back to the cockpit, for precise per-session acknowledgement of completion
reminders.

### Why it exists

Opening a session from the official sidebar (the `current` field of the
`sessions.list` store, i.e. `SessionManager.select`) is **pure in-browser
state**; there is no "selected" signal on the event stream. The cockpit does
not read iframe DOM by architectural principle, so it cannot observe it either.
With the plugin installed:

- The cockpit top bar shows a chain icon: a closed chain means the bridge was
  detected and has recently communicated successfully, a broken chain means no
  plugin was detected or the bridge connection has gone stale — so you can
  confirm at a glance whether precise clearing is currently available.
- Green "completed" reminders clear with **official select semantics**: opening
  a session clears exactly that session's dot — and this now survives **rapid
  consecutive selections, archiving immediately after opening, and transient
  network failures** without losing the acknowledgement. Without the plugin,
  an outdated plugin, or while the bridge is unreachable, the workbench and
  status aggregation remain fully correct; the Device Tab's manual clear stays
  available as the fallback.

### The reliable acknowledgement protocol (v2)

| Signal | Plugin side (inside the device's DSH page) | Cockpit side |
| --- | --- | --- |
| **Parent handshake** | On iframe `load`, device activation, or a capability refresh, the parent `postMessage`s `{ type: 'dsh-cockpit:bridge-config', cockpitOrigin, capability }` to the iframe using a precise `targetOrigin` | The parent first authenticates via its own same-origin cookie session and calls `POST /api/devices/:id/bridge/capability` to obtain a one-shot, short-TTL capability bound to that device's Origin |
| **Startup hello** | On receiving the handshake, `POST <cockpitOrigin>/api/bridge/hello {version, protocolVersion, current}` with an `X-DSH-Cockpit-Bridge-Capability` header | Validates the capability → matches the device by `Origin` → records protocol version and last-success time → drives the top bar bridge icon |
| **Session selection** | Subscribes to `sessions.list.current`; on change, the id is **captured immediately** into a bounded, deduplicated outbox (not re-read later when a timer fires); a 250 ms window only batches the network flush, then each entry is `POST`ed to `.../session-opened {sessionId, current, protocolVersion}`; an entry is removed from the outbox only after an explicit success response | Validates the capability → matches by `Origin` → acknowledges that session's current generation, converging with the completion edge in whichever order they arrive |
| **Cleared after archive** | When `current` becomes `undefined`, the plugin reports `{ current: null }` and resets its same-value dedup latch, so restoring the same id later can be acknowledged again | Handled per-session without touching other sessions' state |
| **Failure retry** | Network errors, 401s, and any other non-2xx response all keep the pending acknowledgement; retries are single-flight with a bounded exponential backoff; a new selection, device activation, or a successful hello are all recovery opportunities | Silent failure never disturbs the native DSH page |

- **The port is no longer hardcoded**: the plugin does not fetch a fixed
  `127.0.0.1:3090` anymore — the real Cockpit origin is supplied dynamically by
  the parent handshake, so the cockpit can run on **any supported
  `COCKPIT_PORT`** and the bridge still works.
- **Authentication does not depend on a cross-port cookie**: the persistent
  `SameSite=Strict` HttpOnly token is never exposed to the plugin. The parent
  page exchanges its own session for a short-lived, single-purpose capability
  bound to one device's Origin, and passes it to bridge calls via a request
  header for the cockpit to validate.
- **Only the session identity and protocol metadata cross the bridge**: no
  conversation content, settings, credentials, or provider tokens are read or
  forwarded.
- **Silent failure**: when the cockpit is unreachable, the pending
  acknowledgement queue is retained and retried with backoff, and the DSH page
  is never disturbed; the outbox has a fixed capacity and TTL, preferring the
  current and most recent selections, so a long cockpit outage cannot grow it
  without bound.
- **Older plugins keep working**: a device still running the legacy (protocol
  1) plugin continues to report best-effort; the top bar marks it as
  "connected but not on the reliable protocol" and points at the manual clear
  fallback.

### Installation (device side, optional)

On each device that should get bridge capability: add `"dsh-cockpit-bridge"` to
the bundles in its `dsh.yaml` (ohmydsh manifest), point the profile dependencies
at this repository's package path, run `dsh build` to materialise it into that
device's `~/.dsh/profiles/web`, then restart that device's DSH web. **A device
already running an older plugin needs a fresh `dsh build` plus a DSH web
restart to pick up the v2 reliable protocol** — until then it keeps working on
the legacy protocol without affecting the native workbench. See
`packages/dsh-cockpit-bridge/README.md` for details.

## Running it

`bin/cockpit` is a dependency-free Node.js cross-platform command. It does not
require Bash, a PowerShell script, or WSL. The repository pins pnpm 10.23.0 via
`packageManager`; the command prefers Corepack and falls back to pnpm on PATH.

```bash
# Linux / macOS
./bin/cockpit bootstrap      # initialise dependencies (idempotent)
./bin/cockpit install        # install into ~/.local/bin (optional)
cockpit start                # build if needed + start in background + open the UI
cockpit restart              # restart
cockpit stop                 # authenticate the instance, then shut down gracefully
cockpit status               # show running status
cockpit build                # build only
cockpit start --dev          # dev mode (tsx watch + vite, foreground)
# Others: --no-open skips the browser; --foreground for debugging; -b forces a rebuild
```

```text
# Windows (CMD and PowerShell both invoke the same Node CLI)
node .\bin\cockpit bootstrap
node .\bin\cockpit start
node .\bin\cockpit status
node .\bin\cockpit stop
node .\bin\cockpit start --dev
```

The root `package.json` declares a `cockpit` bin. To install a short global
command on Windows, run `node .\bin\cockpit install`; pnpm's standard global-bin
mechanism creates the platform shim.

Manual startup remains available:

```bash
pnpm install
pnpm build
node packages/cockpit-server/dist/main.js
```

The default URL is `http://127.0.0.1:3090/`. The first visit completes local token
authentication through an HttpOnly cookie (the token is persisted in the data
directory and only guards against other local processes and malicious pages).

| Environment variable | Purpose |
| --- | --- |
| `DSH_COCKPIT_HOME` | Data, runtime identity and log directory |
| `COCKPIT_PORT` | Server port, default `3090`; the Vite API proxy follows it in dev mode |
| `DSH_COCKPIT_PNPM_EXECUTABLE` | pnpm override; defaults to Corepack, then PATH |
| `DSH_COCKPIT_SSH_EXECUTABLE` | OpenSSH override; defaults to `ssh`/`ssh.exe` on PATH |
| `COCKPIT_BIN_DIR` | Unix install target, default `~/.local/bin` |

## Data directory

`~/.dsh-cockpit/` (override with `DSH_COCKPIT_HOME`):

| File | Purpose |
| --- | --- |
| `devices.json` | Device registry (0600, atomic writes, fail-closed on corruption — never overwritten) |
| `token` | The cockpit's local token (0600) |
| `runtime.json` | Minimal current-instance identity; removed on clean shutdown and never trusted as a PID kill authority by itself |
| `cockpit.log` | Background server log |

The cockpit **never reads or writes** `~/.dsh`; your local DSH is completely
unaffected.

`status` cross-checks `runtime.json`, the local token and the server's
authenticated response. If it reports a stale record and the port is closed,
the next `start` safely replaces it. If an unknown listener owns the port, the
command fails closed and refuses to stop or overwrite that process.

## Security and boundaries

- The cockpit service listens on `127.0.0.1` only. Credentials reuse the system
  OpenSSH passwordless setup; passwords, private keys and passphrases are
  **never stored**.
- Remote Settings/Subscriptions/Credentials are never proxied; provider tokens
  are never read or synced. The cockpit installs nothing at runtime — the bridge
  plugin, if deployed, is installed by the user on the device side and reports
  only a session-selection identity and protocol metadata.
- Bridge authentication uses a capability bound to one device's Origin, with a
  short TTL and a single purpose; it never exposes the persistent HttpOnly
  token to the plugin. The bridge Origin itself is supplied dynamically by the
  parent handshake, so it always matches the actual `COCKPIT_PORT`.
- Every `127.0.0.1:<port>` is a secure context, so remote GUIs run natively
  through the tunnel.
- On catchable signals (SIGINT/SIGTERM) the cockpit conclusively cleans up its
  own SSH child processes (no `ppid=1` orphans) without killing your other SSH
  connections.
- Known boundary: approval/question **events** that occurred while the cockpit
  was offline cannot be read back (that state has no query field — an rc.2
  protocol limitation). The device's own UI shows them correctly once you enter
  it.
- The token auth middleware is mounted on an Express 5 (`path-to-regexp` v8)
  catch-all route; a bare `'*'` is invalid syntax under that combination, and
  Express rewrites `request.path` relative to the mount point inside
  path-scoped middleware, so the middleware must read `request.originalUrl` to
  match the real request path. This implementation detail is enforced by
  `token.middleware.ts` and a real HTTP integration test
  (`app-auth.e2e.test.ts`); nothing about it is a concern for API consumers.

For how to report a vulnerability, see [SECURITY.md](SECURITY.md).

## Verification (measured against the current implementation)

- server vitest 104/104 (registry atomicity / fail-closed corruption, SSH
  identity, conclusive tunnel teardown, event conversion including the archive
  set, device lifecycle including the generation state machine / ack-edge
  convergence / archive-restore, bridge capability lifecycle and
  authorization, delete confirmation gate, order normalisation, **a real
  NestJS+Express integration test confirming the auth middleware actually
  gates every `/api/*` route**)
- web vitest 59/59 (mouse/keyboard/non-bubbling coverage for the Device Tab
  completion clear control, reliable/legacy/stale/missing bridge health
  presentation, Workbench bridge handshake and graceful degradation)
- bridge vitest 13/13 (lossless rapid multi-select, archive-before-flush,
  failure retry, outbox capacity/TTL, activation re-assertion, DSH page
  unaffected by bridge failures)
- typecheck + build green across all five packages (including the bridge's
  host/client dual entry points and source maps)
- Real browser acceptance (agent-browser + an isolated cockpit instance + a
  real local DSH + a controllable fake DSH): non-default port deployment,
  bridge capability issuance and Origin binding, live reliable/legacy/stale
  bridge health presentation, complete→open, ack-before-edge,
  edge-before-ack, archive immediately after completion, restore without
  re-arming, a genuinely new completion re-arming on the next generation, and
  mouse/keyboard manual clearing without switching the selected device
- Real E2E (isolated home + a real `lumevm`): add → own tunnel → READY →
  workbench HTTP 200 → real status counts
- Fault injection: kill the cockpit's ssh → immediately CONNECTING →
  auto-reconnect to READY; SIGTERM during both the startup window and an active
  tunnel leaves no orphans
- Five resident iframes memory baseline: JS heap delta ≈ 13 KB per device
  (browser-native isolation; the cockpit's own overhead is negligible)

## PWA

The frontend build ships PWA capability (assets live in
`packages/cockpit-web/public/`):

- `manifest.webmanifest` + icons (192/512/apple-touch): installable to the
  desktop or home screen. `127.0.0.1` is a secure context, satisfying the PWA
  install prerequisite.
- `sw.js` (registered in production builds only, see `src/pwa.ts`; not
  registered in dev so HMR stays untouched):
  - precaches the app shell so the cockpit opens offline;
  - `/api/*` is network-first with a cache fallback (offline shows the last
    known state);
  - SSE event streams and device workbench iframes (cross-origin ports) are
    never cached.
- After changing SW behaviour, bump `CACHE_VERSION` at the top of `sw.js`; stale
  caches are cleared on activation.

## Status

Early development. Design and implementation plans live in `openspec/`.

This repository practises spec-driven development with
[OpenSpec](https://github.com/Fission-AI/OpenSpec): `openspec/specs/` holds the
current behavioural contract of each capability, and
`openspec/changes/archive/` preserves the proposal, design, tasks and
verification record of every change. To understand *why* a behaviour is the way
it is, read the spec before the code.

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
environment, verification commands and the spec-driven workflow. Please report
security problems privately per [SECURITY.md](SECURITY.md) rather than opening a
public issue.

## Background

This project's predecessor was the OpenSpec change
`federated-dsh-control-plane` in `ohmydsh` (semantic federated Host: a central
node takes over remote APIs and merges many machines into one
`Node → Workspace → Session` tree). That path reached 77/82 before being
re-evaluated and archived as "explored but not adopted" — it required two
compatibility patches pinned to upstream commits, and the spec forbade proxying
remote settings and subscriptions, which meant settings/usage/plugin
inheritance was out of reach.

The decision record and measured evidence live in the `ohmydsh` repository at
`docs/adr/ADR-0003-adopt-cockpit-over-semantic-federation.md`. One measured
conclusion is the foundation of this project: **rc.2's single-consumer
semantics do not preempt server-side event streams** — while a real browser had
a given GUI open, an external subscriber's two streams were never kicked out.

## License

[MIT](LICENSE) © dsh-cockpit contributors
