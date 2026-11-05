## Why

升级后的 DSH 新增了浏览器登录：点击时同步预开一个 `about:blank` 标签页并断开 `opener`，拿到 Host 返回的授权地址后再调 `popup.location.replace(...)` 跳转。驾驶舱工作台 iframe 的 `sandbox` 缺少 `allow-popups-to-escape-sandbox`，弹出的标签页会继承沙箱。Chrome 因此拒绝 iframe 对它的后续导航（`SecurityError`），结果是在驾驶舱里登录时新标签页一直停在 about:blank，而单独打开 DSH 时登录是正常的。2026-11-05 已用真实 Chrome 在双源最小页面上复现，加上该令牌后跳转成功。

## What Changes

- 在工作台 iframe 的 `sandbox` 令牌中新增 `allow-popups-to-escape-sandbox`，其余令牌（`allow-scripts allow-same-origin allow-forms allow-popups`）保持不变。
- 结果：从工作台打开的新标签页成为不受 iframe 沙箱约束的普通顶层页面，行为与单独打开设备 DSH 时一致，包括 DSH 登录这类「先预开、后导航」的流程，以及 PDF 查看、外链等新标签页。
- 不改变 iframe 本身的沙箱，不新增 `allow-top-navigation`、`allow-modals`、`allow-downloads` 等其它令牌，也不改 `allow`（Permissions Policy）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-workbench`：新增 requirement「工作台弹出的新标签页不继承 iframe 沙箱」，把 sandbox 令牌集合定为显式契约（此前归档 change 把该令牌留作后续独立评估，本 change 即这次评估）。

## Impact

- 代码：`packages/cockpit-web/src/workbench/Workbench.tsx`（iframe 的 `sandbox` 属性）以及 `packages/cockpit-web/tests/workbench.test.tsx`（断言 sandbox 令牌集合）。
- 不涉及服务端、bridge、PWA/SW（`sw.js` 行为不变，无需 bump `CACHE_VERSION`）或远端 DSH。
- 前端产物重新构建后刷新页面即可生效。
