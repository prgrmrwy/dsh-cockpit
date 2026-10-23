# Verification — redesign-pwa-icon

2026-10-23, local checkout, existing production Cockpit at http://127.0.0.1:3090/.

- `pnpm build`: passed.
- `pnpm typecheck`: passed, including a final run after test updates.
- `pnpm test`: passed — root 14, shared 8, server 351, web 107, bridge 54 tests.
- `pnpm lint`: passed after importing URL explicitly from node:url in the new Node test.
- `node --test tests/pwa-icons.test.mjs`: final targeted rerun passed (2 tests).
- `openspec validate redesign-pwa-icon --strict`: passed.
- `bash -n packages/cockpit-web/scripts/build-icons.sh`: passed; regeneration twice produced identical SHA-256 hashes.
- Final local diff review: no blocking findings. Scope is icon sources/outputs, generator, manifest/HTML/SW, and regression tests. No bridge build output changes.

## Browser checks

Used an isolated agent-browser Chromium session against the existing service, without starting or restarting a server. Refreshed the page and checked:

- HTML references PNG fallback and SVG favicon.
- All four PNGs returned HTTP 200 with image/png and dimensions 192x192, 512x512, 512x512 maskable, 180x180 apple-touch.
- SVG favicon returned HTTP 200 with image/svg+xml and decoded through HTMLImageElement. createImageBitmap cannot decode this viewBox-only SVG without raster dimensions in this browser; this was a check-tool limitation, not a broken favicon.
- Service worker controller was activated at /sw.js; CacheStorage contained cockpit-shell-v3 and all manifest/icon resources, including favicon.svg.
- Chromium rendered SVG at 16/32px and maskable PNG under circle and rounded-square CSS masks. Window frame and teal planet remained recognizable, with no clipped foreground. Screenshot: /tmp/cockpit-icon-browser-check.png (local, not committed).
- Temporary visual review overlay removed and isolated browser closed.

## Corrections found during verification

- Existing web test assumed exactly two manifest icons. Updated it to assert the approved three size/purpose pairs.
- New root test needed an explicit node:url import under repository ESLint configuration.

## Boundaries

Browser-native install UI / actual OS Dock icon replacement were not exercised. Browser DOM does not expose the browser-chrome favicon pixels; references, decoded assets, and browser rendering were checked. Existing installed PWAs may refresh their OS icons later or need reinstalling. No changes to device connections, aggregation, or bridge behavior.
