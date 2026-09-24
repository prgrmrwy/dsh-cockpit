window.__ModuleLoader__.load({
	id: "dsh-cockpit-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const CAPABILITY_EXPIRED_MESSAGE = "dsh-cockpit:capability-expired";
		/** Stable cross-package service name. Changing it is a breaking change. */
		const COCKPIT_EDITOR_OPEN_SERVICE = "cockpitBridge.editorOpen";
		/** Stable cross-package service name for publishing a device-side loopback
		* port to the cockpit host. Changing it is a breaking change. */
		const COCKPIT_PORT_FORWARD_SERVICE = "cockpitBridge.portForward";
		/** Channel ids name one publishable service of a device. Mirrors the server's
		* accepted shape; `workbench` is reserved for the device's own DSH tunnel. */
		const PORT_FORWARD_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
		function isValidPortForwardChannelId(value) {
			return typeof value === "string" && value !== "workbench" && PORT_FORWARD_CHANNEL_PATTERN.test(value);
		}
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
		//#region src/client/index.ts
		const inject = ["sessions", "uiSession"];
		const CAPABILITY_HEADER = "x-dsh-cockpit-bridge-capability";
		const PLUGIN_VERSION = "0.5.0";
		const PROTOCOL_VERSION = 2;
		const PENDING_PROTOCOL_VERSION = 3;
		const PENDING_SEAM_VERSION = 1;
		const FLUSH_DELAY_MS = 250;
		const RETRY_BASE_MS = 500;
		const RETRY_MAX_MS = 3e4;
		const REQUEST_TIMEOUT_MS = 1e4;
		const OUTBOX_TTL_MS = 3e5;
		const OUTBOX_CAPACITY = 32;
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
		function apply(ctx) {
			let config;
			ctx.provide(COCKPIT_EDITOR_OPEN_SERVICE, { open(path) {
				const sshAlias = config?.sshAlias;
				if (sshAlias === void 0) throw new Error("cockpit remote editor is unavailable");
				const uri = createRemoteEditorUri(sshAlias, path);
				window.open(uri, "_blank");
			} });
			/** Second seam, same contract shape as editorOpen: provided immediately,
			* consumer-agnostic, and unavailable-by-throwing so a consumer can fall back
			* to its own loopback address. Unlike editorOpen this one reaches the
			* cockpit server (it creates an ssh forward), so the capability header is
			* mandatory and a rejection is surfaced rather than swallowed. */
			const seamRequest = async (path, body) => {
				const active = config;
				if (active === void 0) throw new Error("cockpit port forward is unavailable");
				const controller = new AbortController();
				const timeout = setTimeout(() => {
					controller.abort();
				}, REQUEST_TIMEOUT_MS);
				let response;
				try {
					response = await fetch(`${active.cockpitOrigin}${path}`, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							[CAPABILITY_HEADER]: active.capability
						},
						body: JSON.stringify({
							...body,
							protocolVersion: PROTOCOL_VERSION
						}),
						signal: controller.signal
					});
				} finally {
					clearTimeout(timeout);
				}
				if (!response.ok) throw new Error(`cockpit port forward rejected (${response.status})`);
				return await response.json();
			};
			ctx.provide(COCKPIT_PORT_FORWARD_SERVICE, {
				async register(channelId, devicePort) {
					if (!isValidPortForwardChannelId(channelId)) throw new Error("invalid channel id");
					if (!isValidDevicePort(devicePort)) throw new Error("invalid device port");
					await seamRequest("/api/bridge/publishable-port", {
						channelId,
						devicePort
					});
				},
				async publish(channelId) {
					if (!isValidPortForwardChannelId(channelId)) throw new Error("invalid channel id");
					const result = await seamRequest("/api/bridge/publish-port", { channelId });
					if (typeof result?.url !== "string" || result.url === "") throw new Error("cockpit returned no forward url");
					return {
						channelId,
						url: result.url
					};
				}
			});
			ctx.effect(() => {
				let helloReady = false;
				let disposed = false;
				let running = false;
				let rerunRequested = false;
				let failureCount = 0;
				let flushTimer;
				let retryTimer;
				let lastSelection = ctx.sessions.list.getSnapshot().current;
				let pendingDirty = ctx.uiSession !== void 0;
				let pendingFingerprint = "";
				const outbox = /* @__PURE__ */ new Map();
				const pendingSnapshot = () => {
					const source = ctx.uiSession?.pendingInteractions.getSnapshot();
					if (source === void 0) return [];
					return [...source.values()].filter((item) => item.kind === "approval" || item.kind === "question").map((item) => ({
						sessionId: item.sessionId,
						kind: item.kind,
						key: item.key
					})).sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.key.localeCompare(right.key));
				};
				const currentKey = () => {
					const current = ctx.sessions.list.getSnapshot().current;
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
								const current = ctx.sessions.list.getSnapshot().current;
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
							helloReady = true;
							pendingDirty = ctx.uiSession !== void 0;
							failureCount = 0;
							const current = ctx.sessions.list.getSnapshot().current;
							if (current !== void 0) enqueue(current);
						}
						if (pendingDirty && ctx.uiSession !== void 0) {
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
							pendingFingerprint = fingerprint;
							pendingDirty = false;
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
					const current = ctx.sessions.list.getSnapshot().current;
					if (current === lastSelection) {
						const key = current ?? CLEARED_KEY;
						if (outbox.has(key)) requestRun(FLUSH_DELAY_MS, true);
						return;
					}
					lastSelection = current;
					enqueue(current);
					requestRun(FLUSH_DELAY_MS, true);
				};
				const unsubscribe = ctx.sessions.list.subscribe(onSelectionChange);
				const unsubscribePending = ctx.uiSession?.pendingInteractions.subscribe(() => {
					if (JSON.stringify(pendingSnapshot()) === pendingFingerprint) return;
					pendingDirty = true;
					requestRun(FLUSH_DELAY_MS, true);
				});
				const onMessage = (event) => {
					const nextConfig = parseConfig(event);
					if (nextConfig !== void 0 && (config === void 0 || nextConfig.cockpitOrigin === config.cockpitOrigin)) {
						config = nextConfig;
						requestRun(0, true);
						return;
					}
					if (!isActivation(event, config)) return;
					const current = ctx.sessions.list.getSnapshot().current;
					if (current !== void 0) enqueue(current);
					pendingDirty = ctx.uiSession !== void 0;
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