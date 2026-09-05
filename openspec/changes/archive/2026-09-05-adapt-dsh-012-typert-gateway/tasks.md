## 1. 实现前兼容性证据（窄门槛，不扩 scope）

- [x] 1.1 固化四类真实响应 fixture：rc.2、未认证 typert、认证后 typert、非 DSH 401；确认分类不会把普通 401 服务识别为 DSH。
- [x] 1.2 在 typert 活实例完成 waterfall 安全实测：双订阅者时 Cockpit `next` 不影响官方 UI；唯一订阅者时与没有 Cockpit 旁观者的 DSH 默认路径一致；cancel/断线/重连竞态幂等。
- [x] 1.3 用最小 console/plugin spike 验证 `ctx.uiSession.pendingInteractions` 可订阅，snapshot 项稳定提供 `sessionId/kind/key`，approval/question requested 与解除均会发布变化；保存测试 fixture，不读取交互内容。
- [x] 1.4 实测官方启动 URL 交换：只允许 loopback URL + 唯一 token；记录 303、authority-bound `Set-Cookie`、带 cookie 的 HTTP/WS 成功和进程重启后旧 token 失败响应。
- [x] 1.5 若以上证据与 design 冲突，先回填 design/spec；不得以自动发现、轮询、通用凭据或 UI 优化绕过门槛。

## 2. typert 协议适配（cockpit-server）

- [x] 2.1 定义最小协议接口/连接代上下文，保留 DeviceLifecycle 现有聚合算法；只为共享 protocol/auth/mux 上下文调整 `createClient` / `createStream` seam。
- [x] 2.2 新增 typert unary 客户端：`{args:{…}}` envelope、RemoteResult 解包、`session/list` probe 与 session baseline 映射；认证错误保持可诊断。
- [x] 2.3 新增 `/api/remote.mux` 物理连接和 `$events` / `workspace/follow` 逻辑流解析，覆盖 open/item/end/error/cancel；任一必需流失败复用现有整代重连。
- [x] 2.4 将 `api-session/status/added/removed` 映射为现有 `CockpitEvent`，未知 emit 忽略；不得把 waterfall 请求内容送入状态层。
- [x] 2.5 实现 waterfall 立即 `$events/result {outcome:{kind:'next'}}`，回复与 cancel/断线竞态幂等，不产生 pending 数据。
- [x] 2.6 用 `workspace/follow` baseline 及 `archived/upsert/remove/order` 增量维护缓存，向现有生命周期提供 `listWorkspaces()` 同构结果。
- [x] 2.7 按 1.1 分类边界在每个连接代自动选择 rc.2 或 typert；rc.2 的 client/dual-stream 行为保持不变。

## 3. 0.1.2 最小认证握手

- [x] 3.1 在设备新增/编辑输入中增加可选“DSH 启动 URL”，严格校验 loopback host、登记远端端口、根路径和唯一 token；API 只接受写入，所有读取结果不回显 token。
- [x] 3.2 在 Cockpit 自有 0600 原子设备存储中保存 token；新 token 替换旧值，显式清除/设备删除清除它；不得读取 `~/.dsh`、日志或执行 SSH 发现命令。
- [x] 3.3 连接代在当前 endpoint authority 交换并内存持有 server cookie，HTTP RPC 与 WebSocket upgrade 共用；authority 改变时重新交换，不持久化 cookie。
- [x] 3.4 Workbench 只在 typert 首次/恢复认证时加载一次 tokenized root URL，由 DSH 303 清理；后续保留现有 iframe keep-alive，Cockpit 不读取 cookie。
- [x] 3.5 缺失/失效 token 显示“粘贴当前 dsh web 启动 URL”的恢复引导，不新增状态枚举、不自动轮换、不建设独立 credential subsystem。
- [x] 3.6 增加认证安全测试：token 不出现在 devices/status 响应、SSE、日志/诊断、错误正文、iframe 稳态 URL及测试快照。

## 4. typert pending 旁路（现有 bridge + server）

- [x] 4.1 bridge 适配 0.1.2 client 依赖并注入 `uiSession`，订阅 `pendingInteractions`；保留现有 sessions selection 上报，不注册 approval/question listener。
- [x] 4.2 定义 capability 协议的新 pending-snapshot 消息：只含 protocol/seam 版本和 `sessionId/kind/key` 集合；复用现有 capability 鉴权、续签、静默失败和 bounded retry。
- [x] 4.3 snapshot 变化、首次 hello 成功和真实 activation 时上报最新完整 snapshot；网络恢复后重发最新值，不维护 requested/resolved 内容队列。
- [x] 4.4 server 校验 snapshot 形状/容量并按设备 replace/reconcile typert pending；rc.2 继续只用现有 Host 事件流，禁止两来源双写。
- [x] 4.5 shared 增加 `pendingInteractionObservability: 'available' | 'unavailable'`；保留现有 numeric count 和 sessionStatuses 口径。rc.2 为 available，typert 在收到当前兼容 snapshot 前为 unavailable。
- [x] 4.6 TopBar 与 Overview 在 unavailable 时只补充“等待决策状态不可观测”说明；running/completed、连接状态点和 bridge 链条图标保持现有视觉/语义，不做 UI 重设计。

## 5. 回归与双实例验收

- [x] 5.1 单测覆盖：四类探测 fixture、typert unary/stream parser、workspace cache、waterfall next/cancel、认证交换及脱敏、bridge snapshot/恢复/去重、observability 呈现。
- [x] 5.2 :3080 rc.2 回归：原生工作台、pending Host events、running/完成提醒、归档、会话增删和 bridge selection 行为均与升级前一致。
- [x] 5.3 :3081 typert 验收：启动 URL 输入后 server 与 iframe 均认证成功；state、running、完成提醒、归档、会话增删与 rc.2 同场景一致。
- [x] 5.4 typert pending 验收：兼容 bridge 在线时 approval/question 出现与解除正确；bridge 未加载时明确 unavailable，其它状态不受影响。
- [x] 5.5 waterfall 安全复验：Cockpit 在线、离线、双订阅者与唯一订阅者场景均不增加等待、不产生决定。
- [x] 5.6 运行并记录 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`。

## 6. 收尾

- [x] 6.1 复核 proposal/design/delta specs 与实现和验收证据一致，确认未纳入 Scope Guard 排除项。
- [x] 6.2 `openspec validate adapt-dsh-012-typert-gateway --strict` 通过，并更新本 change 的任务状态。
- [x] 6.3 实现完成后按 OpenSpec archive 流程收口；跨仓库通知只作为发布协调，不作为本仓完成条件。
