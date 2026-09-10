## MODIFIED Requirements

### Requirement: 桥接确认可检测失败并最终重试

桥接 SHALL 只在 Cockpit 明确接受打开确认后将其视为已交付。网络异常、非成功 HTTP 响应、认证失败或当前 Cockpit 暂不可达时，桥接 MUST 保留有界且按会话去重的待确认状态，并在后续明确的恢复机会重试，例如新的会话选择、设备 iframe 激活或连接 hello 成功。capability 失效（未认证或 capability 无效类响应）时，桥接 MUST 请求父页面换发 capability 并在换发成功后重试；父页面 SHALL 在 capability 到期前自动续签并重发握手，使长时间停留在同一设备也持续可确认。失败处理 MUST 保持静默，不得阻断或报错到设备 DSH 工作台。

#### Scenario: 网络请求失败
- **WHEN** 会话打开确认因网络异常或 Cockpit 暂不可达而失败
- **THEN** 设备工作台继续正常运行，桥接保留该会话的待确认状态，并在后续恢复机会重试

#### Scenario: 非认证类 HTTP 错误
- **WHEN** Cockpit 对打开确认返回 401 以外的非成功状态
- **THEN** 桥接不得把该确认视为成功，也不得仅因当前选择未变化而永久抑制重试

#### Scenario: 认证失效
- **WHEN** 打开确认或 hello 返回未认证或 capability 失效响应
- **THEN** 桥接请求父页面换发 capability，仅在换发后的重试收到成功响应后删除待确认状态；期间设备工作台不受影响

#### Scenario: capability 到期自动续签
- **WHEN** 父页面持有的 capability 临近过期，且用户未做任何设备切换
- **THEN** 父页面在到期前换发新 capability 并重发 bridge-config 握手，打开确认无需用户操作即可继续生效

#### Scenario: 自动续签失败仍可自愈
- **WHEN** 自动续签因网络异常或 Cockpit 重启而失败
- **THEN** 父页面按有上限的退避重试换发；设备切换、iframe 激活等既有恢复机会继续生效，设备级人工清除兜底保持可用

#### Scenario: 设备重新激活
- **WHEN** 含有待确认会话的 keep-alive iframe 从隐藏状态重新成为当前设备
- **THEN** 桥接重试待确认会话，并重新确认当前打开会话

#### Scenario: 待确认集合有界
- **WHEN** 长时间无法连接 Cockpit 且用户打开了许多会话
- **THEN** 桥接按确定的容量或时效策略限制本地待确认状态，不造成无界内存增长，并保留最新当前会话的确认机会