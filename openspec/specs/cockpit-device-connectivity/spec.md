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
系统 SHALL 对每台设备至少区分：`DISABLED`、`SSH_UNREACHABLE`、`TUNNEL_ERROR`、`DSH_UNAVAILABLE`、`NON_DSH_SERVICE`、`INCOMPATIBLE`、`CONNECTING`、`READY`、`DEGRADED`。状态应由连接层驱动；探活方式随协议形态选择，且不得仅凭单次 401、单一 RPC 或 `command -v` 判断服务身份或 DSH 是否安装。认证缺失属于可执行诊断，不新增连接状态枚举。

#### Scenario: 启动时设备不可达
- **WHEN** 驾驶舱启动后，一台已启用的登记设备 SSH 不可达
- **THEN** 系统显示 `SSH_UNREACHABLE` 与最后已知信息，不阻塞其它设备

#### Scenario: 隧道断开后重连
- **WHEN** 已启用设备原先 `READY`，隧道后断开
- **THEN** 系统立即标记断连并进入 `CONNECTING`，恢复后重新确认协议并回到 `READY`/`DEGRADED`，保留最后已知状态

#### Scenario: 禁用设备的状态
- **WHEN** 一台登记设备被禁用或驾驶舱启动时读取到已禁用设备
- **THEN** 系统将其报告为 `DISABLED`，不尝试协议探测、认证交换或连接，也不把它报告为正在连接或连接故障

### Requirement: Per-device 抖动退避且单设备故障不阻塞其他设备

系统 SHALL 为每台设备维护独立的抖动退避重连（有上限，不无限重试），一台设备故障不得阻塞驾驶舱与其他设备。驾驶舱退出/停止不得阻塞并必须收敛（无无限重试循环）。

#### Scenario: 单台设备永久不可达
- **WHEN** 一台设备的 SSH 长时间不可达
- **THEN** 其他设备与驾驶舱的状态访问不被阻塞；该设备持续在退避窗口内重试且重试间隔有界

#### Scenario: 驾驶舱关闭时仍处于退避中
- **WHEN** 用户在重连退避等待期间关闭驾驶舱
- **THEN** 驾驶舱停止重试并清理自有隧道进程，不遗留后台重试或子进程

### Requirement: 删除设备需无条件确认并保留最小诊断

系统 SHALL 在用户禁用/删除设备时停止其连接与重连。禁用设备后，系统 SHALL 终止该设备的隧道与事件流、停止重连 timer，并清除 endpoint、桥接在线时间及其它仅代表当前活跃连接的事实；设备注册记录仍 SHALL 保留，重新启用后 SHALL 通过新的连接生命周期重新建立这些事实。对禁用设备发起手动刷新或重连 MUST NOT 创建连接或子进程。删除任何设备前 SHALL 获得用户显式确认；未确认前不得停止连接、不得改动注册表。系统 MUST NOT 依据「结果未知的写操作」计数来决定是否需要确认，也 MUST NOT 在设备事实中暴露该计数。保留的最小诊断不得包含可关联用户提示的 rpcId、sessionId 或内容。

#### Scenario: 删除设备需显式确认
- **WHEN** 用户对任意一台已登记设备发起删除
- **THEN** 系统要求显式确认；确认后停止其连接与重连并从注册表移除，保留的诊断不含 rpcId、sessionId 或提示内容

#### Scenario: 用户取消删除
- **WHEN** 用户发起删除后取消确认
- **THEN** 系统不改动注册表、不停止该设备连接，设备保持原有状态与顺序

#### Scenario: 禁用设备
- **WHEN** 用户禁用一台设备
- **THEN** 系统停止并清理其隧道、事件流和重连，清除 endpoint 与桥接在线事实，将状态设为 `DISABLED`，并保留该设备的注册记录

#### Scenario: 禁用设备时请求重连
- **WHEN** 客户端对一台已禁用设备请求刷新或重连
- **THEN** 系统拒绝启动连接且不创建 SSH 子进程，设备保持 `DISABLED`

#### Scenario: 重新启用设备
- **WHEN** 用户重新启用一台设备
- **THEN** 系统建立新的连接生命周期并从 `CONNECTING` 开始连接，不沿用禁用前的 endpoint 或桥接在线时间

### Requirement: 可捕获信号下终结性清理

系统 SHALL 在收到可捕获终止信号（SIGINT/SIGTERM）后清理其**自有** SSH 子进程、socket 与 timer，并且清理后不再启动新的子进程。不可捕获终止（SIGKILL/断电）不被宣称同步清理保证；重启后不得仅凭端口/命令行相似性猜测归属去杀进程。

#### Scenario: 清理后不得再 spawn
- **WHEN** 驾驶舱收到 SIGTERM 且已有自有 SSH 子进程运行
- **THEN** 系统终止这些子进程；且其重连循环不得再启动新的子进程，无 `ppid=1` 孤儿

#### Scenario: 只清理自有进程
- **WHEN** 存在用户自行建立的 SSH 隧道或其它 SSH 进程
- **THEN** 系统只终止其自有子进程，不误杀用户其他 SSH 连接

### Requirement: 设备本地转发端口在生命周期内保持稳定

系统 SHALL 把每台远端设备实际使用的本地转发端口持久化到设备注册记录，并在后续建立隧道时优先复用该端口，使工作台 iframe 的 origin（`http://127.0.0.1:<localPort>`）在设备生命周期内保持稳定，从而让该设备原生 DSH Web 的浏览器侧存储（`localStorage`、`sessionStorage` 及依赖 origin 的插件状态）跨重连、跨驾驶舱重启延续。

端口复用 MUST NOT 建立在「该端口仍然空闲」的假设之上：系统 SHALL 在每次复用前实际验证该端口当前可在 `127.0.0.1` 上绑定。验证失败时系统 SHALL 静默回退到内核分配的新端口并继续建立隧道；端口不可用 MUST NOT 使重连失败，也 MUST NOT 改变设备的状态分级。

验证与 OpenSSH 实际绑定之间存在竞态窗口。系统 SHALL 与既有的有界绑定重试机制协调而非绕过它：一次连接中 SHALL 至多用已持久化端口尝试一次，同一次连接的后续重试 SHALL 使用内核分配的新端口，使窗口内被抢占的情况降级为一次普通重试。重试次数上限保持不变，系统 MUST NOT 为端口复用引入无界重试。

系统 SHALL 仅在实际使用的端口与已持久化的值不同时写入注册表，且该写入 SHALL 复用既有的原子写盘与 fail-closed 校验路径。持久化失败 MUST NOT 中断已经建立的连接。

#### Scenario: 已持久化端口仍然可用
- **WHEN** 一台远端设备的注册记录中存有 `localPort`，且该端口在重连时可在 `127.0.0.1` 上绑定
- **THEN** 系统用该端口建立本地转发，工作台 endpoint 的 origin 与上一次连接一致，浏览器中该 origin 的既有存储得以延续

#### Scenario: 已持久化端口被其它进程占用
- **WHEN** 一台远端设备的注册记录中存有 `localPort`，但该端口在重连时已被其它进程占用
- **THEN** 系统回退到内核分配的新端口并正常完成重连，设备照常进入 `READY`/`DEGRADED`，不因端口占用被判为 `TUNNEL_ERROR`，并把新端口持久化为此后的首选端口

#### Scenario: 首次连接没有已持久化端口
- **WHEN** 一台远端设备从未连接过，或其注册记录中的 `localPort` 缺失、非整数或不在合法端口范围内
- **THEN** 系统按既有行为由内核分配端口，并在连接建立后把实际端口写入该设备的注册记录

#### Scenario: 复用端口在绑定窗口内被抢占
- **WHEN** 已持久化端口通过了可绑定验证，但 OpenSSH 实际绑定前该端口被其它进程抢占，导致本次尝试失败
- **THEN** 系统在既有有界重试次数内用内核分配的新端口重试并完成连接，MUST NOT 反复重试同一个已持久化端口

#### Scenario: 本机设备不涉及端口复用
- **WHEN** 一台 `local` 设备连接其本机 DSH
- **THEN** 系统直接使用其 `remoteDshPort` 作为 endpoint，不分配也不持久化转发端口，其 origin 本就稳定

### Requirement: 同一机群自动适配 rc.2 与 typert 协议
系统 SHALL 支持 rc.2 线（`0.1.1-rc.2`）与 typert 网关线（`0.1.2-rc.1` 起）的 DSH 设备并存。每台设备 SHALL 在连接建立时按响应形态自动选择适配器，MUST NOT 要求用户手工配置协议版本；选择结果只属于当前连接代，重连时 SHALL 重新确认，以适配设备原地升级。

除下文明确记录的 typert pending 来源边界外，typert 适配 SHALL 保持现有用户能力：原生工作台可用、连接状态可诊断、根会话运行状态及完成提醒可聚合、会话增删可到达、workspace 与归档集合可在重连后恢复。

#### Scenario: 两个版本族同时在线
- **WHEN** 机群同时包含 rc.2 与 typert 设备，且各自满足其官方连接前提
- **THEN** 系统为每台设备选择正确适配器，两类设备均可进入 `READY`/`DEGRADED` 并提供现有工作台与状态聚合能力

#### Scenario: 设备原地升级
- **WHEN** 一台原为 rc.2 的设备重启并升级到 `0.1.2` typert 线
- **THEN** 下一连接代重新确认协议并切换适配器，无需用户手工修改协议版本

#### Scenario: 非 DSH 的 401 服务
- **WHEN** 登记端口返回 401，但响应不满足 DSH 官方认证提示与交换协议
- **THEN** 系统不得仅凭 401 将其认作 typert DSH，并按既有非 DSH/不兼容诊断语义失败

### Requirement: typert waterfall 旁观订阅不得阻塞主机交互
Cockpit 为接收 typert `$events` 的 session emit 而收到任何 waterfall 帧时，SHALL 立即通过官方 `$events/result` endpoint 回复 `outcome.kind = 'next'`。Cockpit MUST NOT 持有该 delivery，MUST NOT 返回 `result` 或 `rejected`，MUST NOT 从请求内容推导或代替用户决定。

该放行与 bridge pending 观测 SHALL 相互独立：bridge 只读取官方 client 已发布的 pending snapshot，不注册 approval/question waterfall listener。

#### Scenario: 官方 UI 与 Cockpit 同时在线
- **WHEN** Cockpit 与设备官方 UI 同时订阅 typert Remote Events，Agent 发起审批或提问
- **THEN** Cockpit 立即放行自己的 delivery，官方 UI 仍按原流程显示并完成交互，等待时间不因 Cockpit 增加

#### Scenario: Cockpit 是唯一 Remote Events 客户端
- **WHEN** Cockpit 收到 waterfall 时没有其它浏览器客户端在线
- **THEN** Cockpit 回复 `next`，使请求继续走 DSH 原有的下一监听者或默认路径，其效果与没有 Cockpit 旁观订阅者一致

#### Scenario: waterfall 被取消或回复竞态
- **WHEN** cancel、断线或上游完成与 Cockpit 的 `next` 并发发生
- **THEN** Cockpit 幂等结束本地处理，不重试实质决定，也不因此残留或增加 pending 计数

### Requirement: typert 使用官方启动 URL完成最小认证握手
对要求浏览器会话认证的 typert 设备，系统 SHALL 接受用户粘贴该设备 `dsh web` 打印的官方启动 URL，从中校验并提取唯一 launch token，在当前设备 loopback endpoint 上执行 DSH 官方 `GET /?token=...` → signed cookie 交换。该机制仅用于恢复被 0.1.2 强制认证打断的 server API/WebSocket 访问与 iframe 加载。

系统 SHALL 只在 Cockpit 自有、权限收紧的设备存储中保存 token；MUST NOT 读取本机或远端 `~/.dsh`/日志来发现 token，MUST NOT 通过 SSH 执行发现命令，MUST NOT 建设账号密码、通用凭据或自动轮换协议。token 与交换得到的 cookie MUST NOT 出现在设备查询 API、`DeviceStatusFacts`、日志、诊断、错误正文或 iframe 完成交换后的干净 URL 中。

#### Scenario: 首次连接 typert 设备
- **WHEN** 设备呈现标准 DSH authentication-required 响应，且用户提供有效的官方启动 URL
- **THEN** server 在当前 endpoint 上换取 cookie，以该 cookie 完成协议确认、HTTP RPC 与 WebSocket upgrade，并进入正常连接生命周期

#### Scenario: 未提供或已失效的启动 URL
- **WHEN** typert 设备需要认证，但没有有效 launch token，或 DSH 重启使旧 token 失效
- **THEN** 设备保持不可用并给出“粘贴当前 dsh web 启动 URL”的可执行诊断；其它设备不受影响，系统不尝试自动读取 DSH 数据目录或日志

#### Scenario: endpoint authority 改变
- **WHEN** SSH 重连无法复用原 local port，但已保存的 launch token 对当前 DSH 进程仍有效
- **THEN** server 与 iframe 在新 authority 上重新执行官方交换，不尝试跨 authority 复用旧 cookie

#### Scenario: 更新或删除认证材料
- **WHEN** 用户提供新的启动 URL、显式清除认证材料或删除设备
- **THEN** 系统以新 token 替换旧 token，或清除对应持久及内存认证状态；任何读取接口均不回显旧值或新值
