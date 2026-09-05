## Context

驾驶舱当前只理解 DSH `0.1.1-rc.2` 的三类 unary 调用和两条 WebSocket 事件流；`DeviceLifecycle` 已把协议 I/O 放在 `createClient` / `createStream` seam 后，聚合状态机、基线盲窗缓冲与重连逻辑本身不应因本次上游升级重写。

DSH `0.1.2-rc.1` 的官方实现带来四项强制兼容工作：typert endpoint/envelope、单物理 mux 上的逻辑流、waterfall 放行义务，以及启动 token 换官方 cookie 的浏览器会话认证。后者是上游连接协议的一部分，不是 Cockpit 产品新增的登录或凭据能力。

| 面 | rc.2 | typert 0.1.2-rc.1 |
|---|---|---|
| 认证 | index/API 免认证 | `GET /?token=...` 换 authority-bound HttpOnly cookie，默认 30 天；HTTP/WS 都须带 cookie |
| 探活/会话基线 | `host.describe` / `session.list` | `session/list`，payload 为 `{args:{_request:{}}}` |
| workspace | unary `workspace.list` | stream `workspace/follow`，baseline 后接增量 |
| 事件 | `events.mux` + `events.host` | `remote.mux` 上逻辑流 `$events` |
| approval/question | requested/resolved emit | waterfall request；旁观 client 必须回复 `next`，之后没有 resolved 回传 |

## Goals / Non-Goals

**Goals**

- rc.2 与 typert 设备可在同一机群中使用，设备升级后自动切换适配器；
- 原生工作台、根会话 running、会话增删、归档、完成提醒及 pending 决策提示维持现有能力；
- Cockpit 在线不得占住或改变官方 UI 的 approval/question 处理；
- 只引入 0.1.2 连接所必需的最小认证材料和 UI 输入。

**Non-Goals**

- 不建设 Cockpit 账号、密码库、通用凭据管理、自动发现/轮换或 DSH 运维能力；
- 不读取 `~/.dsh` 或 DSH 日志，不通过 SSH 执行远端命令获取 token；
- 不参与任何审批/提问决定；
- 不支持 0.1.2-alpha 中间形态；
- 不重构 DeviceLifecycle 聚合算法、不重新设计状态 UI、不增加轮询补偿。

## Decisions

### D1：连接建立先做非破坏性载体分类，再在认证后确认协议

未认证 typert 会在 Gateway 分发前统一返回 401，因此不能把“调用 `session/list` 并检查 RemoteResult”作为唯一的首步协议判别。最小实现使用分层分类：

1. 复用现有 endpoint 可达性判断，但将“标准 DSH 0.1.2 的 401 + 固定认证提示/响应特征”识别为 **DSH authentication required 候选**，不误报普通 `DSH_UNAVAILABLE`；
2. 有该设备 launch token 时，在当前 loopback authority 上执行一次官方根路径交换并仅接受预期 303、`Set-Cookie` 与干净根路径；
3. 带交换所得 cookie 调用 `session/list`，以 typert `RemoteResult`/descriptor 响应确认协议；
4. 否则继续现有 rc.2 `host.describe` 路径。普通 401 服务、HTML 登录页或响应形状均不匹配时仍按现有 `NON_DSH_SERVICE` / `INCOMPATIBLE` 语义失败。

探测只缓存于当前连接代，重连重新确认。实现前把 rc.2、未认证 typert、已认证 typert 与非 DSH 401 四种响应固化成 fixture；这只是钉死分类边界，不演化为版本协商框架。

### D2：DSH 认证只实现官方 launch URL 握手

用户在设备登记或认证失效恢复时粘贴该设备 `dsh web` 打印的完整启动 URL；Cockpit 校验 URL 的 loopback host、登记端口与唯一 `token` 参数，只保存 token 值，不保存用户输入中的 host/path，也不接收账号密码。

保存位置沿用 Cockpit 自有 `DSH_COCKPIT_HOME` 下权限为 0600、原子写的设备存储。token 字段是输入专用/写后不回显：`DeviceRecord` 的持久模型可以携带，`DeviceStatusFacts`、设备 GET API、日志、诊断与错误正文绝不返回它。更新为空表示不改；显式清除和删除设备会清除它。

连接代在当前 endpoint authority 上用 token 交换 server cookie，并只在内存中保存 cookie；HTTP RPC 与 WebSocket upgrade 复用该 cookie。iframe 首次创建或认证恢复时只使用一次 `endpoint/?token=...`，由 DSH 自己设置 HttpOnly cookie 并 303 回干净根路径；Cockpit 不读 iframe cookie。稳定 local port 继续复用现状；authority 变化时用同一有效 launch token 重新交换。DSH 进程重启导致 token 失效时明确提示用户重新粘贴官方启动 URL。

这是恢复 0.1.2 连接的最小机制；不自动读取日志、不远程发现、不主动刷新或轮换 token，也不创建独立 secrets subsystem。

### D3：typert mux 适配为现有生命周期提供同构接口

每个 typert 连接代共享一个小型协议上下文：server cookie、一个 `/api/remote.mux` 物理 WebSocket，以及 `$events` / `workspace/follow` 两条逻辑流。它对外继续提供现有生命周期所需的 `probe/listSessions/listWorkspaces/open/dispose` 结构，允许为传递同一个连接代上下文对工厂签名做最小调整，但不改写 DeviceLifecycle 的聚合状态机。

- `session/list` 转成现有 session baseline 字段；
- `api-session/status/added/removed` 转成现有 `CockpitEvent`；
- `workspace/follow` baseline 与 `archived/upsert/remove/order` 增量维护最近缓存，`listWorkspaces()` 从缓存读取；
- 任一必需逻辑流 `error/end` 或物理 socket 断开均触发现有整代 disconnect/reconnect；本次不增加 partial-DEGRADED 新状态或逻辑流单独重试策略。

### D4：所有 waterfall 立即回复 next，bridge 不进入处理链

`$events` 没有事件过滤参数，Cockpit 为获得 session emit 必然也会收到 allowlist 中的 waterfall。每个 waterfall 到达后立即经 `$events/result` 回：

`{ args: { clientId, eventId, outcome: { kind: 'next' } } }`

它只移除 Cockpit 自己的一份 delivery；当官方 UI 同时在线时，官方 UI 的 delivery 仍可继续展示和处理。Cockpit 不等待 bridge、不解析问题内容、不返回 `result/rejected`。若 Cockpit 是唯一订阅者，`next` 使上游回到该 waterfall 的下一监听者/默认路径，等价于没有这个旁观订阅者。

bridge 的 pending 观测完全是另一条旁路：它只订阅官方 client 已发布的 snapshot，不注册 `ctx.remote.$on('approval/request' | 'user-questions/request')`，因此不会增加或持有任何 waterfall delivery。

### D5：pending 用 bridge snapshot 恢复现有提示能力

0.1.2 已有公开的 `ctx.uiSession.pendingInteractions`：`ReadonlyMap<sessionId, interaction>`，interaction 至少含 `sessionId/kind/key`。approval/question 官方 UI 自己负责把请求放入与移出该 snapshot。bridge 仅订阅这个 observable，并通过既有 device-origin-bound、短 TTL capability 通道发送完整的最小 snapshot；server 每次按 snapshot replace/reconcile，而不是依赖可能丢失的 requested/resolved 边沿。

现有 TopBar 的 warning 分组本来就是“每个 session 最多一个 pending 状态并按 session 计数”；bridge snapshot 与这个用户可见口径一致。为避免改变已有公共字段，`pendingInteractionCount` 继续保留 number；另加最小的 `pendingInteractionObservability: 'available' | 'unavailable'`。rc.2 始终为 available；typert 只有收到当前兼容 bridge 的 pending snapshot 时为 available。bridge 不存在、版本过旧、页面未加载或 snapshot 超出既有心跳新鲜窗口时为 unavailable，此时不得把数字 0 描述为“确认无等待”。

bridge 仍是可选配套：不装时原生工作台、running、会话、归档、完成提醒和设备切换都工作；唯一受上游协议限制的降级是 typert pending 显示明确不可观测。安装升级版 bridge 后恢复与现有 rc.2 相同的设备级等待提示。

## Risks / Trade-offs

- **认证前分类**：401 本身不是 DSH 身份；fixture 与负例必须防止把普通服务误认成 typert。
- **token 生命周期**：token 属于 DSH 进程，重启后可能失效；本次选择显式重新粘贴，而不是引入自动发现。
- **waterfall 安全**：必须先完成双订阅者、唯一订阅者与重连实测，再接入主生命周期。
- **bridge 生命周期**：页面关闭时官方 browser snapshot 不存在，因此只能如实标记 unavailable；不以旧 snapshot 或 0 冒充实时事实。
- **版本依赖**：bridge 需要注入 `uiSession` 并升级对应 0.1.2 peer/bundle 依赖；这只服务于本次 pending 兼容。

## Scope Guard

实施发现的新问题只有在满足“0.1.2 直接打断现有能力，且修复不改变现有产品语义”时才纳入本 change。性能调优、自动发现、更智能诊断、凭据体验优化、长期协议抽象、UI 美化与其它顺手重构一律另立 change。
