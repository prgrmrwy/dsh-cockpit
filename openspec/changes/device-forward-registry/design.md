## Context

动机见 `proposal.md`。本版（v2）按用户确认的 5 条收敛决定，从 v1 大幅缩小。v1 → v2 的差异见文末“v1 → v2 收敛记录”。

以下现状事实均已读码确认（路径相对 `packages/`）。

**转发的现状**

- **两张进程内 Map**：`cockpit-server/src/connectivity/connectivity.service.ts:16` 定义上限 `MAX_PUBLISHABLE_CHANNELS = 8`。`:26` 的 `#publishablePorts`（设备 → 用途 → 端口）与 `:28` 的 `#publishedChannels`（→ `{url, localPort}`）都不落盘，也不投影到界面。
- **死链接缓存**：`publishPort`（`:486-507`）命中缓存时直接返回 URL，不检查子进程是否还活着。缓存只在 `releasePublishedPorts`（`:510-516`）中清空。
- **主通道重连连带杀死附加转发**：`DeviceLifecycle.stop()` 与 `#replaceLoop()` 都调用 `disposeNode(deviceId)`（`device-lifecycle.ts:420`、`:452`），会杀掉该设备的**全部**通道，而缓存照旧保留。
- **lifecycle 替换**：`updateDevice` 在 `enabled` 翻转、认证材料变更或自动恢复设置变更时，执行 `#detach` → `#attach`（`connectivity.service.ts:324-333`；`#detach` 见 `:139-147`）。编辑 SSH 别名只调用 `updateRecord`，主通道仍连着旧主机。
- **`removeDevice` 的丢失更新窗口**：`removeDevice` 先 `load`，再整表 `save`（`:339-346`）。
- **TunnelManager 的缺口**：
  - `TunnelHandle`（`tunnel-manager.ts:34-44`）不含 pid；pid 只在 `OwnedProcess` 上（`ssh.ts:11`）。
  - `connect` 只在就绪前与 `process.exited` 竞速（`:168`），就绪之后的退出不会上报。
  - 已有 `disposeChannel`（`:219`）和有界端口重试 `maxBindAttempts = 3`（`:115`）。

**bridge 请求与错误**

- **bridge 请求按 `Origin` 解析设备**：`#lifecycleByOrigin`（`:537-552`）只匹配有 `endpoint` 的 lifecycle，所以主通道不可用时，bridge 的任何请求都会失败。
- **错误映射**：`toHttp`（`devices.controller.ts:385-396`）把业务错误统一映射为 400。bridge 的 `seamRequest`（`dsh-cockpit-bridge/src/client/index.ts:169-182`）对任何 400/401 都先换发能力串再重试，最后抛出**不带 `code`** 的错误。`REQUEST_TIMEOUT_MS = 10_000`（`:52`）。
- **能力串**：授权记录只含 `{deviceId, origin, purpose, issuedAt, expiresAt}`（`auth/bridge-capability.ts:8-14`），TTL 60 秒（`:41`）。由父页面调用 cookie 路由 `POST /api/devices/:deviceId/bridge/capability` 签发（`devices.controller.ts:119-126`），请求体目前为空。
- **bridge 回调豁免名单**：`auth/token.middleware.ts:75-81` 的 `isBridgeCallback` 是精确名单，当前含 `publishable-port` 与 `publish-port`。
  - 前置 change 把名单的权威来源定为 `cockpit-api-auth` 中的 requirement“bridge 回调路由名单”。增删路由必须对它做 MODIFIED。
  - 中间件只在请求**带**能力串头时豁免 cookie（`token.middleware.ts:38`）。不带能力串头的请求按 cookie 路由处理，同源驾驶舱页面带 cookie 就能通过中间件。
  - 所以“必须带能力串”只能由端点自身强制，现有的 `requireBridgeCapability`（`devices.controller.ts:256-263`）就是这样做的，缺头时返回 401 `unauthorized`。

**本版依赖的新事实：驾驶舱页面连接**

- **SSE 服务端**：`GET /api/devices/stream` 在 `devices.controller.ts:18-30`。每个连接调用一次 `DeviceEventsService.subscribe`（`:28`），在 `request.on('close')` 时退订（`:29`）。
- **订阅者即 SSE 连接**：`DeviceEventsService`（`connectivity/device-events.service.ts:9-19`）只有一个 `#listeners` Set。全仓库只有这个控制器调用 `subscribe`，所以 `#listeners.size` 等于当前 SSE 连接数。要统计连接数只需加计数，不需要新的基础设施。
- **SSE 客户端**：唯一的客户端是 `cockpit-web/src/api/stream.ts:16`，即 `new EventSource('/api/devices/stream')`。它在 `main.tsx:41` 挂载一次，URL 不带任何页面标识。EventSource 断线后按**同一 URL** 自动重连。
- **页面刷新时连接数不会归零**：刷新时，旧连接关闭、新连接建立，间隔通常远小于 30 秒。因此“全部连接断开”在刷新时不会成立（见 D4）。
- **关闭时强制断开**：`main.ts:46-50` 在关闭时强制断开所有连接，注释说明浏览器会一直保持这条 SSE。

**本版依赖的新事实：bridge 实例**

- **没有实例概念**：bridge 目前没有任何“实例”概念。在 `dsh-cockpit-bridge/src` 中 grep `instance|pagehide|beforeunload|sendBeacon|keepalive`，均无命中。`hello` 的请求体只有 `version`、`protocolVersion`、`current`（客户端 `client/index.ts:339-343`，服务端 `devices.controller.ts:190-205`）。
- **生命周期入口**：插件入口是 `apply`（`:110`），主体在 `ctx.effect`（`:199`）中，其 dispose 回调在 `:491-500`。`PLUGIN_VERSION = '0.5.1'`（`:43`）。
- **父页面消息通道**：
  - 父页面在 `notifyActivated` 中用精确 `targetOrigin` 下发 `BRIDGE_CONFIG_MESSAGE`（`cockpit-web/src/workbench/Workbench.tsx:70-93`）。
  - 已有一个 iframe→父页面的消息处理器（`:180-206`），它通过比对 `event.source === iframe.contentWindow` 和 `event.origin` 把消息归属到具体设备。iframe 内部导航后，WindowProxy 不变，所以这种归属依然成立。
  - **origin 会漂移**：主通道 endpoint 的 origin 变化时（例如端口漂移），`:246-251` 会先把 `frame.url` 改成新 endpoint，再由 React 改 iframe `src`。旧文档在 `pagehide` 中发出的消息，`event.origin` 仍是**旧** origin；而现有处理器比对的是当前 `frame.url`。
  - 非活动设备的 iframe 以 `display:none` 常驻挂载（`:373-376`）。

**其它**

- **注册表**：
  - `validateDevice`（`storage/registry.ts:59`）按白名单重建记录，旧版本会丢弃未知字段。
  - `mutateDevice`（`:172`）与 `mutateDevices`（`:157`）是原子写盘路径。
- **旧设计的决策**（`openspec/changes/archive/2026-09-24-device-port-forward-seam/design.md`）：D3 规定附加端口不持久化，本版**保持**；D4 规定“不可传端口号”，本版推翻（见 D10）。
- **前置依赖**：独立 change `cockpit-api-same-origin`（capability `cockpit-api-auth`）必须先落地并归档。
  - 它为全部 cookie 路由提供 `Host` / `Origin` / `Sec-Fetch-Site` 同源校验，并新增 requirement“bridge 回调路由名单”作为名单的唯一权威来源。
  - 本 change 不重复定义校验规则，只对名单 requirement 做 MODIFIED（`specs/cockpit-api-auth/spec.md`）。
  - 该 delta 以前置 change 引入的 requirement 为基线，所以本 change 必须在前置 change 归档后才能归档。

## Goals / Non-Goals

**Goals:**

- 一张表看全：在驾驶舱面板或 DSH 设置页，能数清每台设备有几个 ssh 转发进程，以及它们各为谁服务。
- 组件经 bridge 自动申请转发；页面结束后，转发无人值守回收，且不需要续约计时器。
- 自愈：转发断开后自动重建，不交付死地址。
- 不扰动：主通道重连、认证更新都不连带杀死附加转发。
- 支持 TCP，不局限于 HTTP。

**Non-Goals:**

- 不做 TTL 租约、续约或墓碑（见“v1 → v2 收敛记录”）。
- 不持久化附加转发的本地端口。
- 不做新旧 bridge / 驾驶舱的兼容回退。
- DSH 侧不提供创建或删除操作。
- 不定义同源校验规则（由 `cockpit-api-auth` 负责）。
- 不引入 ControlMaster、`ssh -O forward`、SOCKS 或 HTTP 反向代理（见 D2）。
- 不做“最近是否有流量”的空闲判定：驾驶舱不在数据路径中，无从观察流量。
- 不修改 ohmydsh 侧的组件或 shim（属于下游 change）。

## Decisions

编号沿用 v1，便于对照；被删除的编号见文末收敛记录。

### D1. 转发表归 ConnectivityService 按设备持有，是期望状态；system 条目只是投影

新增 `connectivity/forward-table.ts`。`ConnectivityService` 为每台设备持有一个 `DeviceForwards`，其生存期与设备记录一致，**独立于 `DeviceLifecycle` 实例**。

**所有权切分**

- `DeviceLifecycle` 只拥有主通道。`stop()` 与 `#replaceLoop()` 改为调用 `disposeChannel(deviceId, WORKBENCH_CHANNEL)`，不再调用 `disposeNode`。
- `#detach` 拆成两条路径：
  - `#replaceLifecycle`：用于认证、自动恢复设置或 SSH 别名变更，转发表保留。
  - `#terminateDevice`：用于禁用、删除和 shutdown，同时调用 `forwards.terminate()`。
- `removeDevice` 改用 `mutateDevices`，因为常驻条目现在写在设备记录里，整表 `save` 的丢失更新窗口会吞掉并发的常驻写入。

**主通道不迁入表中**

主通道只在投影时合成一条 `kind: system` 行。它的端口稳定、状态分级和退避都已有成熟实现与 spec，迁入的收益只是“看得见”，而投影已经做到了这一点。

**键选设备端口，而非 channelId**

用户关心的计数单位是“一个设备端口一个进程”。
- 备选：用 channelId 作键。否决：两个消费方为同一端口各起一个 channelId，就会起两个进程，这正是要消除的膨胀。

**单飞与原子性**

- 每台设备一条串行队列，上限检查与插入在同一个临界区内完成。
- 建立过程异步进行，不占用队列。
- 同一端口的后续申请只追加持有者。
- 建立完成时检查条目是否仍然存在、generation 是否一致；不一致则立即 dispose 新句柄。

**主通道端口保留**

附加条目的设备端口不得等于主通道的远端 DSH 端口（`reserved-port`）。system 条目已经覆盖这个服务，重复只会让计数失真，还会让“删除附加条目”看起来像在删除工作台。

- 编辑设备把远端端口改成某个现存附加条目的端口时，**不做**冲突拒绝：两个进程都可见、都可删，代价只是一个多余进程。

### D2. 一条转发一个 `ssh -L` 进程，表与进程之间留接缝

每个条目对应一个 `TunnelManager` 通道，channelId 为 `fwd-<devicePort>`，沿用全部安全参数。转发表只通过 `connect`、`disposeChannel` 和新增的就绪后退出回调驱动进程；`TunnelHandle` 增加 `pid` 字段。

- 备选：ControlMaster 加 `ssh -O forward/cancel`。否决，理由如下：
  1. `-O` 无法列出现有转发，真相仍要记在自己的表里。
  2. Windows OpenSSH 对 ControlMaster 的支持不完整（社区普遍报告，未验证）。
  3. master 一旦死亡，全部转发同时失效，这是新的故障面。
  4. 上限只有 8，连接数不是瓶颈。

保留接缝后，将来切换到 ControlMaster 只需替换 `TunnelManager` 对附加通道的实现，表、API 与 UI 都不用改。

### D3. 寿命只有两种：常驻（pinned）与随持有者（held）

**常驻**

- 只能由驾驶舱设备面板创建和删除。
- 以 `DeviceRecord.forwards?: { devicePort, label? }[]` 写入注册表，**不含本地端口**。
- 写入路径：`mutateDevice` → 提交内存 → 启动子进程。写盘失败时，请求按既有错误路径失败，内存表不变，不需要新的错误码。
- 删除常驻条目同样先写盘：写盘失败时删除请求失败，内存表、持有者和子进程都不变。
- 读取：旧记录缺少该字段时视为空表；单个非法条目忽略并告警，不把整个注册表判为损坏。注册表的 fail-closed 针对的是“文件不可解析”。

**随持有者**

- 由 bridge `acquire` 建立或复用。
- 持有者身份为三元组 `(pageId, instanceId, holder)`：
  - `pageId`：驾驶舱页面标识（D4）；
  - `instanceId`：bridge 页面实例标识（D4）；
  - `holder`：调用方提供的标签。
- 同一个三元组对同一端口重复申请是幂等的。
- 条目在“常驻或至少有一个持有者”时存续，否则回收。
- 随持有者条目与持有者都只保存在内存中：驾驶舱重启后不恢复；设备禁用时全部丢弃，而常驻条目保留，并在重新启用后重建。

**常驻与持有可以叠加**

- 面板为一个已被持有的端口创建常驻：只加上常驻标记。
- 面板删除一个条目：同时移除常驻标记和全部持有者。持有者会在快照中看到条目消失；bridge 不会自动重新申请。
- 删除和释放未知的对象都是幂等的。

**为什么没有 TTL**

用户决定删除整套租约机制。“持有者是否还在”改由 D4 的结构性事件回答，不再依靠计时续约。v1 的续约失败分类、主通道断开时的冻结、墓碑，都是为了解决 TTL 与“主通道不可用时 bridge 无法续约”之间的冲突而存在；没有 TTL，这个冲突也就不存在了。

### D4. 实例结束判定：pagehide 经父页面释放 + 页面 SSE 断开宽限回收

这是 v2 的核心新设计。它由三件事件驱动的回收组成，不依赖任何按持有者的计时器。

**(a) bridge 页面实例结束 → 父页面代为释放**

- `instanceId`（≥128 位随机，base64url 编码）随 `acquire` 与 `release` 发送。
  - bridge 在每次 `ctx.effect` 启动时生成新值，所以每次页面加载、以及宿主在同一页面内 dispose 后重跑 effect，都会得到新标识。
  - `pageshow` 且 `event.persisted === true`（从 bfcache 恢复）时，bridge 也生成新值。
- **实例标识是一次性的**：一旦发出 `instance-ended`，bridge 不再以该标识申请或释放。
  - 换用新标识时，bridge 丢弃旧标识下的本地持有记录，并以 `removed` 通知持有者，由消费方决定是否重新申请。
  - 这样，(e) 的已结束集合只会拒绝真正在途的旧请求，不会误伤仍然活着的页面。
- 在 `pagehide` 以及 `ctx.effect` 的 dispose 中，bridge 向父页面发送 `dsh-cockpit:bridge-instance-ended { instanceId }`，`targetOrigin` 为已握手的驾驶舱 origin。
- **归属判定以 `event.source` 为准**：
  - `event.source` 必须等于某台设备 iframe 的 `contentWindow`，消息据此归属到该设备。
  - `event.origin` 只需属于该 iframe 当前或此前加载过的设备 origin。父页面按设备维护一个“已下发过 bridge 配置的 origin 集合”，iframe 卸载或设备被移除时清空。
  - 不要求 `event.origin` 等于当前 origin，原因见 Context：主通道 origin 漂移时，旧文档的消息带的是旧 origin。按当前 origin 比对，会把正是本 change 让其跨越重连存活的持有漏掉。
  - 放宽后的风险有限：`instanceId` 不可猜测，而且“释放实例”端点按 URL 中的设备限定，只能释放该设备的持有。
- 校验通过后，父页面以同源 cookie 调用 `POST /api/devices/:deviceId/forwards/release-instance { instanceId, pageId }`，释放该设备上该实例的全部持有。
- 为什么经父页面，而不是由 bridge 自己在 `pagehide` 中发请求：
  - 能力串 TTL 只有 60 秒，页面卸载时常常已经过期，而卸载过程中来不及走“向父页面换发”的往返（`renewConfig` 至多等待 5 秒）。
  - 带自定义请求头的跨源 `fetch(keepalive)` 需要预检，在卸载过程中的可靠性无法保证。
  - 父页面在 iframe 重载或导航时依然存活，发的是同源请求，不需要能力串。

**(b) 驾驶舱页面断开宽限回收（兜底）**

- 驾驶舱 web 在页面加载时生成 `pageId`，并用在两处：
  - SSE 地址改为 `/api/devices/stream?page=<pageId>`；
  - 能力串签发请求携带 `{ pageId }`，服务端把它写入授权记录。
- **输入契约**：`pageId` 与 `instanceId` 格式相同，都是不透明随机串，含 ≥128 位随机量，编码为 16–64 个 `[A-Za-z0-9_-]` 字符。
  - 签发请求缺少 `pageId` 或格式不合规：返回 400 `invalid-page`，不签发能力串。
  - 授权记录缺少 `pageId` 的能力串视为无效。实际上，所有能力串都由新版签发，这只是防御性规定。
  - SSE 缺少 `page` 参数或参数值不合规：照常推送，但不计入任何 `pageId`。这样外部工具（如 curl）也能观察状态流，又不会让“无连接即起宽限”的判定失真。
  - `pageId` 不进入日志；**不得新增含查询串的访问日志**。当前服务端只有 Nest 应用日志，没有请求 URL 日志。
- `acquire` 时，服务端从**能力串授权记录**中取 `pageId`，而不是从请求体取，因此设备页面无法自选归属。
- `DeviceEventsService` 按 `pageId` 统计连接数：
  - 某个 `pageId` 的连接数降为 0 时，启动一个 30 秒宽限计时；
  - 宽限期内同一 `pageId` 重新连接，就取消计时，这覆盖了 EventSource 按同一 URL 的自动重连；
  - 宽限结束仍为 0，就移除所有设备上属于该 `pageId` 的持有。
  - 这是按页面计的计时器，每个驾驶舱页面至多一个，而不是按持有者计的续约。
- `acquire` 时如果该 `pageId` 当前没有活跃连接，同样启动宽限计时，确保凭空出现的 `pageId` 也会被回收。

**为什么按页面，而不是“全部连接断开”**

用户建议的是后者。但读码确认，刷新驾驶舱页面时，旧 SSE 关闭、新 SSE 几乎立即建立（Context），全局连接数永远不会为 0 超过 30 秒。同时，iframe 在父页面卸载期间发出的 `pagehide` 消息会随父页面一起丢失。结果是每刷新一次，旧实例的持有就永久残留一份。

按页面计数只多了一个查询参数和授权记录里的一个字段，却让刷新、多标签页中关闭其一这两种情况都能在 30 秒后收敛。“全部页面断开”是它的特例，所以这仍然满足用户提出的兜底语义。

**(c) 驾驶舱重启**：随持有者条目不恢复。

**(d) 漏网的持有**

例如 iframe 渲染进程崩溃，没有 `pagehide`，而驾驶舱页面还开着。这时条目在面板与 DSH 设置页中可见，可以在面板手动删除；页面最终关闭时，也会由 (b) 回收。

**(e) 实例结束与同实例在途申请的竞争**

- 竞争场景：bridge 在卸载前刚发出 `acquire`，而父页面的 `release-instance` 先到达服务端。此时释放是空操作，后到的 `acquire` 会为一个已死实例建立持有；由于 `pageId` 仍有连接，(b) 不会触发。
- 处理：服务端在 `release-instance` 时，把 `instanceId` 记入该 `pageId` 的“已结束实例”集合。之后，属于同一 `pageId` 且携带该 `instanceId` 的 `acquire`，以 409 `invalid-holder` 拒绝。
- 这不是按时间过期的墓碑，与收敛决定 1 不冲突：
  - 集合不按时间过期，只在该 `pageId` 宽限回收时一并清除；
  - 其大小受“该页面生命周期内实例结束次数”约束。
- 这套机制依赖 (a) 的一次性约定：bridge 结束某个实例标识后不再使用它。否则 bfcache 恢复或 effect 重跑后，同一标识的申请会被永久拒绝，直到页面宽限回收。

**备选与否决**

- TTL 加续约：用户已决定删除。
- 由 bridge 在 `pagehide` 中自行 `fetch(keepalive)`：否决，理由见 (a)。
- 按能力串过期判定持有者消失：能力串在后台标签页中本就会过期，并按需换发，不能代表页面死活。
- 只做 (b)、不做 (a)：iframe 自身重载（设备 DSH 页面刷新）时，驾驶舱页面还在，旧实例的持有会一直残留到整个页面关闭，所以 (a) 必须保留。

### D5. 自愈：就绪后退出上报并按退避重建；主通道不可用时只暂停“新建”

在 `TunnelManager` 为已就绪的通道增加退出回调 `(deviceId, channelId, diagnostic)`。由自身 dispose 引起的退出不回调，用 `active.disposed` 区分。

转发表收到回调后：

- 把条目置为 `retrying`，并调度重建：退避从 1 秒起逐次加倍，上限 60 秒，带抖动。
- 只要条目存续就一直重试。
- 本地端口由内核重新分配，可能发生变化；持有者通过快照（D7）得知新地址。

**主通道不可用时只暂停新建，不杀存活进程**

- 主通道重连的常见原因是远端 `dsh web` 重启，此时数据库等附加转发完全健康。
- 如果链路真的断了，存活进程会因 keepalive 超时自行退出，随后条目进入 `paused`。
- 暂停新建是为了避免对不可达的主机同时跑 N 个退避循环。

**SSH 别名变更**

- 把“别名变化”加入 `#replaceLifecycle` 的触发条件，并调用 `forwards.rehost()`：终止全部附加子进程并置为 `paused`，等主通道以新别名进入 `READY` 后再重建。
- 这样不会出现“工作台连的是 vm-a、附加转发连的是 vm-b”的错位。
- 归属选择：“别名变更时替换主通道连接”本身是主通道生命周期的行为变化（现状只调用 `updateRecord`）。它只写在 `cockpit-device-port-forward`，因为它的唯一动机是附加转发的一致性；connectivity 的现有 requirement 没有规定别名编辑的连接行为，不需要 MODIFIED。以后修改 connectivity 时，需要同时查看本条。

**只在 ready 时交付地址**

投影与快照只在条目处于 `ready` 时携带本地端口和地址。

### D7. bridge 接缝 `cockpitBridge.forwards`、端点、错误码与快照

**接缝**

- 接缝提供 `acquire(devicePort, holder)`、`release(handle)`、`list()`、`subscribe(listener)`。
- 它在 bridge 0.6.0 中**直接替换** `cockpitBridge.portForward`；旧接缝与旧端点在同一版本删除，不保留适配器（收敛决定 2）。
- `acquire` 立即返回当前状态，地址等到就绪后经快照交付。这样可以避开“建立最坏超过 15 秒”与“bridge 请求 10 秒超时”之间的冲突。
- `list()` 返回最近收到的快照，**不另设列出端点**：父页面在配置消息之后紧接着推送快照，而配置消息到达之前接缝本来就不可用。

**端点**

- bridge 回调（能力串认证，按授权记录定位设备）：
  - `POST /api/bridge/forwards/acquire`，请求体 `{ devicePort, holder, instanceId }`；
  - `POST /api/bridge/forwards/release`，请求体 `{ devicePort, holder, instanceId }`。
  - 这两条路由列入 `cockpit-api-auth` 的“bridge 回调路由名单”；`publishable-port` 与 `publish-port` 同时移出。二者都通过对该 requirement 的 MODIFIED 完成（`specs/cockpit-api-auth/spec.md`），`cockpit-device-port-forward` 只引用该名单。
  - 实现上，`token.middleware.ts` 的 `isBridgeCallback` 同步更新：加入这两条，删除两条旧路由。
  - 两个端点复用 `requireBridgeCapability`：缺少能力串头时由端点自身返回 401，而不是依赖中间件；这项检查先于其它任何校验。
- 驾驶舱 cookie 路由（受 `cockpit-api-auth` 同源校验约束）：
  - `POST /api/devices/:deviceId/forwards`，请求体 `{ devicePort, label? }`，用于创建常驻；
  - `DELETE /api/devices/:deviceId/forwards/:devicePort`；
  - `POST /api/devices/:deviceId/forwards/release-instance`，请求体 `{ instanceId, pageId }`。其中 `pageId` 用于记入已结束实例集合（D4(e)）。
- 能力串签发路由增加必填的 `pageId`，缺失或不合规时返回 400 `invalid-page`（驾驶舱 web 与服务端同版本发布）。

**错误分层**

- 业务拒绝返回 409，响应体带 `{ code }`，可能的 `code` 为 `forward-limit`、`reserved-port`、`invalid-port`、`invalid-holder`、`invalid-label`、`local-device`、`device-unavailable`。
- 能力串相关的拒绝保持既有的 400/401 不变。
- **forwards 端点的判定顺序**，命中即返回：
  1. 缺少能力串头：401 `unauthorized`。
  2. 能力串不存在、已过期，或授权记录的 `origin` 不等于请求 `Origin`：400 `bridge-capability-invalid`。
     - 只查授权记录，不经 `#lifecycleByOrigin`，因此不依赖主通道端点。
     - 现有 `validateBridgeCapability`（`connectivity.service.ts:405-413`）先按 origin 解析 lifecycle、后查授权记录；forwards 端点不能沿用这个顺序。否则同一输入，按实现顺序不同，可能得到 400 也可能得到 409。
     - 而且若 409 先于能力串校验返回，任何回环页面带一个垃圾能力串头，就能探测某个 origin 是否对应在线设备。
  3. 仅 `acquire`：授权记录的 `deviceId` 当前没有主通道端点，返回 409 `device-unavailable`。不返回既有的 400 `bad-request`，否则 `seamRequest` 会把它当成能力串失效，做一次无意义的换发和重试，最后抛出不带 `code` 的错误。
  4. 其余业务校验。
- `release` 按授权记录的 `deviceId` 定位转发表，不经 `#lifecycleByOrigin`。
  - 主通道断开期间 iframe 仍保持挂载，持有者可能正在释放；这时释放照常移除持有者，不会丢失。
- 其它 bridge 端点的校验顺序与错误映射不变。
- `seamRequest` 保持“遇到 400/401 时换发并重试一次”，并新增一条：遇到 409 时不换发，把 `code` 原样交给调用方。
- 备选：业务错误也用 400。否决：会被误判为能力串失效，多一次换发和一次重复写请求。

**快照**

- 驾驶舱 web 已经从 SSE 拿到含转发表投影的设备状态。
- `Workbench.tsx` 在每次发送配置消息之后紧接着推送一次快照，此后每当投影变化就推送；`targetOrigin` 精确等于设备 origin。
- postMessage 按序送达，所以 bridge 处理快照时已经持有驾驶舱 origin。
- bridge 校验 `event.origin`，按条目比对状态和本地端口的变化，然后通知持有者。条目从快照中消失时，以 `removed` 通知持有者。
- 快照不含宿主机 ssh pid；pid 只出现在驾驶舱面板使用的设备状态流投影中，以减少宿主信息泄露给设备页面。
- 备选：bridge 轮询，或直接订阅 SSE。否决：既有 spec 规定不做周期轮询，而跨源 SSE 需要新增 CORS 与认证面。

### D9. DSH 设置区块只读

bridge 用 `ctx.slots.inject('settings.section', …)` 延迟注入一个只读区块，内容为本设备的转发清单、状态与 `N / 8` 占用，模式与 ohmydsh `dsh-memex` 相同。settings 包缺席时，其它能力不受影响。

- 区块不提供创建或删除（收敛决定 4）。因此 v1 中“DSH 侧不能删除驾驶舱常驻条目”（`managed-by-cockpit`）的权限区分也不再需要。
- 设备页面能引起的最大变化，是为本设备申请或释放随持有者条目。

### D10. 推翻旧 D4 的“不可传端口号”

归档 D4 已经论证：登记与发布出自同一个可信页面上下文，登记挡不住一个想要任意端口的页面。所以“不可传端口号”提供的是“显得克制”，并不是安全边界。

真正的边界是结构性的：
- 只转发设备的回环地址；
- 只在宿主机回环地址上监听；
- 每条转发绑定单个端口；
- 上限 8 条；
- 按 `Origin` 限定到本设备，同时依赖 `cockpit-api-auth` 阻止设备页面带着 cookie 调用设备管理 API；
- 全部条目可见、可删；
- 设备页面不能建立常驻条目，也不能删除任何条目。

这仍然满足 `BACKLOG.md` 中“不得作为通用写隧道”的原意，但 README 与 BACKLOG 中“只能发布已登记端口”的字面表述需要改写。

## Risks / Trade-offs

- **发布窗口内 memex 跨机浏览不可用**：驾驶舱与 bridge 0.6.0 同时发布后，ohmydsh 的 memex shim 仍在调用已经删除的 `cockpitBridge.portForward`，于是发现服务缺席并回落本机地址。
  - 影响：本机设备不受影响；跨机设备在 ohmydsh 更新 pin 与 shim 之前，无法经驾驶舱浏览 memex。
  - 缓解：发布顺序固定为“cockpit + bridge 0.6.0 同时发布 → ohmydsh 更新 pin 与 shim”，并尽量缩短两步之间的间隔。
- **漏网的持有**：iframe 崩溃、或父页面没来得及处理 `instance-ended`，会让条目残留到所属驾驶舱页面关闭后 30 秒。条目可见、可在面板删除，代价是一个空闲的 ssh 进程。origin 漂移与在途申请竞争这两条路径已分别由 D4(a) 与 D4(e) 堵住。
- **bfcache 或浏览器冻结**：
  - 驾驶舱标签页进入 bfcache 或被丢弃时，SSE 断开，宽限结束后持有会被回收。
  - 设备页面从 bfcache 恢复时，bridge 在 `pageshow`（`persisted === true`）中换用新实例标识，并以 `removed` 通知旧标识下的持有者。
    - 旧标识的持有，要么已被 `instance-ended` 释放，要么由宽限回收。
    - 消费方重新申请时带的是新标识，不会撞上已结束集合（D4(a)(e)），所以无论 SSE 是否在 30 秒内重连，重新申请都能成功。
  - 冻结但未断开连接的标签页会一直保留持有，这在语义上是正确的。
- **本地端口会漂移**：自愈重建后本地端口可能变化，写死地址的外部客户端（例如数据库 GUI）需要更新。这是用户接受的代价（收敛决定 3）；需要稳定地址时，可以在面板建立常驻条目，但常驻同样不保证端口不变。
- **附加转发的内核端口可能撞上其它设备的持久化主通道端口**：此时主通道按既有规则回退到新端口，origin 发生漂移。概率极低，且与现状相同，本版不处理。
- **首次建立就必然失败的条目会无限重试**：最坏情况下，每条目每分钟约 3 次 spawn。缓解：退避上限 60 秒；主通道不可用时暂停；条目可见并带诊断，可手动删除。
- **`ready` 不代表目标服务可用**：`-L` 只保证本地已在监听。
- **信任面**：
  - 同页插件可以为本设备的任意回环端口申请随持有者转发（D10）。
  - 转发出来的端口对宿主机上任何本地进程无认证可达，这是 `ssh -L` 的固有性质。
  - 浏览器中的网站可以经 DNS rebinding 访问不校验 `Host` 的被转发 HTTP 服务；驾驶舱不在数据路径中，无法缓解。
- **同页插件可以堆积持有者标签**：内存量级很小，页面结束时即被回收。
- **回滚会丢失常驻条目**：旧版本会忽略 `forwards` 字段，下次写盘时把它丢掉。

## Migration Plan

0. **前置**：`cockpit-api-same-origin` 已经落地并归档，“bridge 回调路由名单”已进入主 spec `cockpit-api-auth`。
1. **服务端：所有权切分**。
   - `TunnelManager` 增加就绪后退出回调与 pid。
   - `DeviceLifecycle` 只处置主通道。
   - `#detach` 拆分为 `#replaceLifecycle` 与 `#terminateDevice`；别名变更时替换 lifecycle。
   - `removeDevice` 改用 `mutateDevices`。
   - 这一步完成后，行为上唯一的变化是“重连不再杀附加通道”；既有测试须保持绿色。
2. **服务端：转发表**。
   - 新增 `forward-table.ts`，注册表增加常驻字段。
   - 新增 bridge 与 cookie 端点；删除 `publishable-port`、`publish-port`，以及 `#publishablePorts`、`#publishedChannels`。
   - `isBridgeCallback` 加入 `/api/bridge/forwards/acquire` 与 `/api/bridge/forwards/release`，删除两条旧路由。
   - 新增 SSE `pageId` 连接计数与宽限回收、已结束实例集合；能力串授权记录携带 `pageId`（签发时校验格式）。
   - 转发表投影进入设备状态流。
3. **web**：
   - 生成 `pageId`，并用于 SSE 与能力串请求；
   - 推送快照；
   - 转发 `instance-ended`，并为每个设备维护已下发过配置的 origin 集合；
   - 在设备面板中加入转发清单。
4. **bridge 0.6.0**：
   - 加入 `forwards` 接缝、`instanceId`、`pagehide` 与 dispose 通知；
   - `seamRequest` 对 409 透传 `code`；
   - 加入只读设置区块；
   - 删除 `portForward`。
5. **文档**：改写 README 端口发布段落和 BACKLOG 的相关条目。
6. **发布**：驾驶舱与 bridge 0.6.0 同时发布，随后 ohmydsh 另起 change，更新 bridge pin，并把 memex shim 迁移到 `forwards.acquire`。

**回滚**：驾驶舱与 bridge 必须一起回滚，因为旧 bridge 依赖的端点已被删除。常驻条目会在旧版本下次写盘时丢失，需要写进发布说明。

## Open Questions

无阻塞项。宽限期暂定 30 秒，需要在真实浏览器中确认它覆盖 EventSource 自动重连的间隔（默认约 3 秒；后台标签页可能被节流）；已映射为 test-plan 的具名验收项。

## 人类决策记录（2026-09-29，v2 定稿前）

- 接受 v2 生命周期：常驻 + 随持有者；实例结束经 `pagehide` → 父页面释放；兜底按 `pageId` 的 SSE 连接归零满 30 秒回收；驾驶舱重启不恢复随持有者条目。
- 接受：远端 DSH 端口编辑与附加条目冲突时不拒绝，只会多出一个可见、可删的进程。
- 接受：面板删除条目同时移除持有者，持有者收到 `removed`，bridge 不自动重新申请；消费方策略由下游 change 决定。
- 接受：驾驶舱与 bridge 必须同时回滚，仅在发布说明中写明，不另加保护。
- 接受：30 秒宽限期以真实浏览器实测作为验收项。

## v1 → v2 收敛记录

| v1 内容 | v2 处理 | 依据 |
|---|---|---|
| D3 租约：TTL 5 分钟、每 60 秒续约、主通道断开时冻结计时、墓碑、`revoked` / `lease-expired` | 删除，改为常驻 / 随持有者两种寿命加 D4 事件回收 | 决定 1 |
| D4 “用租约代替空闲超时” | 并入 D3 与 D4：用结构性事件判断持有者是否还在 | 决定 1 |
| D6 附加端口持久化、让位规则、`avoidLocalPorts`、写盘失败回滚、`persist-failed` | 删除；附加端口按内核分配，只持久化常驻标记 | 决定 3 |
| D7 续约失败分类、401 判定旧驾驶舱、`list` 端点 | 删除；`list` 由快照提供；错误分层只保留“409 透传 `code`” | 决定 1、2 |
| D8 旧接缝适配器、旧端点保留、legacy 租约、`legacy:` 标签、版本错配回退 | 删除；0.6.0 直接替换，旧端点同版本移除 | 决定 2 |
| D9 DSH 侧创建常驻、取消常驻、删除，以及 `managed-by-cockpit` 权限区分 | 删除；设置区块只读，接缝只保留 acquire / release / list / subscribe | 决定 4 |
| D11 全局同源校验、spec `cockpit-api-auth`、Migration 第 0 步的实现 | 移出，交给独立 change `cockpit-api-same-origin`；本 change 声明前置依赖，只做引用 | 决定 5 |
| “取消常驻”操作、常驻来源 `cockpit` / `dsh` | 删除；常驻只能由面板建立，删除即取消 | 决定 1、4 |
| 远端 DSH 端口编辑与附加条目的冲突检查（`forward-port-conflict`，同一串行域） | 删除；只保留 acquire 时的 `reserved-port` | 缩小范围，代价只是一个可见、可删的多余进程 |
| connectivity：附加端口持久化及其 4 个场景 | 删除；只修改“附加通道端口不被持久化”这一个场景，使其与“主通道重连不连带附加转发”一致 | 决定 3 |
| 用户建议的“驾驶舱全部页面断开才回收” | 细化为“按 `pageId` 断开宽限回收”，全部断开是其特例 | 读码：刷新时全局连接数不会归零（D4） |

## Round 4 review 建议取舍

- 采纳：📌-1（D5 写明别名变更的归属）；📌-2（forwards 端点的设备解析失败改为 409 `device-unavailable`）；📌-3（快照去掉 pid）；📌-4（删除常驻条目的写盘失败行为）；📌-6（“不自动重新申请”场景加 60 秒观测窗口）；📌-7（D4(b) 写明不得新增含查询串的访问日志）。
- 📌-5：已由 🟡-6 取代，无需单独处理。
- 📌-8 不另改 artifact：Migration 第 5 步已列出 README 与 BACKLOG 的改写，具体措辞按 D10 的结构性边界表述，在实现阶段落实。
