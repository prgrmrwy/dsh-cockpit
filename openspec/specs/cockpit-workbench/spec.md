## Purpose

驾驶舱承载远端 DSH 工作台的方式：通过 iframe 直接呈现该设备原生 DSH Web（零协议耦合），懒加载、建了不销毁，并规定远端零改造与状态独立性。

## Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合

系统 SHALL 在用户选中设备时，通过 iframe 加载该设备原生 DSH Web（`http://127.0.0.1:<localPort>`），让用户直接使用远端的 workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT 接管该设备的 workspace/session API，MUST NOT 改写事件，MUST NOT 在远端安装任何插件。

#### Scenario: 选中设备即见其完整工作台
- **WHEN** 用户顶栏点击一台 `READY` 设备
- **THEN** 内容区显示该设备原生 DSH Web；该设备的设置、插件、usage 均可正常使用

#### Scenario: 远端零改造
- **WHEN** 用户添加一台仅运行标准 dsh web 的设备
- **THEN** 驾驶舱不要求安装任何远端插件；工作台完整可用

### Requirement: 工作台懒加载、建了不销毁

系统 SHALL 首次点入某台已启用设备时才创建其 iframe；创建后不因切换设备而销毁，以保留其输入内容、滚动位置与连接状态。设备被禁用或移除时，系统 SHALL 销毁该设备的 iframe 并释放其页面连接；重新启用后再次选中 SHALL 创建新的 iframe，而不是恢复禁用前页面。

#### Scenario: 首次点入设备
- **WHEN** 用户第一次点击某台已启用设备
- **THEN** 系统创建该设备的 iframe 并加载其工作台

#### Scenario: 切换设备后保留工作台
- **WHEN** 用户从已启用设备 A 切换到已启用设备 B 再切回 A
- **THEN** A 的工作台保持在原状态（未重新加载），无需再次建立

#### Scenario: 已加载设备被禁用
- **WHEN** 一台已创建 iframe 的设备被禁用
- **THEN** 系统销毁该设备的 iframe，不再保留或重试其页面连接

#### Scenario: 禁用设备重新启用
- **WHEN** 用户重新启用设备并再次选择它
- **THEN** 系统使用新连接端点创建新的 iframe，不恢复禁用前的页面实例

### Requirement: 工作台与状态聚合独立

系统 SHALL 保持工作台（iframe 内远端 GUI）与驾驶舱状态聚合（驾驶舱直连 ws/RPC）相互独立；一方故障不影响另一方。iframe 加载或运行异常不得影响驾驶舱对设备状态的聚合。

#### Scenario: 工作台 iframe 异常
- **WHEN** 某设备工作台 iframe 加载失败或崩溃
- **THEN** 驾驶舱对该设备的运行状态/待办聚合不受影响

#### Scenario: 状态聚合异常
- **WHEN** 某设备状态聚合 ws 断开
- **THEN** 该设备工作台仍可正常操作，不受影响

### Requirement: 设备离线时保留工作台并覆盖明确遮罩

系统 SHALL 在已启用设备意外断连时保留其 iframe 内容，覆盖遮罩显示连接层具体原因与最后连接时间；用户可重连。系统不得在遮罩后静默允许操作（以免用户在已断连状态下误操作远端）。设备被明确禁用不属于意外离线，MUST NOT 显示连接遮罩或重连操作。

#### Scenario: 当前工作台设备断连
- **WHEN** 用户正在某台已启用设备工作台操作且其隧道意外断开
- **THEN** 系统显示遮罩并阻断误操作，用户可查看原因或等待自动重连

#### Scenario: 当前工作台设备被禁用
- **WHEN** 用户明确禁用当前工作台设备
- **THEN** 系统移除该工作台而不是显示离线遮罩，且不提供对禁用设备的重连操作

### Requirement: 远端边界与安全

系统 SHALL 在用户对工作台目录/路径操作时，尊重远端环境（例如远端 workspace 路径在中央不映射、且不把远端路径交给本机工具）。系统 MUST NOT 自动下载/同步/devices 共享工作区文件，MUST NOT 调用远端 `host.openPath` 打开本机应用。

#### Scenario: 远端路径给本机工具
- **WHEN** 用户在工作台中复制远端文件路径并希望用本机应用打开
- **THEN** 系统不将远端路径交给本机打开器；用户明确可选择复制路径或在远端适当方式处理

#### Scenario: 目录操作
- **WHEN** 用户在远端工作台选择目录
- **THEN** 目录操作在远端环境下执行，不按本机路径解释

### Requirement: 工作台 iframe 显式授予剪贴板读写权限

系统 SHALL 在承载设备原生 DSH Web 的工作台 iframe 上声明剪贴板权限（`clipboard-read` 与 `clipboard-write`），使嵌入的 DSH 页面在浏览器 Permissions Policy 收紧的默认 allowlist（Chrome 136+ 将 `clipboard-read`/`clipboard-write` 默认从 `*` 收紧为 `self`，跨源 iframe 必须显式授权）下仍可直接使用剪贴板 API。系统 MUST NOT 借此读取、代理、上报或存储设备页面剪贴板的内容；剪贴板操作由浏览器在设备 DSH 页面内直接完成，驾驶舱代码零参与。

#### Scenario: 工作台内复制正常可用
- **WHEN** 用户通过驾驶舱工作台操作设备 DSH，点击 DSH 页面中的复制按钮（如复制消息或代码块）
- **THEN** 复制成功完成，无需其它用户操作；粘贴到任意应用可见复制的文本内容

#### Scenario: 驾驶舱不接触剪贴板内容
- **WHEN** 用户在工作台内发起任意复制操作
- **THEN** 仅浏览器按权限策略在设备 DSH 页面与系统剪贴板之间完成写入；驾驶舱不读取、不转发、不持久化剪贴板内容

#### Scenario: 默认策略收紧环境（Chrome 136+）
- **WHEN** 用户在 Chrome 136+ 中打开驾驶舱并进入任一设备工作台
- **THEN** 该工作台 iframe 已携带显式剪贴板权限声明，DSH 页面调用 `navigator.clipboard` 不因权限策略抛出 `NotAllowedError`

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

系统 SHALL 确保桥接请求的 Cockpit origin 与实际 Cockpit 页面 origin 一致，并使用浏览器可在跨设备端口请求中实际提供、且不向插件暴露持久 token 明文的认证机制。若运行配置无法支持桥接，系统 MUST 明确显示桥接未就绪或配置不兼容。

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

### Requirement: 未安装桥接时核心工作台与人工兜底保持可用

桥接 SHALL 继续是可选能力。设备未安装、安装旧版或 bridge 暂不可用时，系统 SHALL 保持原生 DSH 工作台、只读状态聚合和设备切换可用；完成提醒的精确按会话自动清除可以降级，但 Device Tab 的设备级人工清除 MUST 保持可用。

#### Scenario: 设备未安装桥接
- **WHEN** 用户连接一台仅运行标准 DSH Web 的设备
- **THEN** 原生工作台和状态聚合正常工作，顶栏提示未检测到精确 bridge，并允许人工清除该设备完成提醒

#### Scenario: 设备运行旧版桥接
- **WHEN** hello 报告的 bridge 版本不具备可靠确认协议
- **THEN** 系统继续接受该兼容上报并按会话清除对应提醒，同时保持设备级人工清除兜底可用

#### Scenario: 桥接故障不影响工作台
- **WHEN** bridge 的 hello、确认或重试持续失败
- **THEN** iframe 内的 DSH 会话操作、输入、滚动和连接不受影响
