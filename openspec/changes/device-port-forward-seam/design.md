## Context

见 `proposal.md` 的 Why。设计层面需要抓住的现状事实（均已读码确认）：

- `TunnelManager.connect(request) → TunnelHandle` **已经是句柄形状**：`TunnelHandle` 含 `localPort`、`endpoint`、`generation` 与 `dispose()`（`packages/cockpit-server/src/connectivity/tunnel-manager.ts:15`）。本变更不需要发明新的资源模型。
- 真正的阻塞点在**键**：`#active` 是 `Map<deviceId, …>`（同文件 :82），`connect` 以 `deviceId` 写入（:124），因此第二条转发会覆盖第一条；`disposeNode(deviceId)` 也按设备清一条。
- 转发参数在 spawn 时固定：`tunnelArgs()` 里 `-L 127.0.0.1:<local>:127.0.0.1:<remoteDshPort>`（:72），remote 端口来自 `request.remoteDshPort`。没有 ControlMaster，不能对已建立的连接动态增删转发。
- 端口持久化是**单数**：`DeviceRecord.localPort?: number`（`packages/shared/src/index.ts`），且被「设备本地转发端口在生命周期内保持稳定」整条要求所依赖（为的是 iframe origin 稳定 → 远端 DSH 的 `localStorage` 不丢）。
- bridge 已有一个跑通的 seam 先例 `cockpitBridge.editorOpen`（`packages/dsh-cockpit-bridge/src/client/index.ts:103`），其注释确立了三条 seam 契约：consumer-agnostic、立即 provide 不依赖加载顺序、缺配置同步抛错让消费方回落本地行为。
- 浏览器约束：`editorOpen` 必须在**原始用户激活链路**中同步产出 URI，否则弹窗被拦。这条约束同样作用于任何"点击后打开新标签页"的消费方。

## Goals / Non-Goals

**Goals:**

- 让一台设备能同时持有主通道与若干附加通道，且两者故障域隔离。
- 以**资源式**交付：一次请求得到一个绑定端口的句柄，消费方之后不再查询。
- 复用既有端口设施（分配、可绑定验证、竞态归因、有界重试、终结性清理），不另起一套。
- 保持「操作面零协议耦合」：驾驶舱只建 TCP 转发，不进数据路径。

**Non-Goals:**

- 不做通用隧道（消费方不能指定任意端口）——见 D4。
- 不引入 ControlMaster / SOCKS 动态转发——见 D2 的备选。
- 不为附加通道提供稳定端口保证——见 D3。
- 不代理、不解析、不重写被转发流量；不新增 iframe→父页面的反向动作通道之外的旁路。

## Decisions

### D1. `#active` 的键从 `deviceId` 改为 `deviceId + channelId`

主通道用保留的 `channelId`（如 `workbench`），附加通道用登记时的用途标识。这样 `disposeNode(deviceId)` 自然扩展为「清理该设备全部通道」，`disposeAll` 不变。

**为什么不是新开一个 `ExtraTunnelManager`**：那会复制端口分配、绑定重试、归因判定、终结性清理这四段已经写得很仔细的逻辑，并且两套实现会在「驾驶舱退出时是否都清理干净」这个点上各自演化。键的修改是**收敛**而不是扩散。

**代价**：`#generations` 与 `disposeNode` 的既有语义要逐一复核；主通道的 generation 语义 MUST 保持不变，否则会牵动重连与 pending 收敛。

### D2. 每条附加转发是一个独立的 `ssh -L` 进程

沿用 `tunnelArgs()` 的全部安全参数，只把 remote 端口换成被发布的设备端口。

**备选：ControlMaster + `ssh -O forward` 动态加转发。** 否决理由：它能让 N 条转发共用一条 TCP 连接，但引入 control socket 的路径管理、跨平台差异（Windows OpenSSH 对 ControlMaster 支持不完整）、以及"主连接死了全部转发一起死"的新故障模式。当前预期的附加通道数是个位数，省下的连接数不值这些复杂度。

**备选：`ssh -D` SOCKS。** 否决理由：那正是 D4 要避免的"通用隧道"。

### D3. 附加通道的端口**不**持久化

「稳定端口」那条要求存在的唯一理由是 iframe origin 稳定 → 远端 DSH 页面的 `localStorage` 跨重连延续。附加通道的消费方每次都从新句柄读 URL，不存在跨重连的 origin 依赖，因此持久化只会扩大端口占用面。

这条必须写进 spec（已写），否则实现者会"顺手"把附加端口也存进注册表，然后在下一次重构里被当作必须保持的不变量。

### D4. 句柄绑定单个**已登记**端口，不是通用管子

生产/消费分离之后，消费方不再承担"只能问我自己的端口"这个天然限制，约束必须由生产侧接管。做法是两段式：

```
设备侧登记：  { channelId, devicePort }   ← 驾驶舱据此建立白名单
消费方请求：  publish(channelId)          ← 只能引用已登记项，不能传端口号
```

**为什么不让消费方直接传端口号**：那等于交付「把本设备任意端口发布到宿主机」的能力——数据库、内网服务、其它插件的私有端口都在内。这正是 `BACKLOG.md` 中「不得把 `dsh-cockpit-bridge` 当作通用写隧道」所防的东西。

**登记谁来做**：由设备 DSH 页面内的 bridge 插件发起，与既有 `bridge/hello`、`bridge/session-opened`、`bridge/pending-snapshot` **同级同信任面**（短 TTL 能力串 + `Origin` 设备匹配）。

初稿曾写"由设备 Host 侧声明，因为页面可被任意脚本驱动"。实现时发现该方案不可行且论证也站不住：

- **方向不存在**：现有三个 bridge 端点全部是「浏览器 → 驾驶舱」；驾驶舱访问设备只有"经隧道 fetch 设备 HTTP"这一条路（`protocol-client.ts`）。要让 Host 侧声明，只能由驾驶舱主动去设备上拉一份清单，而那要求远端 DSH 暴露新端点——直接违反 README 的**远端零改造**原则。
- **论证不成立**：能发起登记的前提是**已经作为插件加载进这台设备的 DSH 页面**，而该页面正是经能力串与 Origin 认证的可信上下文。它与 `session-opened` 可上报任意 sessionId 属于同一信任级别；把登记单独要求为"更可信的来源"并不自洽。

因此真正的安全边界不依赖"登记方不可伪造"，而由三条**结构性**约束承担：转发只在回环监听、句柄绑定单个端口（非通用管子）、每设备通道数有上限。这三条即使登记被伪造也仍然成立——伪造者最多让**自己这台设备**的一个回环端口出现在宿主机回环上，拿不到跨设备能力，也拿不到任意端口转发。

### D5. 这是 bridge 上第一个触发服务端动作的 seam，认证沿用既有能力串

`editorOpen` 是纯客户端（拼 URI + `window.open`），不需要驾驶舱做任何事。端口发布**会 spawn 一个 ssh**，因此必须过认证：沿用既有的短 TTL、绑定设备 Origin 的一次性能力串 + 请求头，与 `bridge/hello`、`session-opened` 同一套校验。

这不构成对「统筹面只读」原则的修订：该原则约束的是**不代理远端 API / 不接管应用层协议**，而建立一条 TCP 转发并不让驾驶舱进入数据路径。proposal 已明确记为「原则保持不变」。

### D6. 消费方的时序问题由消费方侧的同源 launcher 解决，不由本 seam 解决

弹窗拦截约束（见 Context）意味着"点击 → await 建隧道 → open"不可行。但**这不应该由驾驶舱来解**：驾驶舱无法知道消费方的 UI 形态。

本 seam 只保证「句柄一旦交付就立即可用」。消费方推荐的做法是：按钮同步打开一个自己的同源 URL，由那个页面去完成"确保服务与转发就绪"，失败时就地显示原因。这一点写进消费方（ohmydsh）的 change，不写进本 spec。

## Risks / Trade-offs

- **[改键牵动既有重连/清理路径]** → `disposeNode`、`#generations`、设备禁用/删除路径必须逐条覆盖测试；特别是"驾驶舱退出时不遗留 `ppid=1` 孤儿"这条既有要求，要在多通道下重新验证。
- **[附加通道数量无界]** → 每条通道一个 ssh 进程。需要一个每设备上限，超限时拒绝并给稳定原因，而不是无声地继续 spawn。
- **[旧注册记录迁移]** → 单数 `localPort` 必须继续被识别为主通道端口。迁移只读不写：不主动改写旧记录，等下一次端口写入时自然落到新形状。
- **[暴露面扩大]** → 被转发的服务在宿主机回环上无认证可达（取决于该服务自身）。这是所有者已确认接受的取舍，但 spec 要求转发只在回环监听，且登记是 Host 侧显式行为，不能由页面脚本静默发起。
- **[seam 名字是跨仓契约]** → `cockpitBridge.portForward` 一旦发布即为 breaking 面。与 `editorOpen` 同样处理：名字写进 spec 作为唯一真相源。

## Migration Plan

1. 先落 `TunnelManager` 的键与生命周期改造，主通道行为**零变化**（现有测试全绿是前置条件）。
2. 再加登记端点与白名单。
3. 最后加 bridge seam 并发布新版本；ohmydsh 侧按精确 pin 升级。
4. 回滚：seam 未发布前，前两步对外不可见；已发布后回滚 bridge 版本即可——消费方发现服务缺席会自动回落本机行为，这是 seam 契约的一部分。

## Open Questions

- 每设备附加通道数量上限取多少（个位数即可，具体值可在实现时定，不影响 spec 与任务拆分）。
- 附加通道是否需要空闲回收（消费方不再使用时自动 dispose）。当前设计把生命周期绑在设备上已经安全；空闲回收是优化，可后续独立提。
