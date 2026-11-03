## 1. 连接代次进入状态快照（D1）

- [x] 1.1 在 `packages/shared` 的 `DeviceStatusFacts` 新增 `connectionGeneration: number`，并由 `DeviceLifecycle` 的事实生成填入 `connectionGeneration()`（本机设备同样适用）。验证：`tests/device-lifecycle.test.ts` 新增用例，断言 `reconnect()` resolve 后发出的事实中 `connectionGeneration` 严格大于调用前，且该事实为 `CONNECTING`、无 endpoint；`pnpm --filter cockpit-server typecheck` 通过。
- [x] 1.2 修正所有构造 `DeviceStatusFacts` 的测试夹具与 Web 侧 mock，使三包 `pnpm typecheck` 通过。

## 2. 启动诊断日志（D5）

- [x] 2.1 `ConnectivityService.workbenchLaunch` 在成功（debug）与失败（warn）时各写一行 `device/protocol/authGeneration/result`；失败只取 `WorkbenchLaunchError.code`，其它异常记 `error`，不输出 message。验证：`tests/connectivity.service.test.ts` 新增用例，捕获 Logger 输出，断言包含设备 ID 与结果码，且不包含 token、tokenized URL 的查询串或 cookie 名。

## 3. Web：用户重连登记重试（D1–D3）

- [x] 3.1 重连接口响应增加 `connectionGeneration`，值为服务端重连返回时的代次 Gn（`ConnectivityService.reconnectDevice` 返回它，controller 透传，Web `api.reconnectDevice` 类型同步）。`App.reconnectCurrent` 在接口成功后向 Workbench 传入登记 `{deviceId, minGeneration: Gn, nonce}`，接口失败时不登记。验证：server 测试断言返回值大于调用前的代次；`tests/app.test.tsx` 断言成功后发生一次重新启动、失败时不发生。
- [x] 3.2 Workbench 接收登记，只在该设备满足 `connectionGeneration ≥ Gn`、`READY/DEGRADED` 且有 endpoint 时执行一次重试：清除该设备全部已尝试 tuple、待处理导航、deadline、launchTarget，重新运行启动 effect，然后撤销登记；不改 `hasNavigated`。设备移出时清除登记。验证：`tests/workbench.test.tsx` 新增以下用例：
  - (a) `unobservable` 且 tuple 不变 → 登记并推进代次、回到 READY → `requestWorkbenchLaunch` 恰好多调用 1 次，iframe 被赋值 1 次；
  - (b) 登记后快照仍是旧代次（< Gn）的 READY → 不调用启动；
  - (c) 代次推进但处于 CONNECTING → 不调用，转为 READY 后才调用；
  - (d) 执行后重复 SSE、load、切换设备再切回 → 不再调用；
  - (e) 两台设备时只重载当前设备；
  - (f) 重试的启动失败 → 显示既有失败遮罩，不自动再请求；
  - (g) 代次始终 < Gn（例如驾驶舱服务端重启后计数归零）→ 不触发；
  - (h) rc.2（返回干净 URL）同样只导航一次。
- [x] 3.3 ↻ 的 `onRefreshLabel` 改为“重连并重新加载当前设备”，TopBar 菜单项改用 `onRefreshLabel ?? '刷新状态'`。验证：`tests/topbar.test.tsx` 断言按钮与菜单项文案一致；不传 label 时菜单仍为“刷新状态”。

## 4. 规范、文档与整体验证

- [x] 4.1 若 README 中有 ↻ 行为或驾驶舱日志内容的描述，同步更新；`CHANGELOG.md` 增加条目。验证：`rg "重连当前设备"` 无遗留旧文案（测试除外）。
- [x] 4.2 运行 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`，全部通过；`openspec validate reload-workbench-on-reconnect --strict` 通过。
- [ ] 4.3 部署到本机驾驶舱（`bin/cockpit build` + `restart`）并手工复现：在 wsl 设备上执行 `dsh restart`，若工作台白屏，点击 ↻ 后应恢复，无需整页刷新；`cockpit.log` 中出现对应的启动日志行，且其中不含 token。验收记录写入本 change 的 tasks 备注。
  - 2026-11-04 进度：已 `pnpm build` 并 `node bin/cockpit restart --no-open`（新 PID 13892）；`/api/devices` 已返回各设备 `connectionGeneration`。待用户刷新驾驶舱页面加载新前端，再在 wsl 上点击 ↻，验收「只重载一次」和日志行。白屏本身无法按需复现，没有用 `dsh restart` 强行制造（会断开当前会话）。
