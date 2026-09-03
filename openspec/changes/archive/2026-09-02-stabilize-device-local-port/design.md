# 设备本地转发端口稳定化设计

## Context

驾驶舱的工作台承载的是设备**原生**的 DSH Web（`packages/cockpit-web` 用 iframe 加载 `http://127.0.0.1:<localPort>`）。这条「零协议耦合」的架构承诺意味着：DSH Web 客户端自己的浏览器侧状态也应当天然继承，而不只是 HTTP API。

当前实现打破了这一点。`packages/cockpit-server/src/connectivity/ssh.ts:100` 的 `reserveCandidatePort()` 用 `server.listen(0, '127.0.0.1')` 让内核分配端口，`tunnel-manager.ts:71-72` 在每次 `connect()` 的重试循环里无条件调用它。端口于是成为「每次连接一次性」的值：

```
localPort → tunnelArgs 的 -L 127.0.0.1:<localPort>:...   (tunnel-manager.ts:38)
          → endpoint = new URL(`http://127.0.0.1:${localPort}`)  (tunnel-manager.ts:87)
          → DeviceLifecycle.#endpoint                    (device-lifecycle.ts:327)
          → statuses().endpoint → 前端 iframe src        (connectivity.service.ts:84)
```

每次重连 origin 变化，浏览器按 origin 隔离的 `localStorage` 就此断链。

`DeviceRecord.localPort?: number` 在 `packages/shared/src/index.ts:24` 已定义，`registry.ts:43` 已在读盘时保留它——但全仓库 grep 显示没有任何代码写入或读取它。它是一个从未接线的字段，本设计的核心就是把这条线接上，并让它在安全前提下真正生效。

约束：连接层必须保守（`CLAUDE.md` 前馈要点），注册表写盘必须原子且 fail-closed，重连路径不得因新增的「优化」而变脆。

## Goals / Non-Goals

**Goals:**

- 远端设备的工作台 origin 在设备生命周期内（跨重连、跨驾驶舱重启）保持稳定。
- 端口复用前实际验证可绑定，绝不假设它还空着。
- 端口不可用时静默、必然地回退到随机端口；重连成功率不因本改动下降。
- 与既有 `maxBindAttempts` 有界重试协调，TOCTOU 窗口内被抢占降级为一次普通重试。
- 首次连接、字段缺失或非法时行为与今天完全一致。

**Non-Goals:**

- 不引入端口池、端口预留守护进程或跨进程端口租约。
- 不让用户手工指定或在 UI 中编辑本地端口（未来若需要是另一个 change）。
- 不改动前端、共享类型或远端行为；不新增任何依赖。
- 不做数据迁移：既有注册表缺 `localPort` 的设备等价于首次连接。
- 不保证「端口永不变化」——被别的进程长期占用时，稳定性让位于可用性。

## Decisions

### 1. `reserveCandidatePort(preferredPort?)`：以真实绑定作为唯一的可用性证明

在 `ssh.ts` 中给现有函数加一个可选首选端口参数。给定首选端口时先 `server.listen(preferredPort, '127.0.0.1')`；**任何** 监听错误（`EADDRINUSE`、`EACCES` 特权端口、其它）都静默回落到既有的 `listen(0)` 路径。无首选端口时行为与今天逐字相同。

选择「真的去 listen 一次」而不是查表或探测的理由：这是唯一不会说谎的检查，并且它顺带覆盖了一个本来需要额外机制的情况——另一台**在线**设备的 ssh 正持有该端口时，绑定同样会失败，无需在 TunnelManager 里维护「已占用端口集合」。

被否决的方案：在 TunnelManager 内维护一个 live-port 集合做预筛。它与内核状态会不同步（驾驶舱之外的进程照样能占用端口），只是在真实检查之外多加一层可能撒谎的缓存，不予采用。

被否决的方案：改用 `SO_REUSEADDR` 或让 ssh 直接尝试绑定并解析 stderr。前者不改变端口被真实占用时的结果，后者把判定建立在 OpenSSH 的错误文案上，脆弱且跨平台不可靠。

### 2. 只在一次连接的第一次尝试里使用已存端口

`TunnelRequest` 新增 `preferredLocalPort?: number`。`connect()` 的重试循环改为：

```
const preferred = attempt === 1 ? sanitize(request.preferredLocalPort) : undefined
const localPort = await reserveCandidatePort(preferred)
```

这条规则同时解决了两件事。其一，`reserveCandidatePort` 与 OpenSSH 真正绑定之间必然存在 TOCTOU 窗口（函数在返回前就 `close()` 了探测用的 server，这是原有设计，隧道需要这个端口空出来才能绑）。窗口内被抢占时 ssh 会因 `ExitOnForwardFailure=yes` 退出，命中既有的 `outcome.kind === 'exit'` 分支，`attempt < maxBindAttempts` 时 `continue` 重试——第二次尝试不再使用已存端口，因此不会撞上同一个刚被抢走的端口反复失败。其二，重试次数上限完全不变，没有为复用引入任何新的循环或无界行为。

被否决的方案：让 `reserveCandidatePort` 持有 server 直到 ssh 绑定完成以消除窗口。做不到——同一个端口不能被两个 socket 同时监听，这正是现有实现先 close 再交给 ssh 的原因。窗口是结构性的，只能靠重试吸收，而重试机制已经存在。

### 3. 端口在连接成功后回写，且只在发生变化时写

`TunnelHandle` 新增 `localPort: number`（endpoint 里已隐含，显式字段避免调用方再解析 URL）。`DeviceLifecycleOptions` 新增可选回调 `onLocalPort?: (deviceId, port) => void`，在远端设备连接建立后触发；`ConnectivityService` 把它接到注册表。

只在实际端口与记录中的值不同时才写盘：稳定复用成功的常见路径下，重连完全不产生磁盘 I/O。

回写失败被吞掉并不影响已建立的连接——端口稳定性是一项优化，它的持久化失败不应该拖垮一条已经可用的隧道。下次连接会重新尝试写入。

同时把新端口同步进内存中的 `#record`（经 `lifecycle.updateRecord`），使同一进程内的后续重连立刻受益，不必等下一次从盘加载。

### 4. 注册表新增窄写入路径 `updateLocalPort`，复用既有原子写盘

不采用「`load()` → 改 → `save()`」的调用方拼装：那对读-改-写不是原子的，会与并发的设备增删互相覆盖。

改为在 `DeviceRegistry` 内把写盘主体抽成私有 `#writeFile(devices)`，`save()` 保持 = 校验 + `#serialize(#writeFile)`，新增 `updateLocalPort(deviceId, port)` = `#serialize(读 → 定位 → 改 → #writeFile)`。整个读-改-写在既有的 `#queue` 串行化域内完成，tmp+rename、0600/0700 权限与损坏 fail-closed 全部原样继承。设备不存在时是无操作（该设备可能刚好被并发删除），不抛错。

### 5. 收紧 `localPort` 的校验为合法端口范围

`registry.ts:43` 目前只要求 `Number.isInteger`，会把 `0`、负数、`70000` 当成有效值读回来。收紧为 `1..65535`。

这不是破坏性变更：`localPort` 是可选字段，校验不通过时只是不进入记录对象，行数据本身仍然有效，因此不会把既有注册表判为 `CORRUPT`。语义正好是规范要求的「非法值等价于缺失」，非法值随后被首次连接的正常路径覆盖掉。

TunnelManager 侧再做一次同样的 `sanitize`，保证即使调用方传入越界值也只会退化为随机分配，不会把非法参数拼进 `-L`。

## Risks / Trade-offs

- [复用端口在验证与 ssh 绑定之间被抢占] → 由既有 `maxBindAttempts` 吸收；第二次尝试强制随机端口，不会反复撞同一个端口。
- [两台设备的记录里存有相同端口（如手工编辑注册表）] → 先连的一方占住，后连的一方 `listen` 失败并回退随机端口，随后把新端口写回自己的记录，自动收敛，无需额外去重逻辑。
- [长期被别的进程占用同一端口，origin 仍会变] → 有意的取舍：可用性优先于稳定性。这种情况下 origin 变化与今天的行为一致，不会更差。
- [端口稳定后，该 origin 的存储在设备被删除后仍留在浏览器里] → 与今天相同数量级的问题（今天是留下更多个一次性 origin 的垃圾），且不涉及凭据；不在本 change 范围内处理。
- [注册表在连接热路径上多了一次写盘] → 仅在端口变化时发生，稳态为零写入；写入本身走既有串行化原子路径，失败不影响连接。
- [`local` 设备被误纳入复用逻辑] → 结构上不可能：`device-lifecycle.ts` 的 `local` 分支直接用 `remoteDshPort` 构造 endpoint，根本不经过 `TunnelManager`。

## Migration Plan

1. 扩展 `reserveCandidatePort` 与其单元测试（首选可用、首选被占、无首选）。
2. 扩展 `TunnelRequest`/`TunnelHandle` 与 `connect()` 的尝试策略。
3. 接线 `DeviceLifecycle` → `ConnectivityService` → `DeviceRegistry.updateLocalPort`。
4. 补充隧道复用、回退与首次连接的测试，并做反向验证（临时改回总是随机分配，确认新测试失败）。
5. 运行 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`。

回滚：本改动是纯加性的（可选参数 + 可选回调 + 新方法），恢复 `connect()` 中的一行即可退回原随机分配行为；注册表中已写入的 `localPort` 会重新变成无人读取的记录，不需要数据回滚。

## Open Questions

无。
