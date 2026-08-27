## Purpose

驾驶舱的设备管理能力：注册设备、托管到远端 DSH Web 的回环 SSH 隧道、健康探测与状态分级、断线重连，以及可捕获信号下的终结性清理。远端只需标准 `dsh web` 且本机到其 SSH 免密，无需任何插件。

## Requirements

### Requirement: 设备注册需先通过非交互 SSH 身份验证

系统 SHALL 持久化设备之前，先用系统 OpenSSH 以仅 BatchMode 的非交互方式验证用户名/主机/端口可达。免密（SSH Agent 或 `~/.ssh/config` 的公钥）验证才通过；不保存密码、私钥内容或 passphrase。失败时不得写入设备记录。

#### Scenario: 交互认证不通过则拒绝保存
- **WHEN** 用户添加一台需要交互密码或主机密钥确认的设备
- **THEN** 系统拒绝保存该设备并显示诊断，不得回退到不安全连接方式

#### Scenario: 身份验证通过后网络断开
- **WHEN** 验证成功但保存到盘前网络失败
- **THEN** 系统不留下部分设备记录（原子性），并为用户提供重试或取消路径

### Requirement: 使用自有 SSH 隧道只监听中央回环并保持有界

系统 SHALL 为每台设备建立一条本地回环转发（`127.0.0.1:<localPort>` → 远端 DSH 端口），由驾驶舱分配并跟踪。隧道 SHALL 使用系统 OpenSSH 配置（别名、`~/.ssh/config`、known_hosts、Agent、ProxyJump），并至少设置 `BatchMode`、`ExitOnForwardFailure` 与有界 keepalive。系统 MUST NOT 关闭 host-key 校验，MUST NOT 把密钥/口令暴露给模型或日志。

#### Scenario: 本地端口被占用
- **WHEN** 驾驶舱分配的本地端口被其他进程占用于建立阶段
- **THEN** 系统重新分配候选端口并继续（有界重试），失败时把该设备的诊断归类为隧道错误

#### Scenario: 隧道建立成功但远端 DSH 未就绪
- **WHEN** 隧道打开但目标端口没有标准 DSH 服务
- **THEN** 系统不把该设备标记为可用，并在状态分级中归类为 `DSH_UNAVAILABLE` 或 `NON_DSH_SERVICE`；不假装就绪

### Requirement: 健康探测与状态分级可诊断

系统 SHALL 对每台设备至少区分：`SSH_UNREACHABLE`（SSH 不可达/认证失败）、`TUNNEL_ERROR`（本地转发失败）、`DSH_UNAVAILABLE`（隧道通但 DSH 服务不可达）、`NON_DSH_SERVICE`（端口有服务但不是 DSH）、`INCOMPATIBLE`、`CONNECTING`（正在连接/重连退避中）、`READY`、`DEGRADED`。状态应由连接层驱动，且不得仅凭 `host.describe` 或 `command -v` 来判断 DSH 未安装。

#### Scenario: 启动时设备不可达
- **WHEN** 驾驶舱启动后，一台登记设备 SSH 不可达
- **THEN** 系统显示 `SSH_UNREACHABLE` 与最后已知信息；不阻塞其他设备，也不误判为从未存在

#### Scenario: 隧道断开后重连
- **WHEN** 设备原先 `READY`，隧道后断开
- **THEN** 系统立即标记断连并进入 `CONNECTING`（重连退避），恢复后重新探测并回到 `READY`/`DEGRADED`，并保留最后已知状态。

### Requirement: Per-device 抖动退避且单设备故障不阻塞其他设备

系统 SHALL 为每台设备维护独立的抖动退避重连（有上限，不无限重试），一台设备故障不得阻塞驾驶舱与其他设备。驾驶舱退出/停止不得阻塞并必须收敛（无无限重试循环）。

#### Scenario: 单台设备永久不可达
- **WHEN** 一台设备的 SSH 长时间不可达
- **THEN** 其他设备与驾驶舱的状态访问不被阻塞；该设备持续在退避窗口内重试且重试间隔有界

#### Scenario: 驾驶舱关闭时仍处于退避中
- **WHEN** 用户在重连退避等待期间关闭驾驶舱
- **THEN** 驾驶舱停止重试并清理自有隧道进程，不遗留后台重试或子进程

### Requirement: 注销设备与删除需确认并保留最小诊断

系统 SHALL 在用户禁用/删除设备时停止其连接与重连；若有未知结果（outcome-unknown）写操作需用户显式确认。保留的最小诊断不得包含可关联用户提示的 rpcId、sessionId 或内容。

#### Scenario: 删除设备时存在未知写操作
- **WHEN** 用户删除一台仍有 outcome-unknown 写操作的设备
- **THEN** 系统要求显式确认；未确认前不停止连接、不改注册表；确认后删除并保留脱敏诊断直到用户明确清除

#### Scenario: 删除无未知操作的设备
- **WHEN** 用户删除一台无未知写操作的设备
- **THEN** 系统直接清理其连接与注册表，无残留诊断

### Requirement: 可捕获信号下终结性清理

系统 SHALL 在收到可捕获终止信号（SIGINT/SIGTERM）后清理其**自有** SSH 子进程、socket 与 timer，并且清理后不再启动新的子进程。不可捕获终止（SIGKILL/断电）不被宣称同步清理保证；重启后不得仅凭端口/命令行相似性猜测归属去杀进程。

#### Scenario: 清理后不得再 spawn
- **WHEN** 驾驶舱收到 SIGTERM 且已有自有 SSH 子进程运行
- **THEN** 系统终止这些子进程；且其重连循环不得再启动新的子进程，无 `ppid=1` 孤儿

#### Scenario: 只清理自有进程
- **WHEN** 存在用户自行建立的 SSH 隧道或其它 SSH 进程
- **THEN** 系统只终止其自有子进程，不误杀用户其他 SSH 连接
