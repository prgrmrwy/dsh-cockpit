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

系统 SHALL 为每台设备建立一条本地回环转发（`127.0.0.1:<localPort>` → 远端 DSH 端口）作为该设备的**主通道**，由驾驶舱分配并跟踪。系统 SHALL 支持同一台设备在主通道之外同时持有若干**附加通道**（其行为与准入由 `cockpit-device-port-forward` 规定）；主通道与附加通道 SHALL 被分别跟踪，MUST NOT 相互覆盖。系统 SHALL 优先使用 `DSH_COCKPIT_SSH_EXECUTABLE` 指定的单一 OpenSSH 可执行文件名或路径；未设置时 SHALL 把 `ssh` 作为可执行文件直接交给 Node.js `child_process.spawn` 并通过当前进程 `PATH` 查找，从而支持 Unix OpenSSH 与 Windows OpenSSH。SSH 进程 MUST 使用 `shell: false`，覆盖值 MUST NOT 被当作 shell 命令行解析。隧道 SHALL 使用系统 OpenSSH 配置（别名、`~/.ssh/config`、known_hosts、Agent、ProxyJump），并至少设置 `BatchMode`、`ExitOnForwardFailure` 与有界 keepalive。系统 MUST NOT 关闭 host-key 校验，MUST NOT 把密钥/口令暴露给模型或日志。

设备的状态分级 SHALL 只由主通道驱动。附加通道的建立失败或中途断开 MUST NOT 改变设备状态分级，也 MUST NOT 触发工作台重连。

#### Scenario: PATH 中发现平台 OpenSSH
- **WHEN** 未设置 SSH 覆盖且当前进程 PATH 包含平台提供的 `ssh` 或 `ssh.exe`
- **THEN** Node.js 直接启动所发现的 OpenSSH，身份验证与隧道保持既有参数及安全约束

#### Scenario: 使用显式 SSH 覆盖
- **WHEN** 用户设置 `DSH_COCKPIT_SSH_EXECUTABLE` 为有效的 OpenSSH 可执行文件名或路径
- **THEN** 身份验证与隧道一致使用该值，且不把值中的字符解释为 shell 参数

#### Scenario: SSH 可执行文件不可用
- **WHEN** SSH 覆盖无效或 PATH 中找不到 `ssh`
- **THEN** 远端设备连接失败并显示可操作的 SSH 命令发现诊断，不持久化未通过身份验证的新设备，且本机设备与驾驶舱 UI 仍可使用

#### Scenario: 本地端口被占用
- **WHEN** 驾驶舱分配的本地端口被其他进程占用于建立阶段
- **THEN** 系统重新分配候选端口并继续（有界重试），失败时把该设备的诊断归类为隧道错误

#### Scenario: 隧道建立成功但远端 DSH 未就绪
- **WHEN** 隧道打开但目标端口没有标准 DSH 服务
- **THEN** 系统不把该设备标记为可用，并在状态分级中归类为 `DSH_UNAVAILABLE` 或 `NON_DSH_SERVICE`；不假装就绪

#### Scenario: 同一设备并存主通道与附加通道
- **WHEN** 一台设备在主通道已就绪后建立了一条附加通道
- **THEN** 两条转发同时存在并被分别跟踪，主通道的 endpoint 与状态分级不受影响

#### Scenario: 附加通道断开不改变设备状态
- **WHEN** 某条附加通道中途断开而主通道仍然健康
- **THEN** 设备状态分级保持不变，工作台不重连，仅该附加通道被标记为不可用

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

系统 SHALL 把每台远端设备**主通道**实际使用的本地转发端口持久化到设备注册记录，并在后续建立隧道时优先复用该端口，使工作台 iframe 的 origin（`http://127.0.0.1:<localPort>`）在设备生命周期内保持稳定，从而让该设备原生 DSH Web 的浏览器侧存储（`localStorage`、`sessionStorage` 及依赖 origin 的插件状态）跨重连、跨驾驶舱重启延续。

本要求的稳定性保证 SHALL 只适用于主通道。附加通道的本地端口 SHALL 由内核分配，MUST NOT 被持久化，也 MUST NOT 享有跨重建稳定的保证。附加通道的生存期独立于主通道（见 `cockpit-device-port-forward`），主通道重连 MUST NOT 使其重新分配端口；只有附加条目自身重建（自愈、SSH 别名变更、设备重新启用、驾驶舱重启后重建常驻条目）时才取得新端口。新端口 SHALL 经转发表投影与 bridge 通知交付给持有者，消费方以最近一次交付的地址为准，因此不依赖端口稳定。

端口复用 MUST NOT 建立在「该端口仍然空闲」的假设之上：系统 SHALL 在每次复用前实际验证该端口当前可在 `127.0.0.1` 上绑定。验证失败时系统 SHALL 静默回退到内核分配的新端口并继续建立隧道；端口不可用 MUST NOT 使重连失败，也 MUST NOT 改变设备的状态分级。

验证与 OpenSSH 实际绑定之间存在竞态窗口。系统 SHALL 与既有的有界绑定重试机制协调而非绕过它，且 SHALL 按**上一次尝试失败的归因**决定后续尝试是否继续使用已持久化端口：

- 当失败可归因于该端口不可用时——预绑定验证失败，或 OpenSSH 因端口绑定/转发失败类原因退出——同一次连接的后续尝试 SHALL 改用内核分配的新端口，且 MUST NOT 再回退到该已持久化端口。
- 当失败与该端口的可用性无关时——例如 SSH 连接超时、主机不可达、认证失败、远端 DSH 尚未就绪，或其它非端口归因的提前退出——后续尝试 SHALL 继续使用该已持久化端口，使一次链路抖动不至于让设备 origin 永久漂移。
- 无法可靠归因的失败 SHALL 按「与端口无关」处理，即保留已持久化端口：稳定 origin 是该要求要保护的属性，误放弃它的代价高于多一次注定失败的重试。

重试次数上限保持不变，系统 MUST NOT 为端口复用引入无界重试，也 MUST NOT 因保留已持久化端口而延长单次连接的总尝试次数。

系统 SHALL 仅在实际使用的端口与已持久化的值不同时写入注册表，且该写入 SHALL 复用既有的原子写盘与 fail-closed 校验路径。持久化失败 MUST NOT 中断已经建立的连接。

设备注册记录 SHALL 以向后兼容的方式承载主通道端口：既有记录中的单数 `localPort` 字段 SHALL 在读取时被识别为主通道端口，MUST NOT 因为引入附加通道而使旧记录失效或丢失其稳定端口。

端口漂移 SHALL 可观测：当一次连接实际使用的本地转发端口与该设备已持久化的值不同时，系统 SHALL 记录一条包含设备标识、原端口、新端口与失败归因的告警级日志。端口持久化写入失败时系统 SHALL 同样记录告警。这些日志 MUST NOT 包含 SSH 密钥、口令或远端命令输出以外的敏感材料，且记录行为 MUST NOT 改变连接结果或设备状态分级。

#### Scenario: 已持久化端口仍然可用
- **WHEN** 一台远端设备的注册记录中存有主通道端口，且该端口在重连时可在 `127.0.0.1` 上绑定
- **THEN** 系统用该端口建立本地转发，工作台 endpoint 的 origin 与上一次连接一致，浏览器中该 origin 的既有存储得以延续

#### Scenario: 已持久化端口被其它进程占用
- **WHEN** 一台远端设备的注册记录中存有主通道端口，但该端口在重连时已被其它进程占用
- **THEN** 系统回退到内核分配的新端口并正常完成重连，设备照常进入 `READY`/`DEGRADED`，不因端口占用被判为 `TUNNEL_ERROR`，并把新端口持久化为此后的首选端口

#### Scenario: 首次连接没有已持久化端口
- **WHEN** 一台远端设备从未连接过，或其注册记录中的主通道端口缺失、非整数或不在合法端口范围内
- **THEN** 系统按既有行为由内核分配端口，并在连接建立后把实际端口写入该设备的注册记录

#### Scenario: 复用端口在绑定窗口内被抢占
- **WHEN** 已持久化端口通过了可绑定验证，但 OpenSSH 实际绑定前该端口被其它进程抢占，导致本次尝试因端口绑定失败而退出
- **THEN** 系统在既有有界重试次数内用内核分配的新端口重试并完成连接，MUST NOT 反复重试同一个已持久化端口

#### Scenario: 首次尝试因链路原因失败后仍保留已持久化端口
- **WHEN** 一台远端设备的注册记录中存有主通道端口，该端口通过了可绑定验证，但首次尝试因与端口无关的原因失败——例如 SSH 连接超时、主机暂时不可达或远端 DSH 尚未就绪
- **THEN** 系统在既有有界重试次数内**继续使用**该已持久化端口重试；重试成功后工作台 endpoint 的 origin 与上一次连接一致，该设备 DSH Web 的 origin 作用域存储不被重置

#### Scenario: 无法归因的提前退出保留已持久化端口
- **WHEN** OpenSSH 在 DSH readiness 之前退出，且其诊断输出不足以判定失败是否由端口不可用引起
- **THEN** 系统按「与端口无关」处理并在后续尝试中保留该已持久化端口，重试次数上限不变

#### Scenario: 端口漂移可从日志定位
- **WHEN** 一次连接最终使用的本地转发端口与该设备已持久化的值不同
- **THEN** 系统记录一条包含设备标识、原端口、新端口与失败归因的告警级日志，且该设备照常完成连接、状态分级不受影响

#### Scenario: 本机设备不涉及端口复用
- **WHEN** 一台 `local` 设备连接其本机 DSH
- **THEN** 系统直接使用其 `remoteDshPort` 作为 endpoint，不分配也不持久化转发端口，其 origin 本就稳定

#### Scenario: 附加通道端口不被持久化
- **GIVEN** 一台设备的附加条目 3939 以本地端口 P 就绪
- **WHEN** 主通道重连成功，随后 3939 的子进程意外退出并被自愈重建
- **THEN** 主通道重连前后 3939 仍使用端口 P、子进程不变；重建后 3939 使用内核分配的端口，且注册记录中不出现 3939 的任何本地端口，主通道端口的稳定性不受影响

#### Scenario: 旧记录的单数端口字段仍被识别
- **WHEN** 读取一条在本变更之前写入、只含单数 `localPort` 的设备记录
- **THEN** 系统把该值识别为主通道端口并照常复用，记录不因缺少附加通道信息而失效

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

对要求浏览器会话认证的typert设备，系统 SHALL接受用户粘贴官方启动URL，严格提取launch token，并在当前loopback endpoint执行官方token→signed cookie交换。交换验证 MUST要求303、干净Location、可解析到期时间，以及cookie名称精确等于当前endpoint authority的确定性名称；仅匹配通用前缀不足以建立authority。系统 SHALL把交换所得cookie/token保存于Cockpit自有0600原子存储，服务端连接优先复用尚未到期且被DSH接受的当前authority cookie。

系统 SHALL在公开事实中只暴露非敏感认证状态；token、cookie及可逆派生值 MUST NOT进入设备查询、SSE、日志、诊断或错误正文。

用户可按设备显式启用ohmydsh自动认证恢复。该授权 SHALL覆盖两个目的：(a) 服务端cookie/token都不能恢复连接；(b) 服务端cookie仍使设备READY，但浏览器工作台需要验证当前launch token而已存token因进程重启失效。两者只能读取固定标准 `$DSH_HOME/dsh.log`（本机）或通过既有BatchMode SSH执行固定、只读、有界命令（远端），从最新匹配登记端口的官方URL提取token；不得读取其它凭据/日志、扫描文件系统或写远端。未授权、来源失败或严格交换失败 SHALL回退人工粘贴且不影响服务端现有健康连接或其它设备。

浏览器启动验证与连接恢复 SHALL按 `(deviceId, endpoint authority, auth generation)`共享operation-owned单飞与有界服务端限频。共享工作不由任一HTTP请求或单一lifecycle调用者独占取消；设备禁用/删除或Cockpit关闭可取消，普通调用者离开只停止等待。结果提交必须经过auth generation与连接代fence；旧结果不得覆盖用户更新或新连接代。有效旧token的验证cookie每次可能不同，验证成功时 SHALL丢弃该临时cookie、不写盘、不增代；只有发现并接受新token时才CAS提交新token/cookie并增加generation。

Cockpit当前协议探测只能区分 `rc2 | typert`，没有兑换前可读取的版本/capability信号；因此所有当前被Cockpit识别为typert的受支持运行时 SHALL遵守已实测的“同一当前token可重复交换”兼容契约。本change不执行不可实现的运行时判别，也不定义 `workbench-auth-incompatible`分支。若未来typert改变此契约，必须先新增可在兑换前读取的capability并另开change；否则该运行时不属于本规范的受支持集合。

#### Scenario: 首次连接 typert 设备
- **GIVEN** endpoint呈现标准DSH认证挑战且用户提供有效官方启动URL
- **WHEN** Cockpit严格交换验证
- **THEN** 保存cookie/token并完成协议确认、HTTP RPC和WebSocket连接

#### Scenario: 普通 DSH 重启后复用已有 cookie
- **GIVEN** DSH重启产生新token但既有cookie仍适用于authority且被接受
- **WHEN** 服务端恢复连接
- **THEN** 优先复用cookie，不为服务端连接读取日志或要求用户操作

#### Scenario: cookie 到期但已保存 token 仍有效
- **GIVEN** cookie无效而已保存token仍被接受
- **WHEN** 服务端恢复连接
- **THEN** 严格交换并原子替换cookie，继续连接

#### Scenario: DSH 重启使旧 token 失效且自动恢复已授权
- **GIVEN** 服务端连接需要认证、cookie不可用、token失效且设备已授权恢复
- **WHEN** endpoint呈现标准挑战
- **THEN** 受限discovery取得当前token，严格交换并CAS替换材料

#### Scenario: 服务端cookie有效但新浏览器需要当前token
- **GIVEN** 设备READY、服务端cookie有效、已保存token因进程重启失效，且设备已授权自动恢复
- **WHEN** 浏览器工作台启动需要当前token
- **THEN** 同一受限discovery权限可用于取得并严格验证当前token；成功CAS提交新材料但不中断服务端现有连接，失败仅影响该浏览器启动

#### Scenario: 未提供或已失效的启动 URL
- **GIVEN** 无有效token且未成功恢复
- **WHEN** 服务端连接或浏览器启动需要认证
- **THEN** 返回对应稳定脱敏诊断/错误并要求人工粘贴，其它设备不受影响

#### Scenario: 自动发现来源不可用
- **GIVEN** 标准日志不存在、无匹配URL、SSH失败或输出非法
- **WHEN** 已授权恢复执行
- **THEN** 不尝试其它路径或宽泛扫描，记录不含输出/secret的失败原因并回退人工更新

#### Scenario: 自动恢复未授权
- **GIVEN** 服务端或浏览器工作台需要新token但设备未授权恢复
- **WHEN** 启动或重连执行
- **THEN** 不读取本机/远端日志，返回人工粘贴路径

#### Scenario: endpoint authority 改变
- **GIVEN** 重连无法复用local port
- **WHEN** 新authority建立
- **THEN** 不跨authority使用旧cookie，以有效token或已授权discovery新token严格交换

#### Scenario: 更新或删除认证材料
- **GIVEN** 用户提供新URL、清除材料或删除设备
- **WHEN** 操作提交
- **THEN** 新材料替换/清除旧持久及内存状态；在途旧验证/discovery不能CAS覆盖

#### Scenario: 查询设备认证状态
- **GIVEN** 用户查看设备
- **WHEN** API返回事实
- **THEN** 仅含非敏感配置/可用性/恢复/时间状态，无token/cookie

#### Scenario: 并发浏览器启动共享有界验证
- **GIVEN** 多个浏览器/标签同时请求同设备、同endpoint authority、同generation启动
- **WHEN** token验证或discovery进行
- **THEN** 服务端共享单飞并施加有界限频；调用者取消不终止其他等待者，设备停止可取消共享工作，最多一次新材料CAS提交

#### Scenario: 当前typert兼容契约
- **GIVEN** endpoint被Cockpit当前协议探测识别为受支持typert，且当前token有效
- **WHEN** 服务端先严格验证token、浏览器随后使用同一token交换
- **THEN** 两次交换均按受支持typert契约成功；实现不尝试从一次消费结果反推token语义
