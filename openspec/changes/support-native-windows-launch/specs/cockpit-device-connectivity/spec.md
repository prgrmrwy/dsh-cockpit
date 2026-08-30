## MODIFIED Requirements

### Requirement: 使用自有 SSH 隧道只监听中央回环并保持有界
系统 SHALL 为每台设备建立一条本地回环转发（`127.0.0.1:<localPort>` → 远端 DSH 端口），由驾驶舱分配并跟踪。系统 SHALL 优先使用 `DSH_COCKPIT_SSH_EXECUTABLE` 指定的单一 OpenSSH 可执行文件名或路径；未设置时 SHALL 把 `ssh` 作为可执行文件直接交给 Node.js `child_process.spawn` 并通过当前进程 `PATH` 查找，从而支持 Unix OpenSSH 与 Windows OpenSSH。SSH 进程 MUST 使用 `shell: false`，覆盖值 MUST NOT 被当作 shell 命令行解析。隧道 SHALL 使用系统 OpenSSH 配置（别名、`~/.ssh/config`、known_hosts、Agent、ProxyJump），并至少设置 `BatchMode`、`ExitOnForwardFailure` 与有界 keepalive。系统 MUST NOT 关闭 host-key 校验，MUST NOT 把密钥/口令暴露给模型或日志。

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
