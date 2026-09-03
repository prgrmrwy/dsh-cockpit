## Context

见 `proposal.md`。当前 Cockpit 以 `session.list` 基线和 `host/session-status` 增量在服务端维护 `prevRunning` 与 `completed`；官方 DSH 页面另有浏览器本地的 `current`、`completedNotifications` 和 `archivedSessionIds`。可选 bridge 监听 `sessions.list.current`，延迟 250ms 后重新读取当前值并 fire-and-forget POST `{sessionId}`。这会产生三类结构性缺口：选择后立即归档时 current 已清空、多个选择被 trailing debounce 合并、HTTP 打开确认与 WS 完成边缘乱序。

此外，现有 bridge 代码固定请求 `127.0.0.1:3090`，而 Cockpit 已支持 `COCKPIT_PORT`；服务端 cookie 为 `SameSite=Strict`，bridge 源码却以跨端口 `credentials: include` + bootstrap 作为认证恢复。这些配置与认证假设必须在可靠性改造中一起闭合，否则自动确认仍可能静默不可达。

约束如下：

- 状态聚合继续只读，不调用归档、恢复或其它远端写 API。
- 父页面不读取跨源 iframe DOM；selection 仍只能由设备页面内的可选插件提供。
- bridge 不持有或读取 Cockpit token 明文，不传输 session 内容。
- 不建立跨 Cockpit 重启的已读账本；重启后的首次 idle 基线仍不生成提醒。
- 未安装 bridge 的标准 DSH Web 必须继续完整可用。

## Goals / Non-Goals

**Goals:**

- 让每个运行轮次的完成边缘与打开确认在任意到达顺序下收敛到相同结果。
- 让快速连续选择、立即归档与短暂传输失败不再永久丢失已读确认。
- 让归档清除当前提醒，恢复不制造新的完成轮次。
- 恢复独立、可访问且不触发 tab 切换的设备级人工清除兜底。
- 使 bridge 的“已连接/可可靠确认”状态与实际端口、认证和最近成功通信一致。

**Non-Goals:**

- 不持久化完成提醒或已读状态到磁盘，不承诺 Cockpit 进程重启前后的未读连续性。
- 不把 bridge 变为远端设备的强制依赖，也不由 Cockpit 自动安装或升级插件。
- 不代理 DSH 的归档/恢复操作，不修改官方 DSH 的本地 `completedNotifications`。
- 不为 approval/question 增加离线可回读能力。

## Decisions

### D1: 以每会话 generation 状态机代替裸 `Set`

服务端为每个根会话维护最小易失状态：当前 `running`、单调 `generation`、该 generation 是否在运行期间/完成后被打开、是否存在未读完成提醒，以及当前是否被 bridge 报告为 selected。`false → true` 开始新 generation 并清除上一轮 ack；`true → false` 仅在本 generation 未被打开且不是当前 selected 时生成提醒。

打开确认不再只是“若 Set 中存在就 delete”：它同时确认当前 generation。这样 HTTP ack 先到、WS idle 后到时，迟到 completion edge 会看到该轮已确认而不重新点亮；下一次 `running:true` 会开启新 generation，因此旧确认不会抑制未来完成。

对从未观察过 running 的 idle baseline 仍只建基线，不生成提醒。重连基线沿用内存中的 generation 状态；会话在完整基线中暂时缺席时不立即按永久删除处理，只有权威 `host/session-removed` 才清理全部状态。

**Alternatives:**

- 只加一个永久 `acknowledgedSessionIds` Set：会错误吞掉该会话未来所有完成。
- 给 HTTP/WS 加时间戳比较：两个来源没有共同可靠事件时间，仍无法准确表达“同一轮”。
- 持久化事件账本：违反不建立第二真相源和不持久化提醒的边界。

### D2: bridge 上报 selected snapshot，并由服务端返回显式接受结果

`session-opened` 契约保留按会话 ID 精确确认，同时请求携带 bridge 协议版本；服务端只有在 origin、认证、设备生命周期和会话 ID 校验通过后返回成功。服务端记录该设备当前 selected session，使“用户正在看着会话完成”不生成未读。selection 变为 undefined 时 bridge 上报清空 current，但不会撤销已经确认的 generation。

父页面的 activation 消息继续作为 keep-alive iframe 恢复机会；激活后 bridge 先刷新实际 Cockpit origin/认证能力，再重申 current 和待确认集合。

**Alternatives:**

- 仅上报 click event：无法知道 completion 时会话已经处于当前选中状态，也不利于失败后重申。
- Cockpit 读取 iframe DOM：跨源不可行且破坏操作面隔离。

### D3: 捕获变化时的 ID，并以有界去重 outbox 实现无损合并

bridge 的订阅回调在变化发生时立即捕获 `current`，而不是定时器执行时重新读取。不同 session ID 进入内存 outbox；调度窗口只合并网络 flush，不覆盖 ID。相同 ID 去重，成功响应后移除，失败保留。

恢复触发包括：后续 selection 变化、parent activation、成功 hello；重试使用有上限的指数退避和单飞发送，避免 Cockpit 离线时请求风暴。outbox 使用固定上限和 TTL；容量压力下优先保留当前会话和最近选择，淘汰最旧非当前项。具体上限作为实现常量并由测试固定，不成为公共 API。

`current: undefined` 会重置同值去重闩并上报 selection cleared，因此归档恢复后同一 ID 能再次进入确认流程。

**Alternatives:**

- 完全移除 debounce 后逐次立即 POST：不丢 ID，但快速导航会放大请求且失败重试难管理。
- 使用 `sendBeacon`：无可靠业务响应，无法判断服务端是否接受，也不适合常驻页面的重试队列。

### D4: 归档集合是独立事实，归档即处置当前提醒

扩展只读 host 事件转换，消费 `host/archived-sessions-changed` 的完整 ID 集合；设备生命周期维护最近归档集合。进入归档集合的 session 清除当前 completed reminder 与 selected 状态，但保留足够的 running generation 基线，使恢复同一空闲会话不会产生 completion edge；离开归档集合只恢复可见性，不生成提醒。

权威 `host/session-removed` 仍表示永久删除并清除全部状态。若旧设备不提供归档事件，服务端不得从一次 `session.list` 缺席推导删除；人工清除保证可恢复性。

**Alternatives:**

- 归档时保留未读到恢复后继续显示：符合“提醒未处理”的一种解释，但用户的实际工作流是看完即归档，且会继续制造幽灵提醒；本 change 选择“归档即显式处置”。
- 把归档当 removed：会丢 generation 基线并在恢复/重连时制造错误边缘。

### D5: completed chip 使用嵌套安全的独立控件或等价非嵌套结构

当前整个设备项是 `<button role="tab">`，不能在其中直接嵌套另一个 button。Web 层应将 tab 主点击区与状态操作区重构为同一视觉容器内的兄弟控件，或使用语义等价且通过键盘/辅助技术验证的结构。completed 清除控件调用设备级 ack endpoint；其它状态仍为非交互展示。

清除操作采用服务端成功后 SSE 更新，不做可能回滚的乐观隐藏；重复调用幂等。

**Alternatives:**

- 在现有 tab button 内给 `<span>` 添加 onClick：鼠标可用但键盘与可访问语义不足，且冒泡容易切换设备。
- 重新让整个设备 tab 点击顺带清除：无法区分“切设备”与“全部已读”，容易误清多条提醒。

### D6: 设备级人工清除与按会话确认使用同一 generation 语义

恢复设备级 endpoint，但 clear-all 不只清当前 completed 集合：它将设备当前已知 session generation 标记为已确认，防止已经在路上的 idle frame马上把同一轮重新点亮。任何 session 下一次进入 `running:true` 后确认位自动重置。

按会话 bridge ack 和设备级 clear-all 均幂等并触发事实推送。这样手工兜底同样能处理 ack-before-edge，而不是只提供短暂视觉清除。

### D7: bridge origin 由父页面握手提供，认证使用父页面代理的短期能力而非持久 token

固定 `COCKPIT_BASE` 与可配置端口不兼容。父 Cockpit 页面在 iframe load/activation 时通过精确 `targetOrigin=deviceEndpoint.origin` 发送包含实际 `window.location.origin` 和一次性/短期 bridge capability 的握手；bridge 只接受 `event.source === window.parent` 的消息，并将该 origin 固定为本页生命周期的 Cockpit 目标。服务端签发的 capability 绑定设备 origin、用途和短 TTL，由父页面通过同源认证 API取得；bridge 请求用 header 携带 capability，服务端验证后执行 hello/selection/ack。插件从不读取持久 HttpOnly token。

为避免首次握手前的固定 3090 请求，bridge 等待 parent handshake；父页面在 iframe onLoad 及每次 activation 重发。若能力签发或端口配置不受支持，父页面显示 bridge unavailable，并保留人工清除。

**Alternatives:**

- 将 cookie 改为 `SameSite=None`：loopback HTTP 下通常还要求 `Secure`，且扩大 cookie 暴露面。
- 在插件包中注入 Cockpit 端口构建配置：每个部署都需重新构建/安装插件，不适合可变端口。
- 把持久 token通过 postMessage 传给插件：暴露长期凭据，违反安全边界。
- 保持固定 3090 并禁止自定义端口：实现简单，但与已公开支持的 `COCKPIT_PORT` 冲突。

### D8: bridge 健康分为“检测到”与“可靠协议就绪”

服务端记录最近成功 hello/ack 时间和 bridge protocol version。Web 仅在版本满足本 change 的可靠协议且最近成功时间未过期时显示完整链条；旧版本或过期状态显示弱提示，说明自动精确清除不可保证并可使用人工清除。过期判断在事实投影或前端时间判断中完成，不引入周期网络轮询。

**Alternatives:**

- 继续把任意历史 `bridgeSeenAt` 当永久连接：会误导用户。
- 定时 ping 设备 iframe：增加额外轮询与跨通道耦合；已有 activation/hello/ack 足够提供活跃证据。

## Risks / Trade-offs

- [短期 capability 增加认证实现复杂度] → 限定为 bridge 专用、绑定 Origin/设备/TTL，不复用为通用 API token，并增加伪造、过期、错设备测试。
- [HTTP ack 和 WS frame 仍无全局顺序] → generation 状态机按语义收敛，不依赖传输顺序或墙钟时间。
- [归档事件在旧 DSH 版本上可能缺失] → 不从列表缺席推导归档/删除；保留设备级人工清除并按 bridge 协议版本降级提示。
- [outbox 在长时间离线后可能淘汰旧确认] → 固定上限/TTL、防止无界增长；优先保留当前与最近 ID，人工清除作为最终兜底。
- [恢复 completed chip 会增加 tab 结构复杂度] → 使用非嵌套交互控件，覆盖鼠标、键盘、焦点和不冒泡测试。
- [新 bridge 协议需要设备升级] → 服务端兼容旧 `{sessionId}` 上报但标记为 legacy；不影响标准 DSH 工作台，文档清楚区分“检测到”与“可靠”。
- [bridge 健康过期可能在安静设备上显示未就绪] → activation 会即时重发握手/hello；过期只影响能力提示，不影响工作台。

## Migration Plan

1. 先发布向后兼容的 Cockpit 服务端与 Web：支持 generation 状态机、归档事件、设备级 clear-all、bridge capability 和 legacy bridge 请求。
2. 更新 bridge 插件协议版本与发布物，增加 parent handshake、selection snapshot、有界 outbox 和失败重试。
3. 在已接入设备上升级 bridge 并重启对应 DSH Web；未升级设备继续工作但显示 legacy/非可靠提示。
4. 更新 README 中英文版和 bridge README，说明人工兜底、端口配置、版本健康与升级步骤。
5. 回滚时可回滚 bridge 到旧版和 Cockpit 到前一版本；由于所有协调状态均为易失内存，无数据迁移或持久格式回滚。

## Open Questions

无。容量、TTL、退避上限等均为实现级常量，可在不改变外部行为与任务拆分的前提下通过测试选择。
