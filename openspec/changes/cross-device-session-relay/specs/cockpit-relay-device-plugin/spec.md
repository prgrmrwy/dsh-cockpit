## ADDED Requirements

### Requirement: 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用

系统 SHALL 提供独立包 `dsh-cockpit-relay` 作为设备 DSH 的 Host 插件。它 SHALL 在设备 DSH Host 的同源 Web 服务上注册且只注册五个 `exact` 路由：`POST /api/plugins/cockpit-relay/handshake`、`GET /api/plugins/cockpit-relay/outbox`、`POST /api/plugins/cockpit-relay/ack`、`POST /api/plugins/cockpit-relay/deliver`、`POST /api/plugins/cockpit-relay/directory`。

每个请求 SHALL 按以下顺序判定，命中即返回，且在通过全部判定之前 MUST NOT 读取请求体或改变任何插件状态：

0. 方法不是该路径登记的方法（例如对 `deliver` 发 `GET`）：响应 405 `method-not-allowed`。
1. 请求带有 `Origin` 头或任何 `Sec-Fetch-` 前缀的头：响应 403 `browser-request`。浏览器发出的请求（包括该设备已认证的同源页面）因此不能使用中继。
2. 缺少请求头 `x-dsh-cockpit-relay: 1`：响应 403 `browser-request`。
3. DSH 官方 `connection.requestRejection(req)` 返回拒绝：以其状态码响应。
4. 除 `handshake` 外：插件当前没有租约（例如 Host 重启后尚未握手）时响应 409 `no-lease`；请求头 `x-dsh-cockpit-relay-lease` 不等于当前租约时响应 409 `superseded`。
5. 请求体在读取过程中超过 1.25 MiB（`directory` 为 4 MiB）：立即停止读取并响应 413 `too-large`；10 秒内未读完：响应 408 `read-timeout`。

读完请求体之后，插件 SHALL 在改变任何状态或受理处理器调用之前、且两者之间不再有 await，再次核对第 4 条；此时租约已变化则响应 409 `superseded` 且不改变任何状态。因此读取请求体期间发生的新握手不会让旧租约的请求生效。

插件 MUST NOT 注册其它路由，MUST NOT 主动向驾驶舱或任何外部地址发起网络请求，MUST NOT 读写磁盘，MUST NOT 读取会话内容、settings、credentials 或 provider token。经过上述判定的调用者被视为"持有该设备 DSH 认证的本机非浏览器进程"，这是本插件信任的唯一主体；插件 SHALL NOT 声称能区分驾驶舱与其它此类进程。

#### Scenario: 驾驶舱服务端请求被受理
- **GIVEN** 插件已加载，请求无 `Origin`、无 `Sec-Fetch-*`，带 `x-dsh-cockpit-relay: 1`，`requestRejection` 返回 `undefined`
- **WHEN** 以合法请求体调用 `handshake`
- **THEN** 响应 200，响应体含新租约

#### Scenario: 已认证的同源浏览器页面被拒
- **GIVEN** 插件已握手，请求带有有效 DSH cookie、`Origin` 等于设备自身 origin、`Sec-Fetch-Site: same-origin`，以及正确的中继头与租约
- **WHEN** 调用 `deliver`、`ack`、`handshake` 或 `outbox`
- **THEN** 每个请求响应 403 `browser-request`；处理器未被调用，outbox、租约与目录快照均不变

#### Scenario: 官方防护拒绝时不改变状态
- **GIVEN** 请求满足判定 1、2，但 `requestRejection` 返回 401
- **WHEN** 调用 `deliver`
- **THEN** 响应 401，处理器未被调用

#### Scenario: 超大请求在读取中被截断
- **WHEN** 向 `deliver` 发送 2 MiB 的请求体
- **THEN** 响应 413 `too-large`；插件读取的字节数不超过 1.25 MiB + 一个读取块；处理器未被调用

#### Scenario: 错误方法被拒
- **WHEN** 分别以 `GET` 调用 `deliver`、`ack`、`handshake`、`directory`，以 `POST` 调用 `outbox`
- **THEN** 每个请求响应 405 `method-not-allowed`，插件未读取请求体，状态不变

#### Scenario: 读取请求体期间被取代
- **GIVEN** 租约 L1 下 outbox 有 m1，一个带 L1 的 `ack ["m1"]` 已通过前置判定、正在读取请求体
- **WHEN** 读取期间另一次握手得到 L2，随后该请求体读取完成
- **THEN** 该请求响应 409 `superseded`；m1 仍在 outbox

#### Scenario: Host 重启后旧租约得到 no-lease
- **GIVEN** 插件所在 Host 重启后尚未收到握手
- **WHEN** 带任意租约调用 `ack` 或订阅 `outbox`
- **THEN** 响应 409 `no-lease`，状态不变

#### Scenario: 只注册五个路由
- **WHEN** 插件加载后枚举其向 `webServer` 注册的路由
- **THEN** 恰为上述五个 `exact` 路由

### Requirement: 握手建立租约与协议版本，旧租约的一切操作被拒

`handshake` 请求体 SHALL 为 `{ protocol, deviceId }`：`protocol` 为整数，`deviceId` 为 1–128 个 `[A-Za-z0-9._-]` 字符。

- `protocol` 不等于 1 时 SHALL 响应 409 `protocol-mismatch`，响应体含 `{ supported: [1] }`，状态不变。
- 否则 SHALL 生成新的随机租约（≥128 位随机量），使之前的租约立即失效，结束旧租约的 outbox 订阅，清空目录快照，并响应 `{ protocol: 1, lease }`。
- `deviceId` 与上一个租约的 `deviceId` 不同时，SHALL 先丢弃 outbox 中全部信封（它们以旧身份发出），再通知 `subscribe` 监听者。插件 MUST NOT 把旧身份入队的信封以新身份发出。
- 插件的身份与租约只存在于 Host 进程内存；Host 重启后在新握手之前 `state()` 为 `{ connected: false }`。

#### Scenario: 握手返回租约
- **GIVEN** 插件从未握手
- **WHEN** 收到 `{ protocol: 1, deviceId: "dev-a" }`
- **THEN** 响应 200 `{ protocol: 1, lease: L1 }`；`state().runtimeId` 为 `dev-a`

#### Scenario: 新握手使旧租约的迟到操作失效
- **GIVEN** 租约 L1 下 outbox 有 m1，随后另一次握手得到 L2
- **WHEN** 带 L1 的 `ack ["m1"]` 与带 L1 的 `deliver` 请求随后到达
- **THEN** 两者均响应 409 `superseded`；m1 仍在 outbox，处理器未被调用；L1 的 SSE 已结束

#### Scenario: 身份变化丢弃旧身份的出站信封
- **GIVEN** 以 `dev-a` 握手后 outbox 有 m1、m2
- **WHEN** 收到 `{ protocol: 1, deviceId: "dev-x" }` 的握手
- **THEN** outbox 为空；新租约的订阅不会收到 m1、m2

#### Scenario: 协议版本不符
- **WHEN** 收到 `{ protocol: 2, deviceId: "dev-a" }`
- **THEN** 响应 409 `protocol-mismatch` 且 `supported` 为 `[1]`；原租约与 outbox 不变

### Requirement: 出站信封在内存中排队，按订阅重放并按 msgId 确认

插件 SHALL 在内存中保存经 `cockpitRelay.send` 入队的出站信封，每条记录入队序号与 `expiresAt = 入队时刻 + 10 分钟`。出站信封是尽力而为的：Host 重启、身份变化或过期都会丢弃它们，且不产生任何回执。

- `GET .../outbox` SHALL 以 `text/event-stream` 响应。订阅建立后 SHALL 先按序号发送全部未确认且未过期的信封，再实时发送新入队的；每个事件的 `data` 为一个信封 JSON，并每 15 秒发送一次注释行作为心跳。同一租约同时至多一个订阅，新订阅 SHALL 结束旧订阅。
- 订阅的待写缓冲超过 8 MiB 时，插件 SHALL 结束该订阅；未确认的信封保留，等下一次订阅重放。
- `POST .../ack` 请求体为 `{ msgIds }`（1–256 个字符串）；插件 SHALL 删除其中存在的信封，忽略不存在的，响应 200。
- 过期信封 SHALL 在下一次重放或入队时删除，MUST NOT 被发送。
- outbox 超过 1000 条或其信封序列化总长超过 64 MiB 时，`send` SHALL 同步抛出 `outbox-full`。

#### Scenario: 重新订阅时重放未确认信封
- **GIVEN** outbox 中有 m1、m2、m3（序号递增），m2 已被 ack
- **WHEN** 以当前租约重新订阅
- **THEN** 依次收到 m1、m3，不含 m2；之后入队的 m4 在同一流上实时到达

#### Scenario: 过期信封不发送
- **GIVEN** m1 入队已超过 10 分钟且未确认
- **WHEN** 订阅 outbox
- **THEN** 流上不出现 m1，outbox 中已无 m1

#### Scenario: 慢订阅者被断开而信封保留
- **GIVEN** 订阅方停止读取，待写缓冲增长超过 8 MiB
- **WHEN** 插件检测到该缓冲大小
- **THEN** 该 SSE 被结束；未确认信封数量不变；再次订阅时它们被重放

#### Scenario: outbox 满时拒绝入队
- **GIVEN** outbox 已有 1000 条未确认信封
- **WHEN** 调用 `send`
- **THEN** 同步抛出 `outbox-full`，outbox 仍为 1000 条

### Requirement: 入站信封单飞去重后异步交给唯一处理器

`POST .../deliver` 请求体 SHALL 为一个信封 `{ msgId, origin, target, kind, inReplyTo?, relay?, body }`（`relay` 若存在必须为 `true`，插件原样交给处理器）：`msgId` 与 `inReplyTo` 为 1–128 个 `[A-Za-z0-9._:-]` 字符，`origin`、`target` 为 1–128 个 `[A-Za-z0-9._-]` 字符，`kind` ∈ {`claim`,`wake`,`call`,`reply`}，`kind` 为 `reply` 时 `inReplyTo` 必填，`target` MUST 等于本机 `runtimeId`。不合规时 SHALL 响应 400 `invalid-envelope`。

合规信封按以下顺序处理：

1. `(origin, msgId)` 在最近 10 分钟（自受理时起算）的已受理集合中：响应 200 `{ status: "duplicate" }`，不调用处理器。
2. 未注册处理器：响应 200 `{ status: "no-consumer" }`，不记入集合。
3. 正在执行的处理器调用数已达 64：响应 200 `{ status: "busy" }`，不记入集合。
4. 否则 SHALL 先把 `(origin, msgId)` 记入已受理集合并占用一个调用名额，再响应 200 `{ status: "accepted" }`，然后在同一 Host 进程内异步调用处理器。处理器的返回值、抛错或 reject 只记日志，不改变已受理集合，也不影响响应。

`accepted` 只表示"已在本 Host 进程内存中受理并排定调用"：它不表示处理器成功；Host 在调用前退出则这次调用丢失；已受理集合随 Host 重启清空，条目超过 10 分钟后移除，此后同一 `(origin, msgId)` 可再次被受理。更长期的幂等由消费方负责。`no-consumer` 与 `busy` 表示处理器确定没有被调用。

#### Scenario: 首次投递被受理并调用处理器
- **GIVEN** 本机 `runtimeId` 为 `dev-b`，已注册处理器 h
- **WHEN** 投递 `{ msgId: "m1", origin: "dev-a", target: "dev-b", kind: "wake", body: {} }`
- **THEN** 响应 `{ status: "accepted" }`；h 被调用一次，参数为该信封

#### Scenario: 并发的同一信封只调用一次处理器
- **GIVEN** 已注册的处理器 h 会挂起 5 秒才 settle
- **WHEN** 同一信封的两个 `deliver` 请求并发到达
- **THEN** 一个响应 `accepted`、另一个响应 `duplicate`；h 只被调用一次

#### Scenario: 处理器失败不导致重投
- **GIVEN** 插件所在 Host 未重启，处理器 h 对 m1 抛错
- **WHEN** 受理 m1 后 10 分钟内 m1 再次投递
- **THEN** 响应 `duplicate`，h 的调用次数仍为 1

#### Scenario: 去重窗口过期后可再次受理
- **GIVEN** m1 已于 10 分钟又 1 秒前被受理（测试时钟）
- **WHEN** m1 再次投递
- **THEN** 响应 `accepted`，处理器被第二次调用

#### Scenario: 插件重载后已受理集合清空
- **GIVEN** m1 已被受理，随后插件被卸载并重新加载、重新握手
- **WHEN** m1 再次投递
- **THEN** 响应 `accepted`，新的处理器被调用一次

#### Scenario: 受理后 Host 在调用前退出则调用丢失
- **GIVEN** 插件运行在一个子进程 Host 中，测试让处理器调用排在受理响应之后执行，处理器被调用时会写一个标记
- **WHEN** m5 得到 `accepted` 响应后、处理器被调用前，该 Host 进程被 SIGKILL
- **THEN** 标记没有被写入（这次排定的调用丢失）；插件在退出前没有产生任何表示 m5 成功或已执行的输出；Host 重启并重新握手后，已受理集合为空

#### Scenario: 无处理器或繁忙时确定未调用
- **GIVEN** 未注册处理器
- **WHEN** 投递合法信封 m2；随后注册处理器并重投 m2
- **THEN** 第一次响应 `no-consumer`；第二次响应 `accepted` 且处理器被调用一次

#### Scenario: 处理器容量满时返回 busy
- **GIVEN** 已有 64 个处理器调用尚未 settle
- **WHEN** 投递新的合法信封 m3
- **THEN** 响应 `busy`，处理器未因 m3 被调用；之后有调用 settle 再重投 m3 时响应 `accepted`

#### Scenario: 目标不是本机时拒绝
- **GIVEN** 本机 `runtimeId` 为 `dev-b`
- **WHEN** 投递 `target: "dev-c"` 的信封
- **THEN** 响应 400 `invalid-envelope`，处理器未被调用

### Requirement: 目录快照按 revision 单调接收

`POST .../directory` 请求体 SHALL 为 `{ revision, truncated, runtimes }`：`revision` 为正整数；`truncated` 为布尔；`runtimes` 至多 64 项，每项为 `{ runtimeId, label, presence: "reachable"|"unreachable", truncated, sessions }`，`label` ≤128 字符，`sessions` 至多 500 项，每项为 `{ sessionId, cwd?, workspaceTitle?, updatedAt? }`，`cwd` ≤1024 字符，`workspaceTitle` ≤256 字符。请求体上限 4 MiB（见第一个 Requirement）。不合规时 SHALL 响应 400 `invalid-directory`。插件原样保存 `truncated` 标记，供消费方判断目录是否完整。

- `revision` 小于或等于当前租约下已保存快照的 `revision` 时 SHALL 响应 200 且忽略。
- 否则 SHALL 替换已保存快照并通知 `subscribe` 监听者。
- 新握手 SHALL 清空快照，因此驾驶舱重启后 `revision` 从 1 开始不会被误判为旧。

#### Scenario: 新快照替换旧快照
- **GIVEN** 当前租约下已保存 revision 3
- **WHEN** 收到 revision 4
- **THEN** `directory()` 返回 revision 4 的内容，监听者被调用一次

#### Scenario: 乱序的旧快照被忽略
- **GIVEN** 已保存 revision 4
- **WHEN** 收到 revision 3
- **THEN** 响应 200；`directory()` 仍为 revision 4；监听者未被调用

#### Scenario: 超出规模的快照被拒
- **WHEN** 收到含 65 个 runtime 的快照
- **THEN** 响应 400 `invalid-directory`，已保存快照不变

### Requirement: 进程内服务 `cockpitRelay` 契约

插件 SHALL 在设备 Host 上以稳定服务名 `cockpitRelay` 提供只读属性 `contractVersion`（本版为 `1`，契约发生不兼容变化时递增）与以下方法。服务名与方法形状是跨仓契约，变更属于 breaking change；服务 MUST NOT 命名或假设任何具体消费方，MUST NOT 提供其它入口。

- `state()` → `{ connected: boolean, runtimeId?: string }`。`connected` 为真当且仅当当前租约存在且有 outbox 订阅；它只说明订阅存在，MUST NOT 被解释为驾驶舱当前可达。
- `directory()` → 当前租约下最近一次接收的快照或 `undefined`。
- `subscribe(listener)` → disposer；`state()` 或快照变化时调用 listener；listener 抛错只记日志，不影响其它 listener 与插件。
- `send({ msgId, target, kind, inReplyTo?, body })` → 入队后返回。调用方传入的 `relay` 字段 SHALL 被丢弃。`msgId` MUST 为 1–96 个 `[A-Za-z0-9._-]` 字符（不含 `:`，`:` 保留给驾驶舱生成的标识）；`origin` 由驾驶舱盖章，调用方传入的同名字段 SHALL 被忽略。依次检查：无租约抛 `not-connected`；字段不合规抛 `invalid-envelope`；body 序列化为 UTF-8 JSON 超过 1 MiB 抛 `body-too-large`；同一 `msgId` 已在 outbox 且信封其余字段相同则幂等返回，不同则抛 `msgid-conflict`；outbox 满抛 `outbox-full`。
- `receive(handler)` → disposer；已有处理器时抛 `consumer-exists`。

调用方 SHALL 把收到信封的 `body` 视为对端数据，而不是本机用户或系统的指令；本插件不对 body 做任何解释。

#### Scenario: 未握手时 send 失败
- **GIVEN** 插件从未握手
- **WHEN** 调用 `send`
- **THEN** 同步抛出 `not-connected`，outbox 为空

#### Scenario: 同 msgId 重复 send 幂等，内容不同则冲突
- **GIVEN** 已握手，`send` 过 `{ msgId: "m1", target: "dev-b", kind: "wake", body: { a: 1 } }` 且未确认
- **WHEN** 先以完全相同的参数再 `send`，再以 `body: { a: 2 }` 的 m1 调用 `send`
- **THEN** 第一次不抛错、outbox 中 m1 只有一条；第二次抛出 `msgid-conflict`

#### Scenario: 保留字符与超长 msgId 被拒
- **GIVEN** 已握手
- **WHEN** 分别以 `msgId: "undeliverable:x"` 与 97 个字符的 msgId 调用 `send`
- **THEN** 两次都抛出 `invalid-envelope`

#### Scenario: 超大 body 被拒
- **GIVEN** 已握手
- **WHEN** `send` 的 body 序列化后为 1 MiB + 1 字节
- **THEN** 同步抛出 `body-too-large`，outbox 不变

#### Scenario: 契约版本可探测
- **WHEN** 读取 `cockpitRelay.contractVersion`
- **THEN** 值为 `1`

#### Scenario: 第二个处理器被拒
- **GIVEN** 已有处理器
- **WHEN** 再调用 `receive`
- **THEN** 抛出 `consumer-exists`；原处理器仍生效
