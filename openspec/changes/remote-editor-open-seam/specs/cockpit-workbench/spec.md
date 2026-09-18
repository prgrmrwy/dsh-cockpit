## MODIFIED Requirements

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

## ADDED Requirements

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
