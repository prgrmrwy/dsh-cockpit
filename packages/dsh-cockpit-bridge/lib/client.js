window.__ModuleLoader__.load({
	id: "dsh-cockpit-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		const inject = ["sessions"];
		const BRIDGE_CONFIG_MESSAGE = "dsh-cockpit:bridge-config";
		const DEVICE_ACTIVATED_MESSAGE = "dsh-cockpit:device-activated";
		const CAPABILITY_EXPIRED_MESSAGE = "dsh-cockpit:capability-expired";
		const CAPABILITY_HEADER = "x-dsh-cockpit-bridge-capability";
		const PLUGIN_VERSION = "0.2.1";
		const PROTOCOL_VERSION = 2;
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
			if (data.type !== BRIDGE_CONFIG_MESSAGE || typeof data.cockpitOrigin !== "string" || typeof data.capability !== "string" || data.capability === "") return;
			try {
				const url = new URL(data.cockpitOrigin);
				if (url.origin !== data.cockpitOrigin || event.origin !== data.cockpitOrigin) return;
				if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return;
			} catch {
				return;
			}
			return {
				cockpitOrigin: data.cockpitOrigin,
				capability: data.capability
			};
		}
		function isActivation(event, config) {
			return config !== void 0 && event.source === window.parent && event.origin === config.cockpitOrigin && typeof event.data === "object" && event.data !== null && event.data.type === DEVICE_ACTIVATED_MESSAGE;
		}
		function apply(ctx) {
			ctx.effect(() => {
				let config;
				let helloReady = false;
				let disposed = false;
				let running = false;
				let rerunRequested = false;
				let failureCount = 0;
				let flushTimer;
				let retryTimer;
				let lastSelection = ctx.sessions.list.getSnapshot().current;
				const outbox = /* @__PURE__ */ new Map();
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
							failureCount = 0;
							const current = ctx.sessions.list.getSnapshot().current;
							if (current !== void 0) enqueue(current);
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
				const onMessage = (event) => {
					const nextConfig = parseConfig(event);
					if (nextConfig !== void 0 && (config === void 0 || nextConfig.cockpitOrigin === config.cockpitOrigin)) {
						config = nextConfig;
						helloReady = false;
						requestRun(0, true);
						return;
					}
					if (!isActivation(event, config)) return;
					const current = ctx.sessions.list.getSnapshot().current;
					if (current !== void 0) enqueue(current);
					helloReady = false;
					requestRun(0, true);
				};
				window.addEventListener("message", onMessage);
				return () => {
					disposed = true;
					clearFlushTimer();
					clearRetryTimer();
					unsubscribe();
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