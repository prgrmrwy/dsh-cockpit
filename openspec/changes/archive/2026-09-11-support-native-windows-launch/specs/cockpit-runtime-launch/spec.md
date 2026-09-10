## ADDED Requirements

### Requirement: 单一 Node.js CLI 提供跨平台生命周期入口
系统 SHALL 以仓库内的单一 Node.js CLI 在 Windows、Linux 和 macOS 上提供 `bootstrap`、`build`、`start`、`restart`、`stop`、`status`、`install`、`uninstall` 与开发模式。该入口 MUST NOT 要求用户安装或调用 Bash、PowerShell、WSL 或 `zx`。CLI SHALL 保持 `bin/cockpit` 路径不变，Unix 可通过 Node shebang 调用，所有平台均可通过 `node <repo>/bin/cockpit` 调用；配置 `package.json#bin` 后 SHALL 允许包管理器生成平台命令 shim。生产启动 SHALL 在服务就绪后默认使用系统浏览器打开驾驶舱，并 SHALL 提供禁止自动打开浏览器与前台运行选项。

#### Scenario: Windows 生产启动
- **WHEN** Windows 用户执行 `node .\bin\cockpit start` 且依赖与构建产物就绪
- **THEN** 系统在 `127.0.0.1` 启动驾驶舱、等待服务就绪并使用默认浏览器打开配置的 URL，全程不要求 PowerShell 或 Bash 脚本

#### Scenario: Unix 既有入口继续工作
- **WHEN** Linux 或 macOS 用户通过 `./bin/cockpit start` 或既有指向该文件的符号链接启动
- **THEN** Node shebang 执行同一个 CLI，并保持既有命令和默认行为

#### Scenario: 跨平台开发启动
- **WHEN** 用户通过 Node CLI 请求开发模式
- **THEN** CLI 以前台方式启动 server watch 与 Vite、明确显示开发 UI 地址，并在终端中断时协调清理自身创建的子进程

#### Scenario: 重复启动
- **WHEN** 配置端口上已经运行且实例身份可验证为当前仓库的驾驶舱
- **THEN** start 不创建第二个服务进程，只打开或报告已有实例

### Requirement: CLI 通过当前 Node 运行时和 PATH 发现依赖命令
CLI SHALL 验证当前 `process.execPath` 对应的 Node.js 版本不低于 22，并使用同一可执行文件启动服务端。CLI SHALL 优先使用 `DSH_COCKPIT_PNPM_EXECUTABLE`；未设置时 SHALL 优先通过 PATH 发现 Corepack 并由其执行仓库 `packageManager` 锁定的 pnpm，Corepack 不可用时才直接通过 PATH 发现 pnpm。覆盖值 SHALL 被视为单一可执行文件名或路径，不得作为任意 shell 命令行求值。Windows 上当发现的包管理器入口是受信任的 `.cmd`/`.bat` shim 时，CLI MAY 通过固定的 `ComSpec` 参数适配执行，但 MUST 分离固定命令与用户参数、不得拼接未经转义的 shell 文本。命令缺失、路径无效或 Node.js 版本过低时 SHALL 给出可操作诊断且不启动服务。

#### Scenario: 使用当前 Node 运行时
- **WHEN** CLI 由 Node.js 22 或更高版本启动
- **THEN** CLI 使用 `process.execPath` 启动服务端，不再查找或猜测另一份 Node 可执行文件

#### Scenario: 通过 Corepack 使用锁定 pnpm
- **WHEN** 未设置 pnpm 覆盖且 Corepack 可由当前进程 PATH 发现
- **THEN** bootstrap、build 与开发模式通过 Corepack 使用仓库 `packageManager` 锁定的 pnpm 版本，包括 Windows 上的命令 shim

#### Scenario: Corepack 不可用时从 PATH 发现 pnpm
- **WHEN** 未设置 pnpm 覆盖、Corepack 不可用且 pnpm 可由当前进程 PATH 发现
- **THEN** bootstrap、build 与开发模式直接使用所发现的 pnpm

#### Scenario: 使用显式 pnpm 覆盖
- **WHEN** 用户设置 `DSH_COCKPIT_PNPM_EXECUTABLE`
- **THEN** CLI 优先使用该文件名或路径，且不得把其内容作为任意 shell 命令求值

#### Scenario: 依赖不可用
- **WHEN** pnpm 覆盖无效、PATH 中不存在 pnpm 或当前 Node.js 版本低于 22
- **THEN** 对应命令以非零状态退出，指出失败依赖和修复方式，并且不留下服务进程

### Requirement: 运行目录与端口跨平台解析一致
系统 SHALL 优先使用 `DSH_COCKPIT_HOME` 作为数据目录；未设置或为空时 SHALL 使用 Node.js 的操作系统用户主目录发现结果下的 `.dsh-cockpit`，不得依赖 Windows 默认不存在的 `HOME`。CLI、服务端与 Vite 开发代理 SHALL 一致解析 `COCKPIT_PORT`，默认值为 `3090`，并拒绝非整数或超出 `1..65535` 的端口。

#### Scenario: Windows 未定义 HOME
- **WHEN** 原生 Windows 进程未设置 `HOME` 且未覆盖 `DSH_COCKPIT_HOME`
- **THEN** token、设备注册表、运行实例信息和日志位于当前用户配置文件目录下的 `.dsh-cockpit`，而不是驱动器根目录

#### Scenario: 覆盖数据目录
- **WHEN** 用户设置 `DSH_COCKPIT_HOME` 为有效路径
- **THEN** CLI 与服务端均使用该目录保存驾驶舱数据、运行实例信息和日志

#### Scenario: 覆盖服务端口
- **WHEN** 用户把 `COCKPIT_PORT` 设置为有效且空闲的端口
- **THEN** 服务监听 `127.0.0.1` 上的该端口，CLI 就绪检查、状态输出、浏览器 URL 与 Vite API 代理使用同一端口

#### Scenario: 端口配置无效
- **WHEN** `COCKPIT_PORT` 不是 `1..65535` 范围内的整数
- **THEN** CLI 与直接启动的服务端都在创建监听器或后台进程前失败并说明配置无效

### Requirement: 跨平台生命周期通过实例身份与认证控制保持安全
服务端 SHALL 为每次启动生成不可预测的实例标识，并在数据目录中以受限权限原子写入最小运行实例信息；实例正常退出时 SHALL 仅删除仍属于自身标识的记录。CLI SHALL 将运行实例记录、配置端口上的认证状态响应和当前仓库身份交叉验证后，才把进程视为可管理的驾驶舱。`stop` 与 `restart` SHALL 通过仅回环可达、受本机 token 和实例标识保护的控制路径请求服务端自行关闭，使 shutdown hooks 完成自有 SSH 子进程、socket 与 timer 的终结性清理。任一身份检查失败时 MUST 拒绝关闭或覆盖监听进程。

#### Scenario: 停止已验证实例
- **WHEN** 运行实例记录、认证状态响应、端口和仓库身份一致
- **THEN** CLI 发送带实例标识的认证关闭请求，等待服务端完成清理并释放端口后报告成功

#### Scenario: 实例记录陈旧
- **WHEN** 数据目录存在运行实例记录，但端口无响应或状态响应的实例标识不一致
- **THEN** CLI 不根据记录中的 PID 盲目终止进程，明确报告陈旧或身份不匹配状态

#### Scenario: 端口由其它进程占用
- **WHEN** 配置端口存在监听者但无法通过认证状态响应证明其属于当前仓库驾驶舱
- **THEN** start、stop 与 restart 均拒绝终止或覆盖该进程，并显示端口冲突诊断

#### Scenario: 重启期间清理 SSH 子进程
- **WHEN** 驾驶舱持有远端 SSH 隧道且用户执行 restart
- **THEN** 旧服务完成自有隧道的终结性清理并释放端口后，CLI 才启动新服务

#### Scenario: 状态输出
- **WHEN** 用户执行 status
- **THEN** CLI 输出经过验证的运行状态、URL、PID、实例标识摘要、数据目录和日志位置；无法验证时明确区分未运行、陈旧记录与未知端口监听者
