## 1. 握手失败传播(protocol-client.ts)

- [x] 1.1 `TypertEventStream`:`#workspaceReady` 的三条终止路径都必须 reject 尚未完成的握手——socket `error`、socket `close`、`dispose()`;已 resolve 的握手 MUST NOT 被后续 socket 断开追溯性地算作失败(那属于既有 `disconnect` 语义)
- [x] 1.2 `open()`:收紧 `fail()` 的语义,使 socket 已 `open` 之后的握手失败同样让 `open()` 以 rejection 结束(当前 `if (!opened) reject(cause)` 是本次永久挂起的直接原因);`dispose()` 保持幂等,重复调用无副作用
- [x] 1.3 `workspaceBaseline()`:握手未完成时 MUST NOT 返回永久 pending 的 promise,失败时 reject 并给出可归因错误消息
- [x] 1.4 错误消息与诊断 MUST NOT 包含 token、cookie 或任何可逆派生值

## 2. 握手截止时间(D2)

- [x] 2.1 为 typert 握手引入 `handshakeTimeoutMs`(默认 `10_000`),作为 stream/lifecycle 可注入选项,便于测试与后续按实测调整
- [x] 2.2 超时走与 1.1 相同的终止路径(reject 未完成握手 + 关闭 socket),错误消息可归因(例如说明握手超时及其毫秒数)
- [x] 2.3 定时器 MUST NOT 泄漏:每次终止路径都要清理 timer,且不阻止进程退出(`unref` 与既有一致)

## 3. 生命周期侧的有界与收敛(device-lifecycle.ts)

- [x] 3.1 `#connectRc2`:把连接代的 abort 信号接进事件流握手,使 `stop()`/手动重连/禁用/删除/关闭能打断进行中的握手
- [x] 3.2 握手失败或取消后按既有失败路径收敛:`#run` 进入有界退避重试,并写入如实的状态与诊断(不再出现「循环已不再推进却仍报告正在重连」)
- [x] 3.3 `#replaceLoop()` / `stop()`:对 `#task` 的等待保留正确性屏障语义,并加一个远大于握手预算的有界兜底 + WARN,使拆除收敛成为结构性保证而非依赖「每个 await 都恰好有界」
- [x] 3.4 确认兜底触发时旧尝试会被既有 `#connectionGeneration` 与隧道 generation 检查判为过期并自行 dispose,不产生两个并存连接代
- [x] 3.5 `connectivity.service.ts`:`onApplicationShutdown` 不再可能被单台设备的 `stop()` 无限阻塞(按 3.3 的收敛保证复核,必要时调整)
- [x] 3.6 **(实施中发现,补充范围)** `#reconcileBaseline()` 在 `#fetchBaselines()` 抛错(baseline 超时)时提前 `return 'failed'`,绕过了 `finally` 里的 `#reconciling = false`,使该设备此后每次 reconcile 都返回 `'skipped'`、**永远无法再进入 `READY`**——与 spec 新要求的「回到有界退避重试并在对端恢复后重新进入 READY/DEGRADED」直接冲突。抽出 `#endReconcile()` 并让**每条退出路径**都经过它

## 4. 测试

- [x] 4.1 `protocol-client` 回归用例:socket `open` 后不带 `workspace/follow` baseline 断开 → 握手在有界时间内失败(修复前该用例为永久 pending,即本次复现)
- [x] 4.2 握手进行中 `dispose()` 与 abort → 以取消收场,不挂起、不泄漏 socket/timer
- [x] 4.3 注入短 `handshakeTimeoutMs`:逻辑流始终不 baseline 时握手超时失败,且错误可归因
- [x] 4.4 基线已送达后再断线 → 仍走既有 `disconnect` → 退避重连路径(不被误判为握手失败)
- [x] 4.5 `device-lifecycle`:握手失败 → 退避重试 → 下一次尝试成功进入 `READY`/`DEGRADED`
- [x] 4.6 `device-lifecycle`:连接尝试悬置时 `reconnect()` 与 `stop()` 在有界时间内返回且完成清理(无残留子进程)
- [x] 4.7 既有 `protocol-client` / `device-lifecycle` / rc.2 相关用例全部保持通过,rc.2 行为不变
- [x] 4.8 **(随 3.6 补充)** `device-lifecycle`:首次 baseline 超时后,后续尝试仍能完成 reconcile 并进入 `READY`(修复前永远停在 `CONNECTING`)

## 5. 验证与收口

- [x] 5.1 按改动范围实际运行 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint` 并记录结果(全部 exit 0;`pnpm test` 198 passed,含新增 9 条)
- [x] 5.2 真机复验:用户重启驾驶舱(pid 73376,构建产物 22:30:50 → 进程 22:33:34)后完成三项验证——(a) 对真实构建产物跑触发场景:socket upgrade 后 baseline 未送达即断 → 103ms 内以 `typert stream closed` 失败(修复前永久 pending);(b) 真实 `POST /reconnect` → **201 / 3.7ms**(修复前 26s 超时无响应),devbox 保持 `READY`;(c) 端到端:让驾驶舱对一台 typert 设备(临时 fake mux)在 upgrade 后立刻断开 baseline → 设备 500ms 退避后下一次尝试自愈到 `READY`,**驾驶舱进程未重启**(pid 前后一致),临时设备已清理
- [x] 5.3 约束:本会话用户已明确**不再重启驾驶舱**,实施阶段 MUST NOT 自行重启;5.2 的生效时机由用户在下一轮显式安排
- [x] 5.4 完成后按 OpenSpec archive 流程收口,并把 delta 同步进 `openspec/specs/cockpit-device-connectivity/spec.md`(已同步:需求 10→12、场景 43→50,两条 ADDED 要求就近插入对应既有要求之后,既有要求顺序与内容零丢失)

## 6. 回归证据(反向验证)

- [x] 6.1 `4.1` 在旧 `protocol-client.ts` 上运行 → 测试超时(永久 pending),在新实现上通过
- [x] 6.2 `4.6`(重连/拆除)在旧 `device-lifecycle.ts` 上运行 → 两者均超时,复现了生产侧 `POST /reconnect` 永不返回的现象
- [x] 6.3 `4.8` 在旧 `device-lifecycle.ts` 上运行 → `expected 'CONNECTING' to be 'READY'`,复现 3.6 的永久卡死
- [x] 6.4 真机端到端(5.2c):驾驶舱对 typert 设备在 upgrade 后立刻断开 baseline → `CONNECTING | reconnecting in 500ms` → 下一次尝试 `READY`;驾驶舱 pid 前后一致,证明「不再需要重启驾驶舱」
- [x] 6.5 真机中断压测(5.2b 延伸):对驾驶舱自有 devbox 隧道连续 `kill -9` 12 次,设备如实报 `SSH_UNREACHABLE | OpenSSH exited before DSH readiness` 并**自行恢复**到 `READY`;日志中拆除兜底告警 0 次,结束时仅剩一条隧道、无孤儿进程
