## MODIFIED Requirements

### Requirement: 归档与恢复不制造完成提醒

系统 SHALL 将会话归档集合变化与会话 detach（live 移除）区分处理。归档 SHALL 清除该会话当前完成提醒，并且归档和恢复本身 MUST NOT 生成新的完成提醒或把已清除的提醒重新点亮；恢复的旧会话 SHALL 延续其既有运行轮次身份，而不是被视为刚完成的新会话。`host/session-removed` SHALL 被当作 live 会话从内存 registry detach 而非永久删除：系统 SHALL 清除该会话的完成提醒与计数呈现（与官方 UI 的移除语义一致），但 MUST 保留其运行轮次身份、已读协调状态与子代理分类知识；该会话重新出现时 MUST NOT 生成新的完成提醒，也不得被视为全新的观察对象。rc.2 协议没有权威的「永久删除」事件，系统 MUST NOT 依据一次 `session.list` 缺席或一次 `host/session-removed` 推导永久删除。

#### Scenario: 已读会话被归档后恢复
- **WHEN** 一个已成功清除完成提醒的会话被归档，之后在没有新运行轮次的情况下恢复
- **THEN** 该会话保持已读，Device Tab 不重新显示其完成提醒

#### Scenario: 未读会话被归档
- **WHEN** 一个仍有完成提醒的会话被归档
- **THEN** 系统清除该会话当前完成提醒且不影响其它会话提醒

#### Scenario: 恢复未产生新完成边缘
- **WHEN** 一个空闲的归档会话被恢复且没有发生新的 `running → idle` 边缘
- **THEN** 系统不因恢复动作生成新的完成提醒

#### Scenario: 会话 detached（session-removed）
- **WHEN** 系统收到 `host/session-removed`，会话从 live registry 移除
- **THEN** 系统清除该会话当前完成提醒并不再计入运行/完成/待决策计数，但保留其运行轮次身份与已读协调状态，且不影响其它会话状态

#### Scenario: 会话 detach 后重新出现
- **WHEN** 一个已 detach 的会话随后再次出现在 `session.list` 中，且期间没有新的运行轮次
- **THEN** 系统不生成完成提醒，也不将该会话视为全新的观察对象；其之后真正重新运行并完成时仍按既有轮次规则生成提醒

#### Scenario: 会话永久删除
- **WHEN** 系统收到权威的会话永久删除事实（当前 rc.2 协议没有此类事件；该场景仅为将来协议保留语义，`session-removed` 与列表缺席均不得触发它）
- **THEN** 系统清除该会话的运行基线、当前选择、乱序协调状态和完成提醒

#### Scenario: 子代理 detach 不改变分类
- **WHEN** 系统收到某子代理会话的 `host/session-removed`
- **THEN** 系统保留该会话的子代理分类知识，其后续状态事件不得进入根会话计数或完成提醒

#### Scenario: 归档事件不可用
- **WHEN** 某个兼容设备版本不提供可消费的归档集合事件
- **THEN** 系统仍不得仅因 session 列表刷新中会话暂时不可见或重新可见而生成完成提醒，并保留设备级人工清除兜底

### Requirement: 状态聚合读取官方只读接口与事件流

系统 SHALL 在设备 READY 后打开其 `/api/events.mux` 与 `/api/events.host` 两条 ws，并以一次 `session.list` 与一次 `workspace.list` 拉取基线（会话运行状态与归档集合）；后续以事件流增量更新每台设备的状态（会话 running、approval/question 等待人决策）。基线与事件流通过不同通道到达时，系统 MUST 按语义收敛，不得因基线在途或乱序而丢失、重复或回滚状态：基线请求期间到达的增量事件 SHALL 在基线应用后按到达序回放，较新的事件状态 MUST 优先于较旧的基线快照。每次连接、重连与手动刷新 SHALL 重建会话与归档基线；归档集合的纠正 MUST NOT 依赖仅在有归档变化时才推送的增量事件。系统 MUST NOT 代理远端 settings/credentials，MUST NOT 读取或同步 provider token，MUST NOT 引入周期轮询。

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