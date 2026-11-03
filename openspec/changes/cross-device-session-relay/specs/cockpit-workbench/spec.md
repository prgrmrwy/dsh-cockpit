## MODIFIED Requirements

### Requirement: bridge 是唯一跨边界通信切面

设备页面与驾驶舱之间的一切通信 SHALL 经 bridge 插件完成。其它设备页面插件 MUST NOT 直接向驾驶舱发送 postMessage 或 HTTP 请求；驾驶舱 MUST NOT 为单个消费方新增第二条跨文档通道。

本 Requirement 约束的是**设备页面（浏览器）**与驾驶舱之间的通信。由设备侧插件发起、发往其它设备的跨设备消息 SHALL 只经可选中继插件 `dsh-cockpit-relay`，由 `cockpit-session-relay` 与 `cockpit-relay-device-plugin` 约束；中继由驾驶舱服务端发起，MUST NOT 经过 iframe、postMessage 或 bridge 能力串，中继插件拒绝一切浏览器请求。驾驶舱对设备官方接口的探测、认证与状态聚合流量，以及既有 bridge 流量，不受本段影响。

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

#### Scenario: 中继不经过设备页面
- **GIVEN** 设备 A 装有 bridge 与中继插件，驾驶舱已与 A 的中继接入
- **WHEN** 驾驶舱向 A 投递一个信封
- **THEN** 请求由驾驶舱服务端直接发往 A 的 `deliver` 端点，不携带 bridge 能力串头；父页面未向 A 的 iframe 发送任何新的 postMessage
