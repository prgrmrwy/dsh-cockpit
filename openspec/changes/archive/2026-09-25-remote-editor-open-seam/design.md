## Context

Worktree paths originate on a remote DSH device while the browser and VS Code protocol handler run on the Cockpit host. The existing `vscode://file/<path>` link already launches host VS Code from the iframe, proving that browser user activation reaches the external protocol handler; it fails because the VM path is interpreted as a host-local path.

Cockpit already owns the missing authority (`DeviceStatusFacts.sshAlias`) and already sends an authenticated, origin-checked `bridge-config` message to the optional device-side bridge. The bridge is the sole allowed communication seam between device-page plugins and Cockpit.

## Goals / Non-Goals

**Goals:**

- Give arbitrary same-page plugins a stable, consumer-agnostic service for opening a remote path in host VS Code.
- Keep all Cockpit↔device communication inside the existing bridge channel.
- Preserve the original synchronous user gesture so the external protocol is not blocked as a popup.
- Preserve all existing acknowledgement/pending behavior and fail safely when alias/config/path is unavailable.

**Non-Goals:**

- A generic RPC or arbitrary action surface.
- A second iframe→parent action message.
- Remote command execution, file syncing, `host.openPath`, or non-SSH authorities.
- Coupling Cockpit to any named consumer plugin.

## Decisions

### D1: Stable same-page service, not a reverse postMessage

The bridge immediately provides `cockpitBridge.editorOpen`, a stable Cordis service object. `open(path)` reads the latest asynchronously received config, validates alias/path, and calls `window.open(vscode-remote URI, '_blank')` directly.

This keeps the original user activation. A reverse postMessage would cross an asynchronous boundary; a subsequent parent `window.open` can be rejected by popup blockers. It would also introduce the first command-like reverse channel when no such channel is needed.

### D2: Service exists before configuration and throws when unavailable

The service object is provided at bridge load and retains stable identity. Config arrives later through postMessage and is stored in a mutable closure. Calls before valid config throw synchronously so consumers can fall back.

We do not use `Service.check` to hide availability: `ctx.get()` does not consult the check predicate. We do not replace the object with `ctx.set`: stable identity avoids cached-object staleness and no notification machinery is required.

### D3: Shared contract package is the single source of truth

`@dsh-cockpit/shared` owns message names, service name, alias/path validators, message/service types, and URI construction. The server validator imports the same alias predicate. Bridge bundles the shared code into its browser artifact, so the published plugin has no runtime dependency on the private workspace package.

### D4: Explicit validation boundary

Alias accepts only `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Paths must be POSIX absolute or drive-letter absolute and contain no `..` segment after slash normalization. URI generation encodes path data and escapes query/fragment delimiters. The bridge validates independently even if a consumer also validates.

### D5: Bridge remains the only cross-boundary seam

Other device-page plugins consume the stable Cordis service; they must not postMessage or call Cockpit HTTP APIs directly. The service is closed (`open(path)` only), not a method dispatcher. Cockpit and bridge do not name any consumer.

### D6: Existing remote boundary is narrowed, not removed

The current prohibition is narrowed from “never give a remote path to a local opener” to “never give a bare remote path with local-path semantics.” A URI carrying explicit `ssh-remote+<alias>` authority is permitted. Prohibitions on `host.openPath` and file synchronization remain unchanged.

## Risks / Trade-offs

- **Remote-SSH missing** → OS/VS Code may silently drop the URI; do not claim success and document the prerequisite.
- **VS Code file/folder heuristic** → dotted directory names may be treated as files; document as an upstream URI limitation.
- **First SSH connection interaction** → host-key/key prompts can delay the window; treat as normal VS Code behavior.
- **Version skew** → old parents omit alias; service throws and consumers fall back.
- **Service-name compatibility** → `cockpitBridge.editorOpen` is a published cross-repo contract; changing it requires a breaking release.

## Migration Plan

1. Release Cockpit parent + bridge 0.4.0 together. With no consumer, behavior is unchanged.
2. Consumers discover `cockpitBridge.editorOpen` via a deployment-specific shim.
3. Roll back either side: missing alias/service produces consumer fallback; existing reporting continues.
