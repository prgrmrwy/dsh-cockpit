## Context

见 proposal.md「Why」。现状：`public/icons/` 下三张写实位图（来源不可复现），manifest 只有 192/512 两枚 `any` 图标，`index.html` 用 192 PNG 做 favicon。`public/sw.js` 预缓存图标（URL 固定），所以换图必须 bump `CACHE_VERSION`。

定稿源：本 change 目录的 `icon.svg` 与 `icon-maskable.svg`；评审过程见 `concepts/`（5 个理念方向对比 `sheet.png`、舷窗配色变体 `porthole-colors/`、遮罩与小尺寸实测 `final-check.png`）。

## Goals / Non-Goals

**Goals:** 一枚表达仓库核心理念、16px 可辨识、可维护的矢量图标；补齐 maskable 与 SVG favicon。

**Non-Goals:** 不改应用内 UI（顶栏不加 logo）；不做浅色主题版图标；不引入构建期图片管线依赖。

## Decisions

**1. 主体：舷窗。** 驾驶舱是窗框，窗里是设备自己原生的世界——直接对应「操作面零协议耦合 / 远端零改造」：iframe 承载原生 DSH Web，驾驶舱不代理、不改写。评审过的备选（见 `concepts/sheet.png`）：
- 姿态仪（首版）→ 主题对但缺个性；
- 回环隧道 → 霓虹感强但隐喻读不出；
- 只读雷达 → 语义最全但赛博雷达是常见图式；
- 座舱罩三灯 / 双轨断线 → 前者小尺寸细节丢失，后者太像设置图标。

**2. 风格与配色：Bebop 扁平复古海报，不用应用令牌。** 图标是品牌物，出现在 Dock、标签页、主屏的任意背景上，需要高辨识度暖底；应用内页面颜色仍全部走 `app.css` 令牌，二者不冲突。色板：
- 底 `#F0A92E`（芥末黄）
- 窗框 `#16130F`（暖黑）
- 星空 `#1C3A63`（深海蓝）
- 星球与错位色块 `#3FB6A8` / 暗部 `#2A8C82`（青绿，与黄互补）
- 飞船、星点、星环 `#F4EBD9`（奶油）

红色行星版本经用户评审否决，换为青绿气态巨星（配色变体对比见 `concepts/porthole-colors/`）。

**3. 个性只押一处：窗框倾斜 -7° + 错位色块**，像印刷套色没对准，带出手绘海报感。不加渐变、光晕、描边高光。

**4. 两份 SVG 源。**
- `icon.svg`：圆角方底（rx 112/512），用于 192/512/apple-touch 与 favicon。
- `icon-maskable.svg`：满铺方底，主体整体缩放 0.8 落入中心安全区；已实测圆形与 squircle 遮罩均不裁到窗框。
- 小尺寸：16px 下飞船细节消失，但黄底 + 深窗 + 青绿块仍成立，可接受，不另做简化版。

**5. 出图用 `rsvg-convert`，脚本入库不入构建。** `packages/cockpit-web/scripts/build-icons.sh` 生成全部 PNG；产物 PNG 入库，构建与 CI 不依赖 librsvg。备选 sharp/resvg-js 会增加原生依赖，不值得。

**6. manifest 分开 `any` 与 `maskable` 条目**，避免圆角版被二次裁切。

## Risks / Trade-offs

- [已安装 PWA 图标不立即更新] → bump `CACHE_VERSION` 保证页面内资源更新，必要时重装。
- [manifest `theme_color` 仍为深色，与黄色图标不同调] → 二者职责不同（窗口 chrome vs 品牌图形），保持现状。
- [SVG 内 `clipPath` id 固定为 `w`] → favicon 独立文档无冲突；不得内联进页面 DOM。
