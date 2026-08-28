## Context

动机见 `proposal.md`。本 change 依赖 `redesign-device-management-panel` 已落地的设备管理面板结构：删除按钮、行内操作错误隔离与设备摘要都已存在，这里只调整删除的确认语义并清理孤儿字段。

当前实现事实：`connectivity.service.ts` 在 `statuses()` 中把 `outcomeUnknownCount` 写为字面量 `0`；`Panels.tsx` 用 `device.outcomeUnknownCount === 0` 推导 `confirmed`，因此始终直接删除；`TopBar.tsx` 输出 `data-outcome-unknown` 属性。服务端 `removeDevice(deviceId, confirmed)` 已经支持「未确认则返回 requiresConfirmation 且不改注册表」的两段式协议。

## Goals / Non-Goals

**Goals:**

- 移除驾驶舱只读架构下不可能产生的 outcome-unknown 计数及其全部依赖。
- 让删除对所有设备都需要一次明确确认，取消即完全无副作用。
- 保持删除的服务端门禁协议与最小诊断要求不变。

**Non-Goals:**

- 不引入任何远端写操作，也不为未来写操作预留字段或状态。
- 不改变 SSH 验证、隧道、重连、事件聚合或设备排序行为。
- 不改动注册表磁盘格式，不需要数据迁移。
- 不重做删除以外的面板视觉与交互。

## Decisions

### 1. 彻底删除字段，而不是保留并置为可选

`DeviceStatusFacts.outcomeUnknownCount` 与 `TopBar` 的 `data-outcome-unknown` 一并移除，测试夹具同步清理。

保留一个恒为 `0` 的可选字段只会延续误导：它看起来像一层生效中的保护，实际上永远不触发。真正需要追踪写操作结果时，那是一个带完整规范的新能力，应连同语义、持久化与 UI 一起定义，而不是复用这个遗留槽位。

### 2. 确认发生在 Web 层，服务端保持既有两段式门禁

Web 在发起删除前先取得用户确认，确认后以 `confirmed: true` 调用；用户取消则不发任何请求。服务端 `removeDevice` 的「未确认 → `requiresConfirmation`、不改注册表」协议原样保留，作为防止未确认删除的后端保险。

这样确认是一次、语义唯一，且不依赖任何计数；同时保留服务端拒绝未确认删除的能力，符合「身份或状态无法证明时拒绝破坏性操作」的保守原则。

### 3. 用可注入的确认入口替代直接调用 `window.confirm`

`DevicePanel` 通过一个默认使用 `window.confirm` 的可选 `confirmDelete` prop 取得确认结果，测试用例注入替身覆盖确认与取消两条路径，不再依赖对全局对象打桩。

这让「取消不发请求」成为可直接断言的行为契约，也为将来换成面板内确认 UI 留出替换点，无需再改调用方。

## Risks / Trade-offs

- **[移除共享字段影响其他消费者]** → 该字段只在本仓库的服务端输出、Web 面板/顶栏与测试夹具中出现；全仓搜索确认无其它使用，且远端 DSH 协议不涉及它。
- **[每次删除都需确认，操作步骤变多]** → 删除是不可逆的破坏性操作，一次确认换取误删保护是合理代价；确认文案需说明设备名以便核对。
- **[原生 `confirm` 阻塞且不可定制]** → 本 change 沿用它以保持范围最小，但通过注入点隔离，后续可无痛替换为面板内确认。

## Migration Plan

1. 先更新共享类型与契约测试，再同步服务端事实输出。
2. 更新 Web 面板确认逻辑与顶栏属性，并补齐确认/取消两条路径的测试。
3. 运行 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build` 与 OpenSpec 严格校验。
4. 重启受管 cockpit 后在现有 `http://127.0.0.1:3090/` 验证删除确认与取消；真实设备只验证取消路径，确认路径在隔离实例中用假设备验证。
5. 回滚方式为整体回退本 change；注册表与远端行为未变，无需数据迁移。
