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
		//#region src/client/settings.ts
		/**
		* Read-only "驾驶舱转发" settings section (device-forward-registry D9).
		*
		* Lists this device's forward table from the snapshot the cockpit parent page
		* pushes. It offers no create, delete or release control: management happens
		* in the cockpit device panel. Labels and diagnostics are rendered as React
		* text children only, never as HTML.
		*/
		const SECTION_LABEL = "驾驶舱转发";
		const STATE_TEXT = {
			starting: "建立中",
			ready: "就绪",
			retrying: "重试中",
			paused: "暂停"
		};
		/** Pure view model: what the section shows for a handshake state and a
		* snapshot. */
		function settingsView(connected, snapshot) {
			if (!connected) return {
				kind: "message",
				text: "未连接驾驶舱"
			};
			if (snapshot === void 0) return {
				kind: "message",
				text: "正在读取转发表"
			};
			if (snapshot.local === true) return {
				kind: "message",
				text: "本机设备无需转发"
			};
			return {
				kind: "rows",
				usage: `${snapshot.additionalCount} / ${snapshot.limit}`,
				hint: "在驾驶舱设备面板中管理",
				rows: snapshot.rows.map((row) => {
					const address = row.state === "ready" && row.localPort !== void 0 ? `127.0.0.1:${row.localPort}` : "";
					if (row.kind === "system") return {
						key: "system",
						port: String(row.devicePort),
						address,
						state: STATE_TEXT[row.state],
						pinned: "系统",
						holders: "",
						diagnostic: ""
					};
					return {
						key: String(row.devicePort),
						port: String(row.devicePort),
						address,
						state: STATE_TEXT[row.state],
						pinned: row.pinned ? "常驻" : "随持有者",
						holders: [row.label, ...row.holders].filter((value) => value !== void 0 && value !== "").join(", "),
						diagnostic: row.diagnostic ?? ""
					};
				}),
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
		const cell = (text) => (0, react.createElement)("td", null, text);
		function ForwardsSettingsSection(props) {
			const { view, subscribe } = props;
			const current = (0, react.useSyncExternalStore)(subscribe ?? (() => () => {}), view ?? (() => void 0));
			if (current === void 0) return null;
			if (current.kind === "message") return (0, react.createElement)("p", null, current.text);
			return (0, react.createElement)("section", null, (0, react.createElement)("p", null, `附加转发占用 ${current.usage}`), (0, react.createElement)("table", null, (0, react.createElement)("thead", null, (0, react.createElement)("tr", null, ...[
				"设备端口",
				"本地地址",
				"状态",
				"类型",
				"标签 / 持有者",
				"诊断"
			].map((title) => (0, react.createElement)("th", { key: title }, title)))), (0, react.createElement)("tbody", null, ...current.rows.map((row) => (0, react.createElement)("tr", { key: row.key }, cell(row.port), cell(row.address), cell(row.state), cell(row.pinned), cell(row.holders), cell(row.diagnostic))))), (0, react.createElement)("p", null, current.hint));
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