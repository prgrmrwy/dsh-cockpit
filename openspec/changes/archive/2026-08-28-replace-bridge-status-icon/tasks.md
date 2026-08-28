## 1. 图标组件

- [x] 1.1 新增 `BridgeIcon` 组件测试：两种形态各自渲染 `data-bridge-icon="connected" | "disconnected"`、使用 `currentColor` 描边、共享同一 `viewBox` 与外框尺寸
- [x] 1.2 实现 `BridgeIcon` 内联 SVG 组件：完整链条与断开链条两种路径，接受 `size` 参数，零运行时依赖

## 2. 顶栏接入

- [x] 2.1 更新 `topbar.test.tsx`：已连接显示 connected 图标、未安装显示 disconnected 图标、非 READY/DEGRADED 且无 `bridgeSeenAt` 时不显示标记，并保留可访问名称、hover 说明与 `data-bridge-hint="missing"`
- [x] 2.2 用 `BridgeIcon` 替换 `TopBar.tsx` 中两处 `⛓` 字符，保持既有 title、`aria-label` 与数据标记不变

## 3. 样式与视觉契约

- [x] 3.1 调整 `.bridge-mark` / `.bridge-hint` 为 14px 等尺寸盒子（`inline-flex` + 固定宽高 + `flex: none`），保留 accent / dim 颜色令牌与弱提示不透明度
- [x] 3.2 扩展样式契约测试：两类标记尺寸一致、颜色走令牌、无写死主题色

## 4. 验证与验收

- [x] 4.1 运行受影响包测试并修复回归，再运行根目录 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`
- [x] 4.2 运行 `openspec validate replace-bridge-status-icon --strict`
- [x] 4.3 构建后刷新现有 `http://127.0.0.1:3090/`，产物层面已确认（emoji 归零、两种形状标记就位、等尺寸盒子生效）；**图标观感与两态辨识度待用户人眼确认**
- [x] 4.4 更新任务状态与验证证据；完成后提示使用 OpenSpec archive 流程

## 验证证据

- `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 全绿：shared 1、server 34、web 42、bridge 6。
- 新增 web 用例 8 条：`bridge-icon.test.tsx` 6 条（形状标记、`currentColor`、共享 viewBox 与外框、两态图形不同、size 参数、装饰性 `aria-hidden`），`topbar.test.tsx` 1 条（两态形状区分、emoji 消失、未知态不渲染、盒子一致、可访问名称与 `data-bridge-hint` 保留），`styles.test.ts` 1 条（共享盒子规则、颜色走令牌、无写死主题色）。
- `openspec validate replace-bridge-status-icon --strict` valid。
- 运行中 3090 实测：页面加载 `index-Bfi7fVSf.js` / `index-B0sXPYUs.css`；JS 产物中 `⛓` 出现 0 次，`data-bridge-icon` 与 connected/disconnected 两种形态均存在；CSS 中 `.bridge-mark,.bridge-hint` 共享 `width:14px;height:14px;flex:none`。
- 已知观察：`bridgeSeenAt` 为进程内存状态，受管 cockpit 重启后被清空，需各设备 DSH 页面再次上报 hello 才恢复；因此重启直后两台设备均显示断链图标属预期行为，非本次改动引入。
- 待人工确认：深浅主题下的对比度与两态辨识度。

## 图形修正记录（用户反馈后）

初版两种图标的路径坐标是手写臆造且**从未实际渲染验证**，用户指出「连接态反而像断开」。用 `rsvg-convert` 实际渲染确认属实：初版 connected 的两个钩子分离、中间斜线未接合，视觉上就是断链。

修正方案：改用业界通行的水平链条几何（Feather link-2，MIT），两态**共用同一段链条主体**，仅「中间横杠」有无决定语义——有横杠即链路贯通（已连接），无横杠即中间缺口（未连接）。尺寸按用户要求从 14px 提升到 16px。

修正后已按真实 16px 渲染复核：连接态横杠贯通、未连接态留缺口，两者一眼可分。教训：图标类改动必须实际渲染查看，不能只凭路径数据判断。
