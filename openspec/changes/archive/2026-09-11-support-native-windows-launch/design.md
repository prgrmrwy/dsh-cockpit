# 单一 Node.js 跨平台启动命令设计

## Context

服务端主体已经是跨平台 Node.js 代码，但启动和远端连接仍有 Unix 假设：`bin/cockpit` 是 Bash 脚本，依赖 `lsof`、`ps`、`pgrep`、`nohup` 等工具；OpenSSH 默认路径固定为 `/usr/bin/ssh`；数据目录回退依赖 Windows 常常不存在的 `HOME`；`COCKPIT_PORT` 也没有真正进入服务端监听配置。

本机实测确认，原生 Windows Node.js 使用 `child_process.spawn('ssh', ['-V'], { shell: false })` 可以通过 PATH 找到系统 `ssh.exe`。因此没有必要维护 PowerShell 版启动器，也不需要用 `zx` 把 Bash 包在 JavaScript 里。更合适的边界是：Node.js 标准库负责跨平台生命周期，系统 OpenSSH 继续作为不经 shell 的外部程序运行。

## Goals / Non-Goals

**目标：**

- Windows、Linux、macOS 共享一份 `bin/cockpit` Node.js CLI 实现。
- 保持现有命令名称、默认端口、数据目录和 Unix 安装路径尽量兼容。
- 通过 PATH 自然发现 pnpm 与 OpenSSH，并允许明确的单一可执行文件覆盖。
- `start/status/stop/restart` 不依赖平台进程枚举工具，也不根据 PID 猜测进程归属。
- 后台停止时由服务端主动执行 shutdown hooks，维持自有 SSH 隧道的终结性清理。

**非目标：**

- 引入 `zx`、Commander、yargs 或其它 CLI 运行时依赖。
- 要求用户安装或调用 PowerShell、Bash、WSL 或 Git Bash。
- 用 CLI 安装 Node.js、pnpm、OpenSSH、SSH 密钥或 DSH。
- 支持密码认证或交互式 SSH。
- 把驾驶舱注册为 Windows Service、launchd daemon 或 systemd service。
- 改变远端 DSH 行为或驾驶舱的只读统筹面架构。

## Decisions

### 1. 原位替换 `bin/cockpit` 为无扩展名 ESM Node CLI

保留 `bin/cockpit` 文件路径，把 shebang 改为 `#!/usr/bin/env node`，使用 Node 22 内置的 `util.parseArgs`、`child_process`、`fs`、`path`、`os`、`net` 和 `fetch` 实现命令。无扩展名入口在根 `package.json` 的 `type: module` 作用域内按 ESM 执行。

这样有三项兼容收益：

- Unix 用户仍可执行 `./bin/cockpit`，已经安装的 `~/.local/bin/cockpit` 相对符号链接继续指向同一路径；
- Windows 用户始终可以执行 `node .\bin\cockpit start`；
- 根 `package.json` 增加 `bin.cockpit` 后，pnpm/npm 可按平台生成命令 shim，不需要仓库维护 `.ps1`、`.cmd` 或额外 Bash wrapper。

CLI 继续支持 `bootstrap`、`build`、`start`、`restart`、`stop`、`status`、`install`、`uninstall`、`--foreground`、`--no-open`、`--dev` 和强制构建。Unix 的 install/uninstall 保留相对符号链接语义；Windows 的全局命令安装委托给包管理器的标准 `bin`/link 机制，直接 `node .\bin\cockpit` 不依赖全局安装。

备选方案：新增 `bin/cockpit.mjs` 并保留旧 wrapper。它会造成入口并存和文档分叉；原位替换能保住既有 Unix 链接且更简单。

备选方案：使用 Google `zx`。`zx` 的命令模板默认依赖 Bash，Windows 仍需切换 PowerShell/pwsh，违背消除平台 shell 依赖的目标。

### 2. Node 运行时不再发现，pnpm 使用有界平台适配

CLI 由 Node 启动后，先验证 `process.versions.node` 不低于 22，并始终使用 `process.execPath` 启动服务端，避免环境中多份 Node 导致构建与运行版本漂移。因此删除原设计中的 `DSH_COCKPIT_NODE_EXECUTABLE`。

pnpm 按 `DSH_COCKPIT_PNPM_EXECUTABLE`、PATH 中的 Corepack、PATH 中的 `pnpm` 顺序解析。优先 Corepack 是为了遵守根 `packageManager` 锁定的 pnpm 10.23.0，避免 PATH 中其它 pnpm 版本重建 node_modules。Unix 和原生可执行文件直接使用 `spawn(..., { shell: false })`。Windows 上 Corepack/pnpm 通常是 `.cmd` shim；本机实测表明 Node 无法以 `shell: false` 直接 spawn `.cmd`。对此只在已解析目标扩展名为 `.cmd`/`.bat` 时使用一个封装良好的 `ComSpec /d /s /c` 适配器，固定命令位置、逐项转义参数且不接受自由 shell 文本。这个适配层是 Windows 命令 shim 的执行机制，不是单独维护 PowerShell/Bash 脚本。

CLI 核心保持零第三方依赖，保证依赖尚未安装时 `bootstrap` 仍能运行。

### 3. SSH 直接依赖 Node spawn 的 PATH 行为

SSH 可执行文件合同为 `DSH_COCKPIT_SSH_EXECUTABLE`，未设置时使用字符串 `ssh`。身份探测与 `TunnelManager` 都从共享运行时配置获得同一个值，再通过 `child_process.spawn(executable, argv, { shell: false })` 启动。Node/操作系统负责 PATH 与 Windows PATHEXT 查找，Windows OpenSSH 会自然使用当前用户的 `.ssh/config`、known_hosts 和 Agent。

SSH spawn 的 `error` 事件必须转成可读诊断并进入现有设备状态路径，不能像当前实现一样只得到空 stderr。SSH 仍按需使用：系统没有 SSH 时，驾驶舱与本机设备正常启动；添加或连接远端设备时明确失败。

备选方案：按平台固定 `/usr/bin/ssh` 或 `C:\Windows\System32\OpenSSH\ssh.exe`。这会绕过用户 PATH、自定义 OpenSSH、nix/homebrew 安装或企业包装器，不予采用。

### 4. 集中管理运行时配置

新增服务端运行时配置模块：

- `DSH_COCKPIT_HOME` 非空时使用其值，否则使用 `path.join(os.homedir(), '.dsh-cockpit')`；
- `COCKPIT_PORT` 默认为 3090，必须是 `1..65535` 的整数；
- `DSH_COCKPIT_SSH_EXECUTABLE` 非空时使用其值，否则为 `ssh`。

认证、存储、运行控制、连接层和 `main.ts` 统一消费该配置。CLI 独立实现同一组无副作用解析函数，用于服务启动前预检、URL、日志和状态。Vite 从 `COCKPIT_PORT` 生成 API proxy target，使非默认端口的开发模式保持连通。

现有数据不自动迁移：Unix 默认路径不变；Windows 从此前错误的驱动器根目录回退改为用户目录。需要保留旧位置时可显式设置 `DSH_COCKPIT_HOME`。

### 5. 以认证实例控制替代跨平台进程枚举和信号猜测

Node 在 POSIX 可以发送 SIGTERM，但 Windows 的 `process.kill(pid, 'SIGTERM')` 不能提供相同的优雅信号语义。仅依赖 PID 文件又会遭遇 PID 复用，依赖 `lsof`/CIM 则重新引入平台分支。因此服务端增加最小运行控制协议：

1. 每次服务启动生成随机 `instanceId`，原子写入数据目录下受限权限的 `runtime.json`，记录 schema 版本、PID、端口、仓库身份、启动时间和实例标识。
2. 服务端确保本机 token 已生成，并提供受现有 token middleware 保护的 `GET /api/runtime/status`；响应返回用于验证的应用、端口、PID、仓库身份和实例标识。
3. CLI 读取 `runtime.json` 与 token 文件，对目标端口调用 status，并要求应用标识、端口、仓库和 `instanceId` 全部一致。
4. 验证通过后，CLI 向 `POST /api/runtime/shutdown` 发送 token 与实例标识。服务端先返回 accepted，再从进程内部触发现有 Nest shutdown 路径。
5. 服务退出时仅当磁盘记录仍属于自己的 `instanceId` 才删除 `runtime.json`，避免旧实例删除新实例记录。

CLI 不对身份不明的端口监听者发送 kill，也不把陈旧 PID 当作归属证明。服务无响应时，stop 明确报告无法完成受控关闭，不自动降级为强制终止；用户仍可在知情情况下手工处理。这一取舍优先保证不误杀和不遗留 SSH 隧道。

控制接口只监听回环、复用现有 HttpOnly token 的服务端验证逻辑，CLI 直接读取受限 token 文件并以 Cookie header 发送，绝不输出 token。shutdown 额外要求匹配实例标识，浏览器页面不会获得磁盘中的 `runtime.json` 内容。

### 6. 后台、前台、开发与浏览器行为全部由 Node 管理

生产后台启动使用 `spawn(process.execPath, [serverEntry], { detached: true, windowsHide: true, stdio: logFds })` 并 `unref()`；CLI 通过认证 runtime status 等待就绪。前台生产模式保持 stdio 连接并传播自身收到的可捕获终止请求。开发模式以前台子进程组运行 pnpm recursive dev，CLI 在 `Ctrl+C`/终止时执行有界清理。

浏览器打开不经过 shell 字符串：Windows 直接启动 `explorer.exe <url>`，macOS 启动 `open <url>`，Linux 启动 `xdg-open <url>`；命令不可用时只打印 URL，不影响服务启动。

### 7. 单元测试与双平台 CI 验证

CLI 导出纯解析和进程选择函数，同时用“仅直接执行时运行 main”的门控保持可测试性。根测试脚本增加 Node 内置 test runner 的 CLI 测试，再运行现有 workspace 测试。单元测试覆盖参数、版本、端口、数据目录、pnpm/SSH 优先级、Windows shim 适配选择、实例状态交叉验证和未知实例拒绝。

CI 保留 Ubuntu job，并新增 `windows-latest` job。两端都使用隔离 `DSH_COCKPIT_HOME` 和非默认空闲端口完成 build → start → status → HTTP → stop；Windows 额外验证 PATH 中的 `ssh.exe` 可由 Node `shell: false` 启动。开发模式清理用有界集成测试覆盖。

## Risks / Trade-offs

- [Windows pnpm 是 `.cmd`，无法由 Node 直接 spawn] → 仅为已解析的 `.cmd`/`.bat` 使用固定 ComSpec 适配器，集中转义和测试，不接受任意命令文本。
- [新增 shutdown API 扩大本机控制面] → 仅回环监听，复用 token 认证并额外校验随机实例标识；不暴露远端操作能力或 token。
- [服务完全无响应时无法优雅 stop] → fail-closed 报告并保留人工处置，不自动强杀可能身份不明的进程。
- [runtime.json 可能因崩溃遗留] → status 将磁盘记录与在线认证响应交叉验证并明确标记陈旧；从不按陈旧 PID 杀进程。
- [替换 Bash 实现可能产生细微行为差异] → 保留命令表面和 `bin/cockpit` 路径，以单元测试及 Ubuntu/Windows 生命周期冒烟约束兼容性。
- [浏览器打开工具在精简 Linux 环境不存在] → 服务仍视为启动成功并打印 URL。
- [Windows 修正后的默认目录看不到旧根目录数据] → 文档说明用 `DSH_COCKPIT_HOME` 显式指回；不自动复制或删除旧数据。

## Migration Plan

1. 新增并测试共享运行时配置、运行实例记录和认证控制接口。
2. 将数据目录、端口、Vite 代理和 SSH 可执行文件接入新配置。
3. 原位重写 `bin/cockpit` 为 Node.js CLI，并增加 `package.json#bin` 与 CLI 测试。
4. 在 Ubuntu 与 Windows 上验证前台、后台、重复启动、状态、停止、重启和开发模式清理。
5. 同步更新中英文 README 与贡献指南；保留 Unix 既有符号链接兼容说明。
6. 回滚时可恢复 Bash 文件并移除运行控制模块；不涉及设备注册表 schema 迁移。

## Open Questions

无。已明确不采用 PowerShell 专用脚本或 `zx`；Windows 包管理器 `.cmd` shim 只通过 Node CLI 内部的有界 ComSpec 适配执行。
