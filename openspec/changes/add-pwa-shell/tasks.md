# Tasks: 驾驶舱 PWA（可安装 + 离线壳）

> 本 change 为**已完成工作的补录**：下列任务在 2026-08-28 已全部实施并验证，
> 此处如实记录为完成状态。

## 1. 图标与清单

- [x] 1.1 生成驾驶舱图标并落地 `public/icons/`：512、192、apple-touch-icon(180) 三种 PNG（原图不入产物）
- [x] 1.2 编写 `public/manifest.webmanifest`：name/short_name/description/lang、`start_url=/`、`scope=/`、`display=standalone`、`background_color`/`theme_color`（#101214，对齐应用主题）、192/512 图标
- [x] 1.3 `index.html` 增加：manifest link、`theme-color`、`apple-touch-icon`、iOS standalone meta（apple-mobile-web-app-*）、viewport-fit=cover

## 2. Service Worker（`public/sw.js`，零依赖手写）

- [x] 2.1 `install`：预缓存壳入口（`/`、`index.html`、manifest、图标，逐项容错）+ `skipWaiting()`
- [x] 2.2 `activate`：清理非当前 `CACHE_VERSION` 缓存 + `clientsClaim()`
- [x] 2.3 `fetch` 策略：导航与 `/api/*` GET 网络优先 + 缓存兜底（API 兜底仅存最后一次成功响应）；`/assets/*` 缓存优先按需填充；SSE（`text/event-stream`）与非 GET 只走网络；跨源请求（设备 iframe）不拦截

## 3. 前端接入与类型

- [x] 3.1 新增 `src/pwa.ts`：`import.meta.env.PROD` 门控注册 `/sw.js`，失败仅告警
- [x] 3.2 `src/main.tsx` 引入注册；`tsconfig.json` 补 `types: ["vite/client"]`（`import.meta.env` 类型）

## 4. 测试、文档与验证

- [x] 4.1 新增 `tests/pwa.test.ts` 四用例：manifest 字段 / 清单图标存在性 / index.html 标签 / SW 离线策略断言
- [x] 4.2 README 增加 PWA 小节（能力说明 + `CACHE_VERSION` bump 约定）
- [x] 4.3 验证：web typecheck 绿、vitest **20/20**、vite build 绿；运行中 3090 服务实测 `/sw.js`、`/manifest.webmanifest`、`/icons/*` 均 200 且 Content-Type 正确

## 5. 主题跟随系统（补录，已完成）

- [x] 5.1 `app.css`：颜色全部令牌化（新增 `--bg-hover`/`--bg-active`/`--overlay`），`@media (prefers-color-scheme: light)` 覆盖整组令牌并切换 `color-scheme`；选择器中不再出现写死的主题色值
- [x] 5.2 `index.html`：`color-scheme: light dark` meta + 按媒体查询的浅/深 `theme-color`（#f6f8fa / #101214）；manifest 静态 `theme_color` 保留（standalone 窗口 chrome 用）
- [x] 5.3 `tests/pwa.test.ts`：主题断言更新（color-scheme + 媒体变体）
- [x] 5.4 验证：web typecheck + vitest 全绿、vite build 绿；3090 实测页面与 meta 更新生效
- [x] 5.5 `sw.js`：导航成功响应回写缓存（离线壳与最近部署同步，避免主题等变更对离线用户不生效），`CACHE_VERSION` bump 至 v2 并实测 `/sw.js` 可达