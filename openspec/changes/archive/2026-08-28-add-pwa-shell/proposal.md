# 驾驶舱 PWA：可安装 + 离线壳

## Why

驾驶舱是纯浏览器应用，每次使用都要重新打开、且完全依赖网络；设备状态聚合是只读的「最后已知状态」语义，天然适合断网后仍可查看的壳体验。为它补齐 PWA 能力（可安装到桌面/主屏、断网也能打开壳并显示最后状态）是低成本高感知度的一笔。

## What Changes

- 新增 Web 端 PWA 资源与逻辑，**零新依赖**（不用 `vite-plugin-pwa`，手写 Service Worker，全部逻辑可审）：
  - `public/manifest.webmanifest`：name / `start_url=/` / `display=standalone` / `theme_color` / 192+512 图标；
  - `public/icons/`：512/192/apple-touch-icon(180) PNG；
  - `public/sw.js`：预缓存应用壳（`/`、`index.html`、manifest、图标）；带指纹的 `/assets/*` 缓存优先按需填充；**导航与 `/api/*` GET 网络优先、失败回退缓存**（离线显示最后已知设备状态）；**SSE 事件流（`text/event-stream`）与非 GET 只走网络、绝不缓存**；跨源请求（设备工作台 iframe 的不同 `127.0.0.1:<port>`）不拦截；
  - 更新语义：`CACHE_VERSION` bump 驱动旧缓存清理，`skipWaiting` + `clientsClaim` 自动接管（本 change 不做前台「新版本就绪」提示）；
  - `src/pwa.ts`：**仅生产构建注册** SW（dev 不注册，避免缓存 vite HMR 响应）；
  - `index.html`：manifest link、`theme-color`、`apple-touch-icon`、iOS standalone meta。
- **主题跟随系统**：CSS 颜色全部令牌化并新增 `prefers-color-scheme: light` 覆盖（深色为默认，选择器零改动）；`index.html` 提供 `color-scheme` meta 与按媒体查询的浅/深两枚 `theme-color`；已安装（standalone）窗口的浏览器 chrome 继续取 manifest 静态 `theme_color`（manifest 无媒体查询能力，页面内外观不受影响）。
- `tsconfig.json` 增加 `types: ["vite/client"]`（`import.meta.env` 类型）。
- 新增 PWA vitest 用例（manifest 字段、图标存在性、index.html 标签、SW 策略断言）。
- 服务端无需改动：`useStaticAssets` 已全量托管 dist，vite build 自动复制 `public/`；SW 主脚本更新检查默认绕过 HTTP 缓存。

## Capabilities

### New Capabilities
- `cockpit-pwa`: 驾驶舱 Web 应用的可安装与离线壳能力——manifest/图标/生产注册、壳预缓存与三类 fetch 策略（导航/API 网络优先兜底、资源缓存优先、SSE 只走网络）、跨源隔离、SW 更新语义。

### Modified Capabilities
（无——本 change 新增独立能力，不改动现有三条能力 spec 的任何需求。）

## Impact

- 代码：`packages/cockpit-web/public/`（manifest、sw.js、icons）、`packages/cockpit-web/index.html`、`src/pwa.ts`（新）、`src/main.tsx`、`tsconfig.json`、`tests/pwa.test.ts`（新）、`README.md`。
- 依赖：无新增（仍仅 React + Vite 既有依赖）。
- 兼容：仅影响驾驶舱自身壳；设备 iframe（跨源）与 SSE 不受 SW 拦截；dev 模式行为不变。
- 验证：web typecheck + vitest（20/20）+ build 全绿；运行中 3090 服务实测 `/sw.js`、`/manifest.webmanifest`、图标均 200 可达（静态服务按请求读盘，免重启）。