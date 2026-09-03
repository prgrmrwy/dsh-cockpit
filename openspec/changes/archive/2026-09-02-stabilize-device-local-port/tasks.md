## 1. 端口预留支持首选端口

- [x] 1.1 让 `reserveCandidatePort` 接受可选首选端口：先尝试在 `127.0.0.1` 绑定该端口，任何监听错误都静默回落到既有 `listen(0)` 路径；无首选端口时行为不变。
- [x] 1.2 补充单元测试：首选端口可用时返回该端口；首选端口被占用时返回其它可用端口；不传首选端口时仍返回内核分配端口。

## 2. 隧道按首选端口建立并回报实际端口

- [x] 2.1 `TunnelRequest` 新增可选 `preferredLocalPort`，在 `connect()` 中做合法端口范围过滤，仅在一次连接的第一次尝试使用，后续重试强制内核分配。
- [x] 2.2 `TunnelHandle` 新增 `localPort`，回报本次实际使用的端口。
- [x] 2.3 补充测试：已存端口可用时被复用；已存端口被占用时回退到新端口且连接成功；无已存端口时行为不变；首次尝试失败后的重试不再复用该端口。

## 3. 注册表窄写入路径

- [x] 3.1 将写盘主体抽为私有方法，`save()` 行为不变；新增 `updateLocalPort(deviceId, port)`，在既有串行化域内完成读-改-写，保持 tmp+rename、权限与 fail-closed 语义，设备不存在时无操作。
- [x] 3.2 收紧 `localPort` 校验为 `1..65535`，非法值等价于缺失且不把注册表判为损坏。
- [x] 3.3 补充注册表测试：写入并读回端口、设备不存在无操作、非法端口值被忽略而非判损坏。

## 4. 生命周期与服务接线

- [x] 4.1 `DeviceLifecycle` 连接远端设备时传入记录中的 `localPort`，并在连接建立后通过可选回调回报实际端口。
- [x] 4.2 `ConnectivityService` 接收回报，仅在端口变化时持久化，并同步内存中的设备记录；持久化失败不影响已建立的连接。
- [x] 4.3 补充测试：远端设备连接后端口被持久化；端口未变化时不重复写盘；本机设备不触发端口持久化。

## 5. 反向验证与检查

- [x] 5.1 临时把复用逻辑改回「总是随机分配」，确认复用相关测试确实失败，然后还原。
- [x] 5.2 实际运行并记录 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`。

## 验证记录

- 2026-09-02，macOS：反向验证三处独立回退，均确认相关测试失败后还原。
  - 隧道复用改回「总是随机分配」→ 3 项失败（复用保持 origin、TOCTOU 重试换端口、lifecycle 复用不重复上报）。
  - `DeviceLifecycle` 去掉 `preferredLocalPort` 透传 → 3 项失败（服务端持久化+复用、占用回退、lifecycle 复用）。
  - `ConnectivityService` 去掉 `onLocalPort` 接线 → 2 项失败（服务端持久化+复用、占用回退）。
- 2026-09-02，macOS：`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过（server 71、web 49、根 CLI 8）。
- 注：`pnpm typecheck` 需先跑一次 `pnpm build` 生成 `@dsh-cockpit/shared` 声明；该顺序依赖为改动前既有行为，已在干净工作区确认。
