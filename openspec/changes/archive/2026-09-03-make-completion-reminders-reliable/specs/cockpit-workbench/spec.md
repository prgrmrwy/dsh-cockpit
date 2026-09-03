## ADDED Requirements

### Requirement: 可选桥接无损上报会话打开事实

当设备安装兼容的桥接插件时，系统 SHALL 将设备 DSH 页面当前打开的根会话 ID 上报给 Cockpit，用于完成提醒的精确已读确认。短时间内连续打开多个不同会话时，每个不同会话 ID MUST 至少被提交一次，系统 MUST NOT 因 trailing debounce 只保留最终 ID。桥接只可传输完成提醒协调所需的设备来源、插件版本和会话标识，MUST NOT 读取或传输会话内容、settings、credentials 或 provider token。

#### Scenario: 快速连续打开多个会话
- **WHEN** 用户在一个合并窗口内依次打开完成会话 A、B、C
- **THEN** 桥接最终向 Cockpit 提交 A、B、C 的打开确认，而不是只提交 C

#### Scenario: 打开后立即归档
- **WHEN** 用户打开会话 A 后在延迟发送窗口结束前立即归档，使当前选择清空
- **THEN** 桥接仍提交打开时捕获的 A，而不是在延迟任务中重新读取空的当前选择并丢弃确认

#### Scenario: 归档后恢复同一会话
- **WHEN** 当前选择因归档变为空，之后恢复并重新打开相同会话 ID
- **THEN** 桥接将其视为新的可确认选择并允许再次提交该 ID

#### Scenario: 普通列表刷新保持同一选择
- **WHEN** 会话列表刷新但当前打开会话未变化，且该会话没有待重试的失败确认
- **THEN** 桥接不产生无界重复请求

#### Scenario: 最小化桥接数据
- **WHEN** 桥接提交 hello、当前选择或打开确认
- **THEN** 请求不包含对话正文、工作区文件内容、settings、credentials 或 provider token

### Requirement: 桥接确认可检测失败并最终重试

桥接 SHALL 只在 Cockpit 明确接受打开确认后将其视为已交付。网络异常、非成功 HTTP 响应、认证失败或当前 Cockpit 暂不可达时，桥接 MUST 保留有界且按会话去重的待确认状态，并在后续明确的恢复机会重试，例如新的会话选择、设备 iframe 激活或连接 hello 成功。失败处理 MUST 保持静默，不得阻断或报错到设备 DSH 工作台。

#### Scenario: 网络请求失败
- **WHEN** 会话打开确认因网络异常或 Cockpit 暂不可达而失败
- **THEN** 设备工作台继续正常运行，桥接保留该会话的待确认状态，并在后续恢复机会重试

#### Scenario: 非认证类 HTTP 错误
- **WHEN** Cockpit 对打开确认返回 401 以外的非成功状态
- **THEN** 桥接不得把该确认视为成功，也不得仅因当前选择未变化而永久抑制重试

#### Scenario: 认证失效
- **WHEN** 打开确认返回未认证
- **THEN** 桥接按受支持的认证流程重新建立本机授权，并仅在重试收到成功响应后删除待确认状态

#### Scenario: 设备重新激活
- **WHEN** 含有待确认会话的 keep-alive iframe 从隐藏状态重新成为当前设备
- **THEN** 桥接重试待确认会话，并重新确认当前打开会话

#### Scenario: 待确认集合有界
- **WHEN** 长时间无法连接 Cockpit 且用户打开了许多会话
- **THEN** 桥接按确定的容量或时效策略限制本地待确认状态，不造成无界内存增长，并保留最新当前会话的确认机会

### Requirement: 桥接端口与认证配置一致且失败可见

系统 SHALL 确保桥接请求的 Cockpit origin 与实际 Cockpit 页面 origin 一致，并使用浏览器可在跨设备端口请求中实际提供、且不向插件暴露持久 token 明文的认证机制。若运行配置无法支持桥接，系统 MUST 明确显示桥接未就绪或配置不兼容，MUST NOT 仅凭 hello 的历史时间戳持续表示精确清除能力可用。

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

#### Scenario: 桥接健康过期
- **WHEN** 最近一次成功 hello 或确认超过定义的活跃期限，或连续确认失败
- **THEN** 顶栏不再把该设备表示为具备当前可用的精确清除能力，并提示仍可使用人工清除兜底

### Requirement: 未安装桥接时核心工作台与人工兜底保持可用

桥接 SHALL 继续是可选能力。设备未安装、安装旧版或 bridge 暂不可用时，系统 SHALL 保持原生 DSH 工作台、只读状态聚合和设备切换可用；完成提醒的精确按会话自动清除可以降级，但 Device Tab 的设备级人工清除 MUST 保持可用。

#### Scenario: 设备未安装桥接
- **WHEN** 用户连接一台仅运行标准 DSH Web 的设备
- **THEN** 原生工作台和状态聚合正常工作，顶栏提示未检测到精确 bridge，并允许人工清除该设备完成提醒

#### Scenario: 设备运行旧版桥接
- **WHEN** hello 报告的 bridge 版本不具备可靠确认协议
- **THEN** 系统不宣称具备可靠自动清除能力，继续接受兼容上报并提供人工兜底

#### Scenario: 桥接故障不影响工作台
- **WHEN** bridge 的 hello、确认或重试持续失败
- **THEN** iframe 内的 DSH 会话操作、输入、滚动和连接不受影响
