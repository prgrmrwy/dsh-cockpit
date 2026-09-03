# 设备本地转发端口在生命周期内保持稳定

## Why

驾驶舱每次为设备建立隧道时都用 `server.listen(0)` 让内核随机分配本地回环端口，因此每次重连后工作台 iframe 的 origin（`http://127.0.0.1:<localPort>`）都会变化。浏览器的 `localStorage` 按 origin 隔离，导致该设备 DSH Web GUI 里的全部本地状态在重连后读不回来：实测 `dsh.sessions.current`、`dsh.workspace.view.v5`（会话排序与分组展开状态）、第三方插件的 `dsh.widthTier` 和 `dsh-pet` 位置全部被重置。

注册表（`DeviceRecord.localPort`）早已定义并持久化该字段，但全仓库没有任何写入方或读取方——它是一个从未被接线的死字段。这是「零协议耦合、承载原生 DSH Web」这一核心架构承诺的一个实际缺口：驾驶舱声称继承设备原生 DSH 的全部能力，却因为自身分配端口的方式抹掉了该 DSH 的浏览器侧持久化。

## What Changes

- 为每台远端设备把实际使用的本地转发端口持久化到注册表 `localPort`，使它成为该设备的稳定属性而不再只是一条无人读取的记录。
- 隧道建立时 SHALL 优先尝试绑定注册表中已存的 `localPort`；仅当该端口当前不可绑定（被其它进程或另一台在线设备占用）时才回退到内核随机分配。
- 端口复用与既有 `maxBindAttempts` 有界重试协调：首次尝试使用已存端口，后续重试改用随机端口，使 TOCTOU 窗口内被抢占的情况自然降级为一次重试而不是连接失败。
- 端口不可用 MUST NOT 导致重连失败——回退是静默且必然的，诊断信息保持既有的隧道错误分类。
- 未持久化端口的设备（首次连接、`localPort` 缺失或非法）行为完全不变：随机分配，然后把结果写回注册表。
- 非隧道的本机设备（`kind: 'local'`）不受影响：它直接使用 `remoteDshPort`，本就是稳定 origin。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-connectivity`：新增「设备本地转发端口在生命周期内保持稳定」要求，规定端口复用优先、绑定前验证、被占用时优雅回退、以及与有界重试的协调关系。既有「使用自有 SSH 隧道只监听中央回环并保持有界」要求的端口分配语义不变（仍由驾驶舱分配并跟踪，占用时重新分配候选端口）。

## Impact

- `packages/cockpit-server/src/connectivity/ssh.ts`：`reserveCandidatePort` 接受可选的首选端口。
- `packages/cockpit-server/src/connectivity/tunnel-manager.ts`：`TunnelRequest` 接受首选端口，`TunnelHandle` 回报实际端口；重试循环区分首次与后续尝试；追踪在线设备已占用的端口。
- `packages/cockpit-server/src/connectivity/device-lifecycle.ts`：连接时传入记录中的 `localPort`，连接后回报实际端口。
- `packages/cockpit-server/src/connectivity/connectivity.service.ts`：把回报的端口持久化到注册表并同步到运行中的 lifecycle 记录。
- `packages/cockpit-server/src/storage/registry.ts`：新增串行化的 `updateLocalPort` 窄写入路径，保持既有原子写盘（tmp+rename）与 fail-closed 校验。
- 不改动前端、不改动共享类型（`DeviceRecord.localPort` 已存在）、不改动远端行为、不新增任何依赖。
- 无数据迁移：既有注册表没有 `localPort` 的设备等价于首次连接，第一次重连后自然获得稳定端口。
