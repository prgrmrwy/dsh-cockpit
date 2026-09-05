## Why

DSH `0.1.2` 线把 Web 侧 `/api` 通道从「非结构化 RPC 代理」整体换成了 **typert 网关**,驾驶舱现行的 rc.2 协议客户端(`rc2-client.ts`)对 `0.1.2-rc.1` 设备完全失效,表现为 `DSH_UNAVAILABLE: rc.2 host.describe HTTP 401`。该破坏由 ohmydsh 仓库的运行体迁移(change `dsh-0-1-2-host-api-migration`)验收时实测发现,并已在 `0.1.1-rc.2`(:3080)与 `0.1.2-rc.1`(:3081)两个活实例上逐项对比确认:

1. **认证**:`/api/*` 与 index 均要求浏览器会话认证,未认证一律 401(旧版免认证);
2. **端点**:点号命名换成斜杠命名空间,`session.list` → `session/list`;`host.describe` 与 `workspace.list` **没有对应端点**(404) —— host facts 只剩事件流 ready 帧的 `home`,workspace 基线改为 `workspace/follow` 流的首帧;
3. **载荷**:`payload` 必须是 `{args:{…}}` 且字段匹配 descriptor(如 `session/list` 要求 `_request`);
4. **事件流**:双流 `/api/events.mux` + `/api/events.host` 换成单路复用 `/api/remote.mux`,帧格式换成 `ready`/`emit`/`waterfall`/`cancel`,其中 `approval/request`、`user-questions/request` 是 **waterfall 模式**(Host 发给每个订阅者并等待表态)。

驾驶舱的机群里设备会长期存在两个版本族并存,升级必须不丢任何现有能力。

## What Changes

一次原子 change,不分阶段:

- **协议适配器**:在既有 `createClient`/`createStream` 工厂缝后新增 typert 协议客户端,按探测结果对每台设备选择 rc.2 或 typert 协议;rc.2 路径不动,生命周期代码(`device-lifecycle.ts`)不动。
- **探活**:typert 侧改用 `session/list`(rc.2 的 `host.describe` 返回值本来就未被消费,仅作 ping,能力零损失)。
- **会话基线与事件**:`session/list`(`SessionSummary` 与现有消费字段逐一对齐)+ `$events` 流的 emit 类事件(`api-session/status`/`added`/`removed`)。
- **workspace 基线与归档集**:`workspace/follow` 流(首帧 `baseline` 含 `items` + `archivedSessionIds`,后续 `archived` 增量),替代 unary `workspace.list`。
- **waterfall 礼貌性应答**:`$events` 订阅会收到全部 allowlist 事件(含 waterfall)。驾驶舱收到 waterfall 帧后 SHALL 立即回 `{kind:'next'}`(声明"我不干预"),MUST NOT 持有不答 —— 这是新协议下"正确地说不"的方式,语义仍是只读,不参与审批决策。
- **待审批/提问计数改走 bridge**:waterfall 应答后驾驶舱无法从 `$events` 得到 resolved 信号,pending interaction 观测整体迁移到 `dsh-cockpit-bridge`(它运行在各设备官方 Web UI 内,天然可见官方审批/提问状态),经既有 capability HTTP 通道上报;观察 seam 由 spike 确定且 MUST NOT 干扰官方处理。
- **认证获取**:typert 设备的 server 侧 API 调用与工作台 iframe 都需要认证;获取方式(launch token 发现 / 一次性人工引导 + 30 天 cookie / 其它官方通道)由 spike 查清后定案。

## 明确不做

- 不放弃 rc.2 协议支持(机群版本并存是常态);
- 不让驾驶舱参与审批/提问的实质决策(只读观测定位不变);
- 不改 DSH 侧任何代码(bridge 是驾驶舱自己的插件,不算);
- 不借机重构 `device-lifecycle` 的聚合与重连逻辑。

## Capabilities

### Modified Capabilities

- `cockpit-device-connectivity`: 新增「多版本 DSH 协议适配」requirement —— 协议探测、按设备选择适配器、能力等价(以 rc.2 设备行为为基准的验收矩阵)、waterfall 不得阻塞主机审批、typert 设备的认证获取;修订健康探测 requirement 中对 rc.2 专有探活方式的表述。
- `cockpit-workbench`: bridge 职责扩展 —— 在会话点击上报之外,新增 pending approval/question 的观察与上报(仅观察,不干预);工作台 iframe 对 0.1.2 设备的认证到达路径。

## Impact

- **代码**:`cockpit-server/src/connectivity/`(新增 typert 客户端 + 流适配,探测选择逻辑)、`dsh-cockpit-bridge/src/client/`(pending 观察上报)、`cockpit-server` 聚合层新增 bridge 来源的 interaction 进水口、`shared` 事件词汇不变(CockpitEvent 形状保持)。
- **验收基准**:两台活实例(rc.2 与 0.1.2)并行对照,typert 设备的 `DeviceStatusFacts` 各字段(state/runningSessionCount/pendingInteractionCount/sessionStatuses/归档集)必须与同状态 rc.2 设备行为一致;"类型对得上"不构成完成判据。
- **风险**:waterfall 应答时序(必须先于官方 fallback 语义生效)、bridge 观察 seam 与官方 UI 的竞态、认证 token 的可发现性因设备启动方式而异。
