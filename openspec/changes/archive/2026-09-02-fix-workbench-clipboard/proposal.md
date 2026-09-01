## Why

Chrome 136+ 将 Permissions Policy 中 `clipboard-read` / `clipboard-write` 的默认 allowlist 从 `*` 收紧为 `self`：跨源 iframe 只有显式声明 `allow` 属性才能使用剪贴板 API。驾驶舱（`127.0.0.1:3090`）通过 iframe 承载设备 DSH（`127.0.0.1:<隧道端口>`，端口不同即跨源），其工作台 iframe 未声明任何 `allow`，导致 DSH 页面内 `navigator.clipboard.writeText()` 直接抛 `NotAllowedError`——复制按钮静默失效（`catch { return }`），用户可观察为「车舱里 DSH 不能复制了」。

## What Changes

- 驾驶舱工作台 iframe（`packages/cockpit-web/src/workbench/Workbench.tsx`）新增
  `allow="clipboard-read; clipboard-write"`，使嵌入的 DSH 原生 GUI 在 Chrome 136+
  下恢复剪贴板读写能力。
- 其余不变：不触碰 sandbox 现有令牌（`allow-scripts allow-same-origin allow-forms
  allow-popups`），不新增其它权限。可选话题（`allow-popups-to-escape-sandbox`，
  与下载/弹窗相关）本次不纳入范围，留作后续独立评估。
- 驾驶舱侧行为说明：仅修复 iframe 权限策略对「原生能力」的钳制，不代理、不读取
  剪贴板内容——剪贴板 API 权限由浏览器在 iframe 内直接授予 DSH 页面，驾驶舱代码
  零参与。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-workbench`：新增一条 Requirement——工作台 iframe 为嵌入的 DSH 页面声明
  剪贴板读写权限，保证原生 DSH GUI 的复制/粘贴可用；并补充「驾驶舱不读取剪贴板
  内容」的边界场景。现有「工作台直接承载远端原生 DSH，零协议耦合」的 Purpose 与
  其余 Requirement 不变。

## Impact

- 代码：`packages/cockpit-web/src/workbench/Workbench.tsx`（iframe 增加 `allow`
  属性，单行级改动）。
- 测试：`packages/cockpit-web/tests/workbench.test.tsx` 补充断言，验证渲染出的
  iframe 携带预期 `allow` 值，且不回归现有懒加载/常驻/卸载行为。
- 不涉及：cockpit-server、桥接插件、DSH 远端、SW/PWA 缓存（无 sw.js 改动、
  `CACHE_VERSION` 不变）、设备管理 UI。
- 验证方式：`pnpm typecheck` / `pnpm test` / `pnpm lint`（web 包）；真实浏览器里
  打开驾驶舱工作台验证 DSH 复制按钮可写入剪贴板。
