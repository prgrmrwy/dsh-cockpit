## ADDED Requirements

### Requirement: bridge 旁路上报 typert 官方 pending snapshot
对 typert 设备，兼容 bridge SHALL 只读订阅官方 `ctx.uiSession.pendingInteractions` observable，并经现有 device-origin-bound、短 TTL capability 通道上报完整的最小 snapshot。每项只包含状态聚合所需的 `sessionId`、`kind` 与不透明 `key`；MUST NOT 包含问题正文、审批原因、工具参数、回答、对话、settings、credentials 或 provider token。

bridge SHALL 在 snapshot 变化及既有 hello/activation 恢复点上报当前完整 snapshot；Cockpit server SHALL 以新 snapshot 替换该设备上一份 bridge pending 状态，使页面重载、请求解除或中间通知丢失后仍可收敛。bridge MUST NOT 注册 approval/question Remote Event listener，MUST NOT 回答或延迟官方 waterfall。

#### Scenario: 官方 UI 出现并解除 pending
- **WHEN** typert 官方 client 的 pending snapshot 加入一个 approval/question，之后又将其移除
- **THEN** bridge 分别上报含该项和不含该项的完整 snapshot，设备等待提示相应出现并解除

#### Scenario: bridge 重载时已有 pending
- **WHEN** bridge 页面加载时官方 pending snapshot 已非空
- **THEN** bridge 首次成功握手后上报当前完整 snapshot，不要求重新触发请求边沿

#### Scenario: 上报失败后恢复
- **WHEN** pending snapshot 上报因网络或 capability 失效失败，之后 hello、activation 或 capability 续签成功
- **THEN** bridge 重发最新完整 snapshot；失败保持静默，不影响官方工作台和交互处理

#### Scenario: 最小化旁路数据
- **WHEN** bridge 上报 pending snapshot
- **THEN** 请求只含设备能力协议元数据及 `sessionId/kind/key` 集合，不读取或发送交互内容

## MODIFIED Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合
系统 SHALL 在用户选中设备时，通过 iframe 加载该设备原生 DSH Web，让用户直接使用远端 workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT 接管该设备的操作 API、改写其事件或代替其处理交互。

对要求浏览器会话认证的 typert 版本，iframe 首次创建或认证恢复时 SHALL 加载当前 endpoint 的官方 tokenized root URL，使 DSH 自己设置 authority-bound HttpOnly cookie 并重定向到干净根路径。Cockpit MUST NOT 读取 iframe cookie，也不得在 iframe 后续 URL、界面或日志中保留 token。rc.2 iframe 继续加载原 endpoint，不增加认证步骤。

#### Scenario: 选中设备即见其完整工作台
- **WHEN** 用户顶栏点击一台 `READY` 设备
- **THEN** 内容区显示该设备原生 DSH Web；该设备的设置、插件、usage 均可正常使用

#### Scenario: 远端零改造
- **WHEN** 用户添加一台仅运行标准 `dsh web` 的设备
- **THEN** 驾驶舱不要求安装 bridge 即可使用工作台；typert 设备只需按官方要求完成启动 URL 认证握手

#### Scenario: rc.2 工作台
- **WHEN** 用户选中一台 `READY` 的 rc.2 设备
- **THEN** iframe 按现有方式直接加载设备 endpoint，完整工作台可用

#### Scenario: typert 工作台首次认证
- **WHEN** 用户选中一台已有有效 launch token、但浏览器尚无当前 authority cookie 的 typert 设备
- **THEN** iframe 完成官方 token→cookie→干净根路径交换后显示完整原生工作台，不呈现裸 401

#### Scenario: typert 工作台缺少认证材料
- **WHEN** typert 设备需要认证但没有有效 launch token
- **THEN** Cockpit 显示粘贴当前官方启动 URL 的引导，不反复加载裸 401 iframe

### Requirement: 未安装桥接时核心工作台与人工兜底保持可用
bridge SHALL 继续是可选配套。设备未安装、安装旧版或 bridge 暂不可用时，系统 SHALL 保持原生 DSH 工作台、running/完成提醒/会话/归档等可由官方 Host API 获得的只读状态、设备切换及完成提醒人工清除可用。

由于 typert Host API 不再向已放行的旁观订阅者提供 approval/question resolved 信号，未加载兼容 bridge 时，该设备的 pending SHALL 明确标记为“不可观测”，MUST NOT 以数值 0 表示确认没有等待。此限制不得使设备连接状态变成错误，也不得影响其它聚合字段。

#### Scenario: typert 未安装兼容 bridge
- **WHEN** typert 设备已连接，但没有兼容 bridge pending snapshot
- **THEN** 原生工作台和其它状态聚合正常，pending 显示不可观测，完成提醒人工清除仍可用

#### Scenario: typert bridge 开始上报
- **WHEN** 兼容 bridge 成功上报第一份当前 pending snapshot
- **THEN** pending 变为可观测并按该 snapshot 呈现；不得把启用 bridge 表示为设备连接状态变化

#### Scenario: rc.2 设备
- **WHEN** rc.2 设备没有 bridge
- **THEN** pending 仍由其既有 Host 事件流观测，行为不因本 change 改变

#### Scenario: 设备运行旧版桥接
- **WHEN** hello 报告的 bridge 版本不具备可靠 pending snapshot 协议
- **THEN** 系统保持原生工作台、其它只读状态聚合与设备级完成提醒人工清除可用，并将 typert pending 明确标记为不可观测

#### Scenario: 桥接故障不影响工作台
- **WHEN** bridge 的 hello、确认、pending snapshot 或重试持续失败
- **THEN** iframe 内的 DSH 会话操作、输入、滚动和连接不受影响，设备级完成提醒人工清除保持可用
