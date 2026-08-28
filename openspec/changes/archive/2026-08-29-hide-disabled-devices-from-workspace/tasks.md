## 1. Shared disabled-state contract

- [x] 1.1 Add `DISABLED` to the shared `DeviceState` contract and update exhaustive state labels, tones, dots, and test fixtures across server and web.
- [x] 1.2 Add shared/contract tests proving disabled device facts serialize as a stable non-connecting state.

## 2. Connectivity lifecycle cleanup

- [x] 2.1 Initialize non-enabled lifecycles as `DISABLED` with no endpoint, stream, client, timer, or session aggregates, while preserving the registry record.
- [x] 2.2 Make disable transitions stop the old lifecycle, clear device `bridgeSeenAt`, attach the inert disabled lifecycle, and publish a final snapshot without active connection facts.
- [x] 2.3 Gate refresh, reconnect, bridge hello, and bridge session-opened paths so disabled devices cannot start or imply an active connection; re-enable through a fresh `CONNECTING` lifecycle.
- [x] 2.4 Extend lifecycle and connectivity-service tests for boot-disabled devices, resource cleanup, endpoint/bridge invalidation, disabled reconnect, and fresh re-enable behavior.

## 3. Workspace navigation and selection

- [x] 3.1 Derive an ordered enabled-device collection in `App`, pass it to `TopBar`, and ensure current/last-used selection is resolved only against that collection.
- [x] 3.2 Implement deterministic fallback when the current device becomes disabled or disappears, including the no-enabled-device empty state and a device-management recovery action.
- [x] 3.3 Keep all devices in device management and overview, but render disabled overview rows as explicitly disabled and non-selectable.
- [x] 3.4 Add App, topbar, and overview tests covering hidden disabled tabs, disabled last-used IDs, live disable fallback, and the all-disabled case.

## 4. Workbench resource release

- [x] 4.1 Give `Workbench` the enabled device set (or equivalent removal signal) and remove/unmount iframe registry entries when a device is disabled or deleted.
- [x] 4.2 Ensure temporary disconnects still retain iframe and overlay behavior, while disabled devices show neither an offline overlay nor a reconnect action and re-enable creates a fresh iframe.
- [x] 4.3 Extend workbench tests for iframe removal on disable/delete, retention on transient disconnect, and fresh creation after re-enable.

## 5. Verification and change tracking

- [x] 5.1 Run focused shared, server, and web tests for the changed contracts and UI flows, fixing any regressions.
- [x] 5.2 Run `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` and record the actual results.
- [x] 5.3 Refresh the existing Cockpit URL after rebuilding web artifacts and verify that disabled devices disappear from the topbar, release their workbench, and remain re-enableable from device management.
