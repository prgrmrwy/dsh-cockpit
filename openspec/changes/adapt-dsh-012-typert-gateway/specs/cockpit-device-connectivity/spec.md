## ADDED Requirements

### Requirement: 多版本 DSH 协议自动适配
系统 SHALL 支持同一机群内 rc.2 线(`0.1.1-rc.2` 及更早)与 typert 网关线(`0.1.2-rc.1` 起)的 DSH 设备并存:对每台设备在连接建立时自动探测协议形态并选择对应适配器,MUST NOT 要求用户手工标注设备协议版本。探测结果 SHALL 只缓存于当前连接代,重连时重新探测(设备可能已被升级)。

typert 设备的观测能力 SHALL 与 rc.2 设备逐项等价:状态分级、根会话运行计数、会话状态分组、归档会话集、会话增删事件均不得因协议不同而缺失或降级;唯一被声明的例外见「pending 交互的 bridge 观测」。

#### Scenario: 探测选择协议
- **WHEN** 一台设备的 DSH 是 `0.1.2-rc.1`
- **THEN** 系统以 typert 适配器连接并达到 `READY`/`DEGRADED`,MUST NOT 报 `DSH_UNAVAILABLE: rc.2 host.describe HTTP 401`

#### Scenario: 设备被原地升级
- **WHEN** 一台 `READY` 的 rc.2 设备重启为 `0.1.2` 线
- **THEN** 重连后系统重新探测并切换到 typert 适配器,不需要用户干预

#### Scenario: 两版本设备并存
- **WHEN** 机群同时含 rc.2 与 typert 设备
- **THEN** 两类设备的 `DeviceStatusFacts` 字段行为一致,顶栏聚合不因协议差异出现口径分裂

### Requirement: waterfall 交互事件不得阻塞主机
typert 设备的 `$events` 订阅会收到 waterfall 模式的交互事件(approval/question)。系统收到 waterfall 帧后 SHALL 立即应答「放行」(`next`),MUST NOT 持有不答,MUST NOT 应答实质结果(result/rejected)—— 驾驶舱是只读观测者,不参与审批/提问决策。

#### Scenario: 主机审批不因驾驶舱在线而挂起
- **WHEN** 驾驶舱连接着一台 typert 设备,该设备上一个 Agent 发起审批
- **THEN** 用户在该设备官方 UI 上的审批流程与驾驶舱不在线时完全一致,不多等待

#### Scenario: 驾驶舱不产生审批决定
- **WHEN** 驾驶舱收到任何 waterfall 交互帧
- **THEN** 它的应答仅为放行,官方 UI 或其它有权客户端仍是唯一决策方

### Requirement: typert 设备的认证获取与失败诊断
typert 设备的 API 访问需要 DSH 浏览器会话认证。系统 SHALL 提供获取并持久化认证凭据的路径,且凭据 MUST NOT 出现在日志或模型可见面。认证缺失或过期时,设备 SHALL 归入可诊断状态并附「需要认证/重新引导」的诊断信息,MUST NOT 表现为无差别连接失败。

#### Scenario: 凭据过期
- **WHEN** 一台 typert 设备的会话 cookie 过期导致 401
- **THEN** 设备状态与诊断明确指向认证问题,用户能按引导恢复,期间其它设备不受影响

## MODIFIED Requirements

### Requirement: 健康探测与状态分级可诊断

系统 SHALL 对每台设备至少区分:`DISABLED`(设备已禁用且不存在活跃连接)、`SSH_UNREACHABLE`(SSH 不可达/认证失败)、`TUNNEL_ERROR`(本地转发失败)、`DSH_UNAVAILABLE`(隧道通但 DSH 服务不可达)、`NON_DSH_SERVICE`(端口有服务但不是 DSH)、`INCOMPATIBLE`、`CONNECTING`(正在连接/重连退避中)、`READY`、`DEGRADED`。状态应由连接层驱动;探活方式随协议适配(rc.2 用 `host.describe`,typert 用等价轻量端点),且不得仅凭单一探活调用或 `command -v` 来判断 DSH 未安装。`DISABLED` MUST NOT 被表示为 `CONNECTING`、错误或其它瞬时连接状态。

#### Scenario: 启动时设备不可达
- **WHEN** 驾驶舱启动后,一台已启用的登记设备 SSH 不可达
- **THEN** 系统显示 `SSH_UNREACHABLE` 与最后已知信息;不阻塞其他设备,也不误判为从未存在

#### Scenario: 隧道断开后重连
- **WHEN** 已启用设备原先 `READY`,隧道后断开
- **THEN** 系统立即标记断连并进入 `CONNECTING`(重连退避),恢复后重新探测并回到 `READY`/`DEGRADED`,并保留最后已知状态

#### Scenario: 禁用设备的状态
- **WHEN** 一台登记设备被禁用或驾驶舱启动时读取到已禁用设备
- **THEN** 系统将其报告为 `DISABLED`,不把它报告为正在连接或连接故障
