window.__ModuleLoader__.load({
	id: "dsh-cockpit-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const CAPABILITY_EXPIRED_MESSAGE = "dsh-cockpit:capability-expired";
		/** Stable cross-package service name. Changing it is a breaking change. */
		const COCKPIT_EDITOR_OPEN_SERVICE = "cockpitBridge.editorOpen";
		function isValidDevicePort(value) {
			return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
		}
		const SSH_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
		function isValidSshAlias(value) {
			return typeof value === "string" && SSH_ALIAS_PATTERN.test(value);
		}
		/** Accept POSIX or drive-letter absolute paths and reject traversal segments. */
		function isValidEditorPath(value) {
			if (typeof value !== "string" || value === "" || value.includes("\0")) return false;
			if (!value.startsWith("/") && !/^[A-Za-z]:[/\\]/.test(value)) return false;
			return !value.replaceAll("\\", "/").split("/").includes("..");
		}
		/** Encode a validated path without allowing query/fragment delimiters through. */
		function createRemoteEditorUri(sshAlias, path) {
			if (!isValidSshAlias(sshAlias)) throw new Error("invalid SSH alias");
			if (!isValidEditorPath(path)) throw new Error("invalid editor path");
			const normalizedPath = path.replaceAll("\\", "/");
			return `vscode://vscode-remote/ssh-remote+${sshAlias}${(normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`).split("/").map((segment, index) => {
				if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
				return encodeURIComponent(segment);
			}).join("/")}?windowId=_blank`;
		}
		//#endregion
		//#region ../shared/dist/forwards.js
		/** Holder labels and entry labels: 1–64 printable ASCII characters. */
		function isValidForwardLabel(value) {
			return typeof value === "string" && /^[\x20-\x7E]{1,64}$/.test(value);
		}
		/** Device iframe → parent page: a bridge page instance ended (design D4(a)). */
		const BRIDGE_INSTANCE_ENDED_MESSAGE = "dsh-cockpit:bridge-instance-ended";
		/** Full service name of the bridge seam. Cross-repo contract: renaming it is
		* a breaking change. */
		const COCKPIT_FORWARDS_SERVICE = "cockpitBridge.forwards";
		/** Thrown synchronously when the page is not in a cockpit iframe or the
		* handshake has not completed; consumers fall back to local behavior. */
		const FORWARDS_UNAVAILABLE = "unavailable";
		//#endregion
		//#region src/client/forwards.ts
		/**
		* `cockpitBridge.forwards` (device-forward-registry D4(a), D7).
		*
		* A consumer asks for a device port by holder label; the cockpit answers with
		* the entry's state at once and delivers the address later through the
		* snapshot the parent page pushes. Holders belong to a one-shot page instance
		* id: a new id on every effect start and on a bfcache restore, and once an id
		* is ended (pagehide / dispose) it is never used again.
		*/
		var SeamError = class extends Error {
			code;
			constructor(code, message = code) {
				super(message);
				this.code = code;
				this.name = "CockpitForwardsError";
			}
		};
		const recordKey = (devicePort, holder) => `${devicePort}\u0000${holder}`;
		function newInstanceId() {
			const bytes = /* @__PURE__ */ new Uint8Array(16);
			globalThis.crypto.getRandomValues(bytes);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
		}
		function addressFor(port) {
			return {
				host: "127.0.0.1",
				port,
				url: `http://127.0.0.1:${port}`
			};
		}
		function isSnapshot(value) {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value;
			return Array.isArray(candidate.rows) && candidate.rows.every((row) => typeof row === "object" && row !== null && isValidDevicePort(row.devicePort)) && typeof candidate.additionalCount === "number" && typeof candidate.limit === "number";
		}
		function createForwards(deps) {
			let instanceId;
			let ended = false;
			let snapshot;
			const records = /* @__PURE__ */ new Map();
			const snapshotListeners = /* @__PURE__ */ new Set();
			const unavailable = () => new SeamError(FORWARDS_UNAVAILABLE, "cockpit forwards are unavailable");
			const notify = (record, notice) => {
				for (const listener of [...record.listeners]) try {
					listener(notice);
				} catch {}
			};
			const drop = (record) => {
				records.delete(recordKey(record.devicePort, record.holder));
				record.state = "removed";
				record.address = void 0;
				notify(record, {
					devicePort: record.devicePort,
					state: "removed"
				});
			};
			const dropAll = () => {
				for (const record of [...records.values()]) drop(record);
			};
			/** One capability-bearing request. 400/401 renew once (the capability is
			* short-lived and a click can come long after load); 409 is a business
			* answer and is surfaced with its code, never renewed or retried. */
			const request = async (path, body) => {
				const active = deps.config();
				if (active === void 0) throw unavailable();
				let response = await deps.send(path, body, active);
				if (response.status === 401 || response.status === 400) {
					const renewed = await deps.renew(active);
					if (renewed !== void 0) response = await deps.send(path, body, renewed);
				}
				if (response.status === 409) {
					let code;
					try {
						code = (await response.json()).code;
					} catch {
						code = void 0;
					}
					throw new SeamError(typeof code === "string" ? code : "request-failed");
				}
				if (!response.ok) throw new SeamError("request-failed", `cockpit forwards request rejected (${response.status})`);
				return await response.json();
			};
			/** The instance id to act under; a used-up id is replaced first. */
			const liveInstance = () => {
				if (deps.config() === void 0 || instanceId === void 0) throw unavailable();
				if (ended) rotate();
				return instanceId;
			};
			const rotate = () => {
				dropAll();
				instanceId = newInstanceId();
				ended = false;
			};
			const apply = (record, state, localPort, diagnostic) => {
				const address = state === "ready" && localPort !== void 0 ? addressFor(localPort) : void 0;
				if (record.state === state && record.address?.port === address?.port) return;
				record.state = state;
				record.address = address;
				notify(record, {
					devicePort: record.devicePort,
					state,
					...address === void 0 ? {} : { address },
					...diagnostic === void 0 ? {} : { diagnostic }
				});
			};
			const onSnapshot = (next) => {
				snapshot = next;
				for (const record of [...records.values()]) {
					const row = next.rows.find((candidate) => candidate.kind === "additional" && candidate.devicePort === record.devicePort);
					if (row === void 0 || row.kind !== "additional") {
						if (record.seen) drop(record);
						continue;
					}
					record.seen = true;
					apply(record, row.state, row.localPort, row.diagnostic);
				}
				for (const listener of [...snapshotListeners]) try {
					listener(next);
				} catch {}
			};
			return {
				service: {
					acquire(devicePort, holder) {
						const instance = liveInstance();
						if (!isValidDevicePort(devicePort)) return Promise.reject(new SeamError("invalid-port"));
						if (!isValidForwardLabel(holder)) return Promise.reject(new SeamError("invalid-holder"));
						return (async () => {
							const result = await request("/api/bridge/forwards/acquire", {
								devicePort,
								holder,
								instanceId: instance
							});
							if (instance !== instanceId) throw unavailable();
							const key = recordKey(devicePort, holder);
							let record = records.get(key);
							if (record === void 0) {
								const created = {
									devicePort,
									holder,
									state: "starting",
									address: void 0,
									seen: false,
									listeners: /* @__PURE__ */ new Set(),
									handle: {
										devicePort,
										holder,
										get state() {
											return created.state;
										},
										get address() {
											return created.address;
										},
										onChange(listener) {
											created.listeners.add(listener);
											return () => {
												created.listeners.delete(listener);
											};
										}
									}
								};
								record = created;
								records.set(key, record);
							}
							const state = result?.state;
							if (state === "starting" || state === "ready" || state === "retrying" || state === "paused") {
								record.state = state;
								record.address = state === "ready" && typeof result.localPort === "number" ? addressFor(result.localPort) : void 0;
							}
							return record.handle;
						})();
					},
					async release(handle) {
						const record = records.get(recordKey(handle.devicePort, handle.holder));
						if (record === void 0 || record.handle !== handle || instanceId === void 0 || ended) return;
						const instance = instanceId;
						drop(record);
						await request("/api/bridge/forwards/release", {
							devicePort: handle.devicePort,
							holder: handle.holder,
							instanceId: instance
						});
					},
					list() {
						if (deps.config() === void 0) throw unavailable();
						return snapshot;
					},
					subscribe(listener) {
						snapshotListeners.add(listener);
						return () => {
							snapshotListeners.delete(listener);
						};
					}
				},
				startInstance() {
					instanceId = newInstanceId();
					ended = false;
				},
				endInstance() {
					const active = deps.config();
					if (instanceId === void 0 || ended) return;
					ended = true;
					if (active === void 0) return;
					try {
						window.parent.postMessage({
							type: BRIDGE_INSTANCE_ENDED_MESSAGE,
							instanceId
						}, active.cockpitOrigin);
					} catch {}
				},
				restoreInstance() {
					rotate();
				},
				stopInstance() {
					this.endInstance();
					dropAll();
					instanceId = void 0;
				},
				snapshot() {
					return snapshot;
				},
				handleMessage(event) {
					const data = event.data;
					if (typeof data !== "object" || data === null || data.type !== "dsh-cockpit:forwards-snapshot") return false;
					const active = deps.config();
					if (active === void 0 || event.source !== window.parent || event.origin !== active.cockpitOrigin) return true;
					if (isSnapshot(data.snapshot)) onSnapshot(data.snapshot);
					return true;
				}
			};
		}
		//#endregion
		//#region src/client/settings-styles.ts
		/**
		* Styles for the read-only “驾驶舱转发” settings section (design D9).
		*
		* The section lives inside the host's settings panel, so the **host owns the
		* theme**: every colour below is a role mapped onto an official `--dsw-alias-*`
		* token, and the section contributes structure, scale and one memorable device
		* instead of a palette of its own. That is why nothing here hard-codes a colour
		* or reads `prefers-color-scheme` — dark and light are the host's to switch.
		*
		* The memorable device is the eight-slot occupancy meter: the additional-entry
		* pool really is bounded at eight, so drawing the slots answers “how much room
		* is left” without asking anyone to remember the number.
		*
		* Rules only ever match this plugin's own `dshcf-` classes (the section carries
		* {@link SECTION_ATTRIBUTE}), so the sheet cannot reach another plugin's row.
		* No webfonts, no images, no network.
		*
		* @module dsh-cockpit-bridge/client/settings-styles
		*/
		/** Marks the section root, so the stylesheet and the injected node stay ours. */
		const SECTION_ATTRIBUTE = "data-dsh-cockpit-forwards";
		/** Marks this section's own row in the settings navigation (see `nav-icon.ts`):
		* the slot projects no icon field, so the row is identified by its label and
		* then drawn by the sheet below. */
		const NAV_MARKER = "data-dsh-cockpit-forwards-nav";
		/**
		* A 16px transfer glyph: two opposing arrows, the conventional "traffic moves
		* between two ends" mark, drawn as a mask so it inherits `currentColor` like the
		* official glyphs.
		*
		* Style is calibrated against the host's own nav icons rather than invented:
		* `dsh-client-ui-settings-shell` renders every section row through
		* `navIcon(id)`, which returns an `Icon*OutlineMedium` primitive from
		* `@deepseek-ai/dsh-client-ui-primitives` — `viewBox="0 0 16 16"`, `fill="none"`,
		* `stroke="currentColor"`, `stroke-width: ICON_MEDIUM_STROKE` (= 1.3, not 1: the
		* set ships a 1px "Regular" weight too), `aria-hidden`, geometry inside the
		* 1.5–14.5 box. Round caps/joins come from `IconChevronsUpDownOutlineMedium`,
		* the set's own arrow-shaped icon, so the arrowheads match its chevrons.
		*
		* Two ports joined by an arrow was tried first and read as a dense blob at
		* 16px; one outline plus one stroke (the earlier port glyph) then read as a
		* different icon family from its neighbours. No emoji font, no image asset, no
		* network.
		*/
		const TRANSFER_MASK = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"#000\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M1.8 5.6h11.4\"/><path d=\"m10.9 3.3 2.3 2.3-2.3 2.3\"/><path d=\"M14.2 10.4H2.8\"/><path d=\"m5.1 8.1-2.3 2.3 2.3 2.3\"/></svg>")}")`;
		const STYLE_ID = "dsh-cockpit-forwards-styles";
		/** The section's whole stylesheet. */
		const SECTION_CSS = `
.dshcf{
  --dshcf-ink:var(--dsw-alias-label-primary,inherit);
  --dshcf-ink-2:var(--dsw-alias-label-secondary,inherit);
  --dshcf-ink-3:var(--dsw-alias-label-tertiary,inherit);
  --dshcf-rule:var(--dsw-alias-border-l2,currentColor);
  --dshcf-rule-weak:var(--dsw-alias-border-l1,currentColor);
  --dshcf-rule-strong:var(--dsw-alias-border-l3,currentColor);
  --dshcf-accent:var(--dsw-alias-state-business-primary,currentColor);
  --dshcf-ok:var(--dsw-alias-state-success-primary,currentColor);
  --dshcf-warn:var(--dsw-alias-state-warn-primary,currentColor);
  --dshcf-error:var(--dsw-alias-state-error-primary,currentColor);
  --dshcf-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  display:flex;flex-direction:column;gap:10px;
  color:var(--dshcf-ink);font-size:12px;line-height:1.55;
}
/* Prose explains; it never runs the width of a wide panel. */
.dshcf-lede{margin:0;max-width:62ch;color:var(--dshcf-ink-2)}
.dshcf-title{margin:0;font-size:13px;font-weight:500}
.dshcf-guidance{margin:0;max-width:62ch;color:var(--dshcf-ink-2)}
/* The pool is a section of its own: the meter governs the rows under it. */
.dshcf-pool{display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--dshcf-rule-strong);padding-top:10px}
.dshcf-usage{display:flex;align-items:center;gap:8px}
.dshcf-usage-label{color:var(--dshcf-ink-3);font-size:11px}
.dshcf-meter{display:inline-flex;gap:2px;margin-left:auto}
/* An unused slot must still be visible: the pool size is the information. */
.dshcf-seg{width:14px;height:4px;border-radius:1px;background:var(--dsw-alias-state-idle-primary,currentColor)}
.dshcf-seg[data-filled="true"]{background:var(--dshcf-accent)}
.dshcf-usage-count{font-family:var(--dshcf-mono);font-size:11px;color:var(--dshcf-ink-3);font-variant-numeric:tabular-nums}
.dshcf-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
/* One row is the object itself: device port becomes a local address. Ports and
   addresses are monospace because one misread digit costs real debugging time. */
.dshcf-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding:7px 0}
.dshcf-row+.dshcf-row{border-top:1px solid var(--dshcf-rule-weak)}
.dshcf-port{font-family:var(--dshcf-mono);font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.dshcf-arrow{color:var(--dshcf-ink-3)}
.dshcf-address{font-family:var(--dshcf-mono);color:var(--dshcf-ink-2)}
.dshcf-state{font-size:11px;color:var(--dshcf-ink-2);margin-left:auto}
.dshcf-row[data-state="ready"] .dshcf-state{color:var(--dshcf-ok)}
.dshcf-row[data-state="retrying"] .dshcf-state{color:var(--dshcf-warn)}
.dshcf-row[data-state="starting"] .dshcf-state{color:var(--dshcf-ink-3)}
.dshcf-row[data-state="paused"] .dshcf-state{color:var(--dshcf-ink-3)}
/* Lifetime is the one filled chip: whether an entry survives its holders is the
   single thing a row must say at a glance. */
.dshcf-life{font-size:11px;padding:0 6px;border:1px solid var(--dshcf-rule);border-radius:4px;color:var(--dshcf-ink-3);white-space:nowrap}
.dshcf-row[data-kind="main"] .dshcf-life{border-color:transparent;background:var(--dshcf-rule);color:var(--dshcf-ink-2)}
.dshcf-holders{flex-basis:100%;font-family:var(--dshcf-mono);font-size:11px;color:var(--dshcf-ink-3);overflow-wrap:anywhere}
/* A diagnostic is labelled and gets its own line; it is never mixed into the
   holder labels it would otherwise look like. */
.dshcf-diag{flex-basis:100%;margin:2px 0 0;display:flex;gap:6px;font-size:11px;color:var(--dshcf-error);overflow-wrap:anywhere}
.dshcf-diag-label{flex:none;color:var(--dshcf-ink-3)}
.dshcf-empty{margin:4px 0 0;max-width:62ch;color:var(--dshcf-ink-3)}
.dshcf-hint{margin:0;border-top:1px solid var(--dshcf-rule);padding-top:8px;max-width:62ch;color:var(--dshcf-ink-3)}
/* Nav row glyph. Both rules are scoped to the marker, which only ever lands on
   the row whose visible text is this section's label, so the sheet cannot reach
   another plugin's row. The replacement is an explicit inline-block rather than
   an anonymous inline box: if the host row is not a flex container, an inline
   ::before would ignore width/height and the row would lose its icon entirely
   (the official svg is hidden by the rule above it). This way the worst case is
   a slightly off alignment instead of no icon at all. */
[${NAV_MARKER}]>svg{display:none}
[${NAV_MARKER}]::before{content:'';display:inline-block;vertical-align:-3px;flex:none;width:16px;height:16px;
  background-color:currentColor;
  -webkit-mask:${TRANSFER_MASK} center/16px 16px no-repeat;mask:${TRANSFER_MASK} center/16px 16px no-repeat}
`;
		/**
		* Inject the section stylesheet, once per page.
		*
		* Returns the disposer that removes it again, or `undefined` when there is no
		* document to inject into (non-browser environments). The first injector owns
		* the sheet: a second mount reuses the node and returns a no-op disposer, so
		* unloading one mount can never strip the styles from another.
		*/
		function injectSectionStyles(host = globalThis.document) {
			if (host === void 0) return void 0;
			if (host.getElementById(STYLE_ID) !== null) return () => {};
			const style = host.createElement("style");
			style.id = STYLE_ID;
			style.textContent = SECTION_CSS;
			host.head.appendChild(style);
			let removed = false;
			return () => {
				if (removed) return;
				removed = true;
				style.remove();
			};
		}
		//#endregion
		//#region src/client/nav-icon.ts
		/**
		* Paint the port-to-port glyph on this section's own row in the DSH settings
		* navigation.
		*
		* `settings.section` projects only `id`, `order` and `label`, and the settings
		* shell picks the row icon from a closed list of built-in ids — so a third-party
		* section renders the fallback gear. Until that contract grows an icon field, a
		* plugin can only identify its **own** row after the dialog mounts, which is the
		* same bounded adaptation ohmydsh's `dsh-memex` ships for its book glyph.
		*
		* Scope discipline: the marker is written only onto the button whose visible
		* text equals our current label, the paired CSS selects nothing but that marker,
		* and every marker is removed on disposal. Failure to locate the row is silent —
		* the official gear stays and the page is unaffected.
		*
		* @module dsh-cockpit-bridge/client/nav-icon
		*/
		/**
		* Keep the marker on the settings-nav button showing this section's label.
		* @param label - resolver for the section's current display label.
		* @returns disposer that stops observing and removes every owned marker.
		*/
		function registerForwardsSettingsNavIcon(label) {
			const doc = globalThis.document;
			if (doc === void 0) return () => {};
			let disposed = false;
			const sync = () => {
				if (disposed) return;
				const current = label().trim();
				if (current.length === 0) return;
				for (const button of doc.querySelectorAll("[role=\"dialog\"] nav button")) if (button.textContent?.trim() === current) button.setAttribute(NAV_MARKER, "");
				else button.removeAttribute(NAV_MARKER);
			};
			sync();
			const observer = new MutationObserver(sync);
			observer.observe(doc.body, {
				childList: true,
				subtree: true,
				characterData: true
			});
			return () => {
				disposed = true;
				observer.disconnect();
				for (const marked of doc.querySelectorAll(`[${NAV_MARKER}]`)) marked.removeAttribute(NAV_MARKER);
			};
		}
		//#endregion
		//#region src/client/settings.ts
		/**
		* Read-only “驾驶舱转发” settings section (device-forward-registry D9).
		*
		* Lists this device's forward table from the snapshot the cockpit parent page
		* pushes. It offers no create, delete or release control: management happens
		* in the cockpit device panel. Labels and diagnostics are rendered as React
		* text children only, never as HTML.
		*
		* The reader may not be the person operating the cockpit, so the section says
		* what it is showing before it shows it: the tunnels are the cockpit's, the
		* local address is only valid on the machine running the cockpit, and the
		* controls live in the cockpit's device panel. `settingsView` holds that copy
		* as data, which is what the bridge's node-only tests assert.
		*
		* Presentation lives in `settings-styles.ts` (the host owns the theme).
		*/
		const SECTION_LABEL = "驾驶舱转发";
		const STATE_TEXT = {
			starting: "建立中",
			ready: "就绪",
			retrying: "重试中",
			paused: "暂停"
		};
		const LEDE = "驾驶舱为这台设备建立的回环转发。表中的本地地址只在运行驾驶舱的那台机器上有效。";
		const HINT = "创建与删除在驾驶舱设备面板中进行；本页只读。";
		const EMPTY_GUIDANCE = "还没有附加转发。设备上的组件申请转发，或在驾驶舱设备面板中添加常驻条目后，会出现在这里。";
		const NOT_CONNECTED_TITLE = "未连接驾驶舱";
		const NOT_CONNECTED_GUIDANCE = ["这个区块只在设备页面运行于驾驶舱工作台内时才会填充。", "在驾驶舱里打开这台设备，就能在这里看到它的转发表。"];
		const READING_TITLE = "正在读取转发表";
		const LOCAL_TITLE = "本机设备无需转发";
		const LOCAL_GUIDANCE = ["驾驶舱与这台 DSH 在同一台机器上，设备上的组件直接访问本地地址即可，不需要经过 SSH 隧道。"];
		function additionalRow(row) {
			const address = row.state === "ready" && row.localPort !== void 0 ? `127.0.0.1:${row.localPort}` : "";
			if (row.kind === "system") return {
				key: "system",
				kind: "main",
				port: String(row.devicePort),
				address,
				state: STATE_TEXT[row.state],
				stateKind: row.state,
				lifetime: "主通道",
				holders: "",
				diagnostic: ""
			};
			return {
				key: String(row.devicePort),
				kind: "additional",
				port: String(row.devicePort),
				address,
				state: STATE_TEXT[row.state],
				stateKind: row.state,
				lifetime: row.pinned ? "常驻" : "随持有者",
				holders: [row.label, ...row.holders].filter((value) => value !== void 0 && value !== "").join(", "),
				diagnostic: row.diagnostic ?? ""
			};
		}
		/** Pure view model: what the section shows for a handshake state and a
		* snapshot. */
		function settingsView(connected, snapshot) {
			if (!connected) return {
				kind: "message",
				title: NOT_CONNECTED_TITLE,
				guidance: NOT_CONNECTED_GUIDANCE
			};
			if (snapshot === void 0) return {
				kind: "message",
				title: READING_TITLE,
				guidance: []
			};
			if (snapshot.local === true) return {
				kind: "message",
				title: LOCAL_TITLE,
				guidance: LOCAL_GUIDANCE
			};
			const rows = snapshot.rows.map(additionalRow);
			return {
				kind: "rows",
				lede: LEDE,
				main: rows.filter((row) => row.kind === "main"),
				additional: rows.filter((row) => row.kind === "additional"),
				usage: {
					count: snapshot.additionalCount,
					limit: snapshot.limit
				},
				emptyGuidance: EMPTY_GUIDANCE,
				hint: HINT,
				controls: []
			};
		}
		function createSettingsStore(source) {
			const listeners = /* @__PURE__ */ new Set();
			let cached;
			return {
				view: () => cached ??= settingsView(source.connected(), source.snapshot()),
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				changed: () => {
					cached = void 0;
					for (const listener of [...listeners]) listener();
				}
			};
		}
		/** Eight slots is the whole point of the meter, so an implausible limit simply
		* loses the meter rather than drawing a wall of segments. */
		function meter(usage) {
			if (!Number.isInteger(usage.limit) || usage.limit < 1 || usage.limit > 24) return void 0;
			const filled = Math.max(0, Math.min(usage.count, usage.limit));
			return (0, react.createElement)("span", {
				className: "dshcf-meter",
				"aria-hidden": "true"
			}, ...Array.from({ length: usage.limit }, (_, index) => (0, react.createElement)("span", {
				className: "dshcf-seg",
				key: index,
				"data-filled": index < filled ? "true" : "false"
			})));
		}
		/** The section root carries the marker the stylesheet is scoped to. */
		function sectionProps() {
			return {
				className: "dshcf",
				[SECTION_ATTRIBUTE]: ""
			};
		}
		function rowElement(row) {
			return (0, react.createElement)("li", {
				className: "dshcf-row",
				key: row.key,
				"data-kind": row.kind,
				"data-state": row.stateKind
			}, (0, react.createElement)("span", { className: "dshcf-port" }, row.port), (0, react.createElement)("span", {
				className: "dshcf-arrow",
				"aria-hidden": "true"
			}, "→"), (0, react.createElement)("span", { className: "dshcf-address" }, row.address === "" ? "尚未就绪" : row.address), (0, react.createElement)("span", { className: "dshcf-state" }, row.state), (0, react.createElement)("span", { className: "dshcf-life" }, row.lifetime), ...row.holders === "" ? [] : [(0, react.createElement)("span", { className: "dshcf-holders" }, row.holders)], ...row.diagnostic === "" ? [] : [(0, react.createElement)("p", { className: "dshcf-diag" }, (0, react.createElement)("span", { className: "dshcf-diag-label" }, "诊断"), (0, react.createElement)("span", null, row.diagnostic))]);
		}
		function ForwardsSettingsSection(props) {
			const { view, subscribe } = props;
			const current = (0, react.useSyncExternalStore)(subscribe ?? (() => () => {}), view ?? (() => void 0));
			if (current === void 0) return null;
			if (current.kind === "message") return (0, react.createElement)("section", sectionProps(), (0, react.createElement)("p", { className: "dshcf-title" }, current.title), ...current.guidance.map((text, index) => (0, react.createElement)("p", {
				className: "dshcf-guidance",
				key: index
			}, text)));
			const meterElement = meter(current.usage);
			return (0, react.createElement)("section", sectionProps(), (0, react.createElement)("p", { className: "dshcf-lede" }, current.lede), ...current.main.length === 0 ? [] : [(0, react.createElement)("ul", {
				className: "dshcf-rows",
				key: "main"
			}, ...current.main.map(rowElement))], (0, react.createElement)("div", { className: "dshcf-pool" }, (0, react.createElement)("div", { className: "dshcf-usage" }, (0, react.createElement)("span", { className: "dshcf-usage-label" }, "附加转发"), ...meterElement === void 0 ? [] : [meterElement], (0, react.createElement)("span", { className: "dshcf-usage-count" }, `${current.usage.count} / ${current.usage.limit}`)), ...current.additional.length === 0 ? [(0, react.createElement)("p", {
				className: "dshcf-empty",
				key: "empty"
			}, current.emptyGuidance)] : [(0, react.createElement)("ul", {
				className: "dshcf-rows",
				key: "additional"
			}, ...current.additional.map(rowElement))]), (0, react.createElement)("p", { className: "dshcf-hint" }, current.hint));
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["sessions", "uiSession"];
		const CAPABILITY_HEADER = "x-dsh-cockpit-bridge-capability";
		const PLUGIN_VERSION = "0.6.1";
		const PROTOCOL_VERSION = 2;
		const PENDING_PROTOCOL_VERSION = 3;
		const PENDING_SEAM_VERSION = 1;
		const FLUSH_DELAY_MS = 250;
		const RETRY_BASE_MS = 500;
		const RETRY_MAX_MS = 3e4;
		const REQUEST_TIMEOUT_MS = 1e4;
		const OUTBOX_TTL_MS = 3e5;
		const OUTBOX_CAPACITY = 32;
		/** How long a seam call waits for the parent to supply a fresh capability. */
		const CAPABILITY_RENEWAL_WAIT_MS = 5e3;
		const CAPABILITY_RENEWAL_POLL_MS = 100;
		const CLEARED_KEY = "\0selection-cleared";
		function parseConfig(event) {
			if (event.source !== window.parent || typeof event.data !== "object" || event.data === null) return;
			const data = event.data;
			if (data.type !== "dsh-cockpit:bridge-config" || typeof data.cockpitOrigin !== "string" || typeof data.capability !== "string" || data.capability === "") return;
			try {
				const url = new URL(data.cockpitOrigin);
				if (url.origin !== data.cockpitOrigin || event.origin !== data.cockpitOrigin) return;
				if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return;
			} catch {
				return;
			}
			return {
				cockpitOrigin: data.cockpitOrigin,
				capability: data.capability,
				...isValidSshAlias(data.sshAlias) ? { sshAlias: data.sshAlias } : {}
			};
		}
		function isActivation(event, config) {
			return config !== void 0 && event.source === window.parent && event.origin === config.cockpitOrigin && typeof event.data === "object" && event.data !== null && event.data.type === "dsh-cockpit:device-activated";
		}
		/** 0.2.0 removed current. A present byId is authoritative even with no main view. */
		function currentSelection(snapshot) {
			if (snapshot.byId !== void 0 && !Object.hasOwn(snapshot, "current")) return Object.values(snapshot.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;
			if (snapshot.byId !== void 0 && Object.values(snapshot.byId).some((row) => row.retainedBy !== void 0)) return Object.values(snapshot.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;
			return snapshot.current;
		}
		function isObservable(value) {
			return typeof value === "object" && value !== null && typeof value.getSnapshot === "function" && typeof value.subscribe === "function";
		}
		/** Project only public identifiers; do not read or forward interaction contents. */
		function pendingSource(ui) {
			const legacy = ui?.pendingInteractions;
			const status = ui?.sessionStatus;
			const source = isObservable(legacy) ? legacy : isObservable(status) ? status : void 0;
			if (source === void 0) return;
			return {
				subscribe: (listener) => source.subscribe(listener),
				getSnapshot: () => {
					const snapshot = source.getSnapshot();
					if (!(snapshot instanceof Map)) throw new Error("unknown pending snapshot");
					const result = [];
					for (const row of snapshot.values()) {
						const item = source === legacy ? row : row?.pendingInteraction;
						if (item === void 0) continue;
						if (typeof item !== "object" || item === null) throw new Error("unknown pending interaction");
						const { sessionId, kind, key } = item;
						if (kind !== "approval" && kind !== "question") continue;
						if (typeof sessionId !== "string" || typeof key !== "string") throw new Error("invalid pending identity");
						result.push({
							sessionId,
							kind,
							key
						});
					}
					return result.sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.key.localeCompare(right.key));
				}
			};
		}
		function apply(ctx) {
			let config;
			ctx.provide(COCKPIT_EDITOR_OPEN_SERVICE, { open(path) {
				const sshAlias = config?.sshAlias;
				if (sshAlias === void 0) throw new Error("cockpit remote editor is unavailable");
				const uri = createRemoteEditorUri(sshAlias, path);
				window.open(uri, "_blank");
			} });
			/**
			* Wait for the parent to hand down a capability different from the stale one.
			*
			* Capabilities live ~60s, and this seam is driven by a human click that can
			* land long after the page loaded — so an expired capability is the NORMAL
			* case here, not an error. Asking the parent and waiting briefly turns it
			* into a transparent retry instead of a user-visible 401.
			*/
			const renewConfig = async (stale) => {
				try {
					window.parent.postMessage({ type: CAPABILITY_EXPIRED_MESSAGE }, stale.cockpitOrigin);
				} catch {
					return;
				}
				for (let waited = 0; waited < CAPABILITY_RENEWAL_WAIT_MS; waited += CAPABILITY_RENEWAL_POLL_MS) {
					await new Promise((resolve) => setTimeout(resolve, CAPABILITY_RENEWAL_POLL_MS));
					const next = config;
					if (next !== void 0 && next.capability !== stale.capability) return next;
				}
			};
			/** `cockpitBridge.forwards`: same contract shape as the seams above —
			* provided immediately, unavailable-by-throwing until the handshake. */
			const forwards = createForwards({
				config: () => config,
				renew: renewConfig,
				send: async (path, body, active) => {
					const controller = new AbortController();
					const timeout = setTimeout(() => {
						controller.abort();
					}, REQUEST_TIMEOUT_MS);
					try {
						return await fetch(`${active.cockpitOrigin}${path}`, {
							method: "POST",
							headers: {
								"content-type": "application/json",
								[CAPABILITY_HEADER]: active.capability
							},
							body: JSON.stringify(body),
							signal: controller.signal
						});
					} finally {
						clearTimeout(timeout);
					}
				}
			});
			ctx.provide(COCKPIT_FORWARDS_SERVICE, forwards.service);
			const settings = createSettingsStore({
				connected: () => config !== void 0,
				snapshot: () => forwards.snapshot()
			});
			ctx.inject(["slots"], (child) => {
				const slots = child.slots;
				child.effect(() => {
					const removeStyles = injectSectionStyles();
					return () => {
						removeStyles?.();
					};
				}, "cockpit-bridge: forwards section styles");
				child.effect(() => registerForwardsSettingsNavIcon(() => SECTION_LABEL), "cockpit-bridge: forwards settings nav glyph");
				slots.inject("settings.section", () => slots.register({
					name: "settings.section",
					id: "dsh-cockpit-forwards",
					order: 300,
					label: () => SECTION_LABEL,
					inject: () => ({
						view: settings.view,
						subscribe: settings.subscribe
					})
				}, ForwardsSettingsSection));
			});
			ctx.effect(() => {
				forwards.startInstance();
				const onPageHide = () => {
					forwards.endInstance();
				};
				const onPageShow = (event) => {
					if (event.persisted === true) forwards.restoreInstance();
				};
				const onSnapshot = (event) => {
					if (forwards.handleMessage(event)) settings.changed();
				};
				window.addEventListener("pagehide", onPageHide);
				window.addEventListener("pageshow", onPageShow);
				window.addEventListener("message", onSnapshot);
				return () => {
					window.removeEventListener("pagehide", onPageHide);
					window.removeEventListener("pageshow", onPageShow);
					window.removeEventListener("message", onSnapshot);
					forwards.stopInstance();
				};
			}, "cockpit-bridge: forwards page instance");
			ctx.effect(() => {
				let helloReady = false;
				let disposed = false;
				let running = false;
				let rerunRequested = false;
				let failureCount = 0;
				let flushTimer;
				let retryTimer;
				let lastSelection = currentSelection(ctx.sessions.list.getSnapshot());
				const pending = pendingSource(ctx.uiSession);
				let pendingDirty = pending !== void 0;
				let pendingFingerprint = "";
				const outbox = /* @__PURE__ */ new Map();
				const pendingSnapshot = () => pending?.getSnapshot() ?? [];
				const currentKey = () => {
					const current = currentSelection(ctx.sessions.list.getSnapshot());
					return current === void 0 ? void 0 : current;
				};
				const purgeExpired = (now = Date.now()) => {
					for (const [key, entry] of outbox) if (now - entry.updatedAt >= OUTBOX_TTL_MS) outbox.delete(key);
				};
				const enforceCapacity = () => {
					while (outbox.size > OUTBOX_CAPACITY) {
						const protectedKey = currentKey();
						const oldestNonCurrent = [...outbox.keys()].find((key) => key !== protectedKey);
						outbox.delete(oldestNonCurrent ?? outbox.keys().next().value);
					}
				};
				const enqueue = (current) => {
					const key = current ?? CLEARED_KEY;
					outbox.delete(key);
					outbox.set(key, {
						key,
						...current === void 0 ? {} : { sessionId: current },
						current: current ?? null,
						updatedAt: Date.now()
					});
					purgeExpired();
					enforceCapacity();
				};
				const post = async (path, body, activeConfig) => {
					const controller = new AbortController();
					const timeout = setTimeout(() => {
						controller.abort();
					}, REQUEST_TIMEOUT_MS);
					try {
						return await fetch(`${activeConfig.cockpitOrigin}${path}`, {
							method: "POST",
							headers: {
								"content-type": "application/json",
								[CAPABILITY_HEADER]: activeConfig.capability
							},
							body: JSON.stringify(body),
							signal: controller.signal
						});
					} finally {
						clearTimeout(timeout);
					}
				};
				const clearFlushTimer = () => {
					if (flushTimer !== void 0) clearTimeout(flushTimer);
					flushTimer = void 0;
				};
				const clearRetryTimer = () => {
					if (retryTimer !== void 0) clearTimeout(retryTimer);
					retryTimer = void 0;
				};
				const scheduleRetry = () => {
					if (disposed || config === void 0 || retryTimer !== void 0) return;
					const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(failureCount, 16), RETRY_MAX_MS);
					failureCount += 1;
					retryTimer = setTimeout(() => {
						retryTimer = void 0;
						run();
					}, delay);
				};
				/** Read the structured error code the cockpit returns, when present. */
				const readErrorCode = async (response) => {
					try {
						const body = await response.json();
						return typeof body.code === "string" ? body.code : void 0;
					} catch {
						return;
					}
				};
				const isCapabilityFailure = (status, code) => status === 401 || status === 400 && code === "bridge-capability-invalid";
				const fail = (status, code, activeConfig) => {
					if (activeConfig !== void 0 && isCapabilityFailure(status, code)) {
						helloReady = false;
						try {
							window.parent.postMessage({ type: CAPABILITY_EXPIRED_MESSAGE }, activeConfig.cockpitOrigin);
						} catch {}
					}
					scheduleRetry();
				};
				const run = async () => {
					if (disposed || config === void 0) return;
					if (running) {
						rerunRequested = true;
						return;
					}
					running = true;
					const activeConfig = config;
					let failed = false;
					try {
						if (!helloReady) {
							let response;
							try {
								const current = currentSelection(ctx.sessions.list.getSnapshot());
								response = await post("/api/bridge/hello", {
									version: PLUGIN_VERSION,
									protocolVersion: PROTOCOL_VERSION,
									current: current ?? null
								}, activeConfig);
							} catch {
								failed = true;
								fail(void 0, void 0, activeConfig);
								return;
							}
							if (!response.ok) {
								failed = true;
								fail(response.status, await readErrorCode(response), activeConfig);
								return;
							}
							if (config !== activeConfig) {
								rerunRequested = true;
								return;
							}
							if (disposed) return;
							helloReady = true;
							pendingDirty = pending !== void 0;
							failureCount = 0;
							const current = currentSelection(ctx.sessions.list.getSnapshot());
							if (current !== void 0) enqueue(current);
						}
						if (pendingDirty && pending !== void 0) {
							const items = pendingSnapshot();
							const fingerprint = JSON.stringify(items);
							let response;
							try {
								response = await post("/api/bridge/pending-snapshot", {
									protocolVersion: PENDING_PROTOCOL_VERSION,
									seamVersion: PENDING_SEAM_VERSION,
									items
								}, activeConfig);
							} catch {
								failed = true;
								fail(void 0, void 0, activeConfig);
								return;
							}
							if (!response.ok) {
								failed = true;
								fail(response.status, await readErrorCode(response), activeConfig);
								return;
							}
							if (disposed || config !== activeConfig) return;
							pendingFingerprint = fingerprint;
							pendingDirty = JSON.stringify(pendingSnapshot()) !== fingerprint;
							if (pendingDirty) rerunRequested = true;
							failureCount = 0;
						}
						purgeExpired();
						while (!disposed && config === activeConfig && outbox.size > 0) {
							const entry = outbox.values().next().value;
							let response;
							try {
								response = await post("/api/bridge/session-opened", {
									protocolVersion: PROTOCOL_VERSION,
									...entry.sessionId === void 0 ? {} : { sessionId: entry.sessionId },
									current: entry.current
								}, activeConfig);
							} catch {
								failed = true;
								fail(void 0, void 0, activeConfig);
								return;
							}
							if (!response.ok) {
								failed = true;
								fail(response.status, await readErrorCode(response), activeConfig);
								return;
							}
							if (outbox.get(entry.key) === entry) outbox.delete(entry.key);
							failureCount = 0;
						}
					} catch {
						failed = true;
						scheduleRetry();
					} finally {
						running = false;
						if (rerunRequested && !disposed) {
							rerunRequested = false;
							if (!failed) {
								clearRetryTimer();
								run();
							}
						}
					}
				};
				const requestRun = (delay, recovery) => {
					if (disposed || config === void 0) return;
					if (recovery) {
						failureCount = 0;
						clearRetryTimer();
					}
					clearFlushTimer();
					flushTimer = setTimeout(() => {
						flushTimer = void 0;
						run();
					}, delay);
				};
				const onSelectionChange = () => {
					const current = currentSelection(ctx.sessions.list.getSnapshot());
					if (current === lastSelection) {
						const key = current ?? CLEARED_KEY;
						if (outbox.has(key)) requestRun(FLUSH_DELAY_MS, true);
						return;
					}
					lastSelection = current;
					enqueue(current);
					requestRun(FLUSH_DELAY_MS, true);
				};
				let unsubscribe = () => {};
				let unsubscribePending;
				try {
					pending?.getSnapshot();
					unsubscribe = ctx.sessions.list.subscribe(onSelectionChange);
					unsubscribePending = pending?.subscribe(() => {
						if (disposed) return;
						try {
							if (JSON.stringify(pendingSnapshot()) === pendingFingerprint) return;
							pendingDirty = true;
							requestRun(FLUSH_DELAY_MS, true);
						} catch {}
					});
				} catch {
					disposed = true;
					unsubscribe();
					unsubscribePending?.();
					clearFlushTimer();
					clearRetryTimer();
					return () => {};
				}
				const onMessage = (event) => {
					const nextConfig = parseConfig(event);
					if (nextConfig !== void 0 && (config === void 0 || nextConfig.cockpitOrigin === config.cockpitOrigin)) {
						const firstHandshake = config === void 0;
						config = nextConfig;
						if (firstHandshake) settings.changed();
						requestRun(0, true);
						return;
					}
					if (!isActivation(event, config)) return;
					const current = currentSelection(ctx.sessions.list.getSnapshot());
					if (current !== void 0) enqueue(current);
					pendingDirty = pending !== void 0;
					helloReady = false;
					requestRun(0, true);
				};
				window.addEventListener("message", onMessage);
				return () => {
					disposed = true;
					clearFlushTimer();
					clearRetryTimer();
					unsubscribe();
					unsubscribePending?.();
					window.removeEventListener("message", onMessage);
					outbox.clear();
				};
			}, "cockpit-bridge: reliable current session acknowledgement");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map