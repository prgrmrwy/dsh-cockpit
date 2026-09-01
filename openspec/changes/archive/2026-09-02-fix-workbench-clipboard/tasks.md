## 1. 实现

- [x] 1.1 在 `packages/cockpit-web/src/workbench/Workbench.tsx` 的工作台 iframe 上新增 `allow="clipboard-read; clipboard-write"` 属性；`sandbox`、`src`、`title`、`data-workbench-device` 等现有属性保持不变
- [x] 1.2 复查并确认改动未触及 iframe 懒加载/常驻/卸载/激活通知逻辑（仅属性级变更；git diff 单行新增，ref/src/title/sandbox/onLoad 与 useEffect 逻辑原样）

## 2. 测试

- [x] 2.1 在 `packages/cockpit-web/tests/workbench.test.tsx` 中补充断言：新创建的 iframe 带有预期 `allow` 属性值（懒加载用例中一并断言）
- [x] 2.2 确认既有用例（懒加载、切换保留、禁用销毁、重连跟随新端口等）不回归（vitest 11 个 workbench 用例全绿）

## 3. 验证

- [x] 3.1 `pnpm typecheck` 与 `pnpm lint` 通过（四包全绿）
- [x] 3.2 `pnpm test` 通过（shared 1 + bridge 6 + server 36 + web 49）
- [x] 3.3 `pnpm build` 产出新前端产物（dist 已更新；3090 静态托管按请求读盘，无需重启服务；已确认运行中的 3090 已服务新 bundle，刷新页面即生效）
- [x] 3.4 人工验证：Chrome 136+ 打开 `http://127.0.0.1:3090/`，进入设备工作台，点击 DSH 的复制按钮（消息/代码块），在其它应用粘贴成功；确认离线遮罩、跨设备切换等既有交互无异常（用户已人工验证通过）
