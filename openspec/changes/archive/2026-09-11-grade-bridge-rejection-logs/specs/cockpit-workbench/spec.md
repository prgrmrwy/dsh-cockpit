## MODIFIED Requirements

### Requirement: 桥接端口与认证配置一致且失败可见

系统 SHALL 确保桥接请求的 Cockpit origin 与实际 Cockpit 页面 origin 一致，并使用浏览器可在跨设备端口请求中实际提供、且不向插件暴露持久 token 明文的认证机制。若运行配置无法支持桥接，系统 MUST 明确显示桥接未就绪或配置不兼容。

系统 SHALL 使桥接拒绝的服务端日志区分「可自愈的常规拒绝」与「需要人介入的自愈失败」，并把日志级别与后者对齐，使告警级恢复「需要人看」的语义：

- 常规拒绝——capability 过期或失效、错设备、origin 不匹配——SHALL 以调试级记录，且 SHALL 保留可定位归属的结构字段（设备标识、origin、协议版本、归因分类）。
- 系统 SHALL 仅在该设备的桥接**自愈失败**时才记录告警级日志：判定条件是同一设备在同一时间窗内的常规拒绝次数达到阈值，且该窗口内没有任何一次成功的桥接上报。该条件是「桥接不再自愈、完成提醒可能停止清除」的可观测表征。
- 同一设备同一归因的连续常规拒绝 SHALL 聚合计数，MUST NOT 逐条输出；聚合输出 SHALL 包含该窗口内的条数、归因与设备标识。
- 系统 SHALL 使调试级桥接日志可被有意开启，使降级不损失诊断能力；开启后 MUST NOT 因此改变任何拒绝的判定或响应。
- 上述日志 MUST NOT 包含 token 或 capability 明文、会话正文、provider 凭据或远端命令输出以外的敏感材料。

本要求只约束服务端日志的级别与聚合。系统 MUST NOT 因本要求改变：拒绝的 HTTP 状态码与响应体（含 `bridge-capability-invalid` 错误码）、桥接收到拒绝后的换发与重投行为、设备级人工清除兜底、以及任何鉴权边界——被拒绝的请求仍然被拒绝。

#### Scenario: Cockpit 使用默认端口
- **WHEN** Cockpit 页面运行在受支持的默认 origin
- **THEN** bridge hello、打开确认和父页面 activation 的 origin 校验使用同一 origin，认证成功后可完成精确清除

#### Scenario: Cockpit 使用配置端口
- **WHEN** Cockpit 通过受支持配置运行在非默认端口
- **THEN** bridge 请求和父子页面消息使用实际 Cockpit origin，而不是静默发送到固定默认端口

#### Scenario: 配置端口暂不受支持
- **WHEN** 当前部署无法安全地把非默认 Cockpit origin 提供给设备 bridge
- **THEN** 启动或界面明确说明精确 bridge 功能不受支持，并保持设备级人工清除可用，不得显示误导性的已连接状态

#### Scenario: 跨端口认证
- **WHEN** bridge 从设备 DSH origin 请求 Cockpit API
- **THEN** 认证流程不依赖浏览器不会随该跨端口请求发送的 cookie 属性，也不要求插件读取 HttpOnly token

#### Scenario: 常规拒绝不进入告警级
- **WHEN** 某设备的桥接请求因 capability 过期或失效被拒绝，且该设备随后通过换发 capability 成功重投
- **THEN** 该拒绝以调试级记录并携带设备标识、origin、协议版本与归因，告警级不产生条目

#### Scenario: 自愈失败提升为告警
- **WHEN** 同一设备在同一时间窗内的常规拒绝次数达到阈值，且该窗口内没有任何成功的桥接上报
- **THEN** 系统记录一条告警级日志，指明该设备标识、归因分类与窗口内拒绝条数，使「完成提醒可能停止清除」可从服务端日志直接定位

#### Scenario: 重复拒绝聚合而非刷屏
- **WHEN** 同一设备因同一归因在短时间内被连续拒绝多次
- **THEN** 系统聚合计数并在聚合输出中给出条数与归因，MUST NOT 为每次拒绝各输出一条独立记录

#### Scenario: 调试级可有意开启
- **WHEN** 运维者显式开启调试级服务端日志
- **THEN** 常规桥接拒绝的结构化条目可见，使其可按设备与归因排查；未开启时这些条目不出现在默认输出中

#### Scenario: 拒绝语义与响应不变
- **WHEN** 任一桥接请求被拒绝
- **THEN** 其 HTTP 状态码与响应体保持既有语义（capability 类失效仍为 400 且错误码为 `bridge-capability-invalid`），桥接的换发与重投行为、人工清除兜底与鉴权边界均不受日志分级影响
