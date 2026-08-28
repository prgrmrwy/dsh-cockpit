## Context

当前注册表与 REST/SSE 快照会保留禁用设备，这是设备管理重新启用所必需的；但同一份 `DeviceStatusFacts[]` 也直接驱动顶栏、总览和当前工作台。后端在启用位翻转时会停止旧 lifecycle 并创建新 lifecycle，禁用 lifecycle 没有启动，因此其默认状态仍是 `CONNECTING`；`ConnectivityService` 维护的 `bridgeSeenAt` 又独立于 lifecycle，禁用时不会清理。前端 Workbench 则把创建过的 iframe 保存在组件内部 registry，设备禁用不会触发移除。

设计必须继续遵守两条边界：注册/管理事实与工作台可选集合可以有不同视图；状态聚合和 iframe 仍保持独立，且不读取 iframe DOM。

## Goals / Non-Goals

**Goals:**

- 让 `enabled=false` 成为连接层与 UI 均可判定的稳定状态，而不是伪装成连接中。
- 在服务端禁用边界彻底终止连接资源并失效在线事实。
- 从全量设备事实派生唯一的“工作台可选设备”集合，统一顶栏、选择与总览入口。
- 在禁用时释放已创建 iframe，重新启用后使用新 endpoint 创建新页面。

**Non-Goals:**

- 不删除禁用设备记录，也不改变设备管理中的重新启用流程。
- 不保留禁用前 iframe 页面状态；禁用是显式释放资源边界。
- 不改变远端 DSH、桥接插件协议或只读状态聚合协议。
- 不把临时断连等同于禁用；已启用设备断连仍保留 iframe 和自动重连。

## Decisions

### 1. 在共享连接状态中增加 `DISABLED`

`DeviceState` 增加稳定状态 `DISABLED`，禁用 lifecycle 的初始事实即为该状态。它与 `enabled` 看似有信息重叠，但用途不同：`enabled` 是配置意图，`state` 是连接层对该意图的归一化结果，管理面板和下游无需再把 `CONNECTING + diagnostic=device disabled` 解释成特殊情况。

备选方案是只依赖 `enabled=false` 并保留任意旧 state。该方案会让状态点、诊断和 API 消费方继续看到互相冲突的事实，无法修复截图中的“正在连接”误导，因此不采用。

### 2. 禁用翻转作为在线事实的失效边界

更新为禁用时，服务端先终止旧 lifecycle，再清除该设备的 `bridgeSeenAt`，随后附加一个不启动的禁用 lifecycle 并发布快照。禁用 lifecycle 不拥有 endpoint、stream、client 或 timer；其 refresh/reconnect 路径直接 fail closed。重新启用仍创建全新 lifecycle，以新的 endpoint 和新基线开始。

`bridgeSeenAt` 表示最近一次插件 hello，但 UI 将其解释为桥接已连接，因此不能跨越禁用边界保存。完成提醒等会话聚合状态也不跨越新 lifecycle，符合显式停止设备后重新连接并重建基线的语义。

备选方案是在前端仅隐藏图标。它掩盖了错误事实，且 API/SSE 仍会向其它客户端宣称桥接在线，因此不采用。

### 3. 服务端返回全量注册设备，前端派生工作台可选集合

REST/SSE 保持返回所有设备，保证设备管理和禁用摘要不丢数据。`App` 通过 `devices.filter(device => device.enabled)` 派生 `enabledDevices`：顶栏只接收该集合；当前选择归一化也只在该集合中进行；设备管理继续接收全量集合。

总览继续展示全量设备用于感知，但禁用行使用不可操作名称/禁用按钮并显示“已禁用”，不能调用 `onSelect`。这样既不会把禁用设备藏出管理与总览，也不会留下绕过顶栏进入工作台的入口。

备选方案是服务端直接过滤禁用设备。它会使设备管理无法重新启用，或迫使新增第二套设备 API，超出本次需求且增加状态同步面，因此不采用。

### 4. 当前选择使用确定性归一化，不在 render 中临时回退

当设备事实变化后，effect 验证 `currentId` 是否仍在 `enabledDevices`。若无效，则选择按现有 order 排序后的第一台已启用设备；若集合为空则清空。启动时的 last-used 也应用同一规则。自动回退更新内存选择，但只有用户主动选择时才写入 last-used，避免一个短暂 SSE 顺序变化覆盖用户偏好。

Workbench 始终只接收归一化后的当前设备，因此不会为禁用设备新建 iframe，也不会对其调用 reconnect。

### 5. Workbench registry 按设备可用性显式删除 frame

Workbench 增加已启用设备 ID 集合（或等价的移除信号），在集合变化时从内部 registry 与 iframe refs 移除不再启用/已删除的设备并更新 frames。React key 移除会卸载 iframe，从浏览器侧释放页面连接。临时连接状态变化不会移除 frame，继续满足断线保留要求。

备选方案是仅把禁用 frame `display:none`。隐藏 iframe 仍存活并可能持续执行网络重试，违背禁用释放资源的目标，因此不采用。

## Risks / Trade-offs

- [新增 `DISABLED` 扩展共享联合类型，所有穷举映射都必须更新] → 通过 TypeScript typecheck 和针对状态标签、色调、顶栏的单测确保无遗漏。
- [禁用会丢失 iframe 内未提交输入] → 这是显式禁用的资源释放语义；设备切换仍保留页面，只有禁用/删除销毁。
- [更新禁用时若快照发布顺序不当，客户端可能短暂看到旧 endpoint] → 完成 stop 与在线事实清理后再发布最终禁用快照，并用服务测试断言最终事实无 endpoint/bridgeSeenAt。
- [当前设备回退 effect 可能产生一帧旧选择] → render 时从已启用集合解析 `current`，无效 ID 立即得到 `undefined`；effect 只负责持久化下一选择。
- [禁用状态仍保留旧会话计数会暗示实时] → 新禁用 lifecycle 使用空聚合事实；重新启用后由新的 baseline 重建。

## Migration Plan

1. 扩展共享状态类型与状态标签/色调映射。
2. 调整服务端禁用 lifecycle、在线事实清理和重连门禁，并补测试。
3. 调整前端可选集合、选择归一化、总览入口和 iframe 移除，并补测试。
4. 运行 build、typecheck、test、lint；构建前端产物后刷新现有 Cockpit URL 验证。

本变更无需注册表迁移：已有 `enabled=false` 记录在首次加载时直接映射为 `DISABLED`。回滚代码即可恢复旧展示；持久化数据格式不变。
