## Why

已归档 change `2026-09-02-stabilize-device-local-port` 建立了「设备本地转发端口在生命周期内保持稳定」要求（`openspec/specs/cockpit-device-connectivity/spec.md`），使工作台 iframe 的 origin 跨重连保持不变，从而让设备原生 DSH Web 的 origin 作用域存储（`localStorage`、`sessionStorage`、插件状态）得以延续。

但实现只在**第一次绑定尝试**使用已持久化端口：`tunnel-manager.ts` 的重试循环用 `attempt === 1 ? sanitizePort(request.preferredLocalPort) : undefined` 决定首选端口，而触发重试的分支（`outcome.kind === 'exit'`，即 OpenSSH 在 DSH readiness 之前退出）**不区分退出原因**。端口被抢占会走这里，SSH 链路抖动、连接超时、远端 DSH 尚未就绪也全都走这里。结果是：只要第一次尝试因任何原因失败，后续重试就永久放弃已持久化端口，origin 发生漂移。

现有 spec 只授权了一种降级情形——「已持久化端口通过了可绑定验证，但 OpenSSH 实际绑定前该端口被其它进程抢占」（spec.md `#### Scenario: 复用端口在绑定窗口内被抢占`）。把与端口可用性无关的失败也一并放弃首选端口，超出了该 Scenario 的授权范围，实际削弱了它要保护的稳定性承诺。

本次排查的实测证据：

- 本机 `lumevm` 设备的 `localPort` 从 `60691` 漂移到 `54695`，而 `60691` 在漂移后与观测时**均完全空闲**（`lsof -nP -iTCP:60691` 无输出），排除了「被其它进程长期占用」。
- SIGTERM 终止隧道后端口**立即**可重新绑定（实测 `+0ms` 即成功），排除了自我冲突与 TIME_WAIT 残留。
- 复现了降级机制本身：旧隧道存活时 `reserveCandidatePort(60691)` 回退到随机端口 `52345`；`dispose` 之后再请求同一端口则成功复用。
- 对照成立：`devbox`（稳定内网，RTT 41ms）端口未漂移；`lumevm`（SSH-over-VM，链路会抖动）漂移。链路质量与是否漂移完全对应。

漂移还是**完全无声**的：`tunnel-manager.ts` 内没有任何日志语句，`connectivity.service.ts` 的 `#persistLocalPort` catch 块为空。端口变更既不写日志也不进设备诊断，因此「设备 DSH 的本地状态又被重置了」无法从服务端日志定位；已消失端口上的残留页面继续回调驾驶舱，只表现为 `no cockpit device matches origin` 一类噪音（本机日志中 `127.0.0.1:62595` 累计 82 条）。

## What Changes

- 绑定重试 SHALL 依据**上一次尝试的失败原因**决定是否继续使用已持久化端口，而不再依据「是否为第一次尝试」：仅当失败可归因于该端口不可用（预绑定验证失败，或 OpenSSH 因端口占用类原因退出）时，后续尝试才放弃它；与端口可用性无关的失败（SSH 连接/认证/网络类退出、远端 DSH 未就绪）SHALL 在既有有界重试次数内继续使用已持久化端口。
- 保留「同一端口不得被无界重试」的既有保证：放弃首选端口的判定一旦成立，本次连接的后续尝试不再回退到它；重试次数上限（`maxBindAttempts`）不变。
- 端口漂移 SHALL 可观测：当一次连接实际使用的本地端口与已持久化值不同时，系统记录一条包含 deviceId、原端口、新端口与归因原因的 WARN 级日志。漂移仍 MUST NOT 使重连失败，也 MUST NOT 改变设备状态分级。
- 不改变本机设备（`kind: 'local'`）行为、不改变首次连接（无 `localPort`）行为、不改变端口持久化的写入路径与原子性保证。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-connectivity`：「设备本地转发端口在生命周期内保持稳定」要求补充失败归因语义——明确区分「端口不可用类失败」与「与端口无关的失败」，规定只有前者才使后续尝试放弃已持久化端口；并新增端口漂移的可观测性要求。既有的「预绑定实际验证」「静默回退不失败」「有界重试」「仅在端口变化时写注册表」保证均不变。

## Impact

- `packages/cockpit-server/src/connectivity/tunnel-manager.ts`：`connect` 重试循环按上一次失败的归因决定首选端口是否延续；对 OpenSSH 提前退出的 stderr 做端口占用类归因判定；端口漂移时发出日志。
- `packages/cockpit-server/src/connectivity/ssh.ts`：`reserveCandidatePort` 需要把「预绑定验证失败」这一归因回报给调用方（当前实现静默 `catch` 后回退，调用方无法区分）。
- `packages/cockpit-server/src/connectivity/connectivity.service.ts`：`#persistLocalPort` 的空 catch 补充失败日志（持久化失败仍 MUST NOT 中断已建立的连接）。
- 日志与诊断：新增端口漂移 WARN；不新增 HTTP 接口、不改变 `DeviceStatusFacts` 结构。
- 测试：`tunnel-manager` 单测覆盖「端口占用类失败 → 放弃首选端口」与「链路类失败 → 保留首选端口」两条分支，以及漂移日志；不改动前端、不改动共享类型、不改动远端行为、不新增依赖。
- 无数据迁移：注册表 `localPort` 字段语义不变。
