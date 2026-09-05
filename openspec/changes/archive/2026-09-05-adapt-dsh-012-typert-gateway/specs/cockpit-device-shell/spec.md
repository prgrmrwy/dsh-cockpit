## ADDED Requirements

### Requirement: 顶栏与总览区分 pending 为零和不可观测
系统 SHALL 在共享设备事实中提供最小的 pending 可观测性标记，并在现有设备状态呈现中区分“已观测且数量为零”和“当前协议来源不可观测”。该标记只描述 approval/question 聚合来源，不得改变连接状态点、bridge 链条图标或其它 session 状态的既有语义。

当 pending 可观测时，现有 warning 图标与数量显示保持不变；当 pending 不可观测时，系统 SHALL 以现有布局内的简短文字、悬浮说明或可访问名称明确说明“等待决策状态不可观测”，MUST NOT 伪造 warning 数量，也 MUST NOT 将其渲染为设备离线或 bridge 安装错误。

#### Scenario: 已观测且没有 pending
- **WHEN** 设备事实表明 pending 可观测且当前数量为 0
- **THEN** 系统按现有行为不显示 warning 状态，并可将其解释为当前没有已知等待决策

#### Scenario: typert pending 不可观测
- **WHEN** typert 设备没有当前兼容 bridge snapshot
- **THEN** 顶栏与设备总览不把 `pendingInteractionCount: 0` 描述为“没有等待”，而是明确说明等待决策状态当前不可观测

#### Scenario: 其它状态继续显示
- **WHEN** pending 不可观测但设备存在 running 或 completed 状态
- **THEN** 对应进行中与完成图标照常显示；pending 可观测性不覆盖连接状态和其它 session 状态

#### Scenario: rc.2 设备保持原行为
- **WHEN** rc.2 设备通过既有事件流提供 pending 状态
- **THEN** 其 pending 可观测性为 available，现有 warning 图标、数量与总览文案不变
