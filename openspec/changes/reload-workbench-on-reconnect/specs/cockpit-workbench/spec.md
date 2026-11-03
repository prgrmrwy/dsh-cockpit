## ADDED Requirements

### Requirement: 用户重连即明确重试当前设备工作台

用户在驾驶舱显式触发“重连当前设备”（顶栏重连按钮、顶栏菜单中的同一动作、离线遮罩上的重连按钮）时，系统 SHALL 在重建该设备连接的同时，把当前设备工作台视为一次用户明确重试：丢弃该设备当前 tuple 的“已尝试”记录，待设备回到 `READY` 或 `DEGRADED` 后重新请求一次工作台启动，并仅为该次被接受的启动结果导航 iframe 一次。该行为 SHALL 同样适用于启动 API 已失败、导航结果不可观测和已正常加载三种状态，以及 typert 与 rc.2 两类设备。

该重试 SHALL 只由用户的显式点击触发。iframe load、SSE 状态更新、设备自动重连、设备切换或重渲染 MUST NOT 触发它，同一 tuple 仍只自动尝试一次。重试 MUST 遵守既有启动契约：tokenized URL 不进入业务状态、等待期间不导航裸 endpoint、晚到或旧 tuple 的结果不导航。重试只作用于触发时的当前设备，MUST NOT 重新加载其它设备的 iframe。

触发该动作的界面入口 SHALL 用文案说明它会重新加载设备页面（例如“重连并重新加载当前设备”），且顶栏按钮与菜单项使用同一文案。

#### Scenario: 不可观测导航留下错误页后由用户恢复
- **GIVEN** 当前设备的工作台导航结果不可观测，iframe 停在连接错误页，隧道恢复后复用同一本地端口，auth generation 未变
- **WHEN** 用户点击顶栏重连按钮
- **THEN** 设备重新连接；回到 `READY` 后驾驶舱重新请求一次启动，iframe 导航到新结果一次，用户无需整页刷新驾驶舱

#### Scenario: 自动路径仍不重试
- **GIVEN** 当前设备的工作台导航结果不可观测
- **WHEN** iframe 再次 load、收到重复 SSE、设备自动重连后回到同一 tuple，或用户切换设备再切回
- **THEN** 驾驶舱不发起新的启动请求，也不重新导航 iframe

#### Scenario: 只重载当前设备
- **GIVEN** 已挂载多台设备的工作台 iframe
- **WHEN** 用户对当前设备触发重连
- **THEN** 只有当前设备的 iframe 重新启动并导航，其它设备的 iframe 不被导航

#### Scenario: 重连后启动失败
- **GIVEN** 用户触发重连，设备回到 `READY`
- **WHEN** 重新请求的工作台启动失败
- **THEN** 驾驶舱显示既有脱敏启动失败遮罩，不自动再次请求

### Requirement: 工作台启动结果写入脱敏诊断日志

服务端 SHALL 在每次工作台启动请求结束时写一条诊断日志，至少包含设备 ID、协议类型（typert 或 rc.2）、auth generation，以及结果（成功或稳定错误码）。日志 MUST NOT 包含 launch token、tokenized URL、查询串、cookie 名称或值，以及任何可还原认证材料的派生值。

#### Scenario: 成功启动的日志不含认证材料
- **WHEN** typert 设备的一次工作台启动成功
- **THEN** 日志记录设备 ID、协议类型、auth generation 和成功结果，且不出现 token、tokenized URL 或 cookie

#### Scenario: 失败启动记录稳定错误码
- **WHEN** 一次工作台启动以 `workbench-unavailable` 或 `workbench-auth-required` 失败
- **THEN** 日志记录设备 ID 与该稳定错误码，不包含服务端内部异常中可能携带的认证材料
