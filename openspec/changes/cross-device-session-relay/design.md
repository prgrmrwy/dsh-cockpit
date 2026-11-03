## Context

驾驶舱目前的通道全部是「宿主机 → 设备」方向：主通道和附加转发都是 `ssh -L`，状态聚合由驾驶舱服务端调用设备官方接口（rc.2 形态 `POST /api/<method>` 不加认证头；typert 带 authority-bound cookie，见 `connectivity/protocol-client.ts`、`dsh-auth.ts`）。设备上的 Host 进程没有回连驾驶舱的通道；设备页面只能经 bridge（iframe + postMessage + 短 TTL 能力串）与驾驶舱通信，且只在 iframe 打开时存在。

ohmydsh 的 dsh-collab 要做跨机协作：会话需要发现其它机器上的会话，并向它们投递"认领 / 唤醒 / 读写空间"三类请求。协作语义（空间、成员、话题上限、幂等 cmdId、回复缓存、超时）全部留在 collab 与它的 shim；驾驶舱只提供"谁在、怎么送到"。两仓的耦合面在协作空间 `cross-machine-collab` 的 charter `relay-contract` 中由双方确认，本设计实现驾驶舱一侧。

关键运行时事实（2026-11-03 核查）：
- DSH 0.2.0-rc.2 Host 插件用 `ctx.webServer.register({ kind: 'exact', path, handler })` 注册同源路由，handler 拥有完整响应生命周期，可保持 SSE；裸路由不带认证，需自行调用 `ctx.connection.requestRejection(req)`。该检查允许 loopback/trustedHosts 上没有 `Origin` 的请求，也允许已认证的同源浏览器请求，再校验 authority-bound cookie（若该设备启用了浏览器认证）。它认证的是"该设备的操作者"，不识别调用者是不是驾驶舱。
- 官方 `session.list` 行只有 `sessionId, running, updatedAt, blank, origin?, parentSessionId?`，没有标题；`workspace.list` 有 `items[{ path, title, sessionIds }]` 与 `archivedSessionIds`。`DeviceLifecycle` 现在把基线折叠成运行轮次模型与归档集合，不保留行与 workspace 元数据；会话新增事件目前只用于子会话分类。

## Goals / Non-Goals

**Goals:**
- 已安装中继插件的设备之间能尽力而为地互投不透明信封，并能看到全体已接入设备及其根会话目录。
- 设备上的同机插件经稳定进程内服务 `cockpitRelay` 使用这些能力，不需要知道驾驶舱地址、端口或凭据。
- 不装插件的设备与今天完全一致；中继故障不影响工作台、状态聚合与 bridge。

**Non-Goals:**
- 不保证投递：不持久化、不承诺至少一次。可靠性（超时、幂等、重试）由消费方负责。
- 不理解消息语义，不做请求/响应状态机，不保证顺序。
- 不给会话或模型直接暴露工具；不新增驾驶舱入站 API、UI 或设备侧 GUI。
- 不支持多个驾驶舱同时接入同一设备。
- 不做跨用户信任模型：驾驶舱管理的都是同一个人的机器；中继插件信任的主体是"持有该设备 DSH 认证的本机非浏览器进程"。

## Decisions

### D1. 独立 Host 插件包，而不是并入 bridge
`dsh-cockpit-bridge` 的 Host 入口只为浏览器插件服务，生命周期跟着 iframe；中继必须在 Host 常驻。并入 bridge 会让"只想要已读确认"的设备也带上 Host 路由，扩大该包的信任面与升级耦合。独立包 `dsh-cockpit-relay` 只有 host 入口、无 `dsh.client`，构建与发布沿用 bridge（tsdown、`lib/` 入库、`cordis.patch.yml` insert 到 bundle）。

### D2. 方向：驾驶舱主动订阅设备 outbox，不加 `-R`、不轮询
备选：(a) `ssh -R` 把驾驶舱端点暴露到设备回环——要改连接层"只用 `-L`"的不变式，设备上任意进程都能连到；(b) 驾驶舱周期拉取——违反"无周期轮询"；(c) 经 bridge 中转——依赖 iframe 打开。选择：驾驶舱在设备 `READY`/`DEGRADED` 后经现有通道打开 outbox SSE 长连接，设备入队即推送；投递走反方向的普通 POST。插件每 15s 发一次 SSE 注释心跳，驾驶舱 45s 无字节即判断断流，这样合盖、路由黑洞等不发 FIN 的情况也能在有界时间内被驾驶舱发现。

### D3. 认证与调用者边界
- `DeviceLifecycle` 新增受控方法 `relayRequest(path, init)`：只接受中继的五个路径，使用生命周期当前的协议端点与认证头，不把端点或 cookie 暴露给调用方；请求固定带 `x-dsh-cockpit-relay: 1`，不带 `Origin`。无需能力串，无需修改 `cockpit-api-auth`。
- 插件在读取请求体前依次判定：有 `Origin` 或任何 `Sec-Fetch-*` 头即拒（浏览器总会带其一，fetch 与表单都不例外，因此设备页面上的脚本——包括已认证的同源页面——无法冒充其它 runtime）；缺自定义头即拒；再走官方 `requestRejection`；再校验租约。
- 剩下能调用的只有"持有该设备 DSH 认证的本机非浏览器进程"：驾驶舱、或该设备操作者自己运行的工具。插件不声称能区分两者，`origin` 的含义因此是"由驾驶舱或该设备操作者盖章"。这与 collab 已定的"同一个人的机器、防误泄不防串通"威胁模型一致；消费方 SHALL 把 body 当作对端数据，而不是用户或系统指令（collab 的唤醒文案已如此处理）。
- 备选：为驾驶舱签发独立 capability 并持久化在设备上——需要首次配对与轮换，且驾驶舱本身就以操作者身份访问设备，收益有限，不采用。

### D4. 尽力而为：内存 outbox、驾驶舱无状态、三处去重
首轮评审指出"持久化 + 超时判失败"会制造"判定失败但实际已执行"的不确定结果，且持久队列带来磁盘满、文件损坏、身份重标等一串恢复问题。消费方（collab shim）本来就有 30s 超时、按 msgId 缓存首个回复、collab 以 cmdId 幂等，因此收缩为：
- 出站信封只在插件内存中排队，直到驾驶舱按 msgId 确认或 10 分钟过期；Host 重启即丢失，不回执。
- 每次订阅都重放全部未确认信封（不用 `Last-Event-ID`）：推送与确认是两个独立请求，"已推送未确认"的信封必须能重发。
- 去重点：驾驶舱进程内 10 分钟窗口（防重放重投）、目标插件 10 分钟已受理集合（防驾驶舱重启后的重投；登记先于调用处理器，并发同一信封只会调用一次）、消费方自己的幂等。
- 目标插件响应 `accepted` 后异步调用处理器，不等待它完成：`accepted` 因此只表示"已在目标 Host 内存中受理并排定调用"（Host 在调用前退出会丢失这次调用），与处理器成败无关；去重只在 10 分钟窗口与同一进程内成立，更长期的幂等由消费方负责；HTTP 层不会因慢处理器堆积。
- 按 msgId 而非序号确认，避免一个不可达目标阻塞后续信封。

### D5. 只有确定未投递才生成回执
发起方需要尽快区分"对方没收到"与"对方慢"。驾驶舱只在能证明处理器没有被调用时生成 `reply{undeliverable}`：`self`、`unknown-target`、`not-connected`（未投递）、`no-consumer`、`busy`（目标明确未调用）。超时、连接失败、非 200 属于结果未知，不生成回执，交给发起方超时。回执 msgId 为 `undeliverable:<原 msgId>`；发送方 msgId 不允许含 `:`（`send` 校验），所以不会冲突；`reply` 不可投递时直接丢弃，防止回执链。驾驶舱生成的回执带 `relay: true`，并且转发任何设备信封时都删除该字段，所以消费方能区分"驾驶舱判定的不可投递"与"对端设备自己声称的不可投递"（ohmydsh 侧评审提出）。

### D11. 契约版本与 deviceId 格式
`cockpitRelay.contractVersion`（本版 1）让消费方在不识别时退回只有同机；它与握手的 `protocol`（驾驶舱↔插件）相互独立。中继只对 deviceId 匹配 `^[a-z0-9][a-z0-9-]{0,63}$` 且不为 `local` 的设备启用：驾驶舱新建设备的 id 本就是 `device-<base36>`，而注册表历史上接受任意非空字符串，与其在消费方做映射，不如在源头排除。

### D6. 目录：复用已有基线与事件，不提供标题
`DeviceLifecycle` 额外保留：最近一次 `session.list` 的根会话行（`sessionId, updatedAt, origin, parentSessionId`）、最近一次 `workspace.list` 的 sessionId → `{ path, title }` 反查表，并把已消费的会话新增事件与归档变化事件同步到这份根会话集合。目录模块订阅生命周期的变化通知。`cwd`、`workspaceTitle`、`updatedAt` 只在基线时更新；新建会话最迟在下一次基线（重连或手动刷新）或第一条涉及它的事件时出现。这是"不轮询"的代价，已在契约中接受，目录不宣称实时完整。

### D7. 租约与协议版本
- 握手携带 `protocol: 1`，插件只认 1，否则 409 `protocol-mismatch` 并返回支持的版本；驾驶舱记 `incompatible`，不自动重试。插件与驾驶舱各自独立发布，版本门禁因此必须显式。
- 每次握手生成新的随机租约，之后所有请求都带租约头；旧租约的迟到 `ack`、`deliver`、`directory`、订阅一律 409 `superseded`，避免旧驾驶舱进程删掉新进程的信封或触发处理器。
- 订阅意外结束时驾驶舱先用原租约重新订阅：`superseded` 才停止；插件 Host 重启后没有租约，返回 `no-lease`，驾驶舱立即重新握手。插件读完请求体后、改变状态前（中间不再 await）再核对一次租约，读取期间被取代的请求不会生效。
- 驾驶舱收到 `superseded` 即停止对该设备自动握手，直到设备再次进入 `READY` 或用户手动刷新，避免两个驾驶舱互相抢夺。
- 握手的 `deviceId` 变化时插件丢弃旧 outbox，不把旧身份入队的信封以新身份发出。

### D8. 有界性
驾驶舱：每设备在途投递 ≤32（超出暂停读取 SSE）、单个 SSE 事件解析前累计 ≤1.25 MiB、投递读响应超时 10s、handshake/ack/directory 端到端 10s 截止且响应 ≤64 KiB、租约变化或退出时中止在途请求且迟到结果不生效、目录推送退避上限 30s、握手退避上限 60s。插件：请求体边读边限（信封 1.25 MiB、目录 4 MiB，超出 413），读取超时 10s；目录 ≤64 runtime × 500 会话且 ≤4 MiB，驾驶舱按确定顺序裁剪并以 `truncated` 标记，不声称完整；outbox ≤1000 条或 64 MiB；单订阅待写缓冲 >8 MiB 即断开；同时执行的处理器调用 ≤64，满则 `busy`。插件不取消已开始的处理器调用，处理器自身的资源由消费方负责。

### D9. 与现有边界的关系
- "统筹面只读、只调官方接口"改为：唯一例外是可选中继插件的五个端点，且不读会话内容、不轮询（`cockpit-device-shell` MODIFIED）。
- "bridge 是唯一跨边界通信切面"明确为设备**页面**侧；由设备插件发起的跨设备消息只经中继；官方接口流量与既有 bridge 流量不受影响（`cockpit-workbench` MODIFIED）。
- "远端零改造"仍成立：工作台与状态聚合不需要任何插件，中继是可选能力。`cockpit-device-connectivity` 的 Purpose 文字在归档同步时补一句"可选插件不影响核心能力"。
- 中继是不透明转发，驾驶舱不执行任何东西；`call` 的 body 能请求什么由目标设备上注册了处理器的插件决定并负责授权。这是有意把语义留在 collab 的结果，不是通用 RPC 入口：驾驶舱侧没有新增任何可被调用的动作。

### D10. 本机设备对称
本机设备同样由驾驶舱服务端主动调用其插件端点，只是不经隧道。collab 侧本机 runtime 走进程内实现、不经中继；驾驶舱收到发给自己的信封回 `self`。

## Risks / Trade-offs

- [设备上任何同机 Host 插件都能经 `cockpitRelay` 向其它机器发信封] → 与 bridge 服务同一信任层（本机已审查的插件）；目标侧只有注册了处理器的插件能收到，并据 `origin` 自行决定是否处理。
- [设备操作者自己的本机工具可以冒充驾驶舱调用插件端点] → 接受：它本来就能直接操作该设备 DSH；浏览器脚本已被结构性排除（D3）。
- [信封会丢] → 有意为之（D4）；消费方以超时与幂等兜底，collab 侧把投递失败呈现给人。
- [新会话进入目录有延迟] → 契约接受；需要时用户手动刷新设备。
- [驾驶舱合盖期间跨机通信停止] → 用户已接受单点；插件侧 `connected` 只表示订阅存在，消费方不得据此判断可达，以超时为准。
- [多驾驶舱] → 不支持；租约（含读完请求体后的二次核对）保证被取代后不再受理新的操作，已经受理的处理器调用会继续执行完；`superseded` 后不自动抢回。

## Migration Plan

1. 发布 `dsh-cockpit-relay`（与 bridge 相同的 release 流程），设备侧按 README 加入 bundle 并重启 DSH web。
2. 驾驶舱升级后自动对 `READY` 设备握手；未装插件的设备记 `absent`，无可见变化。
3. 回滚：从设备 bundle 移除插件即可；两侧都没有持久状态。

## Open Questions

无阻断项。设备面板是否展示中继状态留给后续 change。
