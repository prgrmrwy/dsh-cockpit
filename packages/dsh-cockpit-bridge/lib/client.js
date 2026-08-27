window.__ModuleLoader__.load({
	id: "dsh-cockpit-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		const inject = ["sessions"];
		const COCKPIT_BASE = "http://127.0.0.1:3090";
		const PLUGIN_VERSION = "0.1.1";
		/** Fire-and-forget report; failures must never disturb the DSH page. */
		async function reportOpen(ctx, sessionId) {
			try {
				if ((await fetch(`${COCKPIT_BASE}/api/bridge/session-opened`, {
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId })
				})).status === 401) {
					await fetch(`${COCKPIT_BASE}/api/bootstrap`, { credentials: "include" });
					await fetch(`${COCKPIT_BASE}/api/bridge/session-opened`, {
						method: "POST",
						credentials: "include",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId })
					});
				}
			} catch {}
		}
		/** Startup hello: stamps bridgeSeenAt in the cockpit so the connection layer
		* is visible in the top bar; 401 → bootstrap first (issues the cookie). */
		async function reportHello() {
			try {
				if ((await fetch(`${COCKPIT_BASE}/api/bridge/hello`, {
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ version: PLUGIN_VERSION })
				})).status === 401) {
					await fetch(`${COCKPIT_BASE}/api/bootstrap`, { credentials: "include" });
					await fetch(`${COCKPIT_BASE}/api/bridge/hello`, {
						method: "POST",
						credentials: "include",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ version: PLUGIN_VERSION })
					});
				}
			} catch {}
		}
		/** Debounce consecutive selection changes (rapid left/right clicks). */
		function schedule(callback) {
			let timer;
			return () => {
				if (timer !== void 0) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = void 0;
					callback();
				}, 250);
			};
		}
		function apply(ctx) {
			let last;
			ctx.effect(() => {
				reportHello();
				const flush = schedule(() => {
					const current = ctx.sessions.list.getSnapshot().current;
					if (current === void 0 || current === last) return;
					last = current;
					reportOpen(ctx, current);
				});
				return ctx.sessions.list.subscribe(flush);
			}, "cockpit-bridge: hello + current session watch");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map