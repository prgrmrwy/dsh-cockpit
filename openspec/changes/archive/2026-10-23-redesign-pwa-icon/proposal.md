## Why

当前 PWA 图标是一张 AI 生成的写实「控制台 + 座椅」插画（PNG 位图，512 版约 330KB）：细节在 16/32px 标签页与 Dock 尺寸下糊成一团，看不出产品的核心理念，也没有矢量源，无法维护或派生 maskable 版本。

## What Changes

- 用**舷窗（porthole）**图标替换现有图标，风格取自 Cowboy Bebop 的扁平复古海报：芥末黄底、微倾的黑色窗框（四角铆钉）、窗后错位的青绿色块，窗内是深蓝星空、奶油色飞船与一颗带环的青绿气态巨星。
- 隐喻对应仓库首要原则**操作面零协议耦合**：驾驶舱只是一扇窗框，窗里是设备自己原生的世界，驾驶舱不改写它。
- 新增入库矢量源 `packages/cockpit-web/icons-src/icon.svg` 与 `icon-maskable.svg`（定稿见本 change 目录同名文件），PNG 由 `rsvg-convert` 从 SVG 派生，提供可重复的生成脚本。
- 重新输出 `icon-192.png`、`icon-512.png`、`apple-touch-icon.png`（180），新增 `icon-maskable-512.png`，并在 `public/` 下提供 `favicon.svg`。
- manifest 增加 `purpose: "maskable"` 条目；`index.html` 增加 SVG favicon 引用（PNG 保留作回退）。
- 图标被 SW 预缓存且 URL 不变，因此 bump `public/sw.js` 的 `CACHE_VERSION`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-pwa`：「可安装性：清单、图标与入口引用」要求补充 maskable 图标、SVG favicon，以及图标在小尺寸下可辨识、由入库矢量源派生的约束。

## Impact

- `packages/cockpit-web/public/icons/*`、`public/favicon.svg`、`public/manifest.webmanifest`、`index.html`、`public/sw.js`（CACHE_VERSION 与预缓存清单）。
- 新增 `packages/cockpit-web/icons-src/` 与生成脚本；生成依赖 `rsvg-convert`（librsvg），仅在重新出图时需要，不进入构建/CI 必经路径。
- 不涉及服务端、连接层、状态聚合与 bridge。已安装的 PWA 需在 SW 更新后（或重新安装）才显示新图标，属浏览器行为。
