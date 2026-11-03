## Why

设备 DSH Host 重启前后，工作台 iframe 可能恰好在隧道或 Host 不可用的窗口里完成一次导航，留下 `ERR_CONNECTION_RESET` 错误页（整页空白）。父页面无法观察跨源 iframe 的成败，这一 tuple 被记为“已尝试、结果未知”，按现行规范不会自动重试；而用户能点的“重连当前设备”（顶栏 ↻、菜单项、离线遮罩按钮）只重建服务端连接，隧道通常复用同一本地端口、auth generation 也不变，tuple 不变，所以 iframe 永远不再导航。现行规范写着“用户可明确重试”，但对“导航结果不可观测”的状态界面上没有任何重试入口，用户只能整页刷新驾驶舱。2026-11-03 在 wsl 设备上实际复现。

## What Changes

- 用户显式触发“重连当前设备”（顶栏 ↻、顶栏菜单“刷新状态”、离线遮罩的重连按钮）时，除重建连接外，同时把当前设备工作台视为一次**用户明确重试**：清除该设备当前 tuple 的已尝试记录，待设备回到 `READY`/`DEGRADED` 后重新请求一次启动并导航一次。typert 与 rc.2 设备一致（rc.2 的启动结果即干净 endpoint）。
- 顶栏 ↻ 的提示文案由“重连当前设备”改为“重连并重新加载当前设备”；顶栏菜单里同一动作的菜单项（现写死为“刷新状态”，实际执行的就是重连）改用同一文案，让用户知道点击会重新加载设备页面。
- 服务端在每次工作台启动成功或失败时写一条诊断日志（设备 ID、协议类型、auth generation、结果/错误码），**不含** token、tokenized URL 或 cookie，便于定位“哪次加载落进了空窗”。
- 不改变任何自动行为：同一 tuple 仍只自动尝试一次，iframe load / SSE / 重渲染仍不触发重试。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-workbench`：新增“用户重连即明确重试当前设备工作台”的要求，补上“导航结果不可观测”状态缺失的重试入口；启动诊断日志属于既有“token 不得进入日志”约束下的新增可观察行为。

## Impact

- `packages/cockpit-web/src/main.tsx`：`reconnectCurrent` 在用户触发时向 Workbench 发出一次针对当前设备的重载请求。
- `packages/cockpit-web/src/workbench/Workbench.tsx`：接收重载请求并复用既有 `retryLaunch` 路径。
- `packages/cockpit-web/src/components/TopBar.tsx`：↻ 文案（由 `main.tsx` 传入的 `onRefreshLabel`）。
- `packages/cockpit-server/src/connectivity/connectivity.service.ts`：`workbenchLaunch` 结果日志。
- 测试：`packages/cockpit-web/tests/workbench.test.tsx`、`app.test.tsx`、`topbar.test.tsx`，服务端 launch 相关测试。
- 无 API、协议、数据目录或远端改动；不需要重启远端设备。
