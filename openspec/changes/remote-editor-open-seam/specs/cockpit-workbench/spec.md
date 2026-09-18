## MODIFIED Requirements

### Requirement: 远端边界与安全

系统 SHALL 在用户对工作台目录/路径操作时，尊重远端环境：远端 workspace 路径在中央不映射，且 MUST NOT 以**本机路径语义**把远端路径交给本机工具。系统 MUST NOT 自动下载/同步/devices 共享工作区文件，MUST NOT 调用远端 `host.openPath` 打开本机应用。

系统 MAY 把远端路径连同**显式远端 authority**（标识该路径属于哪台设备的前缀，例如 `ssh-remote+<alias>`）一并交给本机应用，前提是该引用在语义上不可被解释为本机路径，且经由本规范另行约束的受控接缝（见「驾驶舱为设备提供远程编辑器打开接缝」）。裸远端路径 MUST NOT 以任何形式交给本机打开器。

#### Scenario: 裸远端路径给本机工具
- **WHEN** 用户在工作台中复制远端文件路径并希望用本机应用打开
- **THEN** 系统不将该裸路径交给本机打开器；用户明确可选择复制路径或在远端适当方式处理

#### Scenario: 带远端 authority 的显式引用
- **WHEN** 系统经受控接缝产出携带显式远端 authority 的引用（例如 `vscode://vscode-remote/ssh-remote+<alias><path>`）
- **THEN** 允许交给本机应用；该引用明确标注路径归属设备，不构成「按本机路径解释远端路径」

#### Scenario: 目录操作
- **WHEN** 用户在远端工作台选择目录
- **THEN** 目录操作在远端环境下执行，不按本机路径解释

#### Scenario: 不经远端 host 打开本机应用
- **WHEN** 任何路径打开需求出现
- **THEN** 系统不调用远端 `host.openPath`；打开动作只可由宿主机浏览器交给本机系统 handler

## ADDED Requirements

### Requirement: 驾驶舱为设备提供远程编辑器打开接缝

驾驶舱 SHALL 为设备工作台提供一个可选的远程编辑器打开接缝：把设备侧发起的绝对路径，连同该设备的远端 authority，产出为本机可解析的编辑器引用并交给系统 handler。

该接缝 SHALL 仅在设备登记了合法 `sshAlias` 时可用。alias MUST 满足 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`；不满足时 MUST 视为能力不可用，MUST NOT 参与引用拼装。

alias SHALL 经既有 `bridge-config` 握手下发，沿用该通道已有的精确 `targetOrigin` 与 origin 校验。

设备页面与驾驶舱之间的**一切**通信 SHALL 经桥接插件完成。驾驶舱 MUST NOT 为此新增任何其它跨文档通道，无论其是否经过 origin 校验；设备页面中的其它插件 MUST NOT 直接与驾驶舱通信。此约束使 origin 校验、能力续签与失败重试只有一份实现。

驾驶舱侧暴露的能力 SHALL 面向**任意**同页面插件，以稳定的完整服务名标识。该服务名是跨仓契约的唯一真相源，其变更即为 breaking change。驾驶舱 MUST NOT 引用、命名或假设任何具体消费方插件的存在。

引用 SHALL 由**父页面**产出并交给系统 handler，形态为 `vscode://vscode-remote/ssh-remote+<alias><absolute-path>?windowId=_blank`；`windowId=_blank` 用于强制新窗口，避免顶替用户当前窗口。设备 iframe MUST NOT 自行发起该导航。

产出引用前，父页面 SHALL 校验路径：MUST 为绝对路径，MUST NOT 含 `..` 路径段。校验失败 MUST 拒绝且不产出任何引用。

#### Scenario: 远端设备打开目录
- **WHEN** 已连接的远端设备登记了合法 sshAlias，设备侧经接缝请求打开一个绝对路径
- **THEN** 父页面产出 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并交给系统 handler

#### Scenario: 本机设备无 alias
- **WHEN** 当前设备是本机设备、未登记 sshAlias
- **THEN** 握手不声明该能力可用；设备侧按能力缺失处理并回落其本机默认行为

#### Scenario: alias 不满足字符约束
- **WHEN** 设备登记的 alias 含 `@`、`:`、空白或其它约束外字符
- **THEN** 驾驶舱视为能力不可用，MUST NOT 拼装引用

#### Scenario: 相对路径被拒绝
- **WHEN** 打开请求携带的路径不是绝对路径
- **THEN** 父页面拒绝该请求，不产出任何引用

#### Scenario: 路径含上跳段被拒绝
- **WHEN** 打开请求携带的路径含 `..` 段
- **THEN** 父页面拒绝该请求，不产出任何引用

#### Scenario: 编辑器未注册 scheme
- **WHEN** 引用已交给系统 handler，但宿主机没有注册处理该 scheme 的编辑器或未安装 Remote-SSH 扩展
- **THEN** 系统不伪造成功；其行为由操作系统/浏览器的标准处理决定

#### Scenario: 接缝故障不影响工作台
- **WHEN** 接缝任一环节失败
- **THEN** iframe 内的 DSH 会话操作、状态聚合与设备切换不受影响

#### Scenario: 不新增第二条跨文档通道
- **WHEN** 需要在设备页面与驾驶舱之间传递新信息
- **THEN** 该通信经桥接插件完成；系统不新增独立的 postMessage 或其它跨文档通道

#### Scenario: 能力不绑定具体消费方
- **WHEN** 审阅驾驶舱与桥接插件的源码及其暴露的服务契约
- **THEN** 其中不出现任何具体消费方插件的 package 名或产品名；能力对任意同页面插件一视同仁

### Requirement: 桥接反向请求的信任边界

既有桥接通道为**设备到驾驶舱的只读上报**。本能力首次引入**反向请求**（设备 iframe 触发父页面执行动作），因此系统 SHALL 对该方向单独立规。

父页面 SHALL 只接受**封闭的已知动作集合**；未知 `type` 的消息 MUST 被静默丢弃。反向请求的载荷 MUST 限于动作所需的最小标识（本能力为一个绝对路径），MUST NOT 携带凭据、token、会话内容、settings 或 provider token。

父页面 MUST 把来自 iframe 的一切输入视为**不可信**：即使设备侧已做过校验，父页面 MUST 独立完成 origin 校验与参数校验后才执行动作。

该接缝 MUST NOT 新增任何远端命令执行面。驾驶舱既有 SSH 连接用途 SHALL 保持不变（仅 `-L` 端口转发），MUST NOT 因本能力获得执行任意命令的通道。

#### Scenario: 未知动作被丢弃
- **WHEN** 父页面收到 `type` 不在已知动作集合内的 postMessage
- **THEN** 静默丢弃，不执行任何动作

#### Scenario: 非法 origin 被丢弃
- **WHEN** 父页面收到反向请求，但其 origin 与当前设备工作台 origin 不匹配
- **THEN** 静默丢弃，MUST NOT 执行动作

#### Scenario: 父页面独立校验
- **WHEN** 设备侧发来一个已在其本地校验过的路径
- **THEN** 父页面仍独立完成全部校验；不因设备侧声称已校验而跳过

#### Scenario: 载荷最小化
- **WHEN** 接缝传递一次打开请求
- **THEN** 其载荷仅含路径与协议元数据，不含凭据、token 或会话内容

#### Scenario: 不新增远端执行面
- **WHEN** 远程打开能力被使用
- **THEN** 系统仅在宿主机产出引用交给本地系统 handler，不经 SSH 或任何其它通道在远端执行命令
