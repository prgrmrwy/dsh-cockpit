## ADDED Requirements

### Requirement: 每台设备的转发表是其全部 SSH 转发的唯一真相源

驾驶舱 SHALL 为每台远端设备维护一张转发表。表中条目 SHALL 与该设备当前由驾驶舱拥有的 `ssh -L` 子进程一一对应，此外 MUST NOT 存在不入表的转发子进程。

**system 条目**

- 工作台主通道 SHALL 作为一条 `kind: system` 条目投影在表中。
- 该条目 MUST NOT 被删除、取消常驻，也不计入附加条目上限。
- 其状态 SHALL 由设备状态映射：
  - `READY`、`DEGRADED`：`ready`，并带主通道子进程 pid；
  - `CONNECTING`、`SSH_UNREACHABLE`、`TUNNEL_ERROR`、`DSH_UNAVAILABLE`：`retrying`；
  - `DISABLED`、`NON_DSH_SERVICE`、`INCOMPATIBLE`：`paused`。

**附加条目**

- 附加条目以设备端口为键，同一设备端口在一台设备上 SHALL 至多对应一条附加条目。
- 附加条目的设备端口 MUST NOT 等于该设备主通道的远端 DSH 端口。
- 若编辑设备，把其远端 DSH 端口改为某一现存附加条目的设备端口，该编辑 SHALL 以稳定原因 `forward-port-conflict` 被拒绝，且注册记录不变。

**条目字段**

每个附加条目 SHALL 至少暴露：

- 设备端口与本地端口；
- 是否常驻（`pinned`）及常驻来源（`cockpit` 或 `dsh`）；
- 可选标签；
- 租约数及各租约的持有者标签；
- 状态（`starting` / `ready` / `retrying` / `paused`）；
- 状态为 `ready` 时的子进程 pid；
- 最近一次失败的诊断；
- 创建时间与最近一次状态变化的时间。

**上限与并发**

- 每台设备的附加条目数 SHALL 不超过 8，该上限由所有来源共享。
- 超限请求 SHALL 以稳定原因 `forward-limit` 被拒绝，MUST NOT 启动子进程。
- 上限检查与条目插入 SHALL 原子执行。
- 对同一 (设备, 设备端口) 的并发请求 SHALL 单飞：至多一次建立过程在进行中，后到的请求加入同一条目，MUST NOT 替换或打断进行中的建立。

**本机设备**

本机设备 SHALL 没有转发表，对其的任何转发请求 SHALL 以稳定原因 `local-device` 被拒绝。

#### Scenario: 表中列出主通道与附加条目
- **GIVEN** 一台 `READY` 的远端设备持有主通道，以及设备端口 5432 的一条已就绪附加条目
- **WHEN** 读取该设备的转发表投影
- **THEN** 投影恰含两条：`kind: system`、`state: ready` 且 pid 等于主通道子进程 pid 的条目；`devicePort: 5432`、`state: ready` 且 pid 等于其子进程 pid 的条目

#### Scenario: 同一设备端口不产生第二个子进程
- **GIVEN** 设备端口 3939 已有一条附加条目
- **WHEN** 另一来源再次为设备端口 3939 申请转发
- **THEN** 转发表仍只有一条 3939 条目，其租约数加一，驾驶舱启动的 ssh 子进程数不变

#### Scenario: 并发申请同一端口只建立一次
- **GIVEN** 设备端口 3939 没有条目
- **WHEN** 两个申请几乎同时到达
- **THEN** 只启动一次 ssh 建立过程，两个申请各得一个租约并共享同一条目，两者都不因对方而失败

#### Scenario: 并发申请不突破上限
- **GIVEN** 一台设备已有 7 条附加条目
- **WHEN** 为两个不同的新设备端口的申请并发到达
- **THEN** 恰有一个成功、另一个以 `forward-limit` 失败，附加条目数为 8

#### Scenario: 超过上限被拒绝
- **GIVEN** 一台设备已有 8 条附加条目
- **WHEN** 任一来源为第 9 个不同的设备端口请求转发
- **THEN** 请求以 `forward-limit` 失败，转发表不变，且不启动 ssh 子进程

#### Scenario: 不允许为主通道端口建立附加条目
- **GIVEN** 设备主通道的远端 DSH 端口为 3080
- **WHEN** 任一来源为设备端口 3080 请求附加转发
- **THEN** 请求以 `reserved-port` 失败，不启动子进程

#### Scenario: 编辑远端 DSH 端口与附加条目冲突被拒绝
- **GIVEN** 设备端口 5432 有一条附加条目
- **WHEN** 用户把该设备的远端 DSH 端口编辑为 5432
- **THEN** 编辑以 `forward-port-conflict` 失败，注册记录与连接保持原状

#### Scenario: 非法端口被拒绝
- **GIVEN** 任一远端设备
- **WHEN** 请求的设备端口为 0、65536、非整数或非数字
- **THEN** 请求以 `invalid-port` 失败，不启动子进程

#### Scenario: 本机设备没有转发表
- **GIVEN** 一台 `local` 设备
- **WHEN** 对其请求建立任何转发
- **THEN** 请求以 `local-device` 失败，不启动子进程

### Requirement: 附加条目的寿命由常驻标记与租约共同决定

附加条目 SHALL 在“常驻，或至少持有一个租约”时存续，两者皆无时 SHALL 被回收，即终止其子进程并从表中移除。

**常驻**

- 常驻由手动创建设置，常驻来源记录发起方：驾驶舱面板为 `cockpit`，DSH 设置页或 bridge 为 `dsh`。常驻直到被删除或取消常驻为止。
- 对已常驻的端口再次创建常驻 SHALL 成功，且不改变其常驻来源。例外：来源为 `cockpit` 的创建常驻请求作用于来源为 `dsh` 的常驻条目时，SHALL 把其来源提升为 `cockpit`。
- 对未常驻的条目取消常驻 SHALL 成功，且不改变转发表。
- 取消常驻 SHALL 只移除常驻标记，仍持有租约的条目 SHALL 继续存续。

**租约**

- 租约由 bridge 申请创建。每个租约 SHALL 有驾驶舱签发的不可猜测标识、调用方提供的持有者标签，以及到期时间。
- 租约时长 SHALL 为 5 分钟，续约 SHALL 把到期时间重置为“当前时间 + 5 分钟”。
- 释放或到期 SHALL 移除该租约。释放未知租约 SHALL 成功，且不改变转发表（幂等）。
- 对同一设备端口的多次申请 SHALL 各得一个独立租约，并共享同一条目。

**主通道不可用时冻结租约计时**

- 设备主通道不处于 `READY`/`DEGRADED` 期间，系统 MUST NOT 因到期而移除该设备的任何租约。
- 主通道每次进入 `READY`/`DEGRADED` 时，该设备每个租约的到期时间 SHALL 被置为“原到期时间”与“进入时刻 + 5 分钟”两者中的较大值。
- 理由：主通道不可用时，bridge 在结构上无法续约，这种续约缺席不代表持有者已经消失。

**删除与撤销**

- 删除条目 SHALL 同时撤销其全部租约，删除不存在的条目 SHALL 成功（幂等）。
- 被撤销租约的续约 SHALL 以稳定原因 `revoked` 失败，MUST NOT 重新创建条目。
- 撤销记录 SHALL 在驾驶舱进程内至少保留 10 分钟，每台设备至多保留 64 条。
- 超出保留的撤销租约、驾驶舱重启后的撤销租约，其续约 SHALL 以 `lease-expired` 失败，同样 MUST NOT 重新创建条目。

**持久化**

- 常驻标记、常驻来源、标签、租约的标识与持有者标签、本地端口 SHALL 持久化到设备注册记录。
- 只有条目或租约集合发生变化时才写盘，续约 MUST NOT 触发写盘。
- 写盘失败时，引发该变化的请求 SHALL 以稳定原因 `persist-failed` 失败，内存中的转发表 SHALL 回滚到请求前的状态，且 MUST NOT 为该请求启动子进程。
- 例外：条目因租约到期被回收时写盘失败，子进程照常终止，失败记为告警；注册表中残留的租约在下次加载时按普通持久化租约恢复（按冻结规则获得“主通道首次可用时刻 + 5 分钟”），之后因无人续约而自然到期回收。
- 驾驶舱重启后，被持久化的租约 SHALL 按上述冻结规则恢复，即在主通道首次进入 `READY`/`DEGRADED` 时获得“该时刻 + 5 分钟”的到期时间。

**设备禁用**

- 设备禁用时，其全部租约 SHALL 被移除，常驻标记与标签 SHALL 保留，重新启用后常驻条目 SHALL 被重建。
- 理由：禁用会销毁该设备的工作台页面与能力串，持有者必然已经消失。

#### Scenario: 租约全部释放后回收
- **GIVEN** 设备端口 3939 的非常驻条目持有两个租约 A、B
- **WHEN** 先释放 A，再释放 B
- **THEN** 释放 A 后条目仍为 `ready` 且子进程存活；释放 B 后条目从表中移除，其子进程被终止

#### Scenario: 租约到期后回收
- **GIVEN** 设备主通道 `READY`，设备端口 3939 的非常驻条目只持有一个租约，此后再无续约
- **WHEN** 时间越过该租约的到期时间
- **THEN** 条目被回收，其子进程被终止

#### Scenario: 常驻条目不因租约归零而回收
- **GIVEN** 设备端口 5432 的条目为常驻，且持有一个租约
- **WHEN** 该租约被释放
- **THEN** 条目仍在表中且保持 `ready`

#### Scenario: 续约延长到期时间
- **GIVEN** 一个剩余 1 分钟到期的租约
- **WHEN** 持有者续约
- **THEN** 续约成功，该租约的到期时间变为续约时刻 + 5 分钟

#### Scenario: 主通道长时间断开期间租约不过期
- **GIVEN** 设备端口 3939 的非常驻条目持有一个租约，其子进程 pid 为 X
- **WHEN** 设备主通道断开 10 分钟后恢复 `READY`，期间没有任何续约
- **THEN** 断开期间该租约与条目均未被移除；恢复时刻 R 之后，该租约的到期时间不早于 R + 5 分钟；若 X 期间未退出，条目仍为 `ready` 且 pid 仍为 X

#### Scenario: 手动删除撤销租约且不被续约复活
- **GIVEN** 设备端口 3939 的条目持有租约 A
- **WHEN** 用户删除该条目，随后持有者以 A 续约
- **THEN** 条目被移除、子进程被终止；续约以 `revoked` 失败，转发表中不出现 3939 条目

#### Scenario: 驾驶舱重启后被撤销租约的续约不复活条目
- **GIVEN** 用户删除了持有租约 A 的 3939 条目，随后驾驶舱重启
- **WHEN** 持有者以 A 续约
- **THEN** 续约以 `lease-expired` 失败，转发表中不出现 3939 条目，不启动子进程

#### Scenario: 删除发生在建立过程中
- **GIVEN** 设备端口 3939 的条目处于 `starting`，持有租约 A
- **WHEN** 用户删除该条目，随后建立过程完成
- **THEN** 新启动的子进程被立即终止，条目不重新出现，A 的下一次续约以 `revoked` 失败

#### Scenario: 未知租约的续约与释放
- **GIVEN** 一个从未签发的租约标识
- **WHEN** 以该标识续约或释放
- **THEN** 续约以 `lease-expired` 失败，释放成功返回，两者均不改变转发表

#### Scenario: 写盘失败时回滚且不启动子进程
- **GIVEN** 注册表写盘必然失败，设备端口 6379 没有条目
- **WHEN** 驾驶舱面板为 6379 创建常驻条目
- **THEN** 请求以 `persist-failed` 失败，转发表中不出现 6379 条目，不启动子进程

#### Scenario: 驾驶舱面板提升 DSH 常驻来源
- **GIVEN** 设备端口 5432 为常驻条目，来源为 `dsh`
- **WHEN** 驾驶舱面板为 5432 创建常驻
- **THEN** 请求成功，5432 的常驻来源变为 `cockpit`，此后经 bridge 删除 5432 以 `managed-by-cockpit` 失败

#### Scenario: 常驻相关操作幂等
- **GIVEN** 设备端口 5432 的条目常驻、来源为 `cockpit`，设备端口 3939 的条目未常驻
- **WHEN** 经 bridge 对 5432 再次创建常驻，并对 3939 取消常驻
- **THEN** 两个请求都成功；5432 的常驻来源仍为 `cockpit`，3939 条目不变

#### Scenario: 驾驶舱重启后恢复常驻与租约
- **GIVEN** 设备端口 5432 为常驻条目，设备端口 3939 持有租约 A，此时驾驶舱正常退出并重启，重启后主通道在时刻 R 首次进入 `READY`（R 可晚于重启 5 分钟以上）
- **WHEN** 此后持有者以 A 续约
- **THEN** 两条条目均被重建；R 之前租约 A 未被移除；续约成功

#### Scenario: 禁用设备丢弃租约、保留常驻
- **GIVEN** 设备有常驻条目 5432 与只有租约的条目 3939
- **WHEN** 该设备被禁用后重新启用并进入 `READY`
- **THEN** 5432 被重建为 `ready`；3939 不再存在，注册记录中没有其租约

#### Scenario: 损坏的转发记录不阻塞设备
- **GIVEN** 设备注册记录中的转发字段含有非法条目（端口越界、租约缺少标识，或标签不符合字符集）
- **WHEN** 驾驶舱加载注册表
- **THEN** 非法条目被忽略并记录告警，该设备的主通道与其余合法条目照常建立，注册表不被整体判为损坏

### Requirement: 附加条目按期望状态自愈，且只在就绪时交付地址

转发表 SHALL 被视为期望状态。

**建立**

- 新条目创建后 SHALL 立即返回，并在后台建立，初始状态为 `starting`。
- 建立或重建失败时，条目 SHALL 置为 `retrying`，记录诊断，并按有界抖动退避重试：首次约 1 秒，逐次加倍，上限 60 秒。
- 只要条目存续，重试就 SHALL 继续。首次建立失败与之后的失败，处理方式 SHALL 相同。

**就绪后退出**

附加条目的子进程在就绪后意外退出时，系统 SHALL 按同一退避规则重建。

**主通道不可用**

- 设备主通道不处于 `READY`/`DEGRADED` 期间，系统 MUST NOT 为附加条目启动新的子进程，需要新建或重建的条目 SHALL 置为 `paused`，主通道恢复后 SHALL 重新建立。
- 仍在运行的附加子进程 SHALL 保持运行，并维持 `ready`。

**连接参数变更**

- 设备的 SSH 别名被编辑并保存成功后，系统 SHALL 替换该设备的主通道连接，使其改用新别名，与认证材料变更的替换方式相同。
- 同时，系统 SHALL 终止全部附加子进程，并把附加条目置为 `paused`。
- 主通道以新别名进入 `READY`/`DEGRADED` 后，附加条目 SHALL 以新别名按期望状态重建，常驻与租约不变。
- 系统 MUST NOT 出现附加转发与主通道指向不同主机的状态。
- 远端 DSH 端口的编辑与附加条目的申请、创建 SHALL 在该设备转发表的同一串行域内完成冲突检查。二者并发时，只能有一方成功。

**地址交付**

- 系统 SHALL 只在条目为 `ready` 时交付本地地址。
- 系统 MUST NOT 交付一个已知指向已退出子进程的地址。
- 状态 SHALL 只反映 ssh 子进程是否在监听，系统 MUST NOT 声称设备端口上的目标服务可用。

#### Scenario: 转发中途断开后自动重建
- **GIVEN** 设备端口 3939 的条目为 `ready`，主通道健康
- **WHEN** 该条目的 ssh 子进程意外退出
- **THEN** 条目进入 `retrying` 并记录诊断；退避后启动新的子进程并回到 `ready`，设备状态分级与工作台不受影响

#### Scenario: 断开期间不交付旧地址
- **GIVEN** 设备端口 3939 的条目处于 `retrying`
- **WHEN** 持有者续约或列出转发表
- **THEN** 应答中该条目不含可用地址

#### Scenario: 首次建立失败进入重试而不静默消失
- **GIVEN** 设备端口 3939 没有条目，且对该端口的 ssh 转发必然失败
- **WHEN** bridge 申请该端口
- **THEN** 申请成功返回租约，条目状态为 `starting`；此后条目变为 `retrying` 并带诊断，持有者收到状态变化通知；在租约释放或到期前，条目持续存在

#### Scenario: 主通道断开期间不重建附加条目
- **GIVEN** 设备主通道处于退避重连，附加条目 3939 的子进程随后意外退出
- **WHEN** 退避期间经过多个自愈间隔
- **THEN** 3939 条目为 `paused` 且未启动新的子进程；主通道恢复 `READY` 后 3939 被重建并变为 `ready`

#### Scenario: 主通道断开不终止仍存活的附加转发
- **GIVEN** 设备端口 5432 的附加条目为 `ready`，子进程 pid 为 X
- **WHEN** 远端 DSH 重启导致主通道进入重连，而 5432 的子进程未退出
- **THEN** 5432 条目保持 `ready`，pid 仍为 X

#### Scenario: 编辑 SSH 别名后附加转发改连新主机
- **GIVEN** 设备以别名 `vm-a` 持有 `ready` 的附加条目 3939，子进程 pid 为 X
- **WHEN** 用户把该设备的 SSH 别名编辑为 `vm-b` 并保存成功
- **THEN** pid 为 X 的子进程被终止，3939 变为 `paused`；主通道以 `vm-b` 进入 `READY` 后，3939 以新子进程重建，新子进程参数使用 `vm-b`；其租约数不变；在此之前不存在以 `vm-b` 建立、而主通道仍连 `vm-a` 的附加子进程

#### Scenario: 编辑远端 DSH 端口与申请同一端口并发
- **GIVEN** 设备远端 DSH 端口为 3080，端口 5000 尚无附加条目
- **WHEN** 把远端 DSH 端口改为 5000 的编辑，与对设备端口 5000 的申请并发到达
- **THEN** 恰有一方成功：编辑成功时申请以 `reserved-port` 失败；申请成功时编辑以 `forward-port-conflict` 失败

### Requirement: bridge 提供转发申请接缝 `cockpitBridge.forwards`

驾驶舱 SHALL 经 bridge 插件向设备 DSH 页面提供完整服务名为 `cockpitBridge.forwards` 的接缝。该名字是跨仓契约，变更属于 breaking change。

**提供方式**

接缝 SHALL 在 bridge fiber 生命周期内立即提供，面向任意同页面插件，MUST NOT 命名或假设任何具体消费方。

**操作集合**

作用对象恒为调用页面所在的设备（由请求 `Origin` 解析），调用方 MUST NOT 指定其他设备。

- 消费类操作：
  - 申请：设备端口 + 持有者标签，立即返回租约句柄，含当时状态，`ready` 时含地址；
  - 释放；
  - 列出本设备转发表；
  - 订阅转发表变化。
- 管理类操作：
  - 创建常驻：设备端口 + 可选标签，常驻来源记为 `dsh`；
  - 取消常驻；
  - 删除条目。
  - 管理类操作只作用于常驻来源为 `dsh`、或未常驻的条目。对常驻来源为 `cockpit` 的条目取消常驻或删除，SHALL 以稳定原因 `managed-by-cockpit` 被拒绝，且不改变转发表。

**本页去重**

同一 bridge 实例内，对同一 (持有者标签, 设备端口) 的重复申请 SHALL 返回已持有的同一租约，MUST NOT 签发第二个租约；申请仍在进行中时，重复申请 SHALL 等待并复用同一个进行中的请求。

租约被释放、或得知 `revoked`/`lease-expired` 后，该去重项 SHALL 立即清除，此后的申请 SHALL 签发新租约。

**续约**

- 申请得到的租约 SHALL 由 bridge 在页面存活期间自动续约，间隔不超过 60 秒，消费方 MUST NOT 需要自行续约。
- 续约只有得到 `revoked` 或 `lease-expired` 时，才视为租约失效。
- 其余一切失败 SHALL 被视为暂时不可达：bridge SHALL 保留租约，按既有退避继续续约，MUST NOT 通知持有者失效。这类失败包括：
  - 网络失败；
  - 能力串换发失败；
  - 因主通道不可用导致的设备解析失败，即既有的 400 `bad-request`；
  - 其它非 409 响应。

**失效通知**

- 续约得到 `revoked` 或 `lease-expired` 时，bridge SHALL 停止该租约的续约，并以该原因通知其持有者。
- bridge MUST NOT 为此自动重新申请，是否重新申请由消费方决定。

**状态与地址通知**

- 条目状态或本地端口相对上次交付发生变化时，bridge SHALL 通知持有者当前状态。
- 条目为 `ready` 时，通知 SHALL 带新地址。

**地址形式**

地址 SHALL 为宿主机回环地址 `127.0.0.1` 加本地端口，并同时提供 `http://` URL 形式。

**不可用时**

握手未完成，或页面不在驾驶舱 iframe 中时，接缝 SHALL 同步抛出稳定的“不可用”错误，使消费方回落本机行为。

#### Scenario: 申请立即返回并在就绪后通知地址
- **GIVEN** bridge 已握手，设备端口 3939 没有条目
- **WHEN** 消费方以持有者标签 `memex-browse:default` 申请 3939
- **THEN** 申请在建立完成前返回租约句柄，状态为 `starting`、不含地址；条目就绪后，消费方收到状态为 `ready`、地址为 `127.0.0.1:<localPort>` 及对应 `http://` URL 的通知

#### Scenario: 租约在页面存活期间自动续约
- **GIVEN** 消费方持有设备端口 3939 的租约，主通道 `READY`
- **WHEN** 此后 6 分钟内消费方不做任何操作
- **THEN** 6 分钟后该租约仍存在，条目仍为 `ready`

#### Scenario: 主通道断开期间续约被拒仍保持租约
- **GIVEN** 消费方持有设备端口 3939 的租约并订阅了通知
- **WHEN** 设备主通道断开 8 分钟，其间 bridge 的每次续约都被以 400 `bad-request` 拒绝，之后主通道恢复 `READY`
- **THEN** 其间消费方未收到任何失效通知；恢复后 bridge 的下一次续约成功，消费方仍持有原租约

#### Scenario: 页面关闭后租约到期回收
- **GIVEN** 某页面为设备端口 3939 持有唯一租约，条目非常驻，主通道 `READY`
- **WHEN** 该页面被关闭，此后不再有续约
- **THEN** 租约到期后条目被回收，子进程被终止

#### Scenario: 同页重复申请不产生第二个租约
- **GIVEN** 消费方已以持有者标签 H 为设备端口 3939 持有租约 A
- **WHEN** 同一页面再次以 H 申请 3939
- **THEN** 返回租约 A，转发表中 3939 的租约数不变

#### Scenario: 删除条目后持有者收到撤销通知且不自动重新申请
- **GIVEN** 消费方持有设备端口 3939 的租约，并订阅了通知
- **WHEN** 用户在驾驶舱面板删除该条目
- **THEN** bridge 的下一次续约得到 `revoked`，停止续约，并以 `revoked` 通知该消费方；此后 bridge 不发起针对 3939 的申请请求

#### Scenario: 地址变化通知持有者
- **GIVEN** 消费方持有设备端口 3939 的租约，交付时本地端口为 P1
- **WHEN** 条目重建后本地端口变为 P2
- **THEN** 该消费方收到 `ready` 通知，地址为 `127.0.0.1:P2`

#### Scenario: DSH 侧不能删除驾驶舱面板建立的常驻条目
- **GIVEN** 设备端口 5432 为常驻条目，常驻来源为 `cockpit`
- **WHEN** 同页插件经接缝请求删除 5432，或取消其常驻
- **THEN** 请求以 `managed-by-cockpit` 失败，5432 条目保持不变

#### Scenario: 不在驾驶舱中时接缝不可用
- **GIVEN** 设备 DSH 页面并非运行在驾驶舱 iframe 中，bridge 未收到握手配置
- **WHEN** 消费方调用申请
- **THEN** 调用同步抛出“不可用”错误，不发起任何网络请求

#### Scenario: 非法持有者标签被拒绝
- **GIVEN** bridge 已握手
- **WHEN** 消费方以空字符串，或含控制字符的持有者标签申请
- **THEN** 申请以 `invalid-holder` 失败，不改变转发表

### Requirement: 驾驶舱父页面向设备页面推送转发表快照

驾驶舱父页面 SHALL 经既有 iframe `postMessage` 通道，向每台设备的工作台 iframe 推送该设备的转发表快照。

**推送时机**

- 每次向该 iframe 发送 bridge 配置消息后，立即推送一次。消息按序送达，bridge 处理快照时已持有驾驶舱 origin。
- 此后在该设备转发表投影每次变化时推送。

**targetOrigin**

推送的 `targetOrigin` MUST 精确等于该设备 iframe 的 origin，MUST NOT 使用 `*`。

**bridge 侧**

- bridge SHALL 只接受 `event.origin` 等于已握手驾驶舱 origin 的快照消息。
- bridge MUST NOT 轮询驾驶舱获取转发表；“列出”请求仅用于尚未收到推送时的冷启动兜底。

**不新增旁路**

本推送属于父页面→iframe 方向。系统 MUST NOT 为此新增 iframe→父页面反向动作消息通道之外的旁路。

#### Scenario: 转发表变化推送到对应设备页面
- **GIVEN** 设备 A、B 的工作台 iframe 均已挂载且 bridge 已握手
- **WHEN** 设备 A 新增一条附加条目
- **THEN** 父页面向 A 的 iframe 推送含该条目的快照，targetOrigin 为 A 的 origin；B 的 iframe 不收到含 A 转发表的消息

#### Scenario: 配置下发后立即推送快照
- **GIVEN** 设备 A 有一条附加条目，其 iframe 刚被激活
- **WHEN** 父页面向 A 的 iframe 发送 bridge 配置消息
- **THEN** 紧随其后，父页面向同一 iframe 发送含该条目的快照消息

#### Scenario: 伪造来源的快照消息被忽略
- **GIVEN** bridge 已与驾驶舱 origin O 握手
- **WHEN** 页面收到来自非 O 来源的转发表快照消息
- **THEN** bridge 忽略该消息，其列出结果与订阅者均不受影响

### Requirement: 转发表的投影、标签与诊断受数据卫生约束

标签、诊断与租约标识跨越信任边界流转，系统 SHALL 对它们施加以下约束。

**标签**

- 持有者标签与条目标签 SHALL 为 1 至 64 个字符，每个字符 SHALL 属于可打印 ASCII（`0x20`–`0x7E`）。
- 不合规的持有者标签 SHALL 以 `invalid-holder` 被拒绝，不合规的条目标签 SHALL 以 `invalid-label` 被拒绝。

**诊断**

- 条目诊断来自 ssh stderr，属于不可信输入。系统 SHALL 把它截断到至多 300 字符。
- 驾驶舱面板与 DSH 设置区块 SHALL 仅以纯文本渲染标签与诊断，MUST NOT 以 HTML 解析。

**租约标识**

- 租约标识 SHALL 只返回给签发它的申请调用方。
- 它 MUST NOT 出现在转发表投影、设备状态流、iframe 快照、列出应答与日志中。
- 续约与释放 SHALL 只在调用方所属设备的表内查找租约。

#### Scenario: 投影不含租约标识
- **GIVEN** 设备端口 3939 的条目持有租约 A
- **WHEN** 读取设备状态流中的转发表投影、列出应答与 iframe 快照
- **THEN** 三者都包含 3939 的持有者标签与租约数，且均不包含 A 的标识字符串

#### Scenario: 非法条目标签被拒绝
- **GIVEN** 任一远端设备，附加条目占用 `0 / 8`
- **WHEN** 以含换行符或超过 64 字符的标签创建常驻条目
- **THEN** 请求以 `invalid-label` 失败，转发表不变

#### Scenario: 超长诊断被截断
- **GIVEN** 某条目的 ssh 子进程输出了 5000 字符的 stderr 后退出
- **WHEN** 读取该条目的诊断
- **THEN** 诊断长度不超过 300 字符

#### Scenario: 他设备的租约标识无效
- **GIVEN** 设备 A 的页面持有设备 A 的租约 A1
- **WHEN** 设备 B 的页面以 A1 请求释放
- **THEN** 设备 A 的转发表不变，A1 仍然有效

### Requirement: 转发表管理端点仅接受驾驶舱同源请求

驾驶舱面板使用的转发表管理端点 SHALL 要求驾驶舱既有的 HttpOnly token，并受 `cockpit-api-auth` 的同源校验约束。被拒绝时 MUST NOT 改变转发表，也 MUST NOT 启动子进程。

这些端点 MUST NOT 被加入 bridge 能力串豁免名单，也 MUST NOT 被 bridge 能力串替代认证。

理由：驾驶舱 cookie 不按端口隔离；设备页面与驾驶舱同属 `127.0.0.1` 站点，仅靠 cookie 无法区分两者。

#### Scenario: 驾驶舱页面可以管理转发
- **GIVEN** 驾驶舱自身页面持有有效 token
- **WHEN** 它以驾驶舱 origin 调用创建常驻端点
- **THEN** 请求被接受，转发表新增该条目

#### Scenario: 设备页面带 cookie 调用管理端点被拒绝
- **GIVEN** 浏览器持有驾驶舱有效 cookie
- **WHEN** 来自 `http://127.0.0.1:<某设备本地端口>` 的带凭据跨源请求调用创建常驻端点
- **THEN** 请求以 403 `cross-origin-rejected` 被拒绝，转发表不变，不启动子进程

#### Scenario: 仅携带能力串的请求不能使用管理端点
- **GIVEN** 一个仅携带 bridge 能力串、不携带驾驶舱 token 的请求
- **WHEN** 该请求调用管理端点
- **THEN** 请求以 403 `cross-origin-rejected`（来自设备 origin）或 401 `unauthorized`（无 Origin、无 cookie）被拒绝，转发表不变，不启动子进程

### Requirement: bridge 在 DSH 设置页呈现本设备转发清单

bridge SHALL 在设备 DSH 的设置页注册一个“驾驶舱转发”区块。settings 插槽 SHALL 作为可选协作者：它缺席时，bridge 的其它能力不受影响。

**清单内容**

区块 SHALL 列出本设备转发表的全部条目，每条显示：

- 设备端口与本地地址；
- 状态；
- 是否常驻及常驻来源；
- 标签与持有者标签；
- 最近失败诊断（如有）。

**占用**

- 区块 SHALL 显示附加条目占用 `N / 8`。
- system 条目与常驻来源为 `cockpit` 的条目 SHALL 显示为“在驾驶舱管理”，不呈现删除或取消常驻控件。

**操作**

- 区块 SHALL 提供：手动创建常驻条目（输入设备端口与可选标签）；对可管理条目取消常驻与删除。
- 删除持有租约的条目前 SHALL 请求显式确认，并提示持有者会失去访问。

**失败提示**

操作被拒绝时，区块 SHALL 在原位显示稳定原因对应的可读说明，并保留输入。

**不可用时**

页面不在驾驶舱中，或设备为本机设备时，区块 SHALL 显示对应说明，MUST NOT 呈现操作控件。

#### Scenario: 设置页列出转发
- **GIVEN** bridge 已握手，设备有主通道与一条 `ready` 的 3939 租约条目
- **WHEN** 用户打开 DSH 设置页的“驾驶舱转发”区块
- **THEN** 区块显示两行：标为“在驾驶舱管理”的 system 条目、3939 条目（状态 ready、持有者标签、非常驻），以及占用 `1 / 8`

#### Scenario: 在设置页手动创建常驻转发
- **GIVEN** 设备附加条目占用 `1 / 8`
- **WHEN** 用户输入设备端口 5432 并提交
- **THEN** 转发表出现常驻来源为 `dsh` 的 5432 条目，区块在收到新快照后显示该条目与占用 `2 / 8`

#### Scenario: 设置页创建超限时原位提示
- **GIVEN** 设备附加条目占用 `8 / 8`
- **WHEN** 用户提交一个新的设备端口
- **THEN** 区块在表单处显示上限说明并保留输入，转发表不变

#### Scenario: 不在驾驶舱中时不提供操作
- **GIVEN** 设备 DSH 页面未运行在驾驶舱 iframe 中
- **WHEN** 用户打开该区块
- **THEN** 区块显示“未连接驾驶舱”说明，不呈现创建或删除控件

#### Scenario: 本机设备不提供操作
- **GIVEN** bridge 已握手，当前设备为本机设备
- **WHEN** 用户打开该区块
- **THEN** 区块显示“本机设备无需转发”，不呈现创建或删除控件

## MODIFIED Requirements

### Requirement: 附加转发只在宿主机回环监听并随设备生命周期回收

附加转发 SHALL 建立为 `127.0.0.1:<localPort>` → 设备上 `127.0.0.1:<devicePort>` 的本地回环转发，沿用主通道既有的 OpenSSH 调用约束：`shell: false`、`BatchMode`、`ExitOnForwardFailure`、有界 keepalive、不关闭 host-key 校验、不泄露密钥口令。附加转发 MUST NOT 监听非回环地址，设备侧目标 MUST 恒为 `127.0.0.1`。

**所有权**

附加转发由按设备持有的转发表拥有，其生存期独立于任何一次连接生命周期实例。

**设备级终结**

- 以下事件发生时，系统 SHALL 终止该设备的全部附加转发子进程，此后不再为其启动新的子进程：设备禁用、设备删除、驾驶舱收到可捕获终止信号。
- 禁用时，常驻条目按“附加条目的寿命由常驻标记与租约共同决定”保留。删除时，全部条目随设备记录一并移除。

**主通道替换不影响附加转发**

- 主通道的任何重建或连接替换，MUST NOT 终止附加转发子进程。包括：
  - 手动重连；
  - 退避重连；
  - 端口漂移；
  - 认证材料（启动 URL）或自动恢复设置变更导致的连接替换。
- 附加转发只因自身寿命结束、自愈重建、SSH 别名变更或上述设备级终结而被终止。

**不猜测归属**

系统 MUST NOT 依据端口或命令行相似性猜测归属，去杀非自有进程。

**故障隔离**

- 主通道故障 MUST NOT 被附加转发的故障改变，反之亦然。
- 一条附加转发建立失败或中途断开，SHALL NOT 改变设备的状态分级，也 SHALL NOT 触发工作台重连。

#### Scenario: 设备禁用时终止全部附加转发
- **GIVEN** 一台设备持有常驻条目 5432 与带租约的条目 3939，二者均 `ready`
- **WHEN** 该设备被禁用
- **THEN** 主通道与两条附加转发的子进程全部终止，禁用期间不启动新的子进程，注册记录仍含 5432 的常驻标记

#### Scenario: 主通道手动重连不影响附加转发
- **GIVEN** 设备端口 3939 的附加条目为 `ready`，其子进程 pid 为 X
- **WHEN** 用户对该设备请求手动重连，且主通道重建成功
- **THEN** 附加条目仍为 `ready`，其子进程 pid 仍为 X

#### Scenario: 更新启动 URL 不影响附加转发
- **GIVEN** 设备端口 3939 的附加条目为 `ready`，其子进程 pid 为 X
- **WHEN** 用户为该设备粘贴新的 DSH 启动 URL，或切换自动认证恢复，且保存成功
- **THEN** 主通道按既有规则被替换，附加条目仍为 `ready`，其子进程 pid 仍为 X

#### Scenario: 附加转发失败不影响工作台
- **GIVEN** 设备主通道 `READY`
- **WHEN** 某条附加转发建立失败或中途断开
- **THEN** 设备状态分级不变，工作台主通道不重连，失败以结构化原因记录在该条目上

#### Scenario: 驾驶舱退出清理自有转发
- **GIVEN** 驾驶舱持有若干设备的主通道与附加转发子进程
- **WHEN** 驾驶舱收到 SIGINT/SIGTERM
- **THEN** 系统在有界时间内终止全部自有子进程，不遗留 `ppid=1` 孤儿，且不终止非自有 SSH 进程

### Requirement: 驾驶舱为设备提供端口发布接缝

`cockpitBridge.portForward`（`register(channelId, devicePort)` 与 `publish(channelId)`）SHALL 作为已弃用的兼容接缝继续提供，完整服务名不变。新消费方 SHALL 使用 `cockpitBridge.forwards`。

**接缝行为**

- 兼容接缝 SHALL 建立在转发表之上。
- `register` 只在 bridge 本地记下用途标识到设备端口的映射，MUST NOT 单独占用转发表条目或上限。
- `publish` SHALL 以该用途标识为持有者标签申请对应设备端口的租约，并等待其就绪，至多 8 秒，然后返回 `{ channelId, url }`。超时或失败时，以不可用错误结束。
- 同一用途标识重复 `publish` SHALL 复用 bridge 已持有的租约。
- 驾驶舱不提供新转发端点（新端点返回 401 或 404）时，兼容接缝 SHALL 回退为调用旧端点 `publishable-port` 与 `publish-port`，使旧版驾驶舱搭配新版 bridge 时，既有消费方不退化。
- 对 `/api/bridge/forwards/*` 的请求得到 401 时，bridge SHALL 判定驾驶舱为旧版，MUST NOT 为此换发能力串。兼容接缝直接回退旧端点；`cockpitBridge.forwards` 的新申请以稳定的“不可用”错误结束。对已持有租约的续约得到 401 时，按上文续约规则视为暂时失败，不通知持有者失效。

**回落**

握手未完成、设备为本机设备、用途标识未经 `register`、或转发未能在时限内就绪时，兼容接缝 SHALL 以稳定方式表明不可用，使消费方可确定性地回落本机行为。系统 MUST NOT 为此新增 iframe→父页面反向动作消息通道之外的旁路。

**旧服务端端点**

驾驶舱服务端的旧端点 `/api/bridge/publishable-port` 与 `/api/bridge/publish-port` SHALL 保持可用，以服务尚未升级的旧版 bridge（旧版不会续约）。

- 旧端点的“用途标识 → 设备端口”映射 SHALL 仅存于驾驶舱进程内，每台设备至多 8 项，不计入转发表上限。
- 旧端点建立的转发 SHALL 进入转发表，持有一个不过期租约，其持有者标签为 `legacy:` 加上截断到前 57 个字符的 channelId，从而满足持有者标签至多 64 字符的约束。该租约不持久化，在设备禁用、删除、驾驶舱退出或用户删除条目时移除。
- `publish-port` SHALL 至多等待 8 秒，直到条目就绪后返回当前 URL；未就绪时以稳定原因 `forward-not-ready` 失败。系统 MUST NOT 返回已知指向已退出子进程的缓存 URL。

#### Scenario: 兼容接缝经转发表发布
- **GIVEN** bridge 已握手，消费方调用 `register('memex-browse-default', 3939)`
- **WHEN** 消费方调用 `publish('memex-browse-default')`
- **THEN** 返回 `{ channelId: 'memex-browse-default', url: 'http://127.0.0.1:<localPort>' }`，转发表出现 3939 条目，其持有者标签为 `memex-browse-default`

#### Scenario: 新版 bridge 搭配旧版驾驶舱时回退旧端点
- **GIVEN** 驾驶舱为不含转发表的旧版本，新端点返回 401；bridge 已握手，消费方已 `register('memex-browse-default', 3939)`
- **WHEN** 消费方调用 `publish('memex-browse-default')`
- **THEN** bridge 依次调用旧端点 `publishable-port` 与 `publish-port`，消费方得到旧端点返回的 URL；期间 bridge 不请求父页面换发能力串

#### Scenario: 未 register 的用途标识不可发布
- **GIVEN** bridge 已握手，从未对用途标识 `X` 调用 `register`
- **WHEN** 消费方调用 `publish('X')`
- **THEN** 调用以不可用错误失败，不发起网络请求，转发表不变

#### Scenario: 无驾驶舱时消费方仍可工作
- **GIVEN** 设备的 DSH 页面并非运行在驾驶舱 iframe 中
- **WHEN** 消费方调用 `publish`
- **THEN** 调用以不可用错误失败，消费方回落本机行为

#### Scenario: 旧版 bridge 不再得到死链接
- **GIVEN** 旧版 bridge 曾经经旧端点发布设备端口 3939，其子进程随后意外退出且尚未重建
- **WHEN** 旧版 bridge 再次调用 `/api/bridge/publish-port`，且条目在 8 秒内未就绪
- **THEN** 驾驶舱不返回旧 URL，而以 `forward-not-ready` 失败

#### Scenario: 本机设备无需转发
- **GIVEN** 当前设备是本机设备
- **WHEN** 消费方调用 `publish`
- **THEN** 调用以不可用错误失败，消费方回落为直接使用设备本机地址

### Requirement: 端口发布请求须经既有 capability 校验

bridge 发起的全部转发请求 SHALL 沿用既有 bridge 调用的认证与来源约束，包括申请、续约、释放、列出、创建常驻、取消常驻、删除，以及兼容旧端点。

**认证**

- 短 TTL 的一次性能力串经请求头传递，驾驶舱 SHALL 校验该能力串，并按 `Origin` 匹配设备。
- 校验失败 SHALL 以既有拒绝响应拒绝：能力串无效、过期或不匹配为 400 `bridge-capability-invalid`；缺少能力串的请求不享有能力串豁免，按 `cockpit-api-auth` 处理（来自设备 origin 时为 403 `cross-origin-rejected`）。拒绝时 MUST NOT 改变转发表。

**业务拒绝**

- 业务拒绝（`forward-limit`、`reserved-port`、`invalid-port`、`invalid-holder`、`invalid-label`、`managed-by-cockpit`、`revoked`、`lease-expired`、`local-device`、`forward-not-ready`、`forward-port-conflict`、`persist-failed`）SHALL 以 HTTP 409 返回，响应体含稳定的 `code` 字段。
- bridge SHALL 只在 400 `bridge-capability-invalid`，以及对 `/api/bridge/forwards/*` 以外路径的 401 `unauthorized` 时换发能力串并重试；其余拒绝 SHALL 不重试，并把 `code` 原样交给调用方。

**边界**

- 这些接缝 MUST NOT 被用于代理任意 DSH RPC、Settings、credentials 或任何应用层协议。
- 驾驶舱在被转发的数据路径之外，MUST NOT 解析、重写或记录被转发的流量内容。

#### Scenario: 有效能力串的申请被接受
- **GIVEN** 一个未过期、匹配设备 A `Origin` 的能力串
- **WHEN** bridge 以该能力串为设备端口 3939 发起申请
- **THEN** 驾驶舱为设备 A 建立或复用 3939 条目，并返回租约

#### Scenario: 能力串无效时以既有响应拒绝
- **GIVEN** 一个过期、被撤销或不匹配请求 `Origin` 的能力串
- **WHEN** 以该能力串发起任一转发请求
- **THEN** 驾驶舱返回 400，响应错误码为 `bridge-capability-invalid`，转发表不变，不启动子进程

#### Scenario: 业务拒绝不触发能力串换发
- **GIVEN** 设备已有 8 条附加条目，bridge 已握手
- **WHEN** bridge 为新端口发起申请
- **THEN** 驾驶舱返回 409，`code` 为 `forward-limit`；bridge 不换发能力串、不重发请求，调用方收到 `forward-limit`

#### Scenario: 驾驶舱不进入数据路径
- **GIVEN** 一条附加转发已建立，并被浏览器或数据库客户端使用
- **WHEN** 流量经过该转发
- **THEN** 流量经 SSH 直达设备端服务，驾驶舱进程不读取、不重写、不记录其内容

## REMOVED Requirements

### Requirement: 端口发布须经设备侧登记，转发目标不可由消费方任意指定

**Reason**:

- 本 change 明确推翻前一 change 设计 D4 中“消费方不能传端口号，只能引用已登记项”的规则。
- 该规则的初衷是防止形成“把本设备任意端口发布到宿主机”的通用管道。但 D4 自己的论证已经说明：登记与发布出自同一个可信页面上下文，所以登记挡不住一个想要任意端口的页面，它只是让调用多一步。
- 本 change 接受“可信页面可以发布本设备任意回环端口”这一放宽，并以下列结构性约束作为边界：
  - 只转发设备的 `127.0.0.1:<port>`；
  - 只在宿主机回环监听；
  - 每条目绑定单个端口；
  - 每台设备上限 8 条；
  - 按 `Origin` 限定本设备，不能跨设备（由本 change 新增的 `cockpit-api-auth` 同源校验保证：设备页面不能再带 cookie 调用驾驶舱的设备管理 API）；
  - 全部条目在驾驶舱面板可见、可删；
  - 驾驶舱面板建立的常驻条目不能被 DSH 侧删除。

**Migration**:

- 新消费方直接调用 `cockpitBridge.forwards` 的申请，并传入设备端口。
- 旧消费方继续使用 `cockpitBridge.portForward`，其 `register` 保留为 bridge 本地映射，行为不变。
