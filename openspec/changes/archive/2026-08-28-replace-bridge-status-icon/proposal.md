## Why

顶栏的桥接状态标记目前是 12px 的 emoji 字符 `⛓`。它在多数系统字体下渲染得又细又窄，容易被误读成暂停符号「‖」，看不出「链接」语义；而且已连接与未安装两种状态**共用同一个字符**，只靠颜色和透明度区分，在浅色主题、色觉障碍或小尺寸下几乎无法分辨。

同时 `openspec/specs/` 中完全没有关于该标记的需求，它只存在于代码与 README，属于规范缺口。

## What Changes

- 用内联 SVG 图标替换 emoji 字符，图标语义明确为「链接」，并放大到可辨认尺寸。
- **两种状态用不同形状区分**，不再仅依赖颜色：
  - 已检测到桥接（`bridgeSeenAt` 有值）：完整闭合的链条图标。
  - 未检测到桥接（READY/DEGRADED 但无 `bridgeSeenAt`）：断开的链条图标，保持弱提示的视觉权重。
- 图标描边使用 `currentColor`，颜色继续由现有主题令牌驱动，深浅主题自动适配；不引入图标库、不新增运行时依赖、不新增网络请求。
- 保留现有交互与信息：hover title（已连接显示时间、未安装指向 README 安装章节）、`aria-label`、`data-bridge-hint="missing"` 标记均不变。
- 顶栏 tab 的尺寸与布局不得因换图标而跳变。
- 新增该标记的规范需求，补上现有缺口。
- 不改变桥接插件协议、`bridgeSeenAt` 的产生方式或任何连接层行为。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `cockpit-device-shell`: 新增顶栏桥接状态标记的呈现要求（链接语义图标、两态形状区分、主题适配、无布局跳变）。

## Impact

- Web UI：`packages/cockpit-web/src/components/TopBar.tsx`、新增图标组件文件、`packages/cockpit-web/src/styles/app.css` 的 `.bridge-mark` / `.bridge-hint` 尺寸规则。
- 测试：`packages/cockpit-web/tests/topbar.test.tsx` 与样式契约测试。
- 共享类型、服务端、桥接插件与远端 DSH 协议均不变；无新增依赖。
