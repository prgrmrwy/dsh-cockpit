## Context

驾驶舱 Web 端是 Vite/React 构建的纯浏览器壳（`packages/cockpit-web`），由 NestJS 在 `127.0.0.1:3090` 以 `useStaticAssets` 全量托管 dist；`127.0.0.1` 属 secure context，PWA 安装前提天然满足。状态聚合依赖同源 `/api/*`（含一条常驻 SSE 事件流），设备工作台是跨源 iframe（其它 `127.0.0.1:<port>`）。动机见 proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- 零新依赖：可安装 + 离线壳全部用手写静态资源与少量 TS 实现，不引入构建插件
- 离线兜底严格对齐既有语义：「不假装实时」——离线只回退最后已知状态
- 缓存边界清晰：SSE 与跨源 iframe 绝不进缓存

**Non-Goals:**
- 前台「新版本就绪，点击刷新」提示（本 change 用自动接管；提示体验留作后续）
- 离线时设备工作台可用（跨源端口不可预测且属设备侧，驾驶舱不接管）
- 推送通知、后台同步

## Decisions

### D1: 手写 Service Worker，不用 vite-plugin-pwa

SW 放 `public/`（vite build 原样复制），注册逻辑 20 行手写。

- Alternatives: `vite-plugin-pwa`（workbox 封装，自动指纹清单、自动清理）。
- Choice: 手写。理由：仓库零新依赖原则（pnpm 安装需网络且引入黑盒构建链）；本应用壳很小（一个 HTML + 几个指纹资源），workbox 的自动清单/自动清理收益可被 20 行 `CACHE_VERSION` + `activate` 清理替代。代价：SW 内不含指纹资产清单，靠"D1a"策略弥补。

### D1a: 指纹资产按需缓存，而非预缓存清单

预缓存只写死壳入口（`/`、`index.html`、manifest、图标）；`/assets/*` 带哈希文件名不可预知，交给 fetch 阶段**缓存优先 + 按需填充**。首次在线访问会把页面引用的资产全部入缓存；此后离线可用。

- Alternatives: 构建时注入资产清单（需要构建脚本改写 SW 或引入插件）。
- Choice: 按需填充。理由：哈希文件内容不可变，缓存优先是安全策略；避免每次构建改 SW。

### D2: 三类 fetch 策略 + 两条硬排除

- **导航 / `/assets/*`**：导航网络优先（在线拿最新 HTML 与其当前指纹引用），**成功响应回写缓存**（离线壳始终与最近一次部署一致，主题等部署变更对离线用户在下一次在线刷新后生效），离线回退缓存壳；指纹资源缓存优先。
- **`/api/*` GET**：网络优先，失败回退最后一次缓存响应——离线仍显示最后已知设备状态，配合 UI 既有的「最后更新/离线」标注。
- **硬排除 1：SSE**（`Accept: text/event-stream`）只走网络——缓存一条流等于缓存死流，会静默杀死状态聚合；EventSource 自身有重连语义，SW 不得插手。
- **硬排除 2：跨源**（设备 iframe 的其它 `127.0.0.1:<port>`）不拦截——工作台请求不进驾驶舱缓存。
- 非 GET（bootstrap/reconnect/ack 等写操作）一律只走网络，不缓存不应答。

### D3: 仅生产注册

注册入口在 `src/pwa.ts`，以 `import.meta.env.PROD` 门控；dev（vite 5173）不注册，避免 SW 缓存 HMR 响应导致改代码不生效。`tsconfig.json` 补 `types: ["vite/client"]` 提供 `import.meta.env` 类型。

### D4: 更新语义 = `CACHE_VERSION` bump + 自动接管

新版本变更策略行时手工 bump `CACHE_VERSION`；`install` 里 `skipWaiting()`、`activate` 里删除其它版本缓存 + `clientsClaim()`——部署后下次刷新即整体切换，无残留旧缓存。不做前台提示（Non-Goal），把「提示体验」留给后续 change。

### D5: 服务端零改动

`useStaticAssets` 已全量托管 dist（按请求读盘，重建即生效，免重启）；SW 主脚本的更新检查默认绕过 HTTP 缓存，无需调整响应头。manifest、sw.js、图标的 Content-Type 由 express static 按扩展名正确给出（实测 `application/manifest+json`、`text/javascript`、`image/png`）。

### D6: 主题跟随系统：令牌双套 + 媒体查询，manifest 静态色保留

页面颜色全部收敛为 `:root` 令牌（深色默认，含新增 `--bg-hover`/`--bg-active`/`--overlay`），`@media (prefers-color-scheme: light)` 只覆盖整组令牌（并切换 `color-scheme`），所有选择器零改动；新增颜色必须走令牌。浏览器标签栏 chrome 用按媒体查询的两枚 `theme-color` meta（浅 `#f6f8fa` / 深 `#101214`）+ `color-scheme: light dark` 声明。manifest 的 `theme_color`/`background_color` 保持静态深色——manifest 无媒体查询能力，standalone 窗口 chrome 取 manifest 值，此为已知限制；页面内外观与在浏览器内打开的场景均已跟随系统。

- Alternatives: JS 运行时主题切换/手动开关（需持久化与 Toggle UI，超出本 change 范围）；CSS `light-dark()`（需在每个使用点写双值，令牌方案更贴合现有结构）。
- Choice: 令牌 + 媒体查询。理由：改动最小、跟随系统语义天然、无 JS 状态，与仓库「不发明映射、不新增设置面」的风格一致。

## 测试与验证

- `tests/pwa.test.ts`：manifest 字段与图标存在性、index.html 标签、SW 策略关键断言（SSE 不缓存、跨源不拦截、导航/API 网络优先）。
- 实测：web typecheck + vitest 20/20 + build 全绿；运行中 3090 服务直接拉取 `/sw.js`、`/manifest.webmanifest`、图标均 200。