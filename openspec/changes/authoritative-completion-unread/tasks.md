> 依 design D1–D4：先让 bridge 上报官方状态（含协议与测试），再让服务端分流（权威优先、推导回退），最后收尾验证与发包。每步先写失败测试，再实现。

## 1. bridge：官方状态快照上报（design D2）

- [x] 1.1 Write failing test: `reports the official per-session running and completionUnread booleans` in `packages/dsh-cockpit-bridge/tests/client.test.ts` —— 用 0.2.0 形状的 `uiSession.sessionStatus` 夹具断言上报体只含 `sessionId` / `running` / `completionUnread`，官方标记翻转后随下一次快照更新，且不含任何交互或会话内容
- [x] 1.2 Implement: `src/client/index.ts` 从既有 `sessionStatus` 观察源派生状态快照，走新的上报端点（复用 capability、指纹去重、有界重试、激活/hello 恢复），协议版本递增 to pass 1.1
- [x] 1.3 Write failing test: `keeps the status snapshot silent when the observable is absent`（改前即绿的护栏：旧实现根本不发该通道）（旧 DSH / 无该观察源时不上报、不伪造空快照）
- [x] 1.4 Implement: 缺失来源时的静默分支 to pass 1.3
- [x] 1.5 Refactor; `packages/dsh-cockpit-bridge` 全绿 —— 53 passed

## 2. 服务端：权威优先、推导回退（design D1、D3、D4）

- [x] 2.1 Write failing test: `shows the official unread set even when the cockpit never observed the completion edge` in `packages/cockpit-server/tests/device-lifecycle.test.ts` —— 官方快照含一个 `completionUnread` 的根会话且驾驶舱刚启动（无完成边缘）时，`sessionStatuses` 仍含 `completed ×1`
- [x] 2.2 Implement: 接收并缓存官方快照（设备级世代、陈旧帧丢弃），有快照时以官方标记判定完成未读 to pass 2.1
- [x] 2.3 Write failing test: `keeps the run-round model for a device without the official snapshot`（改前即绿的回归护栏） —— 同一设备从未上报官方快照时，`running → idle` 边缘照旧产生提醒（回归保护）
- [x] 2.4 Write failing test: `does not restore a manually cleared reminder until the official flag flips` —— 清除后官方标记未翻转的快照不得让提醒跳回来；标记 false→true 或会话重新运行后解除抑制
- [x] 2.5 Implement: 手动清除的抑制状态与解除条件 to pass 2.4
- [x] 2.6 Write failing test: `ignores subagent sessions in the official snapshot` —— 官方快照里的子代理会话不进入根会话计数
- [x] 2.7 Refactor; `packages/cockpit-server` 全绿 —— 341 passed（含 HTTP 通道 `bridge/status-snapshot` 的校验/去重/裁剪/丢弃多余字段测试，与「官方模式下选择上报不清官方标记」「重连后回退」两条补充用例）

## 2b. 路由白名单（真机暴露的遗漏）

- [x] 2b.1 Write failing test: `bridge-route-list.test.ts` 把本 change 的 delta 加入来源，规格已含 `/api/bridge/status-snapshot` 而实现缺失 → 红（`expected [...6] to deeply equal [...5]`）
- [x] 2b.2 Implement: `BRIDGE_CALLBACK_ROUTES` 补 `/api/bridge/status-snapshot`；`cockpit-api-auth` delta MODIFIED 同步 to pass 2b.1
- [x] 2b.3 Write regression test: `app-same-origin.e2e.test.ts` `grants every listed bridge route the same credentialed preflight, not just hello`——遍历整张名单发真预检，去掉新路由会变红（已验证），还原后绿。**教训**：控制器单测看不到「预检被 403 → 浏览器根本不发请求」，只有真 HTTP 才抓得住

## 3. 前端与既有行为回归

- [x] 3.1 确认 `packages/cockpit-web` 无需改动（`git status` 显示 web 零改动，107 passed）：`sessionStatuses` 口径不变，顶栏图标 / 清除按钮 / `completed ×N` 文本不变（如需改动则补测试）
- [x] 3.2 全量回归 —— `pnpm build && typecheck && lint && test` exit=0：shared 8+12 / bridge 53 / web 107 / server 341；既有完成提醒测试组一条未删：`pnpm build && pnpm typecheck && pnpm lint && pnpm test` 各包全绿；既有完成提醒测试组（ack/edge 顺序、归档、detach、子代理）一条不得删

## 4. 真机验证（design D5）

- [x] 4.1 本机：制造一条官方未读完成（跑一个会话后切走），重启驾驶舱，确认**重启后仍显示**该提醒 —— 重启 t+20s 起恢复 `completed×1` 并稳定到 t+70s（见 verify.md）
- [x] 4.2 本机：清除后不跳回 —— `completed/ack` 201 后连续 30 秒采样均为 `running×1`，期间 bridge 持续重发含 `completionUnread:true` 的同一快照；「在 DSH 里打开该会话」由单测 `shows the official unread set…` 的标记翻转段覆盖
- [ ] 4.3 回退路径：对一台未升级桥接的设备（lumevm/devbox 之一，保持旧版本）确认完成提醒仍按运行轮次模型出现 —— **未做真机**：两台当前均 `bridgeSeenAt: null`（没有打开其页面），按你的要求未动；单测覆盖（`keeps the run-round model for a device that never sent the official snapshot`、`falls back … after the device reconnects`）
- [x] 4.4 记录真机证据（时间线 + SSE 事实流 + DSH 侧栏对照）到 change 的 verify 记录

## 5. 发布（design 风险节；按仓库正式流程）

- [x] 5.1 bridge 版本与协议递增 —— 0.6.4（52522 B，sha256 `877b1312…05f2`，integrity `sha512-yoVSDs5v…Zw==`），`pnpm build` + `npm pack`，记录字节数 / sha256 / integrity
- [x] 5.2 `gh release create` —— `dsh-cockpit-bridge-v0.6.4`，下载 HTTP 200 / 52522 B / `cmp` 一致，下载物核对 HTTP 200 + 字节数 + `cmp` 与本地 artifact 一致
- [x] 5.3 ohmydsh `dsh.yaml` —— `b22e60c` 已推送（含 SHA256 / 字节数 / 要点 / 回滚行） 更新 `spec` / `version` + 日期化注释（SHA256、字节数、要点、回滚行），提交并推送
- [x] 5.4 本机 `dsh build` —— profile 内 `lib/client.js` sha256 `6cca32f6…4bcb` == release 产物同路径文件；hello `0.6.4`；DSH 未重启 物化并核对：profile 内 `lib/client.js` 的 sha256 == 下载到的 release 产物内同路径文件；hello 报新版本；DSH 不重启
