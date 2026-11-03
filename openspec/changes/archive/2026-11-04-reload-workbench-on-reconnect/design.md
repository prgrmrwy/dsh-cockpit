## Context

见 proposal.md - Why。与实现相关的现状：

- Workbench 以 `deviceId + origin + dshAuthGeneration + lifecycle` 作为启动 tuple，每个 tuple 只请求一次启动、只导航一次（`launchAttemptsRef`）。只有 tuple 变化（新端口、新 auth generation、iframe 重建）或认证失败遮罩上的“重试”（`retryLaunch`）会再次启动。
- 导航结果不可观测（`unobservable`）和已正常加载这两种状态没有遮罩，因此也没有任何重试入口。
- 顶栏 ↻、顶栏菜单“刷新状态”、离线遮罩“重连此设备/重新连接”都调用 `App.reconnectCurrent` → `POST /devices/:id/reconnect` → `DeviceLifecycle.reconnect()`。服务端在 `#replaceLoop` 里先拆旧流与工作台隧道、清空 endpoint、置 `CONNECTING`、启动新 `#run()`，然后接口返回。此时新连接尚未 READY。`#run()` → `#connectOnce()` 在第一个 await 之前就同步递增 `#connectionGeneration`，所以接口返回时新代次已经确定。
- 重建后的隧道优先复用记录里的本地端口（`preferredLocalPort`），origin 通常不变；auth generation 只在认证材料变化时前进。因此重连通常不会改变 tuple。
- rc.2 设备也走同一个 `workbench-launch`，服务端直接返回干净 endpoint（`connectivity.service.ts` 中 `protocolKind() === 'rc2'` 分支）。

## Goals / Non-Goals

**Goals:**
- 用户显式重连后，当前设备工作台在新连接 READY 后确定地重新启动、导航一次。
- 重新签发不得早于新连接就绪，避免把“重连中”误呈现为启动失败遮罩。
- 不放宽任何自动重试约束。

**Non-Goals:**
- 不自动检测或修复错误页。跨源 iframe 的成败仍不可观测，本 change 不尝试推断。
- 不改变连接层的重连、隧道复用或端口策略。聚合流断开不拆工作台隧道已由现有实现保证（`#run()` 断流后只释放订阅，`#connectOnce()` 复用存活隧道）。
- 不新增独立的“仅重新加载”按钮。

## Decisions

### D1：以连接代次判定“重连之后的 READY”

在 `DeviceStatusFacts` 中新增非敏感整数 `connectionGeneration`，取值来自 `DeviceLifecycle.connectionGeneration()`。本机设备同样递增。

重连接口 `POST /devices/:id/reconnect` 的响应增加 `connectionGeneration`，取服务端重连返回时的值 Gn。此时新连接循环已经同步推进了代次，所以 Gn 就是新连接的代次。客户端在接口成功后为该设备登记一个待执行的用户重试 `{deviceId, minGeneration: Gn}`。Workbench 只有在该设备的快照满足 `connectionGeneration ≥ Gn`、`state ∈ {READY, DEGRADED}` 且有 endpoint 时，才执行这次重试，执行后立即撤销登记。

（实施时修订：原方案用点击时客户端快照里的 G0，条件是 `> G0`。但点击前已发出、点击后才送达的旧 READY 推送，其代次可能大于一个过时的 G0，会被误判为重连后的就绪。改用服务端返回的 Gn 后，这个判断与客户端快照的新旧无关。）

- 备选：收到接口响应就立刻 `retryLaunch`。被否决的原因是客户端快照可能还是旧的 READY，launch 会被服务端以 `workbench-unavailable` 拒绝，这个 tuple 随即被记为失败，用户看到错误遮罩。
- 备选：先观察到一次非 READY 状态再等 READY。被否决的原因是 CONNECTING→READY 的两次 SSE 推送可能被合并进同一次渲染，客户端会漏掉中间态，导致登记永远不触发。
- 备选：让重连接口阻塞到 READY。被否决的原因是它改变了接口语义，而且重连可能长时间退避，HTTP 请求不宜长时间挂起。

### D2：重试复用既有 tuple 机制，只清除已尝试记录

执行重试时，清除该设备全部已尝试 tuple、待处理导航、deadline 和 `launchTarget`，然后触发启动 effect 重新运行（沿用 `retryNonce`）。启动、结果校验、tokenized URL 一次性交给 iframe、load 和 deadline 的处理全部沿用现有路径，不新增导航入口。

不把 `hasNavigated` 置为 false：重连期间离线遮罩已经覆盖 iframe，已有页面保持挂载、保持可见，直到新结果到来。这符合“已有页面 SHALL 保留至合法启动结果到来”。

### D3：只由用户点击登记

登记只发生在 `reconnectCurrent` 中，并且只在接口成功之后。设备自动重连、SSE、load、设备切换都不登记。用户再次点击时用新的 G0 覆盖旧登记。设备被禁用或移出时，登记随 frame 一起清除。重连接口失败时不登记，沿用现有的错误展示。

### D4：入口文案

`main.tsx` 传给 TopBar 的 `onRefreshLabel` 改为“重连并重新加载当前设备”。TopBar 菜单项改用 `onRefreshLabel ?? '刷新状态'`，与按钮保持一致；未传入 label 时行为不变。离线遮罩按钮文案不变，因为它本来就在设备不可用时出现，用户期望的就是恢复。

### D5：服务端启动诊断日志

在 `ConnectivityService.workbenchLaunch` 结束时写一行日志，记录 `device=<id> protocol=<typert|rc2> authGeneration=<n> result=<ok|错误码>`。错误码只取 `WorkbenchLaunchError.code`，其它异常一律记为 `error`。不输出 `message`，因为异常信息可能间接带出 URL。成功时记 debug 级，失败时记 warn 级。

## Risks / Trade-offs

- [用户本想“只刷新状态”，结果设备页面被重新加载，未保存的输入可能丢失] → 文案明确写出“重新加载”。离线遮罩场景下页面本来就不可用。设备 DSH 自身的会话恢复不受影响。
- [新连接一直起不来，登记就一直挂着] → 登记只是一个内存标记，没有副作用。用户再次点击会覆盖它，设备移除时清除，整页刷新后自然消失。
- [`connectionGeneration` 在驾驶舱服务端进程重启后从 0 开始] → 如果在接口返回之后、新连接就绪之前，驾驶舱服务端恰好重启，新进程的代次可能一直小于 Gn，登记就不会触发。这时用户再点一次重连即可，新的登记会用新进程返回的 Gn 覆盖旧的。在 tasks 中用测试覆盖「代次始终小于 Gn 时不误触发」。
- [`DeviceStatusFacts` 新增字段] → 这个类型只在驾驶舱服务端和 Web 之间使用，同仓库同版本发布；bridge 不消费它。

## Migration Plan

纯前端加服务端增量，无数据迁移。部署方式为 `bin/cockpit build` 加 `restart`；前端按请求读盘，服务端字段与日志需要重启服务端后生效。回滚即还原提交并重新构建。
