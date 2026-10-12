## Context

见 proposal.md。当前 `DeviceLifecycle`（`packages/cockpit-server/src/connectivity/device-lifecycle.ts`）维护 `#subagents`（来源：`session.list` 的 `origin=subagent`、`session-added` 帧），并在 `#syncSessions`/`#applyEvent`/`setBridgeStatusSnapshot` 中对其一律 `#pruneSubagent` 或忽略——这是为了让子代理不制造完成提醒、不进待决策计数，但同时丢掉了子代理的运行位。官方 UI 中 `runningChildCount` 只数「根会话 subagentCatalog 里 running 为 true 的子代理」，并作为额外的 `ongoing` 状态展示。

事实依据：
- `session.list` 行与 `api-session/added` 的 `SessionSummary` 带 `origin?: 'subagent'` 与 `parentSessionId?`。
- `host/session-status` 帧无 origin 与 parent，只能依靠已有的 `#subagents` 先验归类。
- 桥接的官方状态快照包含子代理行（`running`），目前被 `setBridgeStatusSnapshot` 丢弃。

## Goals / Non-Goals

**Goals:**
- 设备项「进行中」数量与官方会话行语义一致：根会话运行或有子代理运行 ⇒ 一个进行中。
- 保持子代理对完成提醒、待决策数量零贡献。

**Non-Goals:**
- 不新增状态种类或图标，不显示「N 个子代理」文案；仅复用既有 ongoing 图标。
- 不新增轮询、不读取任何新的远端接口，不改桥接插件。
- 不重做子代理的 detach/归档语义（沿用现有保留规则）。

## Decisions

1. **独立维护子代理运行表**：新增 `#subagentRunning: Map<subagentId, { running: boolean }>` 与 `#subagentParent: Map<subagentId, parentId | undefined>`，与根会话的 `#sessions`（完成轮次模型）完全分离。这样根会话的完成/确认逻辑一行不动，子代理依旧不会产生完成提醒。
   - 备选：把子代理放进 `#sessions` 并在完成/待决策处过滤。否决：会改动多处完成路径，回归面大。
2. **父会话归属**：`#syncSessions`/`#refreshSubagents` 记录 `parentSessionId`；`session-added` 事件增加可选 `parentSessionId`（`rc2-client`/`protocol-client` 转换保留）。多层嵌套沿 parent 链向上走到第一个非子代理祖先（带环保护与深度上限）。
   - 备选：只数直接子代理，与官方一致。否决：嵌套子代理在官方里显示在中间子代理行，而根会话行不亮，驾驶舱只有设备级聚合，沿链上溯更符合「设备里还有活在跑」的意图。
3. **计数口径**：`#runningSessionIds()` 返回「根会话自身运行」∪「有运行子代理的、非归档根」的集合；孤儿子代理（无父、或父未知）以自身 id 入集合。已有的「待决策根会话不计进行中」过滤继续生效，因为集合仍以根会话 id 为键。
4. **来源优先级**：设备上报了官方状态快照时，子代理运行位取快照（含子代理行，仅取 `running`，忽略 `completionUnread`）；否则取 `session.list` 基线 + `host/session-status` 增量。与现有「按设备而非按会话选真相源」一致。
5. **子代理状态帧**：`#applyEvent('session-status')` 对已知子代理更新运行表而不是丢弃；`session-removed` 对子代理把其运行位置 false 但保留分类（沿用现有 detach 规则）。
6. **清理**：`#pruneSubagent` 仍清除其在 `#sessions`/`#pending` 的残留，不清除运行表；`stop()` 清空运行表；基线全量刷新时，对基线中出现的子代理以基线值覆盖（缺席不视为结束，沿用「缺席不是删除」）。
7. **规模上限**：子代理可达上百；运行表仅存已见子代理，随 `#subagents` 一同有界，无额外保留策略。

## Risks / Trade-offs

- [子代理运行位丢失结束帧导致永久进行中] → 重连/手动刷新时基线覆盖；`session-removed` 置 false；这与根会话已有风险同级，不额外引入轮询。
- [孤儿子代理被计为独立进行中，可能高估] → 设计上宁可显示进行中不漏报；归属出现后自动并入根会话。
- [未带 parent 的旧版设备] → 退化为孤儿口径，数量可能大于根会话数；仍好过漏报。
