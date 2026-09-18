## Why

typert 线的 DSH 事件流握手**可以永久挂起**，并把这个挂起传染给整台设备的连接生命周期，使该设备在驾驶舱里**无法从 UI 自救**。这不是理论缺陷：`devbox` 因此连续多日不可用，直到重启驾驶舱进程才恢复。

缺陷在 `packages/cockpit-server/src/connectivity/protocol-client.ts`：`TypertEventStream.#workspaceReady` 是一个只可能 `resolve`、**从不 `reject`** 的 Promise（`reject` 仅在 289-299 行被保存，359 行只调用 `resolve()`；318 行的 `void this.#workspaceReady.promise.then(resolve, reject)` 是把它的 rejection 转发给 `open()`，而不是触发它）。于是 `open()`（302-324 行）**没有任何超时、也不接受 abort signal**：只要 WebSocket 已经 `open`、但在 `workspace/follow` baseline 到达前就断开，`open()` 就永不 settle。而 `DeviceLifecycle.#connectRc2` 是无界地 `await this.#stream.open()`（`device-lifecycle.ts:572`），`#run()` 又是常驻循环，于是：

- 连接循环永久卡死 —— `stop()`（`device-lifecycle.ts:412`）与 `#replaceLoop()`（444 行）都要 `await this.#task`，因此**手动重连、禁用、删除、以及驾驶舱关闭全部一起卡死**；
- 设备永远停在 `CONNECTING`，而诊断仍写着 `event stream disconnected, reconnecting` —— 实际上什么都没在重连。

触发条件是一次**正常的 DSH 重启**：驾驶舱正握着已 `open` 的 WebSocket 时远端 `dsh web` 退出/升级，socket 先 `open` 后死、baseline 永远不来。本次事故正是如此——`devbox` 的 `~/.dsh/dsh-startup.log` 记录 `2026-09-18T19:26:21`、`19:27:10` 两次重启。

现有 spec 已经要求了被违反的性质：`openspec/specs/cockpit-device-connectivity/spec.md:60` 要求「重连有上限，不无限重试」「一台设备故障不得阻塞驾驶舱与其他设备」「驾驶舱退出/停止不得阻塞并必须收敛」，`:50` 的 `#### Scenario: 隧道断开后重连` 要求断连后能重新确认协议并回到 `READY`/`DEGRADED`。这些承诺在 typert 线的一次中间态断线上直接失效。

本次排查的实测证据：

- `devbox` 设备长期停在 `CONNECTING`，`diagnostic=event stream disconnected, reconnecting`，`compatibility=INCOMPATIBLE`；进程侧**既无 ssh 子进程、`127.0.0.1:63333` 也无监听**，说明连接循环没有在推进。
- `POST /api/devices/device-nbfxl84e/reconnect` **永不返回**（客户端 26s 超时，`http=000`，无响应体）。
- `sample` 该进程显示主线程空闲——不是死循环占 CPU，而是**挂在一个永不 settle 的 Promise 上**，且无待处理句柄/定时器。
- `POST /refresh` 耗时恰好 `5.004s`（= `baselineTimeoutMs` 默认 5000），并写入日志 `device-nbfxl84e: baseline fetch aborted: baseline timed out`；`#fetchBaselines` 用 `Promise.allSettled` 同时等 `listSessions()` 与 `listWorkspaces()`，后者走的正是永挂的 `#workspaceReady.promise`。
- 用**构建产物中的真实类**做了对照复现（`packages/cockpit-server/dist/connectivity/protocol-client.js`）：baseline 正常送达时 `open()` 解析；socket `open` 后不带 baseline 直接 terminate 时，`open()` 在 3000ms 后仍 pending，且 `dispose()` + abort 之后 1500ms **依然 pending**。
- 同期 `devbox` 的 DSH 完全健康：同一条握手链路（新隧道 + cookie 交换 + `remote.mux` 双流）实测返回 `events ready` 与 `workspace baseline`，与本机 DSH 行为一致——问题不在远端，也不在协议实现。

## What Changes

- typert 事件流握手 SHALL **有界且可中断**：`open()` 必须在有界时间内以 resolve 或 reject 结束，并且 SHALL 响应生命周期 abort/dispose，MUST NOT 因为 baseline 未到达而永久挂起。
- `#workspaceReady` 的失败路径 SHALL 真正可用：socket error/close、dispose 与握手超时 SHALL reject 该等待，使 `workspaceBaseline()` 的调用方得到失败而不是永久 pending。
- 单次连接尝试内的每一次等待 SHALL 可被生命周期终止（abort）打断，使 `#run()` 循环始终能收敛回退避重试，MUST NOT 出现「循环已死但状态显示正在重连」的中间态。
- `stop()` / 手动重连 / 禁用 / 删除 / 驾驶舱关闭 SHALL **收敛**，不因存在进行中的连接尝试而无限等待；驾驶舱退出 MUST NOT 需要 SIGKILL 才能释放进程。
- 诊断 SHALL 如实反映连接层事实：握手被中断或尝试被终止时，设备状态与诊断文字 MUST NOT 继续宣称正在重连。
- 不改变 rc.2 线（`0.1.1-rc.2`）行为，不改变授权/凭据语义与存储格式，不新增 HTTP 接口或共享类型字段，不改变远端行为（远端仍只需标准 `dsh web`）。
- 明确 non-goal（另开 change）：`workbench-launch` 在 cookie 仍有效时继续返回过期 `launchToken` 的 iframe URL。该行为本身由 spec `#### Scenario: 普通 DSH 重启后复用已有 cookie` 明确要求（复用 cookie、不要求旧 token 再交换），本次不做修改，只记录为后续独立议题。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-connectivity`：在该 capability 下**新增**两条要求——「单次连接尝试内部的等待有界且可被终止打断」与「typert 事件流握手有界且失败可归因」。
  - 既有要求文字**保持不变**：spec 早已承诺「重连有上限」「一台设备故障不得阻塞其他设备」「驾驶舱退出/停止不得阻塞并必须收敛」（`spec.md:60`）与断连后回到 `READY`/`DEGRADED`（`spec.md:50`）。本次是把这些承诺在**具体路径**上写实：原先只约束了退避次数与间隔，未写明「单次尝试内部的等待必须有界且可被终止打断」，也未写明 typert 握手在基线未送达时的失败语义——实现正是在这两处留了永久挂起的空间。

## Impact

- `packages/cockpit-server/src/connectivity/protocol-client.ts`：`TypertEventStream` 的 `open()` / `workspaceBaseline()` 具备有界超时与失败传播；`#workspaceReady` 在 error/close/dispose/超时时被 reject；必要时让 `open()` 接受 abort signal。
- `packages/cockpit-server/src/connectivity/device-lifecycle.ts`：`#connectRc2` 与 `#connectOnce` 内的等待可被 `runAbort` 打断；`stop()` / `#replaceLoop()` 对 `#task` 的等待有界，保证拆除路径收敛；被中止的尝试写入如实诊断而非「正在重连」。
- `packages/cockpit-server/src/connectivity/connectivity.service.ts`：仅在需要时调整关闭路径，使 `onApplicationShutdown` 不依赖可能无界的 `stop()`；不改变既有隧道清理与「不误杀用户其他 SSH」语义。
- 测试：新增 typert 握手失败路径单测（socket open 后不带 baseline 断开 → `open()` 有界失败而非挂起；abort/dispose 必须生效），以及连接循环在握手失败后可继续退避重试、`stop()`/`reconnect()` 收敛的回归用例。
- 无数据迁移、无注册表 schema 变更、无依赖新增、无前端改动。
