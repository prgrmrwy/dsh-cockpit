## ADDED Requirements

### Requirement: 单次连接尝试内部的等待有界且可被终止打断
系统 SHALL 保证一次连接尝试内部的每一次等待——隧道建立、协议确认、事件流握手、基线同步——都在有界时间内结束，并可被该设备的生命周期终止（手动重连、禁用、删除、驾驶舱关闭）打断。对端在握手中途断开 MUST NOT 使该次尝试永久悬置。一次尝试的实际结局（成功、可归因失败、被终止）SHALL 如实反映到设备状态与诊断中；连接循环已不再推进时，系统 MUST NOT 继续报告正在重连。

#### Scenario: 握手中途对端断开
- **WHEN** 一台已启用设备的连接尝试已建立事件流连接，但握手所需的基线尚未送达即被对端断开（例如远端 `dsh web` 正在重启或原地升级）
- **THEN** 该次尝试在有界时间内以可归因的失败结束，设备回到有界退避重试，并在对端恢复后重新进入 `READY`/`DEGRADED`；MUST NOT 停在 `CONNECTING` 直到驾驶舱被重启

#### Scenario: 连接尝试进行中请求手动重连
- **WHEN** 客户端在一台设备的连接尝试仍悬置时请求重连
- **THEN** 该请求在有界时间内返回，设备终止当前尝试并建立新的连接代，MUST NOT 永久不返回

#### Scenario: 连接尝试进行中关闭驾驶舱
- **WHEN** 驾驶舱在任一设备的连接尝试仍悬置时收到可捕获终止信号
- **THEN** 驾驶舱在有界时间内退出并清理自有隧道与子进程，MUST NOT 依赖 SIGKILL 才能结束进程，也不遗留 `ppid=1` 孤儿

#### Scenario: 一台设备尝试悬置不阻塞其他设备
- **WHEN** 一台设备的连接尝试悬置或反复失败
- **THEN** 其他设备的连接、状态访问与本地工作台不受影响

### Requirement: typert 事件流握手有界且失败可归因
对 typert 设备，系统 SHALL 为事件流握手（WebSocket 建立后的逻辑流打开与 workspace 基线送达）设定有界等待：基线未在界内送达、连接在基线送达前断开，或该次尝试被终止时，握手 SHALL 以失败或取消收场，MUST NOT 永久 pending。握手失败 SHALL 只作用于当前连接代：MUST NOT 删除或重写已保存的认证材料，MUST NOT 改变「优先复用未到期 cookie」的既有语义，也 MUST NOT 影响 rc.2 设备或其它设备。

#### Scenario: 基线未送达即断开
- **WHEN** typert 设备的 WebSocket 已建立，但 `workspace/follow` 基线在送达前 socket 断开
- **THEN** 握手在有界时间内失败并给出可归因诊断，设备按退避重试，不产生永久 pending 的等待

#### Scenario: 握手失败不破坏认证材料
- **WHEN** 一次 typert 握手以上述方式失败
- **THEN** 该设备已保存的 cookie 与 launch token 保持不变，下一次尝试仍按既有 cookie 复用语义进行，且诊断与日志不泄露 token/cookie

#### Scenario: rc.2 设备不受影响
- **WHEN** 机群中同时存在 rc.2 与 typert 设备，且 typert 设备握手失败
- **THEN** rc.2 设备仍按其自身协议进入 `READY`/`DEGRADED`，行为与本次改动前一致
