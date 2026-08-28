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

## Bridge plugin (optional): talking to DSH

Core cockpit functionality **does not depend** on any plugin (see
[Remote requirements](#remote-requirements)). `packages/dsh-cockpit-bridge` is
an **optional** plugin for the official DSH web client. It runs inside **the
device's own dsh web page** (a same-origin cordis bundle) and bridges one
purely browser-local signal — "which session did the user open" — back to the
cockpit.

### Why it exists

Opening a session from the official sidebar (the `current` field of the
`sessions.list` store, i.e. `SessionManager.select`) is **pure in-browser
state**; there is no "selected" signal on the event stream. The cockpit does
not read iframe DOM by architectural principle, so it cannot observe it either.
With the plugin installed:

- The cockpit top bar shows a chain icon (`bridgeSeenAt`) — a closed chain means
  the bridge is connected, a broken chain means no plugin was detected — so you
  can confirm at a glance that the device's connectivity layer is alive.
- Green "completed" reminders clear with **official select semantics**: opening
  a session clears exactly that session's dot. Without the plugin the behaviour
  is still correct, just coarser — dots clear only on re-run or session removal.

### How it talks to DSH

| Signal | Plugin side (inside the device's DSH page) | Cockpit side |
| --- | --- | --- |
| **Startup hello** | `POST /api/bridge/hello {version}` on page load | Match the device by request `Origin` → record `bridgeSeenAt` → closed chain icon in the top bar |
| **Session selection** | Subscribe to `current` of the official `sessions.list`; on user click (250 ms debounce) → `POST /api/bridge/session-opened {sessionId}` | Match the device by `Origin` → `clearCompletedSession(sessionId)`, clearing only that session's dot |

- **Device identity is never hardcoded**: the plugin neither needs nor knows
  which device it runs on. The cockpit matches the request `Origin`
  (`127.0.0.1:<tunnel port>`, same origin as the device endpoint) against every
  device's live endpoint. Running inside the DSH page, the plugin naturally
  carries the correct same-origin `Origin`.
- **Authentication**: cross-origin fetches use `credentials: include` (the
  cockpit enables CORS credentials for loopback origins) and pass the token gate
  via an HttpOnly cookie. On a 401 the plugin requests `GET /api/bootstrap` to
  obtain the cookie, then retries once.
- **Only `sessionId` crosses the bridge**: no conversation content, settings or
  credentials are read or forwarded.
- **Silent failure**: when the cockpit is unreachable, errors are swallowed
  (fire-and-forget) and the DSH page is never disturbed; the next session change
  reports again.

### Installation (device side, optional)

On each device that should get bridge capability: add `"dsh-cockpit-bridge"` to
the bundles in its `dsh.yaml` (ohmydsh manifest), point the profile dependencies
at this repository's package path, run `dsh build` to materialise it into that
device's `~/.dsh/profiles/web`, then restart that device's DSH web. See
`packages/dsh-cockpit-bridge/README.md` for details.

## Running it

```bash
# Option 1: the bin command (recommended, installable into ~/.local/bin)
./bin/cockpit bootstrap      # initialise dependencies (idempotent)
./bin/cockpit install        # install the cockpit command into ~/.local/bin (optional)
cockpit start                # build if needed + start in background + open the UI
cockpit restart              # restart
cockpit stop                 # stop (kills only after strictly verifying port 3090 ownership)
cockpit status               # show running status
cockpit build                # build only
cockpit start --dev          # dev mode (tsx watch + vite, foreground)
# Others: --no-open skips the browser; --foreground for debugging; -b forces a rebuild

# Option 2: manual (equivalent to the first half of cockpit start)
pnpm install
pnpm build
node packages/cockpit-server/dist/main.js
```

Open `http://127.0.0.1:3090/`. The first visit completes local token
authentication through an HttpOnly cookie (the token is persisted in the data
directory and only guards against other local processes and malicious pages).

## Data directory

`~/.dsh-cockpit/` (override with `DSH_COCKPIT_HOME`):

| File | Purpose |
| --- | --- |
| `devices.json` | Device registry (0600, atomic writes, fail-closed on corruption — never overwritten) |
| `token` | The cockpit's local token (0600) |

The cockpit **never reads or writes** `~/.dsh`; your local DSH is completely
unaffected.

## Security and boundaries

- The cockpit service listens on `127.0.0.1` only. Credentials reuse the system
  OpenSSH passwordless setup; passwords, private keys and passphrases are
  **never stored**.
- Remote Settings/Subscriptions/Credentials are never proxied; provider tokens
  are never read or synced. The cockpit installs nothing at runtime — the bridge
  plugin, if deployed, is installed by the user on the device side and reports
  only a `sessionId`.
- Every `127.0.0.1:<port>` is a secure context, so remote GUIs run natively
  through the tunnel.
- On catchable signals (SIGINT/SIGTERM) the cockpit conclusively cleans up its
  own SSH child processes (no `ppid=1` orphans) without killing your other SSH
  connections.
- Known boundary: approval/question **events** that occurred while the cockpit
  was offline cannot be read back (that state has no query field — an rc.2
  protocol limitation). The device's own UI shows them correctly once you enter
  it.

For how to report a vulnerability, see [SECURITY.md](SECURITY.md).

## Verification (measured against the current implementation)

- server vitest 34/34 (registry atomicity / fail-closed corruption, SSH
  identity, conclusive tunnel teardown, event conversion, device lifecycle,
  delete confirmation gate, order normalisation)
- typecheck + build green across all four packages; web vitest 42/42
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
