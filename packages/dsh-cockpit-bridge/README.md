# dsh-cockpit-bridge

官方 DSH web 客户端插件：把"用户点击了哪个会话"从浏览器本地状态无损桥接给
本机 dsh-cockpit，使驾驶舱顶栏的完成提醒（绿点）按官方 select 语义精确清除，
并在快速连续切换会话、打开后立即归档、网络瞬断等场景下也不丢失确认。

从 0.4.0 起，插件还是设备 DSH 页面与驾驶舱之间的**唯一通信切面**：它以稳定
Cordis 服务名 `cockpitBridge.editorOpen` 向任意同页面插件提供远程编辑器打开能力，
0.6.0 起以 `cockpitBridge.forwards` 提供设备回环端口的转发申请能力（取代 0.5.x 的 `cockpitBridge.portForward`）。
消费方只传绝对路径；bridge 使用父页面握手下发的 SSH config alias，在原始用户点击
链路中生成 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank`。

## 为什么存在

官方侧栏打开会话（`ctx.sessions.open` → `SessionManager.select`）是纯浏览器端
内存状态，事件流上没有任何"选中"信号；驾驶舱又按架构原则不读 iframe DOM。
**这个插件运行在官方 web 客户端**（同源），订阅 `sessions.list` 的 `current`
变化，在用户点击会话时把该会话 ID 上报给驾驶舱。驾驶舱切回一个已加载的设备
iframe 时，插件会重新确认当前选中的会话，使该会话若刚好处于完成未读状态，
其绿点按官方 select 语义清除。

- 驾驶舱按请求 `Origin` 匹配设备，**插件不需要知道自己是哪台设备**——它也不
  再假设驾驶舱固定跑在某个端口，实际 Origin 由父页面握手动态提供。
- DSH 0.1.2 下同时订阅官方 `ctx.uiSession.pendingInteractions`，变化时只发送
  当前完整的 `sessionId/kind/key` 集合；不注册 approval/question listener，不做决定，
  不读不传交互内容、会话内容、settings、credentials 或 provider token。
- 驾驶舱不可达时保留待确认队列并按退避重试，绝不影响 DSH 页面；outbox 有
  固定容量与 TTL，避免驾驶舱长期离线时无界增长。

## 协议版本 2（可靠确认）

当前版本实现协议 v2（插件版本 0.4.0；pending snapshot seam 仍为 v3）：

1. **父页面握手**：驾驶舱父页面在 iframe `load`、设备被激活、或能力需要刷新
   时，通过精确 `targetOrigin` 向 iframe `postMessage`：
   `{ type: 'dsh-cockpit:bridge-config', cockpitOrigin, capability, sshAlias? }`。插件
   只接受 `event.source === window.parent` 且 `event.origin` 与声明的
   `cockpitOrigin` 完全一致的消息，并把该 origin 固定为本页生命周期内的驾驶舱
   目标——不会再退回任何硬编码端口。
2. **hello**：收到握手后，插件 `POST <cockpitOrigin>/api/bridge/hello`，body
   为 `{ version, protocolVersion: 2, current }`，请求头带
   `X-DSH-Cockpit-Bridge-Capability: <capability>`。
3. **会话选择**：订阅回调**立即捕获**变化时的 `current` 值（不是等 250ms
   定时器触发时才重新读取，避免归档在这期间清空 `current` 导致确认丢失），
   写入按 ID 去重的有界 outbox；250ms 只合并网络请求，不合并/丢弃 ID。逐个
   `POST <cockpitOrigin>/api/bridge/session-opened`，body 为
   `{ protocolVersion: 2, sessionId?, current }`；`current` 为空时上报
   `{ current: null }`（省略 `sessionId`）。**只有服务端明确 2xx 成功后才从
   outbox 移除该项**；网络异常、401、其它非 2xx 均保留并按有上限的指数退避
   单飞重试。
4. **capability 失效自愈**：capability 是短期凭据（服务端 TTL 60s）；父页面
   会在到期前自动换发并重发握手，使长时间停留在同一设备也能持续确认。作为
   隐藏 iframe（定时器被浏览器节流）的兜底，插件在收到 **401** 或
   `bridge-capability-invalid`（400）时重置 hello 状态，并向父页面
   `postMessage { type: 'dsh-cockpit:capability-expired' }` 请求换发；换发前
   待确认项继续保留在 outbox 中。
5. **恢复触发**：新的会话选择、设备被重新激活（`dsh-cockpit:device-activated`
   或新的 `bridge-config`）、一次成功的 hello、以及 capability 换发成功，
   都会重新尝试发送 outbox 中尚未确认的项。
6. **outbox 上限**：固定容量与 TTL，容量压力下优先保留当前选择与最近的
   selection，淘汰最旧的非当前项。

旧版本（协议 1）插件仍可继续工作：驾驶舱按尽力而为方式接受其上报，顶栏会
标注为「已连接但非可靠协议」，并保留 Device Tab 上的人工清除兜底。

## 同页面能力服务

- **稳定服务名**：`cockpitBridge.editorOpen`（跨仓契约；改名属于 breaking change）。
- **调用**：`open(path: string): void`。未收到合法 alias、路径非绝对路径或含 `..` 段时同步抛错，消费方应回落自身默认行为。
- **生命周期**：服务随 bridge fiber 注册/注销；对象身份稳定，每次调用读取最新握手配置。
- **安全边界**：服务只接受路径，不接收任意 method/命令；不新增 iframe→父页面动作消息，不经 SSH 执行命令。所有跨边界通信仍只经 bridge。
- **前置条件**：宿主机安装 VS Code Remote-SSH，且 `sshAlias` 可由宿主机 SSH config 解析。未安装扩展时 URI 可能被静默丢弃；路径名含点时 VS Code URI handler 可能将目录判断为文件。

### `cockpitBridge.forwards`（0.6.0，取代 `cockpitBridge.portForward`）

把设备上**只监听回环**的服务转发到宿主机，使宿主机浏览器可以访问它（首个消费方：设备上的 memex 卡片浏览 UI）。

- **稳定服务名**：`cockpitBridge.forwards`（跨仓契约；改名属于 breaking change）。0.6.0 直接替换 `cockpitBridge.portForward`，旧服务与驾驶舱旧端点同版本移除，不保留适配层。
- **调用**：
  - `acquire(devicePort, holder): Promise<ForwardHandle>`：立即返回条目当前状态；就绪时带 `address`（`{ host: '127.0.0.1', port, url }`）。建立在后台进行，地址经父页面推送的快照交付。
  - `handle.onChange(listener)`：状态或本地端口变化时通知（`retrying` → `ready` 带新地址）；条目从快照消失时通知 `removed`，bridge **不会**自动重新申请。
  - `release(handle)`、`list()`（最近一次快照）、`subscribe(listener)`。
  - 握手未完成或不在驾驶舱 iframe 中时，`acquire` / `list` **同步**抛出 `code: 'unavailable'`，消费方据此回落本机地址。
- **错误**：业务拒绝以 `code` 抛出（`forward-limit`、`reserved-port`、`invalid-port`、`invalid-holder`、`invalid-label`、`local-device`、`device-unavailable`），不换发能力串、不重试；能力串失效（400/401）换发一次后重试。
- **页面实例**：每次 effect 启动与 bfcache 恢复（`pageshow` 且 `persisted`）生成新的一次性实例标识；`pagehide` 与 dispose 时经父页面发送 `dsh-cockpit:bridge-instance-ended`，驾驶舱据此释放该实例的全部持有。
- **边界**：只转发设备回环地址、只在宿主机回环监听、每条绑定单个端口、每设备至多 8 条、只作用于调用页面自己的设备；不能建立常驻条目或删除任何条目。驾驶舱不进入被转发流量的数据路径。
- **设置页区块**：`settings.section` 可用时，注入只读的「驾驶舱转发」区块（条目、状态、持有者标签、`N / 8`）；settings 缺席时其它能力不受影响。

## 安装

每台要接入驾驶舱的设备，在其 `dsh.yaml`（ohmydsh manifest）的 bundles 里加入：

```yaml
- "dsh-cockpit-bridge"
```

依赖（file: 指向本仓库的包路径）需要出现在 profile 的 dependencies 中，然后
`dsh build`（ohmydsh 会物化到 `~/.dsh/profiles/web`）并重启该设备的 DSH web。

**已经安装旧版本插件的设备**：升级到本版本同样需要重新 `dsh build` 并重启该
设备的 DSH web 才能获得协议 v2 的可靠确认；重启前旧版本仍按尽力而为方式工作，
不影响原生 DSH 工作台。

## 0.6.0 发布说明（升级与回滚）

- **必须与驾驶舱同时发布**：0.6.0 删除了 `cockpitBridge.portForward`，驾驶舱同一版本删除了 `/api/bridge/publishable-port` 与 `/api/bridge/publish-port`。bridge 0.5.x 配新驾驶舱，或 bridge 0.6.0 配旧驾驶舱，端口转发都不可用（消费方回落本机地址，原生 DSH 工作台不受影响）。
- **消费方需迁移**：仍调用 `cockpitBridge.portForward` 的同页面插件（例如 ohmydsh 的 memex 浏览 shim）会发现服务缺席并回落本机地址，直到它改用 `cockpitBridge.forwards.acquire`。发布顺序：驾驶舱 + bridge 0.6.0 同时发布 → 更新消费方的 bridge pin 与调用。
- **回滚**：驾驶舱与 bridge **必须一起回滚**，因为旧 bridge 依赖的端点已被删除。回滚后，设备记录中的常驻转发标记（`forwards` 字段）会被旧版本忽略，并在旧版本**下次写入注册表时丢失**；重新升级后需在设备面板重新创建常驻条目。

## 配置

无需手动配置端口或凭据：驾驶舱的实际 Origin（对应其 `COCKPIT_PORT`）与认证
能力均由父页面在运行时通过安全握手动态提供给插件，插件不再需要与驾驶舱端口
保持源码内的硬编码一致，也从不读取持久 HttpOnly token。
