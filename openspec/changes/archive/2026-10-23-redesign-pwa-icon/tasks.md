## 1. 矢量源

- [x] 1.1 将本 change 定稿 `icon.svg` 复制到 `packages/cockpit-web/icons-src/icon.svg`
- [x] 1.2 将本 change 定稿 `icon-maskable.svg` 复制到 `icons-src/icon-maskable.svg`
- [x] 1.3 用浏览器实际渲染复核 16/32px 与 maskable 遮罩（rsvg 实测已通过，见 `concepts/final-check.png`）

## 2. 出图

- [x] 2.1 新增 `packages/cockpit-web/scripts/build-icons.sh`（rsvg-convert 生成 192/512/180/maskable-512，并复制 favicon.svg 到 public/）
- [x] 2.2 运行脚本，替换 `public/icons/` 下 PNG，新增 `icon-maskable-512.png` 与 `public/favicon.svg`

## 3. 接线

- [x] 3.1 manifest 增加 `purpose: "maskable"` 条目，现有条目标 `purpose: "any"`
- [x] 3.2 `index.html` 增加 `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`，PNG favicon 保留作回退
- [x] 3.3 `public/sw.js` 预缓存清单补入新图标并 bump `CACHE_VERSION`

## 4. 验证

- [x] 4.1 `pnpm build && pnpm typecheck && pnpm test && pnpm lint`
- [x] 4.2 刷新 `http://127.0.0.1:3090/` 确认标签页图标、manifest 图标可达、新 SW 接管
