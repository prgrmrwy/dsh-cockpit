# Verification — 2026-11-08

## Root cause

The shared workbench sandbox omitted allow-downloads. The DSH file action returned requested after clicking its Blob anchor, while Chromium rejected the sandboxed download and produced no download record. The same ZIP downloaded correctly in the independent DSH page.

## Browser oracle

A real HTTP parent embedded the actual running DSH GUI and its existing ZIP card. With the original five sandbox tokens: requested feedback, zero download events, and Chromium's explicit missing-allow-downloads rejection. Adding only allow-downloads: one ZIP download, the exact Chinese filename, and byte-for-byte equality with the Host original. No file was repackaged or sent to an external service.

## Windows deployment

Confirmed the running repository from runtime.json as D:\opensource\dsh-cockpit, initially at 449fc9a with a clean worktree. Applied the targeted sandbox, regression and specification changes there. Restored existing locked development dependencies with pnpm 10.23.0, frozen lockfile and install scripts disabled; no dependency declarations or lockfile changed.

The actual Windows Web package passed 161 tests across 13 files, typecheck, lint and production build. Output includes assets/index-FR5AFIq7.js. The existing Windows Cockpit served the new shell; a fresh browser reached the native device iframe and verified its sandbox contains allow-downloads. Additional full-shell automation did not complete its hand-written Session RPC lookup, so it is not reported as another completed ZIP download.

No Cockpit or DSH restart was needed for this frontend repair. Existing user pages must refresh the whole Cockpit shell to create iframes with the updated sandbox; reconnecting only the embedded device does not update the parent DOM attribute.
