## MODIFIED Requirements

### Requirement: 健康探测与状态分级可诊断

系统 SHALL 对每台设备至少区分：`DISABLED`（设备已禁用且不存在活跃连接）、`SSH_UNREACHABLE`（SSH 不可达/认证失败）、`TUNNEL_ERROR`（本地转发失败）、`DSH_UNAVAILABLE`（隧道通但 DSH 服务不可达）、`NON_DSH_SERVICE`（端口有服务但不是 DSH）、`INCOMPATIBLE`、`CONNECTING`（正在连接/重连退避中）、`READY`、`DEGRADED`。状态应由连接层驱动，且不得仅凭 `host.describe` 或 `command -v` 来判断 DSH 未安装。`DISABLED` MUST NOT 被表示为 `CONNECTING`、错误或其它瞬时连接状态。

#### Scenario: 启动时设备不可达
- **WHEN** 驾驶舱启动后，一台已启用的登记设备 SSH 不可达
- **THEN** 系统显示 `SSH_UNREACHABLE` 与最后已知信息；不阻塞其他设备，也不误判为从未存在

#### Scenario: 隧道断开后重连
- **WHEN** 已启用设备原先 `READY`，隧道后断开
- **THEN** 系统立即标记断连并进入 `CONNECTING`（重连退避），恢复后重新探测并回到 `READY`/`DEGRADED`，并保留最后已知状态

#### Scenario: 禁用设备的状态
- **WHEN** 一台登记设备被禁用或驾驶舱启动时读取到已禁用设备
- **THEN** 系统将其报告为 `DISABLED`，不把它报告为正在连接或连接故障

### Requirement: 删除设备需无条件确认并保留最小诊断

系统 SHALL 在用户禁用/删除设备时停止其连接与重连。禁用设备后，系统 SHALL 终止该设备的隧道与事件流、停止重连 timer，并清除 endpoint、桥接在线时间及其它仅代表当前活跃连接的事实；设备注册记录仍 SHALL 保留，重新启用后 SHALL 通过新的连接生命周期重新建立这些事实。对禁用设备发起手动刷新或重连 MUST NOT 创建连接或子进程。删除任何设备前 SHALL 获得用户显式确认；未确认前不得停止连接、不得改动注册表。系统 MUST NOT 依据「结果未知的写操作」计数来决定是否需要确认，也 MUST NOT 在设备事实中暴露该计数。保留的最小诊断不得包含可关联用户提示的 rpcId、sessionId 或内容。

#### Scenario: 删除设备需显式确认
- **WHEN** 用户对任意一台已登记设备发起删除
- **THEN** 系统要求显式确认；确认后停止其连接与重连并从注册表移除，保留的诊断不含 rpcId、sessionId 或提示内容

#### Scenario: 用户取消删除
- **WHEN** 用户发起删除后取消确认
- **THEN** 系统不改动注册表、不停止该设备连接，设备保持原有状态与顺序

#### Scenario: 禁用设备
- **WHEN** 用户禁用一台设备
- **THEN** 系统停止并清理其隧道、事件流和重连，清除 endpoint 与桥接在线事实，将状态设为 `DISABLED`，并保留该设备的注册记录

#### Scenario: 禁用设备时请求重连
- **WHEN** 客户端对一台已禁用设备请求刷新或重连
- **THEN** 系统拒绝启动连接且不创建 SSH 子进程，设备保持 `DISABLED`

#### Scenario: 重新启用设备
- **WHEN** 用户重新启用一台设备
- **THEN** 系统建立新的连接生命周期并从 `CONNECTING` 开始连接，不沿用禁用前的 endpoint 或桥接在线时间
