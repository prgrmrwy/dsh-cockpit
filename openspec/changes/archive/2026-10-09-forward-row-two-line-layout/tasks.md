> 依 design D1–D3：先写结构断言（红），再改渲染，最后收尾验证。

## 1. pid 下移到次行（design D1）

- [x] 1.1 Write failing test: `puts the pid on the second line for every kind of row` in `packages/cockpit-web/tests/forward-panel.test.tsx`（已确认改前为红：`expected '3080127.0.0.1:51000就绪主通道pid 7001' not to contain 'pid'`）—— 断言 system 行与附加行的 `.forward-row-main` 都不含 `pid`，两行的 `.forward-row-meta` 都含自己的 pid
- [x] 1.2 Implement: `ForwardList.tsx` 把 `pid` 从摘要行移到次行，次行的渲染条件改为「附加条目或有 pid 的就绪条目」to pass 1.1

## 2. 次行无内容不渲染（design D1）

- [x] 2.1 Write failing test: `renders no second line when there is nothing to put on it` in `packages/cockpit-web/tests/forward-panel.test.tsx`（该用例**改前即绿**：旧实现里 system 行根本没有次行；它是防止「把 pid 下移时给非就绪行留空行」的护栏，非红转绿用例）—— 一台远端设备的主通道处于 retrying（无 pid）时，system 行没有 `.forward-row-meta`，且不含 pid 文本
- [x] 2.2 Implement: 次行的渲染条件收紧到「有内容才渲染」，确保非就绪 system 条目不出现空行 to pass 2.1

## 3. 收尾验证

- [x] 3.1 Refactor; `npx vitest run` 全绿 —— 107 passed；既有 `textContent` 类断言跨行仍成立，未删任何断言
- [x] 3.2 `pnpm build && pnpm typecheck && pnpm lint && pnpm test` —— exit=0：shared 8+12 / bridge 50 / web 107 / server 332
- [x] 3.3 真机核对（`/tmp/cockpit-shots/row2-{dark,light,narrow}.png`）：真机 DOM 读取 system 行 `main=3080 127.0.0.1:54695 就绪 主通道` / `meta=pid 89336`，附加行 `main=6379 127.0.0.1:52591 就绪 常驻` / `meta=pid 8331 | redis | 持有者 0`；深/浅/窄三张截图一致，窄屏 `scrollWidth === innerWidth === 390`；临时 6379 条目已删除（回到 0/8）
- [x] 3.4 `openspec validate forward-row-two-line-layout --strict` —— valid（归档前复跑仍为 valid）
