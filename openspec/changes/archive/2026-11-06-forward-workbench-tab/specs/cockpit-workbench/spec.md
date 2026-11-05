## ADDED Requirements

### Requirement: 同端口转发标签页在驾驶舱内承载设备上的其它 Web 服务

带工作台标签页标记的条目被选中时，系统 SHALL 以 iframe 承载 `http://127.0.0.1:<设备端口>` 上的服务。sandbox 与 allow 设置和设备工作台 iframe 相同，并带 `referrerPolicy="no-referrer"`。

- 首次选中时才创建；之后切换标签页、切换设备都 MUST NOT 销毁它。条目被删除、标记被取消，或者设备被禁用、被移除时，SHALL 销毁。
- 条目不是 `ready` 时，SHALL 显示状态文字与诊断，不创建 iframe；已创建的 iframe 保留在遮罩后面。
- 驾驶舱 MUST NOT 读取、代理或改写该服务的流量。

#### Scenario: 首次选中后创建，切走再切回不重载
- **GIVEN** 设备 A 的同端口条目 3082 带标签页标记且为 `ready`，未配打开地址命令，打开路径为 `/dashboard`
- **WHEN** 用户首次选中该标签页，然后切到 A 的工作台，再切到设备 B，最后切回该标签页
- **THEN** 首次选中时创建一个 iframe，并导航到 `http://127.0.0.1:3082/dashboard`；切回时仍是同一个 iframe，未重新加载

#### Scenario: 条目未就绪时只显示诊断
- **GIVEN** 带标签页标记的条目 3082 处于 `retrying`，诊断为 `local port 127.0.0.1:3082 is in use`，标签页从未创建 iframe
- **WHEN** 用户选中该标签页
- **THEN** 内容区显示「重试中」与该诊断，不创建 iframe；条目变为 `ready` 后，标签页创建 iframe 并加载

#### Scenario: 取消标记后销毁标签页
- **GIVEN** 标签页 3082 已创建 iframe
- **WHEN** 用户在面板取消该条目的标签页标记
- **THEN** 顶栏不再显示该标签页，其 iframe 被销毁；若它是当前视图，则回到该设备的工作台

### Requirement: 转发标签页的启动地址只交给 iframe 一次

标签页的启动地址 SHALL 按以下规则取得：

- 条目配有打开地址命令时，经驾驶舱解析端点取得；
- 未配命令时，在本地组装为 `http://127.0.0.1:<本地端口><打开路径或 />`。

地址的使用规则：

- 地址 SHALL 只赋值给该 iframe 一次；load 或导航超时后，父页面 SHALL 清除对它的引用；
- 地址 MUST NOT 写入 React 状态、存储、日志或事件流；
- 解析失败时 SHALL 显示该错误码对应的固定说明与「重试」，MUST NOT 显示服务端原始消息或命令输出；
- 标签页项的快捷菜单 SHALL 提供「重新加载」，按同样规则重新取得地址并导航；
- 系统 MUST NOT 自动重试。

#### Scenario: 经设备命令取得地址并只导航一次
- **GIVEN** 带标签页标记的条目 3082 为 `ready`，配有打开地址命令，解析端点返回 `http://127.0.0.1:3082/?token=T`
- **WHEN** 用户首次选中该标签页，之后又切走、切回
- **THEN** 只请求一次解析端点；iframe 被导航一次到该地址；切回时既不请求也不导航；页面状态与日志中不出现 `T`

#### Scenario: 解析失败可重试
- **GIVEN** 带标签页标记的条目 3082 的命令输出为空
- **WHEN** 用户选中该标签页，随后修好命令来源并点「重试」
- **THEN** 首次显示「没有在命令输出中找到该端口的地址。」与「重试」，不导航 iframe；点「重试」后再请求一次解析端点，成功后导航

#### Scenario: token 轮换后由用户重新加载
- **GIVEN** 标签页 3082 已加载，设备上的服务重启后换了 token
- **WHEN** 用户在该标签页项的快捷菜单中选「重新加载」
- **THEN** 系统再请求一次解析端点，并把同一个 iframe 导航到新地址；在此之前，系统不发起任何解析请求

### Requirement: 转发标签页不参与 bridge 握手

驾驶舱 MUST NOT 向转发标签页 iframe 发送 bridge 配置、设备激活消息或转发表快照，也 MUST NOT 为它签发能力串。来自它的 bridge 消息，例如能力串过期、实例结束，SHALL 被忽略。

- 即使该服务的页面装有 `dsh-cockpit-bridge`，它也因从未握手而保持不可用，MUST NOT 向驾驶舱上报会话。
- 同一设备的主工作台 bridge 不受影响。

#### Scenario: 装有 bridge 的服务在标签页中保持静默
- **GIVEN** 设备 A 的主工作台 bridge 已握手，标签页 3082 加载的页面也装有 `dsh-cockpit-bridge`
- **WHEN** 观察父页面发出的 postMessage、能力串签发请求与设备 A 的会话上报
- **THEN** 父页面只向 A 的主工作台 iframe 发送 bridge 配置，从未向 3082 的 iframe 发送；不为 3082 的 origin 签发能力串；A 的会话上报只来自主工作台

#### Scenario: 来自标签页的 bridge 消息被忽略
- **GIVEN** 标签页 3082 的 iframe 已挂载
- **WHEN** 它向父页面发送能力串过期消息与实例结束消息
- **THEN** 父页面不换发能力串，也不调用释放实例端点
