## ADDED Requirements

### Requirement: 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证

设备进入 `READY` 或 `DEGRADED` 时，驾驶舱 SHALL 向该设备中继插件的 `handshake` 端点发送 `{ protocol: 1, deviceId }`，成功后保存返回的租约，在之后对该设备插件的每个请求中携带它，并打开 outbox 订阅。

- 只有 deviceId 匹配 `^[a-z0-9][a-z0-9-]{0,63}$` 且不等于 `local` 的设备参与中继（驾驶舱新建设备的 id 形如 `device-<base36>`，满足该格式）；不匹配的设备 SHALL 记为中继状态 `unsupported-id`，不握手、不进入目录。

- 请求 SHALL 发往该设备当前协议端点（远端为隧道本地地址，本机设备为直连地址），携带 `x-dsh-cockpit-relay: 1`，不带 `Origin` 与 `Sec-Fetch-*`，并使用该设备当前协议已在使用的认证（typert 为 authority-bound cookie；rc.2 形态不加认证头）。驾驶舱 MUST NOT 为中继新增或保存任何凭据，MUST NOT 新增 SSH 用法（仍只有 `-L`）。
- 对插件的 `handshake`、`ack`、`directory` 请求 SHALL 各有 10 秒端到端截止（含读完响应），响应体超过 64 KiB 视为失败；设备离开 `READY`/`DEGRADED`、租约变化或驾驶舱退出时，SHALL 中止该设备全部在途中继请求，被中止或迟到的请求结果 MUST NOT 改变中继状态、目录推送状态，也 MUST NOT 触发确认或回执。
- 驾驶舱 SHALL 为每台设备维护中继连接代际：每次握手（含尚未拿到租约的在途握手）、设备离开 `READY`/`DEGRADED`、主通道连接替换（即使仍为 `READY`/`DEGRADED`）、手动刷新导致的重新接入以及驾驶舱退出都使代际加一或使中继进入已释放状态。每个中继请求、订阅及其异步续延 SHALL 捕获发起时的代际；代际变化时中止旧请求；在应用任何结果（更新中继状态、保存租约、转发信封、确认、生成回执、推送目录）之前，SHALL 要求捕获的代际等于当前代际且中继未被释放，否则丢弃该结果。
- 中继状态取值：`unsupported-id`（见上）、`absent`（握手 404）、`incompatible`（`protocol-mismatch`）、`superseded`（任一请求得到 409 `superseded`）、`error`（超时、5xx、401、403 等）、`connected`（有租约且订阅已打开）、`idle`（设备不在 `READY`/`DEGRADED`）。
- 收到 409 `no-lease`（插件所在 Host 重启过）时 SHALL 立即重新握手，不计入退避。
- `absent`、`incompatible`、`superseded` 下，在下一次进入 `READY`/`DEGRADED` 或用户手动刷新该设备之前 MUST NOT 再次握手。`error` 下 SHALL 按有抖动的退避重新握手（首次约 2s、加倍、上限 60s）；设备离开 `READY`/`DEGRADED` 或驾驶舱收到 SIGINT/SIGTERM 时停止重试并结束订阅。
- 中继的任何失败 MUST NOT 改变设备状态分级，MUST NOT 触发工作台或主通道重连。

#### Scenario: 装有插件的设备接入
- **GIVEN** 设备 A 装有中继插件，刚进入 `READY`
- **WHEN** 驾驶舱完成握手并打开 outbox 订阅
- **THEN** A 的中继状态为 `connected`；握手请求携带与该设备 `session.list` 请求相同的认证头，且不含 `Origin` 头

#### Scenario: 未装插件的设备不被反复探测
- **GIVEN** 设备 B 未装中继插件，握手返回 404
- **WHEN** B 保持 `READY` 10 分钟
- **THEN** 驾驶舱对 B 只发出 1 次握手请求，B 的中继状态为 `absent`，设备状态仍为 `READY`

#### Scenario: 被取代后不再自动抢回
- **GIVEN** 驾驶舱 X 与设备 A 处于 `connected`
- **WHEN** 另一进程用新的握手取得 A 的租约，X 的下一个请求得到 409 `superseded`
- **THEN** X 结束订阅，A 的中继状态为 `superseded`；在 A 下一次进入 `READY` 或用户手动刷新 A 之前，X 不再向 A 发送握手

#### Scenario: 静默断开的订阅先用原租约恢复
- **GIVEN** 驾驶舱 X 与设备 A 处于 `connected`，另一进程随后握手取得 A 的新租约，X 的订阅因此结束，此后 A 没有任何出站信封
- **WHEN** X 检测到订阅结束
- **THEN** X 先以原租约重新订阅并得到 409 `superseded`，A 的中继状态变为 `superseded`，X 没有发出新的握手

#### Scenario: 插件重启后自动重新握手
- **GIVEN** A 为 `connected`，A 的 DSH Host 重启但主通道保持 `READY`
- **WHEN** 驾驶舱以原租约重新订阅得到 409 `no-lease`
- **THEN** 驾驶舱立即重新握手并恢复 `connected`

#### Scenario: 旧代际的迟到握手结果不生效
- **GIVEN** 驾驶舱对 A 发出握手，响应尚未返回时 A 的主通道被替换（仍为 `READY`），驾驶舱以新代际再次握手并得到租约 L2
- **WHEN** 第一次握手的响应（租约 L1）随后到达
- **THEN** 驾驶舱丢弃 L1，后续请求携带 L2，未以 L1 打开订阅

#### Scenario: 退出时在途控制请求被中止
- **GIVEN** 驾驶舱对 A 的 `ack` 请求挂起未返回
- **WHEN** 驾驶舱收到 SIGTERM，随后该请求的响应迟到
- **THEN** 该请求被中止；迟到响应不引起任何状态变化、重试、确认或回执

#### Scenario: 挂起的控制请求按截止失败
- **GIVEN** A 的 `ack` 端点接受连接但始终不返回响应
- **WHEN** 驾驶舱对 A 发出 `ack`
- **THEN** 10 秒后该请求被中止并记为失败，对应信封留在 A 的 outbox 等待重放

#### Scenario: 中继失败不影响设备状态
- **GIVEN** 设备 C 为 `READY`，其中继握手持续返回 500
- **WHEN** 观察 C 的状态分级与主通道
- **THEN** 状态分级不变、主通道未重连；C 的中继状态为 `error`，相邻两次握手间隔逐次加倍且不超过 60s

### Requirement: 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认

对每台 `connected` 设备，驾驶舱 SHALL 保持一个 outbox SSE 订阅。订阅意外结束（EOF、读错误、连续 45 秒未收到任何字节含心跳）时，驾驶舱 SHALL 先用原租约重新订阅一次：成功则保持 `connected`；得到 409 `superseded` 则进入 `superseded`；得到 409 `no-lease` 则按上一 Requirement 重新握手；其它失败进入 `error` 并按退避重新握手。驾驶舱 SHALL 在解析之前限制单个 SSE 事件的累计字节数（含未结束的行）不超过 1.25 MiB，超出即结束该订阅并进入 `error`。

中继是尽力而为的：信封可能丢失，消费方 SHALL 自行设置超时与幂等；驾驶舱只保证在同一驾驶舱进程内、10 分钟窗口内对同一 `(origin, msgId)` 至多发起一次投递，窗口过后同一 msgId 会被当作新信封。对订阅中收到的每个事件：

1. 事件 `data` 无法解析为 JSON 或缺少合法 `msgId`：驾驶舱 SHALL 结束该订阅并进入 `error`（无法确认的帧会在重放中再次出现，由退避限速）。
2. 驾驶舱 SHALL 把 `origin` 覆盖为出站设备的 deviceId，忽略载荷中的值。
3. 其余字段不合规（`kind` 不在枚举、`reply` 缺 `inReplyTo`、`target` 格式不符、`body` 序列化超过 1 MiB）：只确认，不投递、不生成回执。
4. 同一 `(origin, msgId)` 在本进程最近 10 分钟（自首次处理起算）内已处理：只确认，不投递。
5. 否则 SHALL 记为已处理，并按下一 Requirement 投递，之后确认。

确认 SHALL 调用出站设备的 `ack`；确认失败时信封留在出站设备，等下一次订阅重放（被第 4 步拦下）。驾驶舱 MUST NOT 解析、记录或改写 `body`，日志只记录 msgId、origin、target、kind 与结果。每台出站设备同时在途的投递 SHALL 不超过 32 个，超出时暂停读取该设备的 SSE。

#### Scenario: 正常投递并确认
- **GIVEN** 设备 A、B 均为 `connected`
- **WHEN** A 的 outbox 推出 `{ msgId: "m1", origin: "forged", target: "dev-b", kind: "wake", body: X }`
- **THEN** B 的 `deliver` 收到 `origin` 为 `dev-a`、`body` 与 X 在 JSON 语义上相等的信封；随后 A 的 `ack` 收到 `["m1"]`

#### Scenario: 重放的已处理信封不重复投递
- **GIVEN** 同一驾驶舱进程内，m1 已投递给 B，但对 A 的确认失败
- **WHEN** 首次处理 m1 后 10 分钟内，A 重新订阅后再次推出 m1
- **THEN** B 的 `deliver` 未再收到 m1；A 的 `ack` 收到 `["m1"]`

#### Scenario: 不合规信封被丢弃
- **WHEN** A 的 outbox 推出 `kind: "exec"` 且 msgId 合法的信封
- **THEN** 不向任何设备投递、不生成回执；A 的 `ack` 收到该 msgId

#### Scenario: 无法解析的帧使订阅进入退避
- **WHEN** A 的 outbox 推出 `data: not-json`
- **THEN** 驾驶舱结束 A 的订阅，A 的中继状态为 `error`，不向任何设备投递

#### Scenario: 静默断流被识别
- **GIVEN** A 的订阅已打开，A 的插件对原租约的重新订阅返回 503
- **WHEN** 连续 45 秒没有收到任何字节
- **THEN** 驾驶舱结束该订阅，以原租约重新订阅一次失败后，A 的中继状态变为 `error` 并按退避重新握手

#### Scenario: 未结束的超长帧被截断
- **WHEN** A 的 outbox 持续发送一条没有换行结束的 `data:` 行，累计超过 1.25 MiB
- **THEN** 驾驶舱在累计字节超过 1.25 MiB 后结束订阅，A 的中继状态为 `error`，未解析该帧

#### Scenario: 去重窗口过后同一 msgId 被重新投递
- **GIVEN** m1 已于 10 分钟又 1 秒前（测试时钟）投递给 B 并确认
- **WHEN** A 的 outbox 再次推出 msgId 为 m1 的新信封
- **THEN** B 的 `deliver` 再次收到 m1

### Requirement: 只有确定未投递时驾驶舱才代为生成回执

对 `kind` 为 `claim`、`wake`、`call` 的信封，驾驶舱 SHALL 按以下规则投递并决定是否生成回执：

- `target` 等于 `origin`：原因 `self`；`target` 不是任何已登记设备：原因 `unknown-target`；目标设备中继状态不是 `connected`：原因 `not-connected`。三者都不发起投递。
- 向目标 `deliver` 投递（含建连、响应头与响应体的端到端截止为 10s，响应体超过 64 KiB 视为结果未知；回执投递同样受此约束），响应 `no-consumer` 或 `busy`：原因即为该状态值。
- 响应 `accepted` 或 `duplicate`：已投递，不生成回执。
- 超时、连接失败、非 200 响应或无法解析的响应：结果未知，MUST NOT 生成回执（发送方以自己的超时处理）。目标响应 409 `superseded` 时，目标设备进入 `superseded`。

有原因时，驾驶舱 SHALL 向出站设备的 `deliver` 投递回执 `{ msgId: "undeliverable:" + 原 msgId, origin: 原 target, target: 原 origin, kind: "reply", inReplyTo: 原 msgId, relay: true, body: { undeliverable: <原因> } }`。发送方 msgId 不含 `:`，因此该标识不会与发送方自定的 msgId 冲突。

`relay` 字段只能由驾驶舱设置：驾驶舱转发任何来自 outbox 的信封时 SHALL 删除其 `relay` 字段，因此经 outbox 发出的信封无法伪造驾驶舱的不可投递结论，消费方可以只在 `relay === true` 时相信 `undeliverable`。（持有目标设备 DSH 认证的本机进程可以直接调用该设备的 `deliver`，这属于设备操作者本人，见 `cockpit-relay-device-plugin`。）

`kind` 为 `reply` 的信封无法投递或结果未知时 SHALL 丢弃，MUST NOT 为它生成回执。回执本身投递失败时 SHALL 放弃该回执。

#### Scenario: 目标未接入时回 not-connected
- **GIVEN** 设备 B 已登记但中继状态为 `absent`
- **WHEN** A 推出 `{ msgId: "m2", target: "dev-b", kind: "call" }`
- **THEN** A 的 `deliver` 收到 `{ msgId: "undeliverable:m2", origin: "dev-b", target: "dev-a", kind: "reply", inReplyTo: "m2", relay: true, body: { undeliverable: "not-connected" } }`；A 的 `ack` 收到 `["m2"]`

#### Scenario: 设备伪造的 relay 标记被删除
- **GIVEN** 设备 B 为 `connected`
- **WHEN** B 推出 `{ msgId: "f1", target: "dev-a", kind: "reply", inReplyTo: "m9", relay: true, body: { undeliverable: "not-connected" } }`
- **THEN** A 的 `deliver` 收到的信封 `origin` 为 `dev-b` 且不含 `relay` 字段

#### Scenario: 不合格式的 deviceId 不参与中继
- **GIVEN** 登记记录中有一台 deviceId 为 `My Device` 的设备进入 `READY`
- **WHEN** 观察驾驶舱对它的请求与目录
- **THEN** 没有发出握手，其中继状态为 `unsupported-id`，目录中没有它

#### Scenario: 发给自己
- **WHEN** A 推出 `target: "dev-a"` 的 `wake`
- **THEN** A 的 `deliver` 收到 `body: { undeliverable: "self" }` 的回执，未向任何其它设备投递

#### Scenario: 超时时不生成回执
- **GIVEN** B 为 `connected`，但其 `deliver` 在 10s 内未响应
- **WHEN** A 推出 `{ msgId: "m3", target: "dev-b", kind: "call" }`
- **THEN** A 的 `deliver` 没有收到任何 `relay: true` 且 `inReplyTo: "m3"` 的信封（B 稍后自行发出的回复不受影响）；A 的 `ack` 收到 `["m3"]`

#### Scenario: 目标繁忙时回 busy
- **GIVEN** B 的 `deliver` 对 m4 响应 `{ status: "busy" }`
- **WHEN** A 推出 `{ msgId: "m4", target: "dev-b", kind: "wake" }`
- **THEN** A 收到 `body: { undeliverable: "busy" }` 的回执

#### Scenario: 回执不可投递时不再生成回执
- **GIVEN** 设备 B 中继状态为 `absent`
- **WHEN** A 推出 `{ msgId: "r1", kind: "reply", target: "dev-b", inReplyTo: "x" }`
- **THEN** 驾驶舱不向任何设备投递任何信封，A 的 `ack` 收到 `["r1"]`

### Requirement: 设备会话目录快照

驾驶舱 SHALL 维护目录快照 `{ revision, runtimes }`：

- `runtimes` 为本进程内至少握手成功一次的全部设备，`runtimeId` 为 deviceId，`label` 为设备显示名；中继状态为 `connected` 时 `presence` 为 `reachable`，否则为 `unreachable`。
- 每项 `sessions` 为该设备最近已知的未归档根会话：排除 `origin === "subagent"` 或带 `parentSessionId` 的会话，排除归档集合中的会话。`cwd` 与 `workspaceTitle` 取最近一次 `workspace.list` 基线中包含该会话的 workspace 的 `path` 与 `title`，反查不到时省略；`updatedAt` 取最近一次 `session.list` 基线的值，缺失时省略。设备离线时保留最后已知的 `sessions`。
- 会话集合 SHALL 只来自驾驶舱已有的基线与已消费的事件：基线（连接、重连、手动刷新）重建集合；已消费的会话新增事件加入根会话；归档变化事件增删。`cwd`、`workspaceTitle`、`updatedAt` 只在基线时更新。驾驶舱 MUST NOT 为目录新增周期轮询或额外的远端调用。
- 快照 SHALL 满足插件的规模上限，按以下确定的顺序裁剪，并把裁剪如实标记出来，MUST NOT 在裁剪后声称完整：
  1. 超过 64 个 runtime 时，按"`reachable` 优先、再按 runtimeId 升序"保留前 64 个，顶层 `truncated` 为 `true`；
  2. `label` 超过 128 字符时截断到 128；`cwd` 超过 1024 字符或 `workspaceTitle` 超过 256 字符时省略该字段；发生任一情况时该 runtime 的 `truncated` 为 `true`；
  3. 每个 runtime 的会话按 `updatedAt` 降序（缺失视为最旧）、再按 sessionId 升序排列，超过 500 个时保留前 500，该 runtime 的 `truncated` 为 `true`；
  4. 序列化后仍超过 4 MiB 时，反复从当前会话数最多的 runtime（并列取 runtimeId 最小者）删去排在最后的一个会话并把该 runtime 标为 `truncated`，直到不超过 4 MiB。
  runtime 的 `truncated` 为 `true` 当且仅当第 2–4 步对它做过任何截断、省略或删除；顶层 `truncated` 为 `true` 当且仅当第 1 步删去过 runtime；否则均为 `false`。来源变小后下一次快照 SHALL 恢复为未裁剪。
- 快照内容变化时 `revision` SHALL 加一。驾驶舱 SHALL 为每台 `connected` 设备保存"最新待推送快照"，在内容变化后 500ms 内发起推送；推送失败时按有抖动的退避（首次约 1s、上限 30s）重试最新快照，直至成功、该设备不再 `connected` 或被更新的快照取代。新进入 `connected` 的设备 SHALL 立即被推送当前快照。

#### Scenario: 归档会话从目录消失
- **GIVEN** 设备 A 的目录含根会话 s1、s2，设备 B 为 `connected`
- **WHEN** A 的事件流报告 s2 被归档
- **THEN** 500ms 内驾驶舱向 B 发起推送，快照 revision 加一，A 的 `sessions` 只含 s1

#### Scenario: 子会话不进入目录
- **GIVEN** A 的 `session.list` 含根会话 s1 与 `origin: "subagent"` 的 c1
- **WHEN** 生成快照
- **THEN** A 的 `sessions` 只含 s1

#### Scenario: 新建会话在手动刷新后出现
- **GIVEN** A 上新建了一个尚未运行的根会话 s9，驾驶舱没有消费到关于 s9 的事件
- **WHEN** 用户手动刷新设备 A
- **THEN** 新快照中 A 的 `sessions` 含 s9

#### Scenario: 设备离线时 presence 变化且保留会话
- **GIVEN** 设备 B 为 `connected`，目录中 B 含 s3
- **WHEN** B 的主通道断开导致中继订阅断开
- **THEN** 其余 `connected` 设备收到的新快照中 B 的 `presence` 为 `unreachable`，`sessions` 仍含 s3

#### Scenario: 推送失败后重试最新快照
- **GIVEN** 测试时钟与固定抖动下，推送 revision 8 给设备 B 时得到 500，B 的 `directory` 端点随后恢复为返回 200，之后没有任何状态变化
- **WHEN** 测试时钟推进到首次重试时刻
- **THEN** 驾驶舱再次向 B 推送 revision 8 并得到 200；没有产生 revision 9；此后不再向 B 发出 `directory` 请求

#### Scenario: 超出规模时确定地裁剪并标记
- **GIVEN** 设备 A 有 600 个未归档根会话
- **WHEN** 生成快照
- **THEN** A 的 `sessions` 恰为 `updatedAt` 最新的 500 个，A 的 `truncated` 为 `true`，快照序列化不超过 4 MiB；之后 A 归档到只剩 400 个会话时，新快照中 A 的 `truncated` 为 `false` 且含全部 400 个

#### Scenario: 字节超限时按确定顺序删减并在缩小后恢复
- **GIVEN** 本进程握手过 10 台设备 dev-0 … dev-9，每台 500 个会话，每个会话的 `cwd` 为 1000 字符，按第 1–3 步处理后快照序列化约 5 MiB
- **WHEN** 生成快照
- **THEN** 快照序列化不超过 4 MiB；删去的会话按第 4 步的确定顺序产生（每一步从当时会话数最多、并列时 runtimeId 最小的 runtime 删去末位会话），对同一输入两次生成的快照逐字节相同；被删减过的 runtime 的 `truncated` 为 `true`，其余为 `false`；之后 dev-0 … dev-4 的事件流报告各自 400 个会话被归档，新快照不超过 4 MiB 且所有 runtime 的 `truncated` 为 `false`，期间没有为此新增任何远端请求

#### Scenario: 元数据被省略时标记 truncated
- **GIVEN** 设备 A 某会话所属 workspace 的 `title` 为 300 字符，A 共 10 个会话
- **WHEN** 生成快照
- **THEN** 该会话不含 `workspaceTitle`，A 的 `truncated` 为 `true`

#### Scenario: 超过 64 台设备时保留可达者
- **GIVEN** 本进程握手过 66 台设备，其中 3 台当前不可达
- **WHEN** 生成快照
- **THEN** `runtimes` 含 64 项，包括全部 63 台可达设备，顶层 `truncated` 为 `true`

#### Scenario: 无变化不推送
- **GIVEN** 已向所有 `connected` 设备成功推送 revision 7，没有失败待重试的推送，A 的中继保持 `connected`
- **WHEN** 用户手动刷新设备 A，得到的会话、归档、workspace 元数据与 `updatedAt` 投影后与当前快照逐字段相同
- **THEN** 不产生 revision 8，不发出 `directory` 请求（手动刷新不会让已 `connected` 的中继重新握手）

### Requirement: 中继不进入驾驶舱的入站 API 与持久化

本能力 MUST NOT 新增驾驶舱入站 HTTP 路由，`cockpit-api-auth` 的 bridge 回调路由名单不变。驾驶舱 MUST NOT 把信封、目录、租约或中继状态写入 `~/.dsh-cockpit` 下的任何文件。驾驶舱收到 SIGINT/SIGTERM 时 SHALL 结束全部 outbox 订阅并停止全部中继重试。

#### Scenario: 驾驶舱 API 面不变
- **WHEN** 枚举驾驶舱注册的 HTTP 路由
- **THEN** 与本能力引入前的集合相同

#### Scenario: 不写持久文件
- **GIVEN** 对驾驶舱的文件写入做插桩，驾驶舱与两台设备完成接入并转发过信封
- **WHEN** 检查接入与转发期间发生的全部写入（新建与已有文件）
- **THEN** 没有任何写入的内容包含租约、信封、目录快照或中继状态；与中继无关的合法注册表写入允许发生

#### Scenario: 退出时停止中继
- **GIVEN** 设备 C 的中继处于 `error` 退避中，设备 A 的订阅打开
- **WHEN** 驾驶舱收到 SIGTERM
- **THEN** A 的订阅被结束，此后不再向任何设备发起握手
