## ADDED Requirements

### Requirement: 每台设备的转发表是其全部 SSH 转发的唯一真相源

驾驶舱 SHALL 为每台远端设备维护一张转发表。表中条目 SHALL 与该设备当前由驾驶舱拥有的 `ssh -L` 子进程一一对应，此外 MUST NOT 存在不入表的转发子进程。

**system 条目**

- 工作台主通道 SHALL 作为一条 `kind: system` 条目投影在表中。它 MUST NOT 被删除，也不计入附加条目上限。
- 其状态 SHALL 按设备状态映射：
  - `READY`、`DEGRADED` 映射为 `ready`，并带主通道子进程 pid；
  - `CONNECTING`、`SSH_UNREACHABLE`、`TUNNEL_ERROR`、`DSH_UNAVAILABLE` 映射为 `retrying`；
  - 其余状态映射为 `paused`。

**附加条目**

- 附加条目以设备端口为键。同一设备端口在一台设备上 SHALL 至多对应一条附加条目；多方申请同一端口时 SHALL 复用该条目，并按持有者计数。
- 每个附加条目 SHALL 至少暴露以下字段：设备端口、状态（`starting` / `ready` / `retrying` / `paused`）、是否常驻、可选标签、持有者标签与持有者数、最近一次失败的诊断，以及创建时间和最近一次状态变化的时间。
- 仅在 `ready` 时，条目额外暴露本地端口与子进程 pid。

**上限与并发**

- 每台设备的附加条目 SHALL 不超过 8 条，常驻条目与随持有者条目共享这一上限。超限请求 SHALL 以 `forward-limit` 拒绝。
- 上限检查与条目插入 SHALL 原子执行。
- 对同一（设备, 设备端口）的并发请求 SHALL 单飞：至多一次建立过程在进行中，后到的请求加入同一条目，MUST NOT 替换或打断进行中的建立。

**请求校验**

- 设备端口 SHALL 为 1–65535 的整数，否则以 `invalid-port` 拒绝。
- 设备端口 MUST NOT 等于该设备主通道的远端 DSH 端口，否则以 `reserved-port` 拒绝。
- 本机设备没有转发表，对它的任何转发请求 SHALL 以 `local-device` 拒绝。
- 任何被拒绝的请求 MUST NOT 启动子进程，也 MUST NOT 改变转发表。

#### Scenario: 表中列出主通道与附加条目
- **GIVEN** 一台 `READY` 的远端设备持有主通道，以及设备端口 5432 的一条已就绪附加条目
- **WHEN** 读取该设备的转发表投影
- **THEN** 投影恰含两条：
  - 一条为 `kind: system`、`state: ready`，pid 等于主通道子进程的 pid；
  - 一条为 `devicePort: 5432`、`state: ready`，pid 等于其子进程的 pid，且带本地端口。

#### Scenario: 同一设备端口复用条目且并发只建立一次
- **GIVEN** 设备端口 3939 没有条目
- **WHEN** 持有者 H1、H2 几乎同时申请 3939，之后 H1 以相同身份再次申请 3939
- **THEN** 只启动一次 ssh 建立过程，转发表只有一条 3939 条目，其持有者数为 2

#### Scenario: 并发申请不突破上限
- **GIVEN** 一台设备已有 7 条附加条目
- **WHEN** 针对两个不同新设备端口的申请并发到达
- **THEN** 恰有一个成功，另一个以 `forward-limit` 失败；附加条目数为 8，且只为成功的一方启动子进程

#### Scenario: 非法、保留端口与本机设备被拒绝
- **GIVEN** 一台主通道远端 DSH 端口为 3080 的远端设备，以及一台 `local` 设备
- **WHEN** 分别为远端设备申请端口 0、65536、3080，并为本机设备申请端口 3939
- **THEN** 请求依次以 `invalid-port`、`invalid-port`、`reserved-port`、`local-device` 失败，两台设备的转发表均不变，且不启动任何子进程

### Requirement: 附加条目只有常驻与随持有者两种寿命

附加条目 SHALL 在“常驻，或至少有一个持有者”时存续；两者皆无时，SHALL 被回收，即终止其子进程并从表中移除。系统 MUST NOT 使用 TTL、续约或基于时间的过期来决定单个持有者是否存续。

**常驻**

- 常驻条目只能由驾驶舱设备管理面板创建和删除，直到被删除为止都存续。
- 常驻标记与标签 SHALL 持久化到设备注册记录，本地端口 MUST NOT 持久化。
- 写盘失败时，创建或删除常驻条目的请求 SHALL 失败，内存中的转发表（含持有者与子进程）保持不变；创建失败时 MUST NOT 启动子进程。

**随持有者**

- 条目经 bridge 申请建立或复用。每个持有者由（驾驶舱页面标识, bridge 实例标识, 持有者标签）唯一确定。同一持有者对同一端口重复申请 SHALL 幂等。
- 持有者释放后 SHALL 被移除；释放一个未知的持有者 SHALL 成功，且不改变转发表。
- 持有者与随持有者条目 MUST NOT 持久化，驾驶舱重启后 MUST NOT 恢复。

**叠加与删除**

- 为一个已被持有的端口创建常驻时，SHALL 只追加常驻标记。
- 删除一个条目时，SHALL 同时移除其常驻标记与全部持有者，并终止子进程。
- 若删除发生在建立过程中，建立完成后新子进程 SHALL 被立即终止，条目 MUST NOT 重新出现。
- 删除一个不存在的条目 SHALL 成功（幂等）。

**设备禁用**

- 设备禁用时，其全部持有者 SHALL 被移除，常驻标记与标签 SHALL 保留。
- 设备重新启用后，常驻条目 SHALL 被重建。

#### Scenario: 持有者全部释放后回收，常驻条目不回收
- **GIVEN** 设备端口 3939 的非常驻条目有两个持有者 A、B；设备端口 5432 的常驻条目有一个持有者 C；两条均为 `ready`
- **WHEN** 依次释放 A、B、C，再释放一次 A
- **THEN** 释放 A 后，3939 仍为 `ready`，子进程存活；释放 B 后，3939 从表中移除，子进程被终止；释放 C 后，5432 仍在表中并保持 `ready`；重复释放 A 成功，且转发表不变

#### Scenario: 删除发生在建立过程中
- **GIVEN** 设备端口 3939 的常驻条目处于 `starting`，且有一个持有者
- **WHEN** 用户在面板删除该条目，随后建立过程完成
- **THEN** 新启动的子进程被立即终止；转发表与注册记录中都不出现 3939

#### Scenario: 驾驶舱重启后只恢复常驻条目
- **GIVEN** 设备有常驻条目 5432，以及只有持有者的条目 3939；驾驶舱正常退出后重启
- **WHEN** 该设备的主通道重新进入 `READY`
- **THEN** 5432 被重建并进入 `ready`；表中不存在 3939；注册记录中只有 5432 的常驻标记，不含任何本地端口

#### Scenario: 禁用设备丢弃持有者、保留常驻
- **GIVEN** 设备有常驻条目 5432，以及只有持有者的条目 3939
- **WHEN** 该设备被禁用，之后重新启用并进入 `READY`
- **THEN** 禁用期间两条附加子进程都被终止；重新启用后 5432 被重建为 `ready`，3939 不再存在

### Requirement: 持有随所属 bridge 页面实例或驾驶舱页面结束而回收

系统 SHALL 在持有者所属的 bridge 页面实例结束，或其所属的驾驶舱页面断开超过宽限期时，移除这些持有者，且 MUST NOT 依赖计时续约来判定。

**标识**

- **格式**：bridge 实例标识与驾驶舱页面标识 SHALL 是不透明随机串。生成时至少含 128 位随机量，编码为 16–64 个 `[A-Za-z0-9_-]` 字符。
- **bridge 实例标识**：bridge SHALL 在以下时机生成新的实例标识，并在申请与释放时携带：
  - 每次 bridge effect 启动时（每次页面加载都会启动）；
  - `pageshow` 且 `event.persisted === true` 时（页面从 bfcache 恢复）。
  - 实例标识是一次性的：bridge 一旦为某个实例标识发出“实例结束”消息，MUST NOT 再以该标识申请或释放。
  - 换用新标识时，bridge SHALL 丢弃旧标识下的本地持有记录，并以 `removed` 通知这些持有者。
- **驾驶舱页面标识**：驾驶舱 web SHALL 在每次页面加载时生成页面标识。它以查询参数 `page` 订阅设备状态流，并在请求签发 bridge 能力串时携带页面标识。
  - 签发请求缺少页面标识或格式不合规时，驾驶舱 SHALL 以 HTTP 400 拒绝，`code` 为 `invalid-page`，且不签发能力串。
  - 驾驶舱 SHALL 把页面标识写入该能力串的授权记录。授权记录缺少页面标识的能力串 SHALL 视为无效。
  - 申请时，持有者的驾驶舱页面标识 SHALL 取自所用能力串的授权记录，MUST NOT 取自请求体。
  - 设备状态流请求缺少 `page` 参数或参数值不合规时，驾驶舱 SHALL 照常推送，但该连接 MUST NOT 计入任何页面标识的连接数。

**实例结束**

- bridge SHALL 在 `pagehide` 以及自身 dispose 时，向驾驶舱父页面发送“实例结束”消息，消息携带实例标识，`targetOrigin` 为已握手的驾驶舱 origin。
- 父页面 SHALL 按 `event.source` 判定消息归属：只接受 `event.source` 为某台设备工作台 iframe 窗口的消息，并将其归属到该设备。
  - `event.origin` SHALL 属于该 iframe 当前或此前加载过的设备 origin。
  - 父页面按设备记录已向该 iframe 下发过 bridge 配置的 origin 集合；该 iframe 卸载或设备被移除时，集合清空。
- 接受后，父页面 SHALL 以驾驶舱 cookie 调用该设备的“释放实例”端点，携带实例标识和自身页面标识。驾驶舱 SHALL 移除该设备上属于该实例标识的全部持有者。
- 驾驶舱 SHALL 把该实例标识记入该页面标识的“已结束实例”集合。
  - 此后，若申请所用能力串属于该页面标识，且申请携带的是该实例标识，申请 SHALL 以 `invalid-holder` 拒绝。
  - 该集合 MUST NOT 按时间过期，SHALL 在该页面标识的宽限回收时一并清除。

**驾驶舱页面断开**

- 驾驶舱 SHALL 按页面标识统计设备状态流的连接数。
- 某个页面标识的连接数降为 0 时，SHALL 启动 30 秒宽限期：
  - 宽限期内该页面标识重新连接，SHALL 取消回收；
  - 宽限期结束时连接数仍为 0，SHALL 移除全部设备上属于该页面标识的持有者，并清除其已结束实例集合。
- 申请时，若该页面标识当前没有任何连接，同样 SHALL 启动宽限期。

**漏网的持有**

未能经上述途径回收的持有，例如 iframe 崩溃时没有触发 `pagehide`，SHALL 在转发表中可见，并可在驾驶舱面板删除。

#### Scenario: 设备页面重载后旧实例的持有被释放
- **GIVEN** 设备 A 的 bridge 实例 I1 持有 3939 的唯一持有者，条目非常驻
- **WHEN** 设备 A 的 DSH 页面在 iframe 内重载，bridge 在 `pagehide` 时向父页面发送携带 I1 的实例结束消息
- **THEN** 父页面调用设备 A 的释放实例端点；3939 条目被回收，子进程被终止

#### Scenario: 主通道端口漂移后，旧实例的结束消息仍被接受
- **GIVEN** 设备 A 的 iframe 以 origin O1 加载，实例 I1 持有 3939 的唯一持有者，条目非常驻
- **WHEN** 主通道端口漂移，父页面把该 iframe 导航到新 origin O2；旧文档在 `pagehide` 时从 O1 发出携带 I1 的实例结束消息
- **THEN** 父页面接受该消息，因为其 `event.source` 是设备 A 的 iframe 窗口，且 O1 在 A 已加载过的 origin 集合中；随后调用设备 A 的释放实例端点，3939 条目被回收

#### Scenario: 非所属来源的实例结束消息被忽略
- **GIVEN** 设备 A 的实例 I1 持有 3939
- **WHEN** 父页面收到携带 I1 的实例结束消息，但满足以下任一情况：其 `event.source` 不是设备 A 的 iframe 窗口；或其 `event.origin` 从未被设备 A 的 iframe 加载过
- **THEN** 父页面不发起释放请求，3939 条目与其持有者不变

#### Scenario: 释放实例先于同实例的在途申请到达
- **GIVEN** 驾驶舱页面 P 中，设备 A 的实例 I1 已发出对 3939 的申请，但请求尚未到达驾驶舱；3939 没有条目
- **WHEN** 父页面为 I1 发出的释放实例请求先到达，随后该申请到达
- **THEN** 申请以 `invalid-holder` 被拒绝；3939 不出现在转发表中，也不启动子进程

#### Scenario: 驾驶舱页面关闭后宽限期满回收
- **GIVEN** 页面标识为 P 的驾驶舱页面是唯一连接，经其 iframe 持有 3939 的唯一持有者
- **WHEN** 该页面被关闭，其设备状态流连接断开，此后 30 秒内 P 没有重新连接
- **THEN** 宽限期满后该持有者被移除，3939 条目被回收，子进程被终止

#### Scenario: 设备状态流短暂断线，宽限期内重连不触发回收
- **GIVEN** 驾驶舱页面 P 经其 iframe 持有 3939，子进程 pid 为 X
- **WHEN** 页面 P 的设备状态流断开，并在 5 秒内以同一页面标识重新连接
- **THEN** 该持有者不被移除，3939 条目仍为 `ready`，pid 仍为 X

#### Scenario: 设备页面经 bfcache 恢复后以新实例标识申请
- **GIVEN** 设备 A 的 bridge 以实例标识 I1 持有 3939 的唯一持有者，条目非常驻
- **WHEN** 页面进入 bfcache：`pagehide` 时 bridge 发出携带 I1 的实例结束消息，父页面释放 I1。随后页面经 `pageshow`（`event.persisted === true`）恢复，消费方再次申请 3939
- **THEN** I1 的持有已被移除，消费方收到 `removed`；bridge 以新的实例标识 I2 发出申请，申请成功，不因 I1 已结束而被拒绝

#### Scenario: 请求体中的页面标识被忽略
- **GIVEN** 能力串 C 由页面 P1 请求签发
- **WHEN** bridge 以 C 发起申请，且请求体额外携带页面标识 P2
- **THEN** 新持有者归属于 P1；P2 断开宽限期满时，该持有者不被移除

#### Scenario: 签发请求缺少页面标识被拒绝，无页面标识的状态流不计数
- **GIVEN** 页面 P 以带 `page=P` 的唯一一条设备状态流连接，经其 iframe 持有 3939 的唯一持有者
- **WHEN** 驾驶舱 web 发出不带页面标识的能力串签发请求；另有一条不带 `page` 参数的设备状态流连接建立并保持；之后 P 的连接断开满 30 秒
- **THEN**
  - 签发请求返回 400，`code` 为 `invalid-page`，且不签发能力串；
  - 不带 `page` 参数的连接照常收到设备状态推送；
  - P 的持有者照常被移除，3939 条目被回收

### Requirement: 附加条目按期望状态自愈，且只在就绪时交付地址

转发表 SHALL 被视为期望状态，系统 SHALL 持续把实际子进程收敛到它。

**建立与重建**

- 新条目创建后 SHALL 立即返回，建立在后台进行，条目初始状态为 `starting`。
- 建立失败，或子进程在就绪后意外退出时，条目 SHALL 置为 `retrying` 并记录诊断，然后按有界抖动退避重建：首次约 1 秒，逐次加倍，上限 60 秒。只要条目存续，重建就一直进行。
- 本地端口 SHALL 在每次建立时由内核分配，可能与上一次不同。

**主通道不可用**

- 设备主通道不处于 `READY` / `DEGRADED` 期间，系统 MUST NOT 为附加条目启动新的子进程；需要新建或重建的条目 SHALL 置为 `paused`，待主通道恢复后重建。
- 仍在运行的附加子进程 SHALL 继续运行，并保持 `ready`。

**SSH 别名变更**

- 设备的 SSH 别名编辑保存成功后，系统 SHALL 替换主通道连接，改用新别名。同时 SHALL 终止全部附加子进程，并把附加条目置为 `paused`。
- 主通道以新别名进入 `READY` / `DEGRADED` 后，附加条目 SHALL 按期望状态重建。
- 系统 MUST NOT 出现附加转发与主通道指向不同主机的状态。

**地址交付**

- 系统 SHALL 只在条目为 `ready` 时交付本地地址，MUST NOT 交付已知指向已退出子进程的地址。
- `ready` SHALL 只表示 ssh 子进程正在监听，系统 MUST NOT 据此声称目标服务可用。

#### Scenario: 转发中途断开后自动重建，期间不交付地址
- **GIVEN** 设备端口 3939 的条目为 `ready`，主通道健康
- **WHEN** 该条目的 ssh 子进程意外退出
- **THEN** 条目进入 `retrying` 并带诊断，此时投影与快照中都不含其本地端口；退避后启动新的子进程，条目回到 `ready`；设备状态分级与工作台均不受影响

#### Scenario: 主通道断开期间不重建附加条目
- **GIVEN** 设备主通道处于退避重连中，附加条目 3939 的子进程随后意外退出
- **WHEN** 退避期间经过多个自愈间隔
- **THEN** 3939 为 `paused`，且没有启动新的子进程；主通道恢复 `READY` 后，3939 被重建并变为 `ready`

#### Scenario: 主通道断开不终止仍存活的附加转发
- **GIVEN** 设备端口 5432 的附加条目为 `ready`，子进程 pid 为 X
- **WHEN** 远端 DSH 重启导致主通道进入重连，而 5432 的子进程没有退出
- **THEN** 5432 保持 `ready`，pid 仍为 X

#### Scenario: 编辑 SSH 别名后附加转发改连新主机
- **GIVEN** 设备以别名 `vm-a` 持有 `ready` 的附加条目 3939，子进程 pid 为 X
- **WHEN** 用户把该设备的 SSH 别名改为 `vm-b` 并保存成功
- **THEN** pid 为 X 的子进程被终止，3939 变为 `paused`；主通道以 `vm-b` 进入 `READY` 后，3939 以使用 `vm-b` 的新子进程重建，持有者数不变；在此之前，不存在以 `vm-b` 建立、而主通道仍连着 `vm-a` 的附加子进程

### Requirement: bridge 提供转发申请接缝 `cockpitBridge.forwards`

驾驶舱 SHALL 经 bridge 插件向设备 DSH 页面提供完整服务名为 `cockpitBridge.forwards` 的接缝。该名字是跨仓契约，变更它属于 breaking change。接缝 SHALL 在 bridge fiber 生命周期内立即提供，面向任意同页面插件，MUST NOT 命名或假设任何具体消费方。

**操作**

作用对象恒为调用页面所在的设备，即所用能力串授权记录中的设备；授权记录的 origin 必须等于请求 `Origin`。调用方 MUST NOT 指定其他设备。

- **申请**：参数为设备端口与持有者标签。申请 SHALL 在建立完成前返回当时的状态；条目为 `ready` 时，返回值同时包含地址。
- **释放**：释放该持有者。
- **列出**：返回最近一次收到的本设备转发表快照。
- **订阅**：订阅转发表变化。

接缝 MUST NOT 提供创建常驻、删除条目或作用于其他持有者的操作。

**通知**

- 持有者所持条目的状态或本地端口相对上次交付发生变化时，bridge SHALL 通知该持有者当前状态；条目为 `ready` 时，通知 SHALL 附带新地址。
- 条目从快照中消失时，bridge SHALL 以 `removed` 通知其持有者，并丢弃本地持有记录，MUST NOT 自动重新申请。

**地址形式**

地址 SHALL 由宿主机回环地址 `127.0.0.1` 与本地端口组成，并同时提供 `http://` URL 形式。

**不可用**

握手未完成，或页面不在驾驶舱 iframe 中时，接缝 SHALL 同步抛出稳定的“不可用”错误，使消费方回落到本机行为。能力串有效但其设备当前没有主通道端点时，申请 SHALL 以 `device-unavailable` 失败，bridge 不为此换发能力串；释放不受主通道影响。

#### Scenario: 申请立即返回，就绪后通知地址
- **GIVEN** bridge 已握手，设备端口 3939 没有条目
- **WHEN** 消费方以持有者标签 `memex-browse:default` 申请 3939
- **THEN** 申请在建立完成前返回，状态为 `starting` 且不含地址；条目就绪后，消费方收到状态为 `ready` 的通知，地址为 `127.0.0.1:<localPort>`，并附对应的 `http://` URL

#### Scenario: 条目被删除后持有者收到 removed，且不自动重新申请
- **GIVEN** 消费方持有 3939，并订阅了通知
- **WHEN** 用户在驾驶舱面板删除该条目，父页面推送不含 3939 的快照
- **THEN** 消费方收到 `removed` 通知；此后 60 秒观测窗口内，bridge 不为 3939 发起申请请求

#### Scenario: 地址变化时通知持有者
- **GIVEN** 消费方持有 3939，上次交付的本地端口为 P1
- **WHEN** 条目自愈重建后，本地端口变为 P2
- **THEN** 消费方先收到 `retrying` 通知，再收到地址为 `127.0.0.1:P2` 的 `ready` 通知

#### Scenario: 不在驾驶舱中时接缝不可用
- **GIVEN** 设备 DSH 页面并非运行在驾驶舱 iframe 中，bridge 从未收到握手配置
- **WHEN** 消费方调用申请
- **THEN** 调用同步抛出“不可用”错误，不发起任何网络请求

### Requirement: 驾驶舱父页面向设备页面推送转发表快照

驾驶舱父页面 SHALL 经既有 iframe `postMessage` 通道，向每台设备的工作台 iframe 推送该设备的转发表快照。

**推送时机**

- 每次向该 iframe 发送 bridge 配置消息后，SHALL 立即推送一次快照。
- 此后，每当该设备的转发表投影发生变化，SHALL 推送一次。

**targetOrigin**

推送的 `targetOrigin` MUST 精确等于该设备 iframe 的 origin，MUST NOT 使用 `*`。

**内容**

快照 MUST NOT 包含宿主机 ssh 子进程的 pid，设备页面不需要它。

**bridge 侧**

- bridge SHALL 只接受 `event.origin` 等于已握手驾驶舱 origin 的快照消息。
- bridge MUST NOT 轮询驾驶舱来获取转发表。

#### Scenario: 配置下发后及转发表变化时推送到对应设备
- **GIVEN** 设备 A、B 的工作台 iframe 均已挂载，设备 A 有一条附加条目
- **WHEN** 父页面向 A 的 iframe 发送 bridge 配置消息，之后设备 A 又新增一条附加条目
- **THEN** 父页面在配置消息之后，立即向 A 推送含第一条条目的快照；新增条目后，再推送含两条条目的快照；两次推送的 targetOrigin 均为 A 的 origin；B 的 iframe 不收到含 A 转发表的消息

#### Scenario: 伪造来源的快照消息被忽略
- **GIVEN** bridge 已与驾驶舱 origin O 握手
- **WHEN** 页面收到一条来自非 O 来源的转发表快照消息
- **THEN** bridge 忽略该消息，列出结果与订阅者都不受影响

### Requirement: 转发表的投影、标签与诊断受数据卫生约束

跨越信任边界流转的标签、诊断与标识，系统 SHALL 按以下约束处理。

**标签**

- 持有者标签与条目标签 SHALL 为 1 至 64 个字符，每个字符 SHALL 属于可打印 ASCII（`0x20`–`0x7E`）。
- 不合规的持有者标签或实例标识 SHALL 以 `invalid-holder` 拒绝，不合规的条目标签 SHALL 以 `invalid-label` 拒绝。

**诊断**

- 条目诊断来自 ssh stderr，属于不可信输入，SHALL 截断到至多 300 字符。
- 驾驶舱面板与 DSH 设置区块 SHALL 仅以纯文本渲染标签与诊断，MUST NOT 将其解析为 HTML。

**标识**

bridge 实例标识与驾驶舱页面标识 MUST NOT 出现在以下任何位置：转发表投影、设备状态流、iframe 快照、日志。投影只暴露持有者标签与持有者数。

#### Scenario: 投影不含实例与页面标识
- **GIVEN** 实例标识为 I1、页面标识为 P1 的持有者，以标签 `memex-browse:default` 持有 3939
- **WHEN** 读取设备状态流中的转发表投影、iframe 快照与驾驶舱日志
- **THEN** 三者都包含 `memex-browse:default` 与持有者数 1，且都不包含 I1 或 P1 的字符串

#### Scenario: 非法标签被拒绝，超长诊断被截断
- **GIVEN** 一台附加条目占用为 `0 / 8` 的远端设备
- **WHEN** 以含换行符的持有者标签申请 3939；以 65 个字符的标签创建常驻条目 5432；另一条目的 ssh 子进程输出 5000 个字符的 stderr 后退出
- **THEN** 申请以 `invalid-holder` 失败，创建以 `invalid-label` 失败，两者都不改变转发表；该条目记录的诊断长度不超过 300 个字符

### Requirement: 转发表管理端点仅供驾驶舱自身页面使用

驾驶舱 SHALL 提供以下转发表管理端点：为设备创建常驻条目、删除条目、按实例标识释放持有者。这些端点 SHALL 要求驾驶舱既有的 HttpOnly token，并 SHALL 受 `cockpit-api-auth` 的同源校验约束。

- 这些端点 MUST NOT 被列为 bridge 回调路由，也 MUST NOT 接受以 bridge 能力串替代驾驶舱 token 的认证。
- 被拒绝时 MUST NOT 改变转发表，也 MUST NOT 启动子进程。

#### Scenario: 驾驶舱页面创建常驻条目
- **GIVEN** 驾驶舱自身页面持有有效 token，设备附加条目占用为 `0 / 8`
- **WHEN** 它以驾驶舱 origin 为设备端口 6379 调用创建常驻端点
- **THEN** 请求成功；转发表新增常驻的 6379 条目，注册记录写入其常驻标记

#### Scenario: 只携带能力串的请求不能使用管理端点
- **GIVEN** 一个只携带有效 bridge 能力串、不携带驾驶舱 token 的请求
- **WHEN** 该请求调用创建常驻或删除端点
- **THEN** 请求按 `cockpit-api-auth` 的规则被拒绝；转发表不变，不启动子进程

### Requirement: bridge 在 DSH 设置页只读呈现本设备转发清单

bridge SHALL 在设备 DSH 的设置页注册一个只读的“驾驶舱转发”区块。settings 插槽 SHALL 作为可选协作者：它缺席时，bridge 的其它能力不受影响。

- 区块 SHALL 列出本设备转发表的全部条目，每条显示：设备端口与本地地址、状态、是否常驻、标签与持有者标签、最近一次失败的诊断（如有）。
- 区块 SHALL 显示附加条目占用 `N / 8`。
- 数据 SHALL 来自父页面推送的快照。
- 区块 MUST NOT 呈现创建、删除或释放控件，可提示“在驾驶舱设备面板中管理”。
- 页面不在驾驶舱中，或设备为本机设备时，区块 SHALL 显示相应说明。

#### Scenario: 设置页列出转发
- **GIVEN** bridge 已握手，设备有主通道，以及一条 `ready` 的随持有者条目 3939
- **WHEN** 用户打开 DSH 设置页的“驾驶舱转发”区块
- **THEN** 区块显示两行（system 条目，以及 3939 的状态、持有者标签和非常驻标识）和占用 `1 / 8`，且不含任何创建或删除控件

#### Scenario: 不在驾驶舱中时显示说明
- **GIVEN** 设备 DSH 页面未运行在驾驶舱 iframe 中
- **WHEN** 用户打开该区块
- **THEN** 区块显示“未连接驾驶舱”，不显示任何条目

## MODIFIED Requirements

### Requirement: 附加转发只在宿主机回环监听并随设备生命周期回收

附加转发 SHALL 建立为 `127.0.0.1:<localPort>` → 设备上 `127.0.0.1:<devicePort>` 的本地回环转发，并沿用主通道既有的 OpenSSH 调用约束：`shell: false`、`BatchMode`、`ExitOnForwardFailure`、有界 keepalive、不关闭 host-key 校验、不泄露密钥口令。附加转发 MUST NOT 监听非回环地址，其设备侧目标 MUST 恒为 `127.0.0.1`。

**所有权**

附加转发由按设备持有的转发表拥有，其生存期独立于任何一次连接生命周期实例。

**设备级终结**

- 设备禁用、设备删除或驾驶舱收到可捕获终止信号时，系统 SHALL 终止该设备的全部附加转发子进程，此后不再为其启动新的子进程。
- 禁用时，常驻条目按“附加条目只有常驻与随持有者两种寿命”保留；删除时，全部条目随设备记录一并移除。

**主通道替换不影响附加转发**

- 主通道的任何重建或连接替换 MUST NOT 终止附加转发子进程，包括手动重连、退避重连、端口漂移，以及因认证材料（启动 URL）或自动恢复设置变更导致的连接替换。
- 附加转发只在以下情况下被终止：自身寿命结束、自愈重建、SSH 别名变更，或上述设备级终结。

**不猜测归属**

系统 MUST NOT 依据端口或命令行的相似性猜测归属，去杀非自有进程。

**故障隔离**

一条附加转发建立失败或中途断开，SHALL NOT 改变设备的状态分级，也 SHALL NOT 触发工作台重连。

#### Scenario: 设备禁用时终止全部附加转发
- **GIVEN** 一台设备持有常驻条目 5432 与随持有者条目 3939，二者均为 `ready`
- **WHEN** 该设备被禁用
- **THEN** 主通道与两条附加转发的子进程全部终止；禁用期间不启动新的子进程；注册记录仍含 5432 的常驻标记

#### Scenario: 主通道重连或认证更新不影响附加转发
- **GIVEN** 设备端口 3939 的附加条目为 `ready`，子进程 pid 为 X
- **WHEN** 用户对该设备请求手动重连并成功，随后又为其粘贴新的 DSH 启动 URL 并保存成功
- **THEN** 主通道按既有规则被重建和替换；附加条目始终为 `ready`，pid 仍为 X

#### Scenario: 驾驶舱退出时清理自有转发
- **GIVEN** 驾驶舱持有若干设备的主通道与附加转发子进程
- **WHEN** 驾驶舱收到 SIGINT 或 SIGTERM
- **THEN** 系统在有界时间内终止全部自有子进程，不遗留 `ppid=1` 孤儿，也不终止非自有的 SSH 进程

### Requirement: 端口发布请求须经既有 capability 校验

bridge 发起的转发请求 SHALL 沿用既有 bridge 调用的认证与来源约束：短 TTL 的能力串经请求头传递，驾驶舱 SHALL 校验该能力串，并按 `Origin` 匹配设备。

**bridge 回调路由**

- `POST /api/bridge/forwards/acquire` 与 `POST /api/bridge/forwards/release` SHALL 作为 bridge 回调路由，列入 `cockpit-api-auth` 的 requirement“bridge 回调路由名单”。
  - 该名单以那条 requirement 为唯一权威来源，本 capability MUST NOT 另行声明名单。
  - 本 change 对该 requirement 的 MODIFIED 见 `specs/cockpit-api-auth/spec.md`。
- 这两条路由 SHALL 要求携带能力串，并由接缝端点自身拒绝缺少能力串的请求，返回 401 `unauthorized`：
  - 即使请求携带有效的驾驶舱 cookie、已通过 `cockpit-api-auth` 的来源校验，也照样拒绝；
  - 端点 MUST NOT 以驾驶舱 cookie 替代能力串；
  - 这项检查 SHALL 先于其它任何校验。

**拒绝**

- forwards 端点 SHALL 按以下顺序判定，命中即返回：
  1. 缺少能力串头：返回 401 `unauthorized`。
  2. 能力串不存在或已过期，或者授权记录的 origin 不等于请求 `Origin`：返回 400 `bridge-capability-invalid`。
     - 这一步只依据授权记录本身判定，MUST NOT 依赖设备主通道端点。
     - 因此不对应任何在线设备的 origin 带无效能力串时，同样得到 400。
  3. 仅对申请：能力串有效，但授权记录中的设备当前没有主通道端点，返回 409 `device-unavailable`。
  4. 其余业务校验。
- 释放 SHALL 按授权记录中的设备定位转发表。设备主通道不可用时，释放 SHALL 照常移除持有者。
- 业务拒绝 SHALL 以 HTTP 409 返回，响应体含稳定的 `code` 字段，取值为：`forward-limit`、`reserved-port`、`invalid-port`、`invalid-holder`、`invalid-label`、`local-device`、`device-unavailable`。
- bridge 对 409 SHALL 不换发能力串、不重试，并把 `code` 原样交给调用方。
- 任何拒绝都 MUST NOT 改变转发表。

**边界**

- 这些接缝 MUST NOT 被用于代理任意 DSH RPC、Settings、credentials 或任何应用层协议。
- 驾驶舱在被转发的数据路径之外，MUST NOT 解析、重写或记录被转发的流量内容。

#### Scenario: 能力串无效时以既有响应拒绝
- **GIVEN** 一个已过期、已被撤销，或者授权记录 origin 与请求 `Origin` 不匹配的能力串
- **WHEN** 以该能力串调用 `/api/bridge/forwards/acquire`
- **THEN** 驾驶舱返回 400，错误码为 `bridge-capability-invalid`；转发表不变，不启动子进程

#### Scenario: 不对应在线设备的 origin 带无效能力串返回 400
- **GIVEN** 回环 origin `http://127.0.0.1:47999` 不对应任何有主通道端点的设备
- **WHEN** 来自该 origin 的请求带一个不存在的能力串，调用 `/api/bridge/forwards/acquire`
- **THEN** 驾驶舱返回 400 `bridge-capability-invalid`，而不是 409 `device-unavailable`；转发表不变

#### Scenario: 主通道断开期间释放照常生效
- **GIVEN** 设备 A 的持有者 H 以有效能力串持有非常驻条目 3939，随后 A 的主通道断开并进入重连
- **WHEN** bridge 在主通道恢复前，以同一能力串调用 `/api/bridge/forwards/release` 释放 H
- **THEN** 请求成功，H 被移除；3939 不再有持有者，被回收，子进程被终止

#### Scenario: 同源页面只带 cookie 调用申请端点被拒绝
- **GIVEN** 驾驶舱自身页面持有有效的驾驶舱 cookie
- **WHEN** 它以驾驶舱 origin 调用 `/api/bridge/forwards/acquire`，请求带 cookie，但不带能力串请求头
- **THEN** 接缝端点返回 401 `unauthorized`；转发表不变，不启动子进程

#### Scenario: 业务拒绝不触发能力串换发
- **GIVEN** 设备已有 8 条附加条目，bridge 已握手
- **WHEN** bridge 为一个新端口发起申请
- **THEN** 驾驶舱返回 409，`code` 为 `forward-limit`；bridge 不换发能力串、不重发请求，调用方收到 `forward-limit`

#### Scenario: 驾驶舱不进入数据路径
- **GIVEN** 一条附加转发已建立，正被浏览器或数据库客户端使用
- **WHEN** 流量经过该转发
- **THEN** 流量经 SSH 直达设备端服务，驾驶舱进程不读取、不重写、也不记录其内容

## REMOVED Requirements

### Requirement: 端口发布须经设备侧登记，转发目标不可由消费方任意指定

**Reason**：本 change 推翻归档 change `device-port-forward-seam` 设计 D4 中“消费方不能传端口号，只能引用已登记项”的规则。D4 自己已经论证，登记与发布出自同一个可信页面上下文，登记挡不住一个想要任意端口的页面，只是让调用多一步。

边界改由以下结构性约束承担：
- 只转发设备的 `127.0.0.1:<port>`；
- 只在宿主机回环监听；
- 每个条目绑定单个端口；
- 每台设备上限 8 条；
- 按 `Origin` 限定本设备，并依赖前置 change `cockpit-api-same-origin` 保证设备页面不能带 cookie 调用设备管理 API；
- 全部条目可见、可删；
- 设备页面不能建立常驻条目，也不能删除任何条目。

**Migration**：消费方改为调用 `cockpitBridge.forwards` 的申请，直接传入设备端口，不再登记。

### Requirement: 驾驶舱为设备提供端口发布接缝

**Reason**：`cockpitBridge.portForward`（`register` + `publish`）与旧端点返回的 URL 是永久缓存。它不经过转发表，无法回收，而且会交付死地址。按照用户决定，不保留兼容层：bridge 0.6.0 直接以 `cockpitBridge.forwards` 替换它。

**Migration**：
- 同一版本同时删除 bridge 接缝 `cockpitBridge.portForward`，以及服务端端点 `/api/bridge/publishable-port`、`/api/bridge/publish-port`。
- 这两个端点随之退出 bridge 回调路由名单。
  - 本 change 以 MODIFIED 更新 `cockpit-api-auth` 的 requirement“bridge 回调路由名单”：移除这两条旧路由，加入 `/api/bridge/forwards/acquire` 与 `/api/bridge/forwards/release`。
  - 实现侧的 `isBridgeCallback` 名单同步更新。
- 唯一的下游是 ohmydsh 的 memex shim，由其下游 change 迁移到 `cockpitBridge.forwards`。
- 发布顺序为：驾驶舱与 bridge 0.6.0 同时发布，然后 ohmydsh 更新 pin 与 shim。
- 在这两步之间的窗口里，shim 会发现服务缺席并回落本机地址。
