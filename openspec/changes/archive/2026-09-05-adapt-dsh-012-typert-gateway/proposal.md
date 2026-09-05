## Why

DSH `0.1.2` 线把 Web 侧 `/api` 通道从 rc.2 的非结构化 RPC/双事件流切换为 typert 网关，并首次给 index 与全部 `/api/*` 加上浏览器会话认证。驾驶舱现行 `rc2-client.ts` 因而无法连接 `0.1.2-rc.1` 设备，实测表现为 `DSH_UNAVAILABLE: rc.2 host.describe HTTP 401`。

这里的“认证”不是 Cockpit 新增账号、密码或 provider 凭据：它是 DSH 0.1.2 自己新增的启动 URL 握手——`dsh web` 打印一次 `/?token=...`，浏览器以它换取官方签名 cookie。旧版没有这一步，所以 Cockpit 原先也不需要保存任何 DSH 访问材料。本 change 只做被上游强制出来的最小兼容，不建设通用凭据系统。

已经在 `0.1.1-rc.2`(:3080)与 `0.1.2-rc.1`(:3081)两个活实例上确认的破坏面包括：

1. **认证**：0.1.2 的 index、HTTP RPC 与 WebSocket upgrade 未认证均拒绝访问；
2. **端点和载荷**：`session.list` → `session/list`，载荷为 `{args:{…}}`；`host.describe` 和 unary `workspace.list` 不再存在；
3. **事件流**：`/api/events.mux` + `/api/events.host` → 单路 `/api/remote.mux`，其上复用 `$events` 与 `workspace/follow`；
4. **交互事件**：`approval/request`、`user-questions/request` 改为 waterfall。只读订阅者必须立即回复 `next`，否则会占住一份等待中的 delivery；
5. **pending 解除信号**：服务端旁观者回复 `next` 后不再收到该交互后续的 resolved 事件，需沿已规划的 `dsh-cockpit-bridge` 旁路观察官方 Web client 的 pending snapshot。

驾驶舱机群会长期存在两个版本族并存；升级目标是恢复现有工作台与只读聚合能力，不借机增加产品功能或重构架构。

## What Changes

一次原子兼容 change：

- **双协议适配**：在既有 client/stream 工厂缝后支持 rc.2 与 typert，按每个连接代自动判别；设备原地升级后无需手工标注版本。
- **最小认证握手**：typert 设备需要认证时，用户粘贴该设备 `dsh web` 已打印的官方启动 URL。Cockpit 只提取其中的进程 token，在当前回环 endpoint 上分别为 server 访问与 iframe 完成官方 token→cookie 交换；材料只存于 Cockpit 自有的 0600 设备存储，不进入状态 API、日志或模型可见面。失效后提示重新粘贴。
- **会话基线与事件**：`session/list` 加 `$events` 中的 `api-session/status`/`added`/`removed` 映射回现有 `CockpitEvent`。
- **workspace 基线与归档集**：用 `workspace/follow` 的 baseline 与增量恢复现有 workspace/archived 观测。
- **waterfall 礼貌性应答**：服务端收到任何 waterfall 帧立即经 `$events/result` 回复 `next`，只声明“不干预”，绝不返回实质决定。
- **pending 旁路观测**：升级现有 bridge，使其只读订阅官方 `ctx.uiSession.pendingInteractions` snapshot，并经既有短期 capability 通道上报最小的 `sessionId/kind/key`；它不订阅或回答 approval/question，不改变官方 UI 处理链。typert 设备未加载兼容 bridge 时明确显示 pending 不可观测，而不是错误显示为 0；其它聚合能力保持可用。

## 明确不做

- 不放弃 rc.2 支持，也不支持 0.1.2-alpha 中间协议；
- 不新增账号体系、密码库、通用 credential manager、自动轮换或 bearer-token 协议；
- 不读取本机或远端 `~/.dsh`、DSH 日志、provider token，也不增加 SSH 远程命令来自动发现 launch token；
- 不让 Cockpit 或 bridge 参与审批/提问决定；
- 不代理远端 Settings/Subscriptions/Credentials 或任何操作 API；
- 不把此次升级扩展为 DeviceLifecycle 重构、UI 重设计、轮询补偿或其它优化迭代；只允许为双协议连接代传递必要上下文的最小接口调整。

## Capabilities

### Modified Capabilities

- `cockpit-device-connectivity`：新增 rc.2/typert 自动适配、typert 官方认证握手、session/workspace/事件等价映射与 waterfall 安全放行。
- `cockpit-workbench`：iframe 首次认证送达；现有可选 bridge 增加 typert pending snapshot 的只读旁路上报。
- `cockpit-device-shell`：只为协议无法观测的情况区分“pending 为 0”和“pending 不可观测”，不改变现有状态图标语义。

## Impact

- **代码**：`cockpit-server/src/connectivity/` 增加 typert 适配与最小 cookie 会话；设备登记/更新接收官方启动 URL；`dsh-cockpit-bridge/src/client/` 增加 pending snapshot 上报；`shared` 与现有 TopBar/Overview 只增加 pending 可观测性表达。`CockpitEvent` 词汇保持不变。
- **验收基准**：rc.2 与 typert 活实例并行对照。工作台完整可用；state、根会话 running、sessionStatuses、归档集、会话增删事件行为一致；typert 在兼容 bridge 存活时 pending requested/resolved 与 rc.2 同场景一致，无 bridge 时明确为不可观测。
- **主要风险**：认证前无法仅靠 typert endpoint 响应判协议；waterfall `next` 时序；bridge snapshot 与官方 UI 生命周期。对应结论在实现前以窄范围 fixture/实测钉死，不扩展为新系统。
