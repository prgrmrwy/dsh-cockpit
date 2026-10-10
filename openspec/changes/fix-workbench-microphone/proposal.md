## Why

驾驶舱工作台 iframe 跨源承载设备原生 DSH Web，其 `allow` 属性目前只声明了剪贴板权限，未声明 `microphone`。Permissions Policy 中 `microphone` 的默认 allowlist 是 `self`，顶层驾驶舱文档（`127.0.0.1:3090`）不会自动把麦克风能力委派给跨源 iframe（设备 DSH 位于 `127.0.0.1:<隧道端口>`，端口不同即跨源）。结果是设备 DSH 内的语音输入插件（`dsh-experimental-client-ui-voice-input`）调用 `navigator.mediaDevices.getUserMedia` 时直接抛 `NotAllowedError`，插件把它显示为「麦克风权限未开启，请在浏览器和系统设置中允许访问」——但浏览器既不弹授权框，站点设置里也不留记录，用户无从开启。

用户可观察的对比：直接访问 `http://127.0.0.1:3080` 语音输入正常；只在驾驶舱工作台 iframe 内失效。这与 2026-09-02 剪贴板问题（`archive/2026-09-02-fix-workbench-clipboard`）是同一类缺陷：跨源 iframe 的原生能力被 Permissions Policy 钳制，而驾驶舱尚未显式委派该权限。剪贴板那次只补齐了剪贴板，麦克风（以及未来其它浏览器权限）没有被同等对待。

## What Changes

- 驾驶舱工作台 iframe（`packages/cockpit-web/src/workbench/Workbench.tsx`）的 `allow` 属性增加 `microphone`，即
  `allow="clipboard-read; clipboard-write; microphone"`，使嵌入的 DSH 页面可在跨源 iframe 内请求并使用麦克风。
- `sandbox` 令牌（`allow-scripts allow-same-origin allow-forms allow-popups`）与 iframe 生命周期契约（懒加载、建了不销毁、跨源独立、离线遮罩、单次启动导航）保持不变。
- 边界不变：驾驶舱 MUST NOT 代理、读取、上报或存储麦克风音频或设备页面权限状态；媒体授权与采集全部由浏览器在设备 DSH 页面内直接完成，驾驶舱代码零参与。
- 显式非目标：不新增 `camera`、`geolocation`、`midi` 等其它权限。目前没有证据表明有 DSH 插件需要它们，保持最小授权；确有需求时按同一模式单独评估。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-workbench`：新增一条 Requirement——工作台 iframe 为嵌入的设备原生 DSH 页面委派 `microphone` 权限，使设备 DSH 的语音输入等原生麦克风能力在驾驶舱内不被 Permissions Policy 拦截；同时声明驾驶舱不接触音频流的边界，与既有「工作台 iframe 显式授予剪贴板读写权限」Requirement 并列（不改动该条，也不改动「工作台直接承载远端原生 DSH，零协议耦合」）。

## Impact

- 代码：`packages/cockpit-web/src/workbench/Workbench.tsx`（iframe `allow` 属性，单行级改动）。
- 测试：`packages/cockpit-web/tests/workbench.test.tsx` 中既有 `allow` 断言（现为 `'clipboard-read; clipboard-write'`）需同步为包含 `microphone` 的期望值；现有懒加载/常驻/卸载断言不回归。
- 不涉及：`cockpit-server`（无权限响应头、无新路由）、`dsh-cockpit-bridge`、DSH 远端代码（远端零改造不变量保持）、SW/PWA（无 `sw.js` 改动，`CACHE_VERSION` 不 bump；工作台 iframe 为跨源端口，SW 本就不拦截）。
- 安全面：授权对象是用户自己设备上运行的 DSH 页面，且浏览器仍会以 iframe origin 为单位向用户弹出媒体授权请求（首次使用时）；驾驶舱自身不请求、不读取麦克风，也不缓存授权结果。
- 验证方式：`pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build`（web 包），加真机人工验证（Chrome 打开驾驶舱工作台 → DSH 语音输入可录音；单独访问 3080 行为不变；拒绝授权时插件仍显示原有提示）。
