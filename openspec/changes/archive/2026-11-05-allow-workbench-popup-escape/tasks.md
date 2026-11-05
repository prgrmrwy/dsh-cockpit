## 1. 实现

- [x] 1.1 在 `packages/cockpit-web/src/workbench/Workbench.tsx` 中，给工作台 iframe 的 `sandbox` 追加 `allow-popups-to-escape-sandbox`，其余属性与生命周期逻辑保持原样。
- [x] 1.2 在 `packages/cockpit-web/tests/workbench.test.tsx` 中断言 sandbox 令牌集合恰为五个令牌，且不含 `allow-top-navigation`。

## 2. 验证

- [x] 2.1 运行 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`，全部通过。
- [x] 2.2 用真实 Chrome 做双源复现：旧 sandbox 下 `replace` 抛 `SecurityError`，新 sandbox 下跳转成功；并确认构建产物（`packages/cockpit-web/dist`）包含新令牌。

> 验证记录（2026-11-05）：build/typecheck/lint 退出码均为 0；test：web 142、server 368、bridge 54 全部通过。真实 Chrome 双源复现：旧 sandbox 下 `replace` 抛 SecurityError，新 sandbox 下 TARGET 加载。运行中的 3090 已返回含新令牌的 `index-D32bFt6t.js`。
