//#region src/index.ts
/**
* @module dsh-cockpit-bridge
*
* Host-side entry of the cockpit bridge: a minimal no-op cordis plugin.
*
* All real functionality lives in the browser bundle (`src/client/index.ts` →
* `lib/client.js`), which runs inside each device's DSH web client. This host
* half exists for one structural reason: `cordis.patch.yml` inserts
* `dsh-cockpit-bridge` as a profile bundle row, so the DSH loader imports this
* package's main entry at boot. Without it the loader fails with
* `ERR_MODULE_NOT_FOUND` on `lib/index.js` and the whole plugin tree — i.e. the
* entire DSH process — refuses to start.
*
* Being a loader entry is also what makes the client half reachable: the
* client-modules scanner discovers the browser bundle declared in package.json
* (`dsh.client` + `exports["./client"]`) and serves it at
* `/plugins/dsh-cockpit-bridge/client.js` in the Web boot manifest.
*
* Keep this file free of side effects: it must never touch the network,
* filesystem, or session state. The bridge deliberately reports nothing from
* the host — only the browser half sends a session id to the local cockpit.
*/
/** Stable cordis plugin name. */
const name = "dsh-cockpit-bridge";
/** Services required before this plugin mounts (none host-side). */
const inject = [];
/** No-op host-side apply: the bridge is browser-only by design. */
function apply() {}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map