## 1. 跨平台运行时配置

- [x] 1.1 新增服务端运行时配置模块，负责 `os.homedir()`、`DSH_COCKPIT_HOME`、经过验证的 `COCKPIT_PORT` 和 `DSH_COCKPIT_SSH_EXECUTABLE`；覆盖默认值、空值、覆盖值和非法端口测试。
- [x] 1.2 将认证与存储接入共享数据目录解析器，并补充 Windows 未定义 `HOME` 时不会写入驱动器根目录的回归测试。
- [x] 1.3 将服务端监听和 Vite 开发代理接入同一 `COCKPIT_PORT`，保留 3090 默认值并测试非默认端口。

## 2. 可移植的 OpenSSH 发现

- [x] 2.1 将身份探测和 `TunnelManager` 的 `/usr/bin/ssh` 默认值替换为共享的环境变量覆盖或 `ssh` 命令名，继续使用 `shell: false` 和既有 argv 边界。
- [x] 2.2 将 SSH 子进程的 spawn `error` 事件保留为可操作诊断，使命令缺失能与认证失败、网络不可达区分。
- [x] 2.3 扩展 SSH、隧道和连接层测试，覆盖 PATH 行为、显式覆盖、命令缺失、安全参数不变，以及缺少 SSH 时本机设备仍可使用。

## 3. 认证运行实例与优雅关闭

- [x] 3.1 实现带随机 `instanceId` 的 `runtime.json` 原子写入、受限权限、条件删除和陈旧记录识别，并添加竞态与恢复测试。
- [x] 3.2 新增受现有本机 token 保护的运行状态接口，返回应用、端口、PID、仓库身份和实例标识，并测试未认证访问被拒绝。
- [x] 3.3 新增同时校验 token 与 `instanceId` 的关闭接口，使服务从进程内部触发既有 shutdown hooks；测试错误实例不得关闭服务。
- [x] 3.4 添加带自有 SSH 隧道的受控 stop/restart 集成测试，确认端口、socket、timer 与 SSH 子进程均完成终结性清理。

## 4. 单一 Node.js CLI

- [x] 4.1 原位将 `bin/cockpit` 改为零第三方运行时依赖的 ESM Node CLI，使用 `util.parseArgs` 实现现有命令和选项，并验证 Node 22+。
- [x] 4.2 实现 `process.execPath` 服务启动、pnpm 环境变量/Corepack/PATH 发现，以及 Windows `.cmd`/`.bat` 的有界 ComSpec 适配；添加转义和无 shell 注入测试。
- [x] 4.3 实现 bootstrap、build、构建新旧判断、前台生产模式和前台开发模式，并处理 `Ctrl+C` 与子进程清理。
- [x] 4.4 实现后台 detached 启动、日志、认证就绪等待、重复启动、跨平台浏览器打开和 `--no-open`。
- [x] 4.5 实现基于运行实例交叉验证的 status、stop 与 restart；未知监听者、陈旧记录和身份不匹配时保持 fail-closed。
- [x] 4.6 保留 Unix install/uninstall 相对符号链接行为，添加根 `package.json#bin`，并为 Windows 记录包管理器生成全局命令 shim 的标准流程。
- [x] 4.7 用 Node 内置 test runner 覆盖 CLI 参数、版本、路径、端口、命令选择、平台分支、实例验证和错误诊断，并接入根 `pnpm test`。

## 5. 双平台验证与中文文档

- [x] 5.1 保留 Ubuntu CI，并新增 `windows-latest` 生命周期任务；两端使用隔离数据目录和非默认空闲端口验证 build、start、status、HTTP、stop 与无进程遗留。
- [x] 5.2 在 Windows CI 验证 Node 以 `shell: false` 从 PATH 启动 `ssh.exe`，并验证 pnpm `.cmd` shim 适配。
- [x] 5.3 更新 `README.md`、`README.en.md` 和 `CONTRIBUTING.md`，说明统一 Node 命令、平台调用方式、环境变量、全局 shim、端口、日志和陈旧实例排障；中文文档内容以中文编写。
- [ ] 5.4 实际运行并记录 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`、Windows 与 Unix 生产生命周期冒烟、开发模式中断清理，以及 Windows OpenSSH 远端连接验证。

## 验证记录

- 2026-08-30，Windows：`pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build` 全部通过。
- 2026-08-30，Windows：隔离目录与 43992 端口的生产 start/status/HTTP 200/stop 冒烟通过，停止后端口关闭且 `runtime.json` 已删除。
- 2026-08-30，Windows：开发模式 `Ctrl+C` 冒烟通过，43991 与 5173 均关闭且 `runtime.json` 已删除；Windows `.cmd` 终止确认由 CLI 自动处理。
- 2026-08-30，Windows：从 PATH 发现并运行 `C:\Windows\System32\OpenSSH\ssh.exe`（OpenSSH 9.5p2）；当前没有已注册远端设备，无法执行真实远端握手。
- 待外部环境：由 Ubuntu CI 执行 Unix 生产生命周期；由提供了可连接目标的 Windows 环境执行 OpenSSH 远端连接验证。
