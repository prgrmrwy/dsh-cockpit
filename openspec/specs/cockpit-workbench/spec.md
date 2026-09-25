## Purpose

驾驶舱承载远端 DSH 工作台的方式：通过 iframe 直接呈现该设备原生 DSH Web（零协议耦合），懒加载、建了不销毁，并规定远端零改造与状态独立性。

## Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合
系统 SHALL 在用户选中设备时，通过 iframe 加载该设备原生 DSH Web，让用户直接使用远端 workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT 接管该设备的操作 API、改写其事件或代替其处理交互。

对要求浏览器会话认证的 typert 版本，iframe 首次创建或连接层确认浏览器认证需要恢复时 SHALL 加载当前 endpoint 的官方 tokenized root URL，使 DSH 自己设置 authority-bound HttpOnly cookie 并重定向到干净根路径。Cockpit MUST NOT 读取 iframe cookie，也不得在 iframe 后续 URL、界面或日志中保留 token。一次恢复 SHALL 只触发一个受连接代约束的重认证导航；成功后继续既有 keep-alive 语义，失败则由连接遮罩提供恢复路径，不得形成无界刷新循环。rc.2 iframe 继续加载原 endpoint，不增加认证步骤。

#### Scenario: 选中设备即见其完整工作台
- **WHEN** 用户顶栏点击一台 `READY` 设备
- **THEN** 内容区显示该设备原生 DSH Web；该设备的设置、插件、usage 均可正常使用

#### Scenario: 远端零改造
- **WHEN** 用户添加一台仅运行标准 `dsh web` 的设备
- **THEN** 驾驶舱不要求安装 bridge 即可使用工作台；typert 设备只需按官方要求完成启动 URL认证握手

#### Scenario: rc.2 工作台
- **WHEN** 用户选中一台 `READY` 的 rc.2 设备
- **THEN** iframe 按现有方式直接加载设备 endpoint，完整工作台可用

#### Scenario: typert 工作台首次认证
- **WHEN** 用户选中一台已有有效 launch token、但浏览器尚无当前 authority cookie 的 typert 设备
- **THEN** iframe 完成官方 token→cookie→干净根路径交换后显示完整原生工作台，不呈现裸 401

#### Scenario: typert 工作台缺少认证材料
- **WHEN** typert 设备需要认证但没有有效 launch token
- **THEN** Cockpit 显示粘贴当前官方启动 URL或启用受支持自动恢复的引导，不反复加载裸 401 iframe

#### Scenario: DSH cookie 静默重新签发
- **WHEN** 连接层在同一 endpoint 上确认设备 cookie失效并成功取得当前 launch token
- **THEN** 已创建的 iframe执行一次官方 tokenized root 导航、获得新 HttpOnly cookie并回到干净根路径，无需用户重建或重新选择设备

#### Scenario: 重认证失败
- **WHEN** tokenized root未成功建立浏览器会话或连接代在交换期间变化
- **THEN** 系统停止该次重认证并显示当前连接诊断，不循环刷新 iframe，也不让旧连接代结果覆盖新连接代

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

系统 SHALL 在用户对工作台目录/路径操作时，尊重远端环境：远端 workspace 路径在中央不映射，且 MUST NOT 以**本机路径语义**把远端路径交给本机工具。系统 MUST NOT 自动下载/同步/devices 共享工作区文件，MUST NOT 调用远端 `host.openPath` 打开本机应用。

系统 MAY 把远端路径连同**显式远端 authority**（例如 `ssh-remote+<alias>`）一并交给本机应用，前提是该引用在语义上不可被解释为本机路径，且经由本规范另行约束的 bridge 接缝。裸远端路径 MUST NOT 以任何形式交给本机打开器。

#### Scenario: 裸远端路径给本机工具
- **WHEN** 用户在工作台中复制远端文件路径并希望用本机应用打开
- **THEN** 系统不将该裸路径交给本机打开器；用户明确可选择复制路径或在远端适当方式处理

#### Scenario: 带远端 authority 的显式引用
- **WHEN** bridge 接缝产出携带显式远端 authority 的引用
- **THEN** 允许交给本机应用；该引用明确标注路径归属设备，不构成按本机路径解释远端路径

#### Scenario: 目录操作
- **WHEN** 用户在远端工作台选择目录
- **THEN** 目录操作在远端环境下执行，不按本机路径解释

#### Scenario: 不经远端 host 打开本机应用
- **WHEN** 任何路径打开需求出现
- **THEN** 系统不调用远端 `host.openPath`；打开动作只可由宿主机浏览器交给本机系统 handler

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

### Requirement: 未安装桥接时核心工作台与人工兜底保持可用
bridge SHALL 继续是可选配套。设备未安装、安装旧版或 bridge 暂不可用时，系统 SHALL 保持原生 DSH 工作台、running/完成提醒/会话/归档等可由官方 Host API 获得的只读状态、设备切换及完成提醒人工清除可用。

由于 typert Host API 不再向已放行的旁观订阅者提供 approval/question resolved 信号，未加载兼容 bridge 时，该设备的 pending SHALL 明确标记为“不可观测”，MUST NOT 以数值 0 表示确认没有等待。此限制不得使设备连接状态变成错误，也不得影响其它聚合字段。

#### Scenario: typert 未安装兼容 bridge
- **WHEN** typert 设备已连接，但没有兼容 bridge pending snapshot
- **THEN** 原生工作台和其它状态聚合正常，pending 显示不可观测，完成提醒人工清除仍可用

#### Scenario: typert bridge 开始上报
- **WHEN** 兼容 bridge 成功上报第一份当前 pending snapshot
- **THEN** pending 变为可观测并按该 snapshot 呈现；不得把启用 bridge 表示为设备连接状态变化

#### Scenario: rc.2 设备
- **WHEN** rc.2 设备没有 bridge
- **THEN** pending 仍由其既有 Host 事件流观测，行为不因本 change 改变

#### Scenario: 设备运行旧版桥接
- **WHEN** hello 报告的 bridge 版本不具备可靠 pending snapshot 协议
- **THEN** 系统保持原生工作台、其它只读状态聚合与设备级完成提醒人工清除可用，并将 typert pending 明确标记为不可观测

#### Scenario: 桥接故障不影响工作台
- **WHEN** bridge 的 hello、确认、pending snapshot 或重试持续失败
- **THEN** iframe 内的 DSH 会话操作、输入、滚动和连接不受影响，设备级完成提醒人工清除保持可用

### Requirement: bridge 旁路上报 typert 官方 pending snapshot
对 typert 设备，兼容 bridge SHALL 只读订阅官方 `ctx.uiSession.pendingInteractions` observable，并经现有 device-origin-bound、短 TTL capability 通道上报完整的最小 snapshot。每项只包含状态聚合所需的 `sessionId`、`kind` 与不透明 `key`；MUST NOT 包含问题正文、审批原因、工具参数、回答、对话、settings、credentials 或 provider token。

bridge SHALL 在 snapshot 变化及既有 hello/activation 恢复点上报当前完整 snapshot；Cockpit server SHALL 以新 snapshot 替换该设备上一份 bridge pending 状态，使页面重载、请求解除或中间通知丢失后仍可收敛。bridge MUST NOT 注册 approval/question Remote Event listener，MUST NOT 回答或延迟官方 waterfall。

#### Scenario: 官方 UI 出现并解除 pending
- **WHEN** typert 官方 client 的 pending snapshot 加入一个 approval/question，之后又将其移除
- **THEN** bridge 分别上报含该项和不含该项的完整 snapshot，设备等待提示相应出现并解除

#### Scenario: bridge 重载时已有 pending
- **WHEN** bridge 页面加载时官方 pending snapshot 已非空
- **THEN** bridge 首次成功握手后上报当前完整 snapshot，不要求重新触发请求边沿

#### Scenario: 上报失败后恢复
- **WHEN** pending snapshot 上报因网络或 capability 失效失败，之后 hello、activation 或 capability 续签成功
- **THEN** bridge 重发最新完整 snapshot；失败保持静默，不影响官方工作台和交互处理

#### Scenario: 最小化旁路数据
- **WHEN** bridge 上报 pending snapshot
- **THEN** 请求只含设备能力协议元数据及 `sessionId/kind/key` 集合，不读取或发送交互内容

### Requirement: 驾驶舱为设备提供远程编辑器打开接缝

驾驶舱 SHALL 经 bridge 插件向设备 DSH 页面提供稳定的远程编辑器打开服务。完整服务名 SHALL 为 `cockpitBridge.editorOpen`，这是跨仓契约的唯一真相源；变更该名字属于 breaking change。

服务 SHALL 面向任意同页面插件，MUST NOT 引用、命名或假设任何具体消费方。服务 SHALL 在 bridge fiber 生命周期内稳定提供，调用时读取最新的握手配置；握手尚未完成、本机设备无 alias 或 alias 非法时 SHALL 拒绝调用，使消费方可回落其默认行为。

`sshAlias` SHALL 经既有 `bridge-config` 握手下发，沿用该通道的精确 `targetOrigin` 与 origin 校验。alias MUST 满足 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`；不满足时 MUST 视为能力不可用。

服务调用 SHALL 接收一个路径并在设备 iframe 内、原始用户激活链路中直接产出 `vscode://vscode-remote/ssh-remote+<alias><absolute-path>?windowId=_blank`，交给浏览器系统 handler。系统 MUST NOT 为此新增 iframe→父页面反向动作消息。

调用前 SHALL 校验路径：MUST 为 POSIX 绝对路径或 Windows drive 绝对路径，MUST NOT 含 `..` 路径段。校验失败 SHALL 拒绝且不产出 URI。

#### Scenario: 远端设备打开目录
- **WHEN** bridge 已收到合法 sshAlias，消费方在用户点击调用服务并传入绝对路径
- **THEN** 服务在同一用户激活链路中产出 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并交给系统 handler

#### Scenario: 本机设备无 alias
- **WHEN** 当前设备是本机设备、握手未携带 sshAlias
- **THEN** 服务拒绝调用且不产出 URI；消费方可回落其默认行为

#### Scenario: alias 不满足字符约束
- **WHEN** 握手携带的 alias 含 `@`、`:`、空白或其它约束外字符
- **THEN** bridge 不采纳该 alias，服务拒绝调用且不产出 URI

#### Scenario: 相对路径被拒绝
- **WHEN** 服务收到的路径不是绝对路径
- **THEN** 服务拒绝该调用，不产出 URI

#### Scenario: 路径含上跳段被拒绝
- **WHEN** 服务收到的路径含 `..` 段
- **THEN** 服务拒绝该调用，不产出 URI

#### Scenario: 配置续签即时生效
- **WHEN** 父页面续签 capability 并重发 bridge-config
- **THEN** 服务后续调用读取最新配置，不持有旧 alias 或旧 origin 快照

#### Scenario: 编辑器未注册 scheme
- **WHEN** URI 已交给系统 handler，但宿主机没有注册处理该 scheme 的编辑器或未安装 Remote-SSH
- **THEN** 系统不伪造成功；行为由操作系统/浏览器标准处理决定

#### Scenario: bridge 卸载
- **WHEN** bridge fiber 卸载
- **THEN** 远程编辑器服务自动注销，不留下失效实现

### Requirement: bridge 是唯一跨边界通信切面

设备页面与驾驶舱之间的一切通信 SHALL 经 bridge 插件完成。其它设备页面插件 MUST NOT 直接向驾驶舱发送 postMessage 或 HTTP 请求；驾驶舱 MUST NOT 为单个消费方新增第二条跨文档通道。

bridge 对同页面插件暴露的能力 SHALL 使用稳定、完整、可运行时探测的服务名。每项服务契约 MUST 封闭且用途明确，MUST NOT 演化为通用 RPC 或任意动作入口。

本能力只传递既有握手中的 alias，并在浏览器内产生 URI。它 MUST NOT 传输凭据、token、会话内容、settings 或 provider token，MUST NOT 新增任何远端命令执行面；驾驶舱 SSH 用途仍仅为 `-L` 端口转发。

#### Scenario: 不新增第二条跨文档通道
- **WHEN** 同页面插件需要使用驾驶舱能力
- **THEN** 它运行时探测 bridge 暴露的服务；不得自行与父页面或驾驶舱 HTTP API 通信

#### Scenario: 能力不绑定具体消费方
- **WHEN** 审阅驾驶舱与 bridge 的源码及服务契约
- **THEN** 其中不出现任何具体消费方 package 名或产品名；能力对任意同页面插件一视同仁

#### Scenario: 服务契约封闭
- **WHEN** 消费方调用 `cockpitBridge.editorOpen`
- **THEN** 服务只接受路径并执行远程编辑器打开，不接受任意 method、命令或附加载荷

#### Scenario: 不新增远端执行面
- **WHEN** 远程打开能力被使用
- **THEN** 系统仅在浏览器中产出 URI 交给本机系统 handler，不经 SSH 或其它通道执行远端命令

#### Scenario: 接缝故障不影响工作台
- **WHEN** 服务缺少配置、拒绝调用或 `window.open` 抛错
- **THEN** bridge 不向宿主 DSH 页面泄漏未捕获错误，既有会话上报与 pending snapshot 不受影响
