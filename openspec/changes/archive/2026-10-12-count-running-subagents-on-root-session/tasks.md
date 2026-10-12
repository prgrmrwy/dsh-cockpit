## 1. 协议与事件

- [x] 1.1 `packages/shared` 的 `session-added` 事件增加可选 `parentSessionId`；`pnpm typecheck` 通过
- [x] 1.2 `rc2-client.ts` 与 `protocol-client.ts` 的 session-added 转换保留 `parentSessionId`；在 `rc2-client.test.ts`、`protocol-client.test.ts` 增加断言并通过

## 2. 状态聚合

- [x] 2.1 `device-lifecycle.ts` 增加子代理运行表与父会话映射，从 `session.list` 基线与 `session-added` 建立；单测覆盖基线含运行中子代理时进行中计数
- [x] 2.2 `session-status` 对已知子代理更新运行表，`session-removed` 置 false 并保留分类；单测覆盖事件收敛与不产生完成提醒/待决策
- [x] 2.3 `#runningSessionIds` 按根会话去重（含嵌套上溯、孤儿子代理、归档父会话排除、待决策优先）；单测逐条覆盖 spec 场景
- [x] 2.4 官方状态快照（`setBridgeStatusSnapshot`）保留子代理的 `running` 位且忽略其 `completionUnread`；单测覆盖
- [x] 2.5 重连/`stop()` 清理与基线覆盖行为；单测覆盖「基线中子代理已结束则进行中消失」

## 3. 验证与收口

- [x] 3.1 更新现有 `excludes subagent sessions from running...` 等测试以反映新口径，并保证完成提醒、待决策排除断言仍然成立
- [x] 3.2 运行 `pnpm build && pnpm typecheck && pnpm test && pnpm lint` 全部通过
- [x] 3.3 用本机 DSH 做一次实机核对：根会话结束、子代理仍运行时设备项显示进行中，结束后消失；完成后 `openspec archive`
