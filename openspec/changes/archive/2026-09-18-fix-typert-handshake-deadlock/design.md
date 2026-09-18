## Context

动机与违反的既有承诺见 `proposal.md`（Why）与本次 spec delta。设计只需要在此补充当前状态与约束：

- `TypertEventStream`（`packages/cockpit-server/src/connectivity/protocol-client.ts`）用 `#workspaceReady` 这个 Promise 表示「事件流握手完成」，但它只被 `resolve()`，`reject` 从未被调用；`open()` 没有超时参数、也没有 abort 入口，并且 `open()` 只在 socket 尚未 `open` 时才把失败向上传播（`if (!opened) reject(cause)`）。
- `DeviceLifecycle`（`device-lifecycle.ts`）已经具备完整的取消面：`#abort`（生命周期级）与 `#runAbort`（连接代级），`stop()` 会 abort 两者；`#run()` 是常驻循环，`#connectRc2` 在中途无界地 `await this.#stream.open()`。`#replaceLoop()` / `stop()` 都 `await this.#task` 作为「不得有重叠连接代」的正确性屏障。
- 既有有界预算可作参照：隧道就绪探测 12×500ms、基线同步 `baselineTimeoutMs` 默认 5s、隧道 `ConnectTimeout=5` + `ServerAliveInterval=15`×3。
- 约束：不新增依赖；不改认证/存储语义与注册表 schema；rc.2 走 `DualEventStream`（`rc2-client.ts`），其行为必须保持不变；测试用各包既有 vitest。

## Goals / Non-Goals

**Goals:**

- 一次连接尝试内部的每一次等待都有界，并且可被该设备的生命周期终止打断——对端行为不再能决定本机能否收敛。
- 「socket 已建立但基线未送达」从**永久挂起**降级为**一次可归因的普通失败**：进入既有退避重试，对端恢复后自动回到 `READY`/`DEGRADED`。
- 拆除路径（手动重连、禁用、删除、驾驶舱关闭）结构性地收敛，而不是依赖「每个 await 恰好都正确」。
- 诊断与状态如实反映连接层事实。

**Non-Goals:**

- 不引入通用取消/超时框架，不把 `EventEmitter` 全面改写为 AbortSignal 风格；只补齐握手这一处缺失的失败传播与截止时间。
- 不改 rc.2 适配线语义；不改退避次数与间隔上限；不改隧道建立与端口复用逻辑。
- 不处理 `workbench-launch` 在 cookie 有效时仍返回过期 `launchToken` 的问题（见 proposal 的 non-goal，另开 change）。
- 不引入重试次数上限之外的任何新状态枚举。

## Decisions

**1. 让 `#workspaceReady` 具备真正的失败路径，而不是新增旁路。**
`#workspaceReady` 是握手唯一被 await 的点，把它的失败传播补上是最小且正确的修法：socket `error`/`close`、`dispose()`、握手超时三类终止路径都 SHALL reject 尚未完成的握手。替代方案（改用轮询状态机、或让调用方加超时后放弃）会让「谁负责让握手结束」继续分散在调用方，留下同样的挂起空间。
关键约束：**拒绝只作用于尚未完成的握手**。基线已送达后 socket 再断开属于既有 `disconnect` 语义（走 `#waitForDisconnect` → 退避重连），MUST NOT 被追溯性地算作握手失败。

**2. 握手用自己的截止时间，而不是依赖 socket 层保活。**
socket 可以长期保持 `open` 而逻辑流始终不 baseline，只有截止时间能覆盖这种情形。默认 `handshakeTimeoutMs = 10_000`（与既有 5s 基线、6s 隧道探测预算同量级，对慢链路保留余量），并作为 lifecycle/stream 选项可注入，便于测试与后续调整。替代方案（依赖 ws ping/pong）不覆盖「逻辑流未打开」；替代方案（沿用 socket 默认无限等待）正是本次缺陷。

**3. 把连接代的 abort 信号接进握手。**
`stop()` 已经 abort `#abort`/`#runAbort`，所以只要握手响应 abort，拆除路径就不必等对端。替代方案（只在 `stop()` 里对 `#task` 加超时后直接放弃等待）会留下仍在运行的旧连接代，与既有的 `#connectionGeneration`、隧道 generation 屏障语义冲突——这些屏障的前提正是旧尝试会真正结束。

**4. 保留 `await this.#task` 作为正确性屏障，另加有界兜底 + WARN。**
有了 (1)(2)(3)，`#task` 会自行结束，屏障照旧。但为了让「驾驶舱退出/停止不得阻塞」是**结构性**保证而非依赖「所有 await 都写对了」，拆除路径对 `#task` 的等待加一个（远大于握手预算的）有界兜底：超时则记 WARN 并继续拆除。兜底预期永不触发；即便触发，晚到的旧尝试也会被既有 generation 检查判为过期并自行 dispose，不会产生两个并存连接代。

**5. 诊断沿用既有状态机，不新增枚举。**
握手失败以 rejection 冒泡到 `#connectRc2`，按既有失败路径落状态并进入 `CONNECTING`/'reconnecting in Xms' 退避。因此「连接循环已不再推进却仍报告正在重连」在修复后不会出现——循环每次失败都会有新的状态与诊断写入。不为握手超时新增独立状态（spec 的健康探测要求只约束既有枚举集合，不要求新增）。

## Risks / Trade-offs

- [握手截止时间过短，慢链路或大 workspace 被误判失败] → 默认值取与既有基线/探测预算同量级的宽松值（10s），且失败只是一次普通退避重试而非永久状态；数值可注入，便于按实测调整。
- [拒绝握手可能追溯性地破坏一个健康连接代] → 拒绝只针对未完成的握手；基线已送达后的断线仍走既有 `disconnect` → 重连路径（Decision 1 的约束）。
- [`stop()` 兜底超时后旧尝试与新连接代并存] → 既有 `#connectionGeneration` / 隧道 generation 检查会使过期尝试自行退出并 dispose 自有隧道；兜底同时写 WARN，便于发现「又有新的无界 await」。
- [改动 `open()` 语义可能影响既有测试] → 更新 `protocol-client` 既有用例并补一条回归用例：socket `open` 后不带 baseline 断开时，握手必须有界失败（当前实现为永久 pending，正是本次复现的用例）。
- [验证需要重启驾驶舱才能生效] → 见 Migration Plan；实施阶段 MUST NOT 自行重启，重启时机由用户决定。

## Migration Plan

- 无数据迁移、无注册表 schema 变更、无远端改动：纯代码与测试改动，回滚即回退提交。
- 生效需要重新构建并重启本机驾驶舱进程。**已与用户确认：本会话不再重启驾驶舱**，因此实施与验证的重启时机由用户在下一轮显式安排；构建与单测/类型检查可在不重启的前提下先行完成。

## Open Questions

- 握手截止时间的最终默认值（10s）与是否要与隧道探测预算对齐，可在实施时结合实测调整；该数值不改变 spec 要求、方案与任务拆分。
