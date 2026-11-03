## MODIFIED Requirements

### Requirement: 状态聚合读取官方只读接口与事件流

系统 SHALL 在设备 READY 后打开其 `/api/events.mux` 与 `/api/events.host` 两条 ws，并以一次 `session.list` 与一次 `workspace.list` 拉取基线（会话运行状态与归档集合）；后续以事件流增量更新每台设备的状态（会话 running、approval/question 等待人决策）。基线与事件流通过不同通道到达时，系统 MUST 按语义收敛，不得因基线在途或乱序而丢失、重复或回滚状态：基线请求期间到达的增量事件 SHALL 在基线应用后按到达序回放，较新的事件状态 MUST 优先于较旧的基线快照。每次连接、重连与手动刷新 SHALL 重建会话与归档基线；归档集合的纠正 MUST NOT 依赖仅在有归档变化时才推送的增量事件。系统 MUST NOT 代理远端 settings/credentials，MUST NOT 读取或同步 provider token，MUST NOT 引入周期轮询。

驾驶舱现有的协议探测、认证握手与上述状态聚合流量保持不变。在此之外，驾驶舱为状态聚合或跨设备消息新增的请求 SHALL 只有一类：设备安装了中继插件时，按 `cockpit-session-relay` 调用该插件的 `handshake`、`outbox`、`ack`、`deliver`、`directory` 五个端点。该例外 MUST NOT 用于代理远端操作 API，MUST NOT 读取会话内容、settings、credentials 或 provider token，MUST NOT 引入周期轮询（失败后的有界退避重试不属于轮询）；目录所需的会话数据 SHALL 复用本 Requirement 已拉取的基线与事件流。

#### Scenario: 中继例外不新增轮询
- **GIVEN** 设备 A 安装了中继插件且为 `READY`
- **WHEN** 从 A 进入 `READY` 起观察驾驶舱对 A 的 DSH 发出的 HTTP 请求，直到中继握手、订阅与首次目录推送均一次成功之后再过 10 分钟；期间所有设备都没有会话、归档或中继状态变化，A 没有出站信封，用户没有手动刷新，也没有任何传输失败
- **THEN** 请求只包含一次基线（`session.list`、`workspace.list`）、事件流连接，以及中继的一次 `handshake`、一个 `outbox` 订阅和一次接入时的 `directory` 推送，没有其它周期性请求

#### Scenario: 设备打开后状态变化
- **WHEN** 远端会话从 running 变为空闲，或有新 approval
- **THEN** 系统更新该设备的状态计数并如实呈现在顶栏

#### Scenario: ws 重连
- **WHEN** 设备的 ws 断开后重连成功
- **THEN** 系统自动重查一次会话与归档快照并纠正计数与归档集合；用户也可手动触发刷新

#### Scenario: 基线请求期间的完成边缘
- **WHEN** 系统拉取基线期间某会话从运行变为空闲，且该完成边缘随后经事件流到达
- **THEN** 系统在基线之上回放该边缘并生成正确的完成提醒，不丢失也不重复

#### Scenario: 陈旧基线不覆盖新事件
- **WHEN** 一次刷新响应晚于已在途的事件流增量到达，且两者对同一会话状态不一致
- **THEN** 系统以较新的事件状态为准，不因基线回滚状态或制造错误的完成边缘

#### Scenario: 归档集合重连纠正
- **WHEN** 断线期间设备发生归档或恢复，重连后 `workspace.list` 返回最新归档集合
- **THEN** 系统以其纠正归档集合：已归档会话的完成提醒被清除且不再计数，恢复的会话不生成新的完成提醒
