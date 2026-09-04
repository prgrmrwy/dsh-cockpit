## Context

现状与约束见 `proposal.md`，行为契约见 `specs/cockpit-device-shell/spec.md` 与 `specs/cockpit-workbench/spec.md`。当前实现的关键事实（均有代码与上游 `dsh@0.1.1-rc.2` 证据）：

- Bridge capability 默认 TTL 60s（`bridge-capability.ts`），Cockpit Web 只在使用 `expiresAt` 却从不按它续签（`Workbench.tsx` capability effect 仅在 deviceId/endpoint/enabled 变化时重跑）；服务端对失效 capability 返回 400，bridge 只对 401 重置 `helloReady`，于是拿旧 token 重试直到 outbox 5 分钟 TTL 丢弃确认。
- 连接流程是「`session.list` → 创建流 → `stream.open()`」（`device-lifecycle.ts`），而 `events.host` open 时不 replay 任何当前状态（上游 `dsh-host-apiproxy/lib/index.js:3609-3664`），中间存在确定的丢事件窗口；手动 `refresh()` 也没有官方客户端 `listMutations` 式的在途合并。
- 归档集合只靠增量 `host/archived-sessions-changed` 维护（初始为空），但该事件只在归档变化时推送；可查询的归档基线 `workspace.list → archivedSessionIds`（上游 `index.js:3009-3014`，官方客户端在连接后调用）从未被使用。
- `host/session-removed` 由 `session/disposed`（live detach）产生（上游 `index.js:3624-3628`），持久化日志保留、`session.list` 会重新列出 cold session（`index.js:2155-2205`）；Cockpit 却把它当作永久删除并清空全部状态。

约束：零轮询、只读聚合、不持久化提醒、操作面零耦合、人工清除兜底、非默认端口支持、旧版插件（0.1.2）兼容。

## Goals / Non-Goals

**Goals:**

- 让「在同一设备长时间停留」与「断线/重连/手动刷新」场景下，已读确认与完成提醒的生成/清除行为可预期，且可被单测与真实链路验证。
- 所有修复对旧版 bridge（0.1.2）保持尽力而为兼容；对未装 bridge 的设备保持人工兜底。
- 为「绿点失灵」类问题提供服务端可观测日志。

**Non-Goals:**

- 不恢复断线期间「完整运行并结束」的完成边缘（协议无 cursor/重放；恢复只能得到最终状态）。该限制在 spec/README 中明确为已知边界。
- 不持久化完成提醒或已读账本到磁盘，不建立跨 Cockpit 重启的未读连续性。
- 不改 pending approval/question 语义、不改归档即处置语义（除 removed 建模修正外）。
- 不代装/强制升级设备插件（升级为 ops 步骤，见 Migration）。

## Decisions

### D1: capability 采用「父页面定时续签 + bridge 失效信号」双通道

- **父页面定时续签**：Workbench 为当前设备保存 `expiresAt`，在 `expiresAt - 15s` 定时重新调用 capability 接口；成功后重发 `bridge-config` 握手并重置下一轮定时；失败按有上限指数退避（15s 起、2 分钟封顶）重试，期间不干扰工作台。定时器按 deviceId 管理，设备切换/禁用时清理；与既有「iframe load、device 激活、endpoint 变化」刷新路径共用同一「换发→重发握手」例程，避免多路径逻辑分叉。
- **bridge 失效信号**：bridge 在 `/api/bridge/*` 收到 capability 失效类响应（401，或 400 且 body code 为 `bridge-capability-invalid`）时，向父页面 `postMessage({ type: 'dsh-cockpit:capability-expired' })` 并重置 `helloReady`；父页面收到后立即换发并重发握手。这覆盖「父页面定时器被后台标签页/隐藏 iframe 节流」的自愈路径，不需要浏览器定时器保证。
- 服务端保持 TTL 60s 默认（实现常量），`issue` 幂等；换发不做 one-shot 作废（旧 token 到期自失效），避免竞态。
- **Alternatives**：只靠父页面定时器（隐藏页面节流后无法自愈）；只靠 bridge 信号（首次失效前有最长 60s 的失效窗口无法提前规避）；把 TTL 调成 10 分钟（窗口变大、仍无自愈）。双通道同时覆盖「提前规避」与「失效后自愈」。

### D2: 基线采用「先订阅、缓冲、应用基线、有序回放、恢复直通」单一例程

- 连接、重连、手动刷新共用一条 reconciliation 例程：
  1. 确保事件流已创建（连接路径在 probe 后先创建并 `open()` 双流，而非先拉基线）；
  2. 进入缓冲模式：事件一律入队，不直接应用；
  3. 并行拉取 `session.list` 与 `workspace.list`（连接路径与刷新路径一致）；
  4. 应用归档基线 → 应用会话基线；
  5. 按到达序回放缓冲事件（覆盖「基线请求期间的完成边缘」与「在途归档事件」两类乱序，回放天然后于基线，陈旧基线不会覆盖新事件）；
  6. 退出缓冲模式，事件恢复直通。
- 乱序正确性：事件与快照跨通道无公共序号，靠「snapshot 先应用、增量后回放」保证事件优先；对完成状态机，晚到的事件回放是幂等的（同一会话同值帧不产生边缘；`true→false` 成对在缓冲中按序存在则正确产生边缘）。
- 缓冲保护：缓冲有上限（如 2000 条）并以 5s 超时兜底；超时后先应用基线再回放已缓冲内容，之后恢复直通，**不丢弃也不合并状态事件**（状态机按序消费本身已去重同值帧）。
- 状态机同时增加「刷新期间事件已在缓冲中时不得再被直通路径应用」的单一写入门（JS 单线程下用标志位即可）。
- **Alternatives**：给事件加序号/水位（上游 FrameQueue 的 rpcId 是随机的，无此能力）；先拉基线后开流并接受丢窗口（现状）；只修 refresh 不修 connect（盲窗仍在）。单一例程把 connect/reconnect/refresh 的乱序语义收敛为一处，测试也可覆盖同一组场景。

### D3: 归档基线走 `workspace.list`，在途事件靠回放顺序天然优先

- `rc2-client` 增加 `workspace.list` 一元 RPC；reconciliation 的步骤 4 用它整体替换 `#archivedSessions`。
- 「workspace.list 在途期间到达的 `archived-sessions-changed`」在 D2 的缓冲回放中自然后于基线应用，事件优先——不需要官方客户端 `archivedSupersedesRefresh` 那样的额外布尔标志（回放顺序已给出同样的最后写入语义）。
- 若设备不支持 `workspace.list`（兼容路径），RPC 失败时保持事件驱动并记录诊断，行为退化为现状（spec 已有「归档事件不可用」场景兜底）。
- **Alternatives**：把归档集合塞进 `session.list`（上游无此字段）；仅靠增量事件（当前，重连窗口不可纠正）。

### D4: `host/session-removed` 建模为「live detach」，采用软保留

- received `session-removed` 时：清除该会话的完成提醒（`completedGeneration`）与计数呈现（`running=false`、清 pending），**保留**其 generation/ack 轮次身份与 `#subagents` 分类知识；若 detach 的恰是当前桥接选择，清除选择快照（不撤销已确认的轮次）；从 `#archivedSessions` 中移除该 ID。
- 会话重新出现在基线时：`#observeRunning` 按快照取值——空闲则无边缘、无提醒；真正重新运行则 `generation+1` 开始新轮，与归档恢复语义一致。
- 为防 `#sessions` 无限增长（detach 频繁的设备，如本机 700+ 会话），对有界保留做保守淘汰：仅淘汰「非 running、无未读提醒、非当前桥接选择、非归档、且不在此次基线快照中」的最久未用条目（上限实现常量，如 2000）。
- **Alternatives**：维持现状「removed 即清空」（与官方 UI 移除语义近似，但丢失轮次身份与子代理知识，且 spec/注释固化错误模型）；彻底不清理（无界）。软保留同时满足「detach 后重新出现不制造提醒」与「子代理分类不丢」。

### D5: 失败分类与可观测性

- 服务端 bridge 拒绝统一结构化日志（WARN）：原因（capability 过期/失效、错设备、未知 origin、disabled）、deviceId、协议版本；capability 失效响应体保留 `code: bridge-capability-invalid`。
- Bridge 单飞换发请求按设备限频（如 5s 内至多一次），防止「401→换发→再 400」风暴。
- **Alternatives**：改动状态码（如 400→401）看似诱人，但 401 在既有链路中同时承担「cookie 缺失」语义，旧插件依赖它触发 bootstrap；保持 400 + 明确 code 字段，由 v2 bridge 按 code 判定，不动旧语义。

## Risks / Trade-offs

- [缓冲模式将事件应用推迟数百毫秒（基线 RPC 期间）] → 缓冲有超时与上限；期间事件极少；超时兜底不丢事件（见 D2）。
- [refresh 在途事件回放可能把已直通应用过的旧状态再覆盖？] → refresh 全程缓冲、无直通，唯一写入顺序是「基线→回放→直通」，不存在旧状态晚到覆盖。
- [保持 `#sessions` 条目带来内存增长] → 保守 LRU 淘汰（D4），仅保留有协调价值的条目。
- [capability 换发请求失败风暴] → 有上限退避 + 按设备限频（D5）；换发失败不影响工作台（既有 .catch 静默路径）。
- [旧 bridge 0.1.2 与新服务端] → 服务端对新消息（capability-expired）不产生新的对外协议要求；0.1.2 走 cookie 认证 + legacy 路径，行为不变。
- [`workspace.list` 在个别兼容设备上缺失] → RPC 失败降级为事件驱动并记录诊断（D3）。
- [buffered 回放与 live 直通的切换边界出错会丢事件] → 单一写入门 + 连接/刷新路径共用例程 + 专项测试（含 5s 超时与上限路径）。

## Migration Plan

1. 服务端 + Web 先行发布：generation/盲窗/归档基线/removed 软语义/日志全部在服务端与 Web 内自洽，旧 bridge 与新 bridge 均兼容。
2. 重新构建 bridge 包（协议版本仍为 2，新增 capability-expired 消息，`PLUGIN_VERSION` 递增到 0.2.x）并验证 `lib/` 发布物。
3. 设备侧（ops）：`host`、`devbox` 当前仍是 0.1.2（无重试/多选无损），需 `dsh build` 并重启对应 DSH Web 后升级；升级前行为与现状一致，不强制。
4. 回滚：回滚服务端/Web 即回到现状；新 bridge 对旧父页面发送的 `capability-expired` 会被忽略，退化为「切设备恢复」的既有行为，无数据迁移。

## Open Questions

- `#sessions` 有界保留的具体阈值与淘汰实现常量（实现期确定，不改变外部行为）。
- 是否把「断线期间完成丢失」进一步用 UI 提示（如 Device Tab 状态点旁的「可能错过」标记）——这是独立的产品决策，不影响本 change 的可靠性修复，可延后。