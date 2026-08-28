## 1. 共享契约与服务端

- [x] 1.1 更新共享契约测试，断言 `DeviceStatusFacts` 不再包含 `outcomeUnknownCount`，再从 `packages/shared/src/index.ts` 移除该字段
- [x] 1.2 移除 `connectivity.service.ts` 中硬编码的 `outcomeUnknownCount` 输出，并确认删除门禁与最小诊断行为不变
- [x] 1.3 补服务端测试：未确认删除不改注册表且返回 `requiresConfirmation`，确认删除后停止连接并移除记录

## 2. Web 删除确认

- [x] 2.1 先补 `DevicePanel` 测试：确认后以 `confirmed: true` 删除、取消时完全不发请求、删除失败在该行显示错误
- [x] 2.2 为 `DevicePanel` 增加默认走 `window.confirm` 的可注入确认入口，改为无条件确认并移除对计数的依赖
- [x] 2.3 移除 `TopBar.tsx` 的 `data-outcome-unknown` 输出，并清理各测试夹具中的 `outcomeUnknownCount`

## 3. 验证与验收

- [x] 3.1 运行受影响包测试并修复回归，再运行根目录 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`
- [x] 3.2 运行 `openspec validate remove-outcome-unknown-counter --strict`
- [x] 3.3 重启受管 cockpit 后在现有 `http://127.0.0.1:3090/` 验证：真实设备删除取消不删除；隔离实例中假设备确认删除生效
- [x] 3.4 更新任务状态与验证证据；完成后提示使用 OpenSpec archive 流程

## 验证证据

- `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 全绿；shared 需先 build 再 typecheck（server 经 `dist/*.d.ts` 解析共享类型）。
- 测试：shared 契约 1、server 34（含未确认删除保留注册表、确认删除移除记录与 lifecycle、事实不含计数）、web 34（含取消删除零请求、确认后 `confirmed: true`、默认 confirm 含设备名、删除失败行内报错）。
- `openspec validate remove-outcome-unknown-counter --strict` 与 `redesign-device-management-panel --strict` 均 valid。
- 运行中 3090 实测：设备事实不再包含 `outcomeUnknownCount`；隔离 `DSH_COCKPIT_HOME` 实例中，未确认 DELETE 返回 `{"removed":false,"requiresConfirmation":true}` 且注册表不变，`?confirmed=true` 返回 `{"removed":true,...}` 并进入空状态。
- 真实设备 host / lumevm 全程未被删除或改名，验证后均恢复为 READY。
