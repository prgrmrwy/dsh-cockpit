## Context

驾驶舱与设备 DSH 的耦合面全部集中在 `cockpit-server/src/connectivity/rc2-client.ts`(184 行):3 个 unary 方法(`probe`/`listSessions`/`listWorkspaces`)+ 1 个双 WebSocket 事件流(`DualEventStream`,9 种事件转换)。`device-lifecycle.ts` 已把两者做成可注入工厂(`createClient`/`createStream`),聚合、重连、基线 reconcile 逻辑与协议无关。

DSH `0.1.2` 的破坏面已在两个活实例上逐项实测(证据保存在 ohmydsh 仓库 change `dsh-0-1-2-host-api-migration` 的 baseline.md,以及本 change 起草时的 live probe):

| 面 | rc.2(0.1.1-rc.2) | typert(0.1.2-rc.1) | 实测方式 |
|---|---|---|---|
| 认证 | `/api` 与 index 免认证 | 均 401;launch token 换 30 天 cookie | curl 对照 |
| 探活 | `host.describe`(返回值弃用) | 无对应端点;`session/list` 可用 | curl:`{"args":{"_request":{}}}` 返回 items |
| 会话基线 | `session.list` → items | `session/list` → `SessionSummary[]`,字段逐一对齐(sessionId/updatedAt/running/blank/parentSessionId/origin) | curl 实测 + 类型对照 |
| workspace 基线+归档 | unary `workspace.list` | `workspace/follow` 流首帧 `{type:'baseline',value:{items,archivedSessionIds}}`,归档变更为 `{type:'archived'}` 增量 | ws 实测收到 baseline 帧 |
| 事件流 | `/api/events.mux` + `/api/events.host` 双流 | `/api/remote.mux` 单路复用;`{type:'open',streamId,endpoint:'$events',payload:{args:{}}}` 开流,首帧 `ready`(含 clientId 与 host.home) | ws 实测 101 + ready 帧 |
| 交互事件 | `approval/requested` 等 emit 帧 | `approval/request`/`user-questions/request` 为 **waterfall**:`deliveries.size===0` 才 settle,订阅者不答 = 主机审批挂起 | 网关源码逐行读(receiveRemoteEventResult/finishRemoteEvent) |

## Goals / Non-Goals

**Goals:**
- 0.1.2 设备的观测能力与 rc.2 设备逐项等价(状态分级、会话计数、pending 计数、归档集、会话增删事件)
- 机群内两版本并存,按设备自动选择协议
- 绝不因驾驶舱在线而阻塞任何主机的审批/提问

**Non-Goals:**
- 不参与审批/提问的实质决策
- 不重构聚合/重连层
- 不支持 0.1.2-alpha 中间版本(只认 rc.1 起的网关形态)

## Decisions

### D1: 协议探测顺序 —— 先 typert 后 rc.2

`session/list`(typert 载荷)对 rc.2 返回的是 200 + zod issues(rc.2 对未知 method 也 200),而 rc.2 的 `host.describe` 对 typert 是 401/404 —— 两个方向都不能靠"错误码区分"。改用**响应形状**判别:typert 的 `gateway/*` 错误码族与 rc.2 的 `bad-request` zod issues 结构互斥,一次探测请求即可分类。探测结果缓存于连接代,重连时重新探测(设备可能被升级)。

**备选**:设备记录里手工标注协议版本。**否决**:多一处人工状态,升级设备后必然漂移。

### D2: waterfall 立即回 next,是协议义务而非能力

`$events` 订阅无法选择事件子集(网关按 allowlist 全量下发,源码确认无过滤参数)。因此收到 `{type:'waterfall'}` 帧必须立即经 `$events/result` 回 `{outcome:{kind:'next'}}` —— "next" 在网关语义里是「本监听者放行」,与浏览器端官方 client 收到不感兴趣的 waterfall 时的行为一致。**这不是驾驶舱获得了审批能力,而是新协议下旁观者的合法表态方式。**

推论:驾驶舱从 waterfall 帧只能得知 requested,得不到 resolved(自己 next 之后 pending 就与它无关了),所以 **pending 观测必须另有来源**(D3)。

**备选 A**:不订阅 `$events`。**否决**:连 `api-session/status` 等 emit 事件也一起丢,会话状态只剩轮询。
**备选 B**:订阅但不答。**否决**:实测网关 `deliveries.size===0` 才 settle,不答 = 挂住主机审批;且"连着才坏、断开自愈",是最难排查的故障形态。

### D3: pending approval/question 观测迁移到 bridge

bridge 运行在每台设备的官方 Web UI 内,以官方 client 的旁观者身份观察 pending 状态(具体 seam —— slots store / conversation blocks / sessions 快照 —— 由 spike 在 0.1.2 官方 client 面上查定),经既有 capability HTTP 通道上报 `{sessionId, kind, key, resolved}`。cockpit-server 聚合层为 bridge 来源开一个 interaction 进水口,复用现有 `#trackInteraction`(key 去重、状态优先级)。

**代价与如实声明**:bridge 活在页面里,**设备浏览器没开时 0.1.2 设备的 pending 计数不可用**。这与 `bridgeSeenAt` 的既有语义一致(bridge 本来就依赖页面存活),UI 上应可区分"无 pending"与"无 bridge 无法观测"。rc.2 设备不受影响(事件流继续供数)。

**备选**:cockpit-server 从 waterfall 帧提取 requested、由 bridge 只补 resolved。**否决**:同一计数两来源双写,竞态与去重复杂度远超收益;单一来源(bridge)语义干净。

### D4: workspace 基线从「按需查」改为「常驻流缓存」

typert 客户端连接后即打开 `workspace/follow`,缓存最近 baseline + 应用 `archived`/`upsert`/`remove`/`order` 增量;`listWorkspaces()` 契约面不变,改为读缓存。流断开视同设备事件流断开(同一重连代)。rc.2 路径继续按需查询。

### D5: 认证获取 —— spike 决定,fail-explicit

0.1.2 设备的 API 与 iframe 都要认证。候选:① 设备登记时人工提供 launch token(URL 粘贴),换 30 天 cookie 持久化于设备记录;② 本机设备直接读 `$DSH_HOME/dsh.log` 的 token 行;③ 官方是否有面向自动化的凭据通道待查。无论哪种,**认证缺失时设备必须归入可诊断状态**(如 `DSH_UNAVAILABLE` + "authentication required" 诊断),不得表现为无差别连接失败。

## Risks / Trade-offs

- **[waterfall next 时序]** next 必须在官方 UI 处理之前不产生副作用 —— 网关源码显示任一 client 的 result/rejected 会 settle 整个 pending,但 next 只减 delivery,**只要浏览器还连着就安全**;唯一危险场景是"驾驶舱是唯一订阅者"(设备浏览器全关),此时 next 会让 pending 立即以 next settle —— 等于无人订阅时的默认行为,语义仍正确。已读源码确认,spike 需实测双订阅者场景。
- **[bridge seam 漂移]** 官方 client 内部 store 无稳定契约,升级可能悄悄破坏观察点 → bridge 上报带 seam 版本标记,cockpit 对超期未上报的 0.1.2 设备显示"pending 不可观测"而非 0。
- **[cookie 过期]** 30 天后 401 复现 → 认证失败必须落到 D5 的可诊断状态并提示重新引导。

## Open Questions

- bridge 观察 pending 的具体 seam(0.1.2 官方 client 的哪个 store/服务面)?
- 认证获取走哪条通道(D5 三候选)?本机与远端设备是否需要不同方式?
- `$events` 断线重连后 pending waterfall 会重新下发吗(网关源码显示新 client 会收到全部 pendingRemoteEvents —— 需实测确认 next 后不会重复计数)?
