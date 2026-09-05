## ADDED Requirements

### Requirement: 同一机群自动适配 rc.2 与 typert 协议
系统 SHALL 支持 rc.2 线（`0.1.1-rc.2`）与 typert 网关线（`0.1.2-rc.1` 起）的 DSH 设备并存。每台设备 SHALL 在连接建立时按响应形态自动选择适配器，MUST NOT 要求用户手工配置协议版本；选择结果只属于当前连接代，重连时 SHALL 重新确认，以适配设备原地升级。

除下文明确记录的 typert pending 来源边界外，typert 适配 SHALL 保持现有用户能力：原生工作台可用、连接状态可诊断、根会话运行状态及完成提醒可聚合、会话增删可到达、workspace 与归档集合可在重连后恢复。

#### Scenario: 两个版本族同时在线
- **WHEN** 机群同时包含 rc.2 与 typert 设备，且各自满足其官方连接前提
- **THEN** 系统为每台设备选择正确适配器，两类设备均可进入 `READY`/`DEGRADED` 并提供现有工作台与状态聚合能力

#### Scenario: 设备原地升级
- **WHEN** 一台原为 rc.2 的设备重启并升级到 `0.1.2` typert 线
- **THEN** 下一连接代重新确认协议并切换适配器，无需用户手工修改协议版本

#### Scenario: 非 DSH 的 401 服务
- **WHEN** 登记端口返回 401，但响应不满足 DSH 官方认证提示与交换协议
- **THEN** 系统不得仅凭 401 将其认作 typert DSH，并按既有非 DSH/不兼容诊断语义失败

### Requirement: typert waterfall 旁观订阅不得阻塞主机交互
Cockpit 为接收 typert `$events` 的 session emit 而收到任何 waterfall 帧时，SHALL 立即通过官方 `$events/result` endpoint 回复 `outcome.kind = 'next'`。Cockpit MUST NOT 持有该 delivery，MUST NOT 返回 `result` 或 `rejected`，MUST NOT 从请求内容推导或代替用户决定。

该放行与 bridge pending 观测 SHALL 相互独立：bridge 只读取官方 client 已发布的 pending snapshot，不注册 approval/question waterfall listener。

#### Scenario: 官方 UI 与 Cockpit 同时在线
- **WHEN** Cockpit 与设备官方 UI 同时订阅 typert Remote Events，Agent 发起审批或提问
- **THEN** Cockpit 立即放行自己的 delivery，官方 UI 仍按原流程显示并完成交互，等待时间不因 Cockpit 增加

#### Scenario: Cockpit 是唯一 Remote Events 客户端
- **WHEN** Cockpit 收到 waterfall 时没有其它浏览器客户端在线
- **THEN** Cockpit 回复 `next`，使请求继续走 DSH 原有的下一监听者或默认路径，其效果与没有 Cockpit 旁观订阅者一致

#### Scenario: waterfall 被取消或回复竞态
- **WHEN** cancel、断线或上游完成与 Cockpit 的 `next` 并发发生
- **THEN** Cockpit 幂等结束本地处理，不重试实质决定，也不因此残留或增加 pending 计数

### Requirement: typert 使用官方启动 URL完成最小认证握手
对要求浏览器会话认证的 typert 设备，系统 SHALL 接受用户粘贴该设备 `dsh web` 打印的官方启动 URL，从中校验并提取唯一 launch token，在当前设备 loopback endpoint 上执行 DSH 官方 `GET /?token=...` → signed cookie 交换。该机制仅用于恢复被 0.1.2 强制认证打断的 server API/WebSocket 访问与 iframe 加载。

系统 SHALL 只在 Cockpit 自有、权限收紧的设备存储中保存 token；MUST NOT 读取本机或远端 `~/.dsh`/日志来发现 token，MUST NOT 通过 SSH 执行发现命令，MUST NOT 建设账号密码、通用凭据或自动轮换协议。token 与交换得到的 cookie MUST NOT 出现在设备查询 API、`DeviceStatusFacts`、日志、诊断、错误正文或 iframe 完成交换后的干净 URL 中。

#### Scenario: 首次连接 typert 设备
- **WHEN** 设备呈现标准 DSH authentication-required 响应，且用户提供有效的官方启动 URL
- **THEN** server 在当前 endpoint 上换取 cookie，以该 cookie 完成协议确认、HTTP RPC 与 WebSocket upgrade，并进入正常连接生命周期

#### Scenario: 未提供或已失效的启动 URL
- **WHEN** typert 设备需要认证，但没有有效 launch token，或 DSH 重启使旧 token 失效
- **THEN** 设备保持不可用并给出“粘贴当前 dsh web 启动 URL”的可执行诊断；其它设备不受影响，系统不尝试自动读取 DSH 数据目录或日志

#### Scenario: endpoint authority 改变
- **WHEN** SSH 重连无法复用原 local port，但已保存的 launch token 对当前 DSH 进程仍有效
- **THEN** server 与 iframe 在新 authority 上重新执行官方交换，不尝试跨 authority 复用旧 cookie

#### Scenario: 更新或删除认证材料
- **WHEN** 用户提供新的启动 URL、显式清除认证材料或删除设备
- **THEN** 系统以新 token 替换旧 token，或清除对应持久及内存认证状态；任何读取接口均不回显旧值或新值

## MODIFIED Requirements

### Requirement: 健康探测与状态分级可诊断
系统 SHALL 对每台设备至少区分：`DISABLED`、`SSH_UNREACHABLE`、`TUNNEL_ERROR`、`DSH_UNAVAILABLE`、`NON_DSH_SERVICE`、`INCOMPATIBLE`、`CONNECTING`、`READY`、`DEGRADED`。状态应由连接层驱动；探活方式随协议形态选择，且不得仅凭单次 401、单一 RPC 或 `command -v` 判断服务身份或 DSH 是否安装。认证缺失属于可执行诊断，不新增连接状态枚举。

#### Scenario: 启动时设备不可达
- **WHEN** 驾驶舱启动后，一台已启用的登记设备 SSH 不可达
- **THEN** 系统显示 `SSH_UNREACHABLE` 与最后已知信息，不阻塞其它设备

#### Scenario: 隧道断开后重连
- **WHEN** 已启用设备原先 `READY`，隧道后断开
- **THEN** 系统立即标记断连并进入 `CONNECTING`，恢复后重新确认协议并回到 `READY`/`DEGRADED`，保留最后已知状态

#### Scenario: 禁用设备的状态
- **WHEN** 一台登记设备被禁用或驾驶舱启动时读取到已禁用设备
- **THEN** 系统将其报告为 `DISABLED`，不尝试协议探测、认证交换或连接，也不把它报告为正在连接或连接故障
