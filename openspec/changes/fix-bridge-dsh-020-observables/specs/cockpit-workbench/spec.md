## MODIFIED Requirements

### Requirement: bridge 旁路上报 typert 官方 pending snapshot
对 typert 设备，兼容 bridge SHALL 只读订阅官方 pending observable：旧版本使用 `ctx.uiSession.pendingInteractions`；DSH 0.2.0 使用官方 Session status observable 中每会话的 `pendingInteraction`。bridge SHALL 经现有 device-origin-bound、短 TTL capability 通道上报该来源当前可见的完整最小 snapshot；0.2.0 来源只表示每会话当前最高优先级交互，不宣称覆盖隐藏的低优先级请求。每项只包含状态聚合所需的 `sessionId`、`kind` 与不透明 `key`；MUST NOT 包含问题正文、审批原因、工具参数、回答、对话、settings、credentials 或 provider token。

bridge SHALL 在 snapshot 变化及既有 hello/activation 恢复点上报当前完整 snapshot；Cockpit server SHALL 以新 snapshot 替换该设备上一份 bridge pending 状态，使页面重载、请求解除或中间通知丢失后仍可收敛。bridge MUST NOT 注册 approval/question Remote Event listener，MUST NOT 回答或延迟官方 waterfall。缺少已识别的 pending observable 时 bridge MUST 保持来源不可观测，不发送伪造空快照，且 MUST NOT 阻断原生 DSH client 激活。

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

#### Scenario: 0.2.0 status 替代旧 pending observable
- **WHEN** 官方只提供 Session status 且其中一个会话有 pendingInteraction
- **THEN** bridge 正常激活，只投影该交互的最小三字段；当该交互解除或被新的当前交互替代时上报最新快照

#### Scenario: 未知来源不假装没有 pending
- **WHEN** 官方没有任一已识别的 pending observable
- **THEN** bridge 不宣称 pending seam 可用、不上报空快照，原生工作台仍能启动

## ADDED Requirements

### Requirement: bridge 兼容新旧官方当前选择与订阅生命周期
bridge SHALL 只读观测旧版本 list.current 或 DSH 0.2.0 list 的 retainedBy.mainView，保持既有选择捕获/outbox/重试协议；SHALL 正确区分空选择与旧形状缺失。bridge MUST 对已安装的订阅、定时器执行对称清理，异常初始化不得留下访问 inactive context 的回调。

#### Scenario: 0.2.0 快速切换并清空
- **WHEN** 官方 mainView 依次保留 A、B，随后清空
- **THEN** bridge 捕获并提交 A、B 与空选择，不因不存在 current 而丢失确认

#### Scenario: 旧版保持兼容
- **WHEN** 官方仍使用 current 与 pendingInteractions
- **THEN** 既有选择确认、pending 快照与重试行为不变

#### Scenario: 销毁后订阅停止
- **WHEN** bridge effect 销毁后官方 list/status 继续变化
- **THEN** bridge 不继续发请求，不访问 inactive service，不遗留 listener 或 timer
