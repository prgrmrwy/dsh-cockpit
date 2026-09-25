## Context

动机见 `proposal.md`。以下现状事实已读码确认：

- **两张进程内 Map**：`ConnectivityService`（`packages/cockpit-server/src/connectivity/connectivity.service.ts`）持有 `#publishablePorts`（`deviceId → channelId → devicePort`）与 `#publishedChannels`（`publishKey → { url, localPort }`），上限常量 `MAX_PUBLISHABLE_CHANNELS = 8`。两者均不落盘，也不投影到任何界面。
- **死链接缓存**：`publishPort` 一旦命中 `#publishedChannels`，就直接返回缓存 URL，不校验子进程是否存活。缓存只在 `releasePublishedPorts`（禁用、删除、认证变更时经 `#detach`）清空。以下两条路径都会杀掉附加进程，却都不清理缓存：
  1. 主通道重连时，`#replaceLoop` 调用 `tunnels.disposeNode(deviceId)`，杀掉该设备**全部**通道（`device-lifecycle.ts:452`）。这是最常见的触发路径。
  2. 附加子进程在就绪后自行退出。
- **lifecycle 替换也会杀掉全部通道**：`updateDevice` 在 `enabled` 翻转，**以及认证材料或自动恢复设置变更**（`authChanged || discoveryChanged`）时，会执行 `#detach` → `lifecycle.stop()` → `disposeNode`，然后 `#attach` 一个新 lifecycle（`connectivity.service.ts:324-333`）。编辑 SSH 别名或远端端口只调用 `updateRecord`，不重启 lifecycle。
- **TunnelManager 已有能力与缺口**：`#active` 已按 `deviceId + channelId` 键控，并已提供 `disposeChannel`、`preferredLocalPort`、端口归因重试（`maxBindAttempts = 3`，`ConnectTimeout=5`）。缺两样：
  - 就绪后退出的上报：`connect()` 只在就绪前与 `process.exited` 竞速。
  - `TunnelHandle` 不含 pid（pid 只在 `OwnedProcess` 上）。
  - 另外，同 key 再次 `connect` 会先 `#disposeKey`，打断进行中的建立。
- **bridge 请求按 origin 解析设备**：所有 bridge 请求都经 `#lifecycleByOrigin`，它只匹配 `endpoint !== undefined` 的 lifecycle；能力串换发同样要求 endpoint 存在。所以**主通道不可用期间，bridge 的任何请求（包括续约）都必然失败**。
- **拒绝状态码**：缺少能力串返回 401 `unauthorized`；能力串无效或 origin 不匹配返回 400 `bridge-capability-invalid` / `bad-request`，主通道不可用时设备解析失败也返回 400 `bad-request`；其余错误经 `toHttp` 默认映射为 400。
  - bridge 的 `seamRequest` 对**任何** 400/401 都先换发能力串再重试，最后抛出不带 body 的错误。
  - `seamFetch` 超时为 10 秒。
  - 本设计不改变既有能力串拒绝的状态码与响应体，以保持与旧版 bridge 兼容。
- **CORS**：`main.ts` 对任意回环 origin 反射 ACAO 并设置 `credentials: true`；cookie 为 `SameSite=Strict`，没有 Domain 属性。设备页面（`127.0.0.1:<设备端口>`）与驾驶舱同站，浏览器会带上 cookie。`TokenMiddleware` 不校验 Origin。
- **注册表**：
  - `validateDevice` 按白名单挑选字段重建记录，因此旧版本会忽略新字段，但旧版本下次写盘时会丢掉它们。
  - `removeDevice` 在 `#detach` 前先 `load`，之后用整表 `save`，存在丢失更新窗口。
- **bridge 与父页面**：父页面已通过 `postMessage` 向 iframe 下发 capability；工作台保持已创建的 iframe 常驻挂载（`Workbench.tsx`）。
- **旧设计的两条决策**（`openspec/changes/archive/2026-09-24-device-port-forward-seam/design.md`）：
  - D3 不持久化附加端口。
  - D4 规定句柄绑定单个**已登记**端口，并明确“不让消费方直接传端口号”。本 change 推翻这两条（见 D6、D10）。

## Goals / Non-Goals

**Goals:**

- 一张表看全：在驾驶舱面板或 DSH 设置页，能数清每台设备有几个 ssh 转发进程、各为谁服务。
- 自动化：组件经 shim 申请转发，用完或页面关闭后无人值守回收。
- 自愈：转发断开后自动重建，不交付死地址。
- 不扰动：主通道重连、认证更新都不连带杀死附加转发。
- 支持 TCP（数据库等），不局限于 HTTP。

**Non-Goals:**

- 不引入 ControlMaster、`ssh -O forward`、SOCKS、HTTP 反向代理（见 D2）。
- 不做“最近是否有流量”的空闲判定（见 D4）。
- 不修改 ohmydsh 侧的组件或 shim（下游 change）。
- 不移除旧接缝与旧端点。

## Decisions

### D1. 转发表归 ConnectivityService 按设备持有，是期望状态；system 条目只是投影

新增 `connectivity/forward-table.ts`。`ConnectivityService` 为每台设备持有一个 `DeviceForwards` 实例，其生存期与设备记录一致，**独立于 `DeviceLifecycle` 实例**。

所有权的切分：

- `DeviceLifecycle` 只拥有主通道。它的 `stop()` 与 `#replaceLoop()` 改为 `disposeChannel(deviceId, WORKBENCH_CHANNEL)`，不再调用 `disposeNode`。
- `ConnectivityService` 把 `#detach` 拆为两种操作：
  - `#replaceLifecycle`：认证材料或自动恢复设置变更，只替换 lifecycle，转发表不动。
  - `#terminateDevice`：禁用、删除、shutdown，替换 lifecycle，并调用 `forwards.terminate()`。
- `DeviceForwards` 订阅 lifecycle 的状态，用来决定暂停或恢复（D5）。lifecycle 被替换后，转发表重新订阅新实例。

主通道不迁入这张表，只在投影时合成一条 `kind: system` 行，状态映射见 spec。原因：主通道的端口稳定、状态分级、重连退避已有成熟实现与 spec，迁移风险高而收益只是“看得见”，而投影已经能满足可见性。

**键选设备端口，不选 channelId**。“一个设备端口一个进程”才是用户关心的计数单位；channelId 降级为持有者标签。

- 备选：沿用 channelId 作为键。否决：两个消费方为同一端口各起一个 channelId，就会起两个进程，正是要消除的膨胀。

**单飞与原子性**：`DeviceForwards` 的全部变更经每设备一条串行队列执行，上限检查与插入在同一个临界区内完成。

- 建立过程本身是异步的，不占用队列。条目进入 `starting` 后，建立在后台运行。
- 同一端口的后续申请只追加租约，不再次 `connect`。
- 建立完成时先检查条目是否仍然存在、其 generation 是否一致；已被删除则立即 dispose 新句柄。

### D2. 仍然是“一条转发一个 `ssh -L` 进程”，表与进程之间留一层接缝

每条条目对应一个 `TunnelManager` 通道，channelId 为 `fwd-<devicePort>`，沿用全部安全参数。转发表只通过 `TunnelManager` 的 `connect / disposeChannel / onExit` 驱动进程；`TunnelHandle` 增加 `pid` 字段。

- 备选：ControlMaster 加 `ssh -O forward/cancel`，每台设备一条 TCP 连接。本次不采用，理由：
  1. `-O` 无法列出现有转发，真相仍需记在我们自己的表中。
  2. Windows OpenSSH 对 ControlMaster 支持不完整（未验证，为社区普遍报告）。
  3. 会引入 master 死亡导致全部转发一起失效的新故障面。
  4. 上限只有 8，连接数不是瓶颈。

保留这层接缝后，将来切换到 ControlMaster 只需替换 `TunnelManager` 对附加通道的实现，表、API 与 UI 都不变。

### D3. 寿命 = 常驻 ∨ 租约；租约有 TTL、自动续约、可撤销，主通道不可用时冻结

**常驻**：用于人手动建立的转发。人建立的东西由人删除，不设过期。常驻来源记录 `cockpit` 或 `dsh`（D9）。

**租约**：用于程序申请的转发，因为程序会崩、页面会关。

- TTL 5 分钟，bridge 每 60 秒续约一次，可容忍约 4 次续约失败。
- **冻结规则**：主通道不处于 `READY`/`DEGRADED` 时不做到期判定；主通道恢复时，把到期时间抬到至少“恢复时刻 + 5 分钟”。
  - 原因：主通道不可用期间，`#lifecycleByOrigin` 必然失败，续约在结构上无法送达（见 Context）。这时持有者的沉默不等于持有者已消失。
  - 实现：到期检查器在主通道非可用态时跳过该设备；lifecycle 状态进入可用态的回调中统一抬高到期时间。
- **多方申请同一端口时复用**：每个申请各得一个租约，全部消失后才回收。
  - 备选：第二个申请报冲突。否决：memex 的多个库、多个页面都可能指向同一端口。

**删除即撤销，任何路径都不复活**：

- 撤销记录（墓碑）只保存在内存中，保留至少 10 分钟，每设备至多 64 条，用来给出更准确的 `revoked` 原因。
- 超出保留期或驾驶舱重启后，同一租约的续约得到 `lease-expired`。
- **正确性不依赖墓碑**：服务端对 `revoked` 与 `lease-expired` 都不重建条目，bridge 对两者都不自动重新申请。墓碑只影响原因的精确度，不影响行为，所以不需要持久化。
- 消费方收到失效通知后是否重新申请，由消费方决定。memex shim 的策略（撤销后不重申，直到下次页面加载）写在下游 change 里。
  - 备选：bridge 在 `lease-expired` 时自动重新申请。否决：驾驶舱重启后，“被撤销”与“自然过期”在服务端不可区分，自动重申会复活用户删除的条目。

**续约不写盘**：只在条目或租约集合变化时写盘。重启恢复的租约按冻结规则处理，即主通道首次可用时获得“该时刻 + 5 分钟”。

- 代价：重启前刚关闭页面的租约会多存活最多 5 分钟，可以接受。

**禁用时丢弃全部租约，保留常驻**。禁用会销毁 iframe 并撤销能力串，持有者必然已经消失。

### D4. 用租约代替“空闲超时”

驾驶舱不在数据路径中（既有约束），看不到流量，“N 分钟无流量回收”无从实现。

- 备选：解析 ssh 的 `-v` 日志来识别连接事件。否决：依赖私有格式，脆弱且与平台相关。

租约把“还有没有人需要”交给知道答案的一方判断，也就是持有者页面是否还活着。

### D5. 自愈：就绪后退出上报，按退避重建；主通道不可用只暂停“新建”

（别名变更见本节末尾。）

在 `TunnelManager` 为已就绪通道增加退出回调：就绪后 `process.exited` 结算时，回调 `(deviceId, channelId, diagnostic)`。由自身 dispose 引起的退出不回调，按 `active.disposed` 区分。

转发表收到回调后，把条目置为 `retrying` 并调度重建：

- 退避从 1 秒起逐次加倍，上限 60 秒，带抖动。
- 条目存续期间无限重试。
- 重建时携带持久化端口作为 `preferredLocalPort`。

**主通道不可用时只暂停新建，不杀存活进程**：

- 主通道重连的常见原因是远端 `dsh web` 重启，此时数据库等附加转发完全健康。
- 如果链路真的不可达，存活进程会因 keepalive（`ServerAliveInterval × CountMax`）自行退出，进入 `paused`。
- 暂停新建是为了避免对不可达主机同时跑 N 个退避循环，交给主通道的退避统一节流。

**SSH 别名变更**：

- 现状是编辑别名只调用 `updateRecord`，主通道不会重连，工作台会一直连在旧主机上，直到下次断线。
- 本 change 把“别名变化”加入 `#replaceLifecycle` 的触发条件，与认证变更同等处理。
- 同时调用 `forwards.rehost()`：终止全部附加子进程并置为 `paused`，等主通道以新别名进入 `READY` 后按期望状态重建。
- 这样不会出现“工作台是 vm-a、附加转发是 vm-b”的错位窗口。

**远端 DSH 端口变更**：

- 冲突检查放进该设备转发表的串行队列：`updateDevice` 先经转发表队列取得“端口占用快照 + 检查”，再在同一个临界区内调用 `mutateDevice` 写盘。
- 与 acquire 的 `reserved-port` 检查在同一个串行域内完成，二者并发时只有一方成功。
- 冲突时以 `forward-port-conflict` 拒绝编辑。
- 附加端口不得等于主通道远端端口，原因是：两条转发会指向同一个设备服务，而 system 条目已经覆盖了这个服务，重复只会让计数失真，并让“删除附加条目”看起来像是在删工作台。

### D6. 附加端口持久化（推翻旧 D3）

消费方现在会把地址写进配置（memex 的“访问地址”），或长期保存（数据库客户端连接串），端口漂移会让这些地址失效。所以附加端口要持久化并复用，复用时沿用既有的“验证、归因、有界重试”规则。

旧 D3 的顾虑是扩大端口占用面。实际持久化的只是**存续条目**的端口，受上限 8 约束，条目回收时端口记录一并删除。

**让位规则**：附加条目选择或复用本地端口时，排除所有设备注册记录中的主通道 `localPort`，包括已禁用设备。主通道 origin 的稳定关系到 DSH 的 `localStorage`，优先级高于附加地址的稳定。

- 实现：`TunnelManager.connect` 增加 `avoidLocalPorts` 参数，内核分配到被排除端口时视为端口归因失败并重试。
- 概率极低，但必须处理。

**注册记录的形状**：

```
DeviceRecord.forwards?: PersistedForward[]
PersistedForward = {
  devicePort
  localPort?
  pinned
  pinnedBy?: 'cockpit' | 'dsh'
  label?
  leases: { id, holder }[]
}
```

- 读取：不含 `forwards` 的旧记录读作空表；单个非法条目忽略并告警，不把整个注册表判为损坏。
- 与 fail-closed 不冲突：注册表的 fail-closed 针对的是“文件不可解析”，单条转发数据损坏不应导致用户丢失全部设备。
- legacy 租约（D8）不写盘。

**写盘**：

- 统一经 `mutateDevice` 执行。`removeDevice` 改用 `mutateDevices`，消除整表 `save` 的丢失更新窗口。
- 变更顺序是“内存计算新表 → 写盘 → 提交内存 → 启动子进程”。
- 写盘失败时返回 `persist-failed`，内存表不提交，不会出现“界面显示有、重启后消失”的常驻条目。
- 唯一例外是租约到期回收：没有请求方可以通知，子进程照常终止，失败记为告警。残留的租约在下次加载时按普通持久化租约恢复（冻结规则给予“首次可用 + 5 分钟”），之后因无人续约而自然回收。

### D7. bridge 接缝、错误码与快照下发

`cockpitBridge.forwards` 的请求类操作沿用 `seamRequest`，即“能力串 + `Origin` 解析设备”。新端点为 `/api/bridge/forwards/*`，加入 `token.middleware.ts` 的豁免名单，与旧端点同级。

**acquire 立即返回，地址异步交付**：

- 申请只做校验、插入条目或追加租约，然后返回，不等待 ssh 建立。
- 这样避开“最坏超过 15 秒的建立时间”与 bridge 10 秒超时之间的冲突，也就不会出现客户端超时、服务端已签发的孤儿租约。
- bridge 本地按 `(holder, devicePort)` 去重，同一页面的重复申请复用已有租约。

**错误码分层**：

- 能力串相关的拒绝保持既有的 400/401 不变。
- 业务拒绝一律为 409，响应体带 `{ code }`。
- `seamRequest` 只在 400 `bridge-capability-invalid`，以及对 `/api/bridge/forwards/*` 以外路径的 401 `unauthorized` 时换发能力串并重试，其余情况把 `code` 透传给调用方。
- 这一修改同时让旧接缝的 `forward-limit` 等原因首次能够到达调用方。
- 备选：业务错误也用 400。否决：`seamRequest` 会把它误判为能力串失效，导致多一次换发和一次重复写请求。

**快照下发**：

- 驾驶舱 web 已经通过 `/api/devices/stream` 拿到含转发表投影的设备状态。
- `Workbench.tsx` 在每次发送 bridge 配置消息后紧接着推送一次，此后在投影每次变化时推送，`targetOrigin` 精确等于设备 origin。
- 父页面观察不到 bridge 的“握手完成”，因为配置消息是单向的；而 postMessage 按序送达，紧随配置消息推送即可保证 bridge 已持有驾驶舱 origin。
- bridge 校验 `event.origin`。
- 备选 1：bridge 定时拉取。否决：既有 spec 规定不做周期轮询，而且每次拉取都要走一次能力串认证请求。
- 备选 2：bridge 直接订阅驾驶舱 SSE。否决：跨源 SSE 需要新增 CORS 与认证面，而父页面已经持有这份数据。
- 另外保留 `list` 请求，作为冷启动兜底。

**续约**：

- bridge 为自己签出的每个租约设一个定时器，间隔不超过 60 秒。能力串过期由 `seamRequest` 负责换发。
- 失败分类（写入 spec）：只有 409 `revoked` / `lease-expired` 表示租约失效；其余一切失败都视为暂时不可达，包括网络错误、换发失败、主通道不可用时的 400 `bad-request`，以及其它非 409 响应。
- 主通道不可用期间续约必然失败，这与 D3 的冻结规则对应：bridge 静默退避重试，不通知持有者。

### D8. 旧接缝与旧端点的兼容

**旧接缝** `cockpitBridge.portForward`：在新版 bridge 中改为薄适配器。

- `register` 只在 bridge 本地记下映射。
- `publish` 调用 `forwards.acquire(devicePort, channelId)`，然后等待 `ready` 通知，至多 8 秒。
- 新端点得到 401 或 404 时，说明驾驶舱是旧版（新驾驶舱对该路径不会返回 401：无效能力串为 400，缺能力串为 403）：不换发能力串，直接回退到旧端点 `publishable-port` 加 `publish-port`，保证“先升级 bridge”不会让现有功能退化。
- 现有 ohmydsh `cockpit-memex-browse-shim` 无需改代码即可继续工作。

**旧服务端端点**：服务于旧版 bridge（0.5.x），这类 bridge 不会续约。

- 给予一个**不过期、不落盘**的租约，持有者标签为 `legacy:` + channelId 前 57 个字符，以满足 64 字符的上限；寿命与旧语义“随设备生命周期”一致。
- 服务端的旧版登记映射仍保存在内存中，每设备至多 8 项，不计入转发表上限。
- `publish-port` 至多等待 8 秒，低于旧版 bridge 的 10 秒超时；未就绪时返回 `forward-not-ready`。
- 与旧实现的区别只有两点：条目进入转发表后可见、可删；不再返回死链接。

### D9. DSH 侧管理能力：保留，但不能动驾驶舱建立的常驻条目

review 提出过一个更便宜的方案：DSH 设置区块只读，bridge 接缝只提供 acquire / release / list / subscribe。本 change 仍然保留 DSH 侧的创建、取消常驻与删除，理由如下：

- 用户明确要求“驾驶舱和 DSH（经 bridge）都能创建隧道”。在设备页面里需要一个数据库转发时，不必切到驾驶舱面板。
- DSH 设置区块与同页插件运行在同一上下文中，无法区分“用户点击”与“插件调用”。所以把信任面收窄到：DSH 侧管理操作只作用于来源为 `dsh` 的常驻条目和未常驻条目；来源为 `cockpit` 的常驻条目返回 `managed-by-cockpit`。
- 结果是：用户在驾驶舱面板精心建立的转发不会被设备页面里的插件删除；DSH 侧能删除的，至多是 DSH 侧自己建立的条目和租约条目。租约条目被删除后，持有者会收到 `revoked`。

settings slot 是可选协作者：不加入顶层 `inject`，使用 `ctx.slots.inject('settings.section', …)` 延迟注入，模式与 ohmydsh `dsh-memex` 相同。settings 包缺席时，bridge 的会话上报与接缝不受影响。

### D10. 推翻旧 D4 的“不可传端口号”

归档 D4 明确写道：不让消费方直接传端口号，否则等于交付“把本设备任意端口发布到宿主机”的能力。本 change 推翻这条规则，理由是：

- 同一个 D4 已经论证，登记与发布出自同一个可信页面上下文，登记挡不住一个想要任意端口的页面，只是多了一步调用。这条规则提供的是“显得克制”，而不是安全边界。
- 真正的边界是结构性的：只转发设备回环、只在宿主机回环监听、单端口、上限 8、按 Origin 限定本设备、全部可见可删、驾驶舱常驻条目不受 DSH 侧影响（D9）。

在这些约束下，本设计**仍然满足** `BACKLOG.md` “不得作为通用写隧道”的原意：它不是 SOCKS/HTTP 代理，不能跨设备，不能监听非回环地址，也不承载任意协议 RPC 到驾驶舱。但 README 与 BACKLOG 中“只能发布已登记端口”的字面表述需要改写。

### D11. 全部 cookie 路由的同源校验（新 capability `cockpit-api-auth`）

cookie 不按端口隔离，CORS 又对回环 origin 反射凭据许可，所以设备页面、以及任何经转发在浏览器中打开的本地 HTTP 服务，都可以带着驾驶舱 cookie 调用全部 cookie 路由（Context）。这不只是新端点的问题：

- `workbench-launch` 会交出任意设备的 DSH 启动 token；
- `PUT /api/devices/:id` 能把本设备的 SSH 别名改成另一台主机，再经 acquire 转发那台主机的端口；
- `DELETE` 能删除设备，连带删除驾驶舱面板建立的常驻条目。

本 change 让“转发出来的 HTTP 服务在浏览器里打开”成为常态，同时把 D4 的放宽理由建立在“不能跨设备”上。因此这项修复**并入本 change**（用户决定），不再推迟。

**实现**：在 `TokenMiddleware` 中，先于既有的 token 豁免判断（`requiresToken` / bootstrap）执行：

- 对所有 `/api/` 请求**无条件**校验 `Host`：必须存在，且主机名为 `127.0.0.1` 或 `localhost`。bootstrap 与 bridge 回调也不例外，这样被拒绝时不会下发 `Set-Cookie`。
- 再执行来源校验，其豁免范围与 token 豁免一致（bootstrap、带能力串的 bridge 回调）：
- `Origin` 存在时，必须等于 `http://` + 请求的 `Host`，且 `Host` 的主机名为 `127.0.0.1` 或 `localhost`。
- `Sec-Fetch-Site` 存在时，必须为 `same-origin` 或 `none`。
- 不满足时返回 403 `cross-origin-rejected`。

**“驾驶舱自身 origin”取自请求 `Host`，而不是服务端配置端口**，这样一条规则同时覆盖：

- 生产环境直接访问（`127.0.0.1:3090`）；
- Vite 开发代理（页面在 5173，代理 `changeOrigin: false` 保留 `Host: 127.0.0.1:5173`，浏览器发出的 `Origin` 也是 5173）；
- `localhost` 与 `127.0.0.1` 两种写法。

跨端口页面的 `Origin` 端口与 `Host` 不同，一定会被拒。

- 备选：比对配置端口。否决：会误拒开发代理，还得维护一份 dev 白名单。
- DNS rebinding：服务端只监听 `127.0.0.1`，攻击页面的 `Host` 是攻击者域名；Host 主机名校验对所有 `/api/` 请求无条件执行（含无 Origin 的同源 GET 与 bootstrap），因此被拒绝。
- 跨源 GET 与导航不附 `Origin`，靠 `Sec-Fetch-Site` 拦截；为此规定有副作用的 cookie 路由不得使用 GET 或 HEAD。

**CORS**：只对 bridge 回调路由返回 `credentials: true`，其它路由不再对外部 origin 放行凭据。

- bridge 的 `seamFetch` 本来就不依赖 cookie（能力串放在请求头中），因此不受影响。

## Risks / Trade-offs

- **浏览器节流或冻结驾驶舱 tab**：
  - 场景：tab 进入后台后受到 intensive throttling，或者被 Memory Saver 冻结、丢弃；这时续约会延迟甚至停止。
  - 影响：tab 冻结或丢弃超过 5 分钟，租约条目会被回收。这是可以接受的，因为持有者页面实际上已经不在运行。
  - 恢复：页面恢复或重新加载后，消费方会收到 `lease-expired` 通知，或在重新加载时重新申请（由下游 shim 的策略决定）。
  - 待办：需要实测，已列入 tasks 验收。
- **首次建立必然失败的条目无限重试**：
  - 最坏情况：每条目每分钟 1 轮，每轮最多 3 次 spawn，因此每设备每分钟约 24 次 spawn。
  - 缓解：退避上限 60 秒；主通道不可用时暂停；条目在面板上可见，并显示诊断，可以手动删除。
- **`ready` 不代表目标服务可用**：`-L` 只保证本地在监听。spec 已写明状态语义只到 ssh 层。
- **注册表写盘频率上升**：续约不写盘；申请与释放的频率跟页面加载相当，处于人工操作的量级。
- **信任面扩大（已经用户确认接受）**：
  - 同页插件可以为本设备的任意回环端口建立转发，并可删除租约条目与 `dsh` 来源的常驻条目（D9、D10）。
  - 转发一旦建立，宿主机上**任何本地进程与页面**都能无认证访问该回环端口，这是 `ssh -L` 本身的性质，与现有主通道相同。例如数据库端口转发后，本机任意程序都能连接。
  - 用户已在规划阶段确认接受这两点。
  - 浏览器中的任意网站可经 DNS rebinding 访问不校验 `Host` 的被转发 HTTP 服务（例如本地 Web UI）。这同属 `ssh -L` 回环监听的固有性质，驾驶舱不在数据路径中，无法缓解；被转发服务应自行校验 `Host`。
- **全局同源校验的行为变化**：
  - 无能力串的旧版 bridge 回调（hello、session-opened、pending-snapshot 的 legacy cookie 路径）来自设备 origin，将被 403。已 pin 的 bridge 0.5.1 总是带能力串，预期无实际影响。
  - 通过反向代理或 hosts 别名、以非回环主机名访问驾驶舱将被 403。
- **冻结规则在主通道反复抖动时会延长租约**：每次恢复都把到期时间抬到至少 5 分钟后，页面已关闭的持有者租约可能因此多存活一段时间。代价仅是一个空闲的 ssh 进程，而且在面板上可见、可删，接受。
- **版本错配**：新 bridge（0.6.0）遇到旧驾驶舱时，新端点不在旧驾驶舱的豁免名单中，会返回 401。缓解是 `portForward.publish` 在新端点得到 401 或 404 时不换发能力串、直接回退到旧端点（D8）；`forwards.*` 在旧驾驶舱上以稳定的“不可用”错误结束。发布顺序仍然应当是驾驶舱先于 bridge。
- **全局同源校验可能误伤未知客户端**：不带 `Origin` 的请求照常放行，浏览器之外的客户端不受影响；浏览器中合法的驾驶舱页面 `Origin` 必定等于 `Host`。
- **旧版 bridge 的 legacy 租约永不过期**：与旧语义一致，不会比现状更差。
- **回滚会丢失常驻条目**：旧版本会忽略 `forwards` 字段，但下次写盘时会把它丢掉。

## Migration Plan

0. **服务端第 0 步：全局同源校验（D11）**。独立、先行，对驾驶舱页面、SSE、Service Worker 与 CLI 无影响（驾驶舱页面的 `Origin` 恒等于 `Host`，CLI 不带 `Origin`）；唯一的行为变化见 Risks“全局同源校验的行为变化”，先堵住跨设备这条路。
1. **服务端第 1 步：所有权切分**。
   - `TunnelManager` 增加就绪后退出回调，`TunnelHandle` 增加 pid，`connect` 增加 `avoidLocalPorts`。
   - `DeviceLifecycle.stop()` 与 `#replaceLoop()` 只处置主通道。
   - `#detach` 拆为 `#replaceLifecycle` 与 `#terminateDevice`，`removeDevice` 改用 `mutateDevices`。
   - 这一步完成时还没有转发表。旧的附加通道由 `#terminateDevice` 通过 `releasePublishedPorts` 回收，行为上唯一的变化是“重连不再杀附加通道”。
   - 前置条件：现有测试全部保持绿色。
2. **服务端第 2 步：转发表**。
   - 加入 `forward-table.ts` 与注册表的 `forwards` 字段。
   - 旧端点改由转发表承载（legacy 租约），`#publishablePorts` 与 `#publishedChannels` 删除。
   - 加入 bridge 新端点、面板端点与同源守卫、状态流投影。
   - 这一步完成后，旧版 bridge 也能获得“可见 + 不返回死链接”。
3. **web**：设备管理面板的转发清单；`Workbench.tsx` 推送快照。
4. **bridge**：
   - 新接缝 `forwards` 与续约。
   - `seamRequest` 的错误分层。
   - `portForward` 适配器。
   - 设置区块。
   - 发布 0.6.0。
5. **文档**：README 端口发布段落、BACKLOG 的相关条目。
6. **下游**：ohmydsh 另起 change。
7. **移除旧接缝与旧端点**：另起 change，前提是下游已全部迁移。

**回滚**：

- 服务端回滚后，`forwards` 字段会被旧版本忽略（已读码确认 `validateDevice` 是白名单读取），但下次写盘时会被丢弃，常驻条目随之丢失。这一点需要写入发布说明。
- bridge 回滚到 0.5.x 后，仍可使用旧端点。

## Open Questions

- 无阻塞问题。信任面放宽与全局同源校验的范围已由用户确认。
- 续约间隔与 TTL 需要在真实浏览器中实测，覆盖后台 tab 与 Memory Saver 场景，映射为 test-plan 中的具名验收项。
