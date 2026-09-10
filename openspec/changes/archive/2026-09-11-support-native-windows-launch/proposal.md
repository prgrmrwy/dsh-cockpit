# 单一 Node.js 跨平台启动命令

## Why

仓库当前的 `bin/cockpit` 是 Bash 脚本，服务端还固定启动 `/usr/bin/ssh`，导致原生 Windows 无法直接使用完整生命周期命令和远端设备连接。与其再维护一套 PowerShell 实现，不如把启动入口统一为 Node.js CLI，并复用 Node 的跨平台进程、路径、网络和 `PATH` 命令发现能力。

## What Changes

- 将现有 `bin/cockpit` 从 Bash 脚本替换为不依赖第三方运行时库的 Node.js CLI，在 Windows、Linux 和 macOS 上提供同一套 `bootstrap`、`build`、`start`、`restart`、`stop`、`status`、`install`、`uninstall` 和开发模式。
- 保持 `bin/cockpit` 路径不变：Unix 可继续通过 Node shebang 或既有符号链接调用，Windows 可执行 `node .\bin\cockpit`；同时通过 `package.json#bin` 允许包管理器生成平台命令 shim。
- pnpm 按“显式环境变量覆盖、Corepack、当前进程 `PATH`”发现，确保遵守仓库锁定版本；OpenSSH 按“显式覆盖、PATH”发现。Node CLI 使用自身的 `process.execPath` 启动服务，不再额外发现 Node 可执行文件。
- SSH 使用 `child_process.spawn('ssh', argv, { shell: false })` 的平台原生 PATH 查找，兼容 Windows OpenSSH，并保留可选的 `DSH_COCKPIT_SSH_EXECUTABLE` 覆盖。
- 新增经过认证的本机运行实例识别与优雅关闭控制，使跨平台 `status`、`stop` 和 `restart` 不依赖 `lsof`、`ps`、PowerShell 或不可靠的强制杀进程。
- 统一修正数据目录、端口、Vite 代理和浏览器 URL 的跨平台配置，并补充 Windows/Linux CI 与中英文文档。

## Capabilities

### New Capabilities

- `cockpit-runtime-launch`：单一 Node.js 跨平台 CLI、外部命令发现、运行时配置、实例识别及安全生命周期控制。

### Modified Capabilities

- `cockpit-device-connectivity`：通过 Node 的平台原生 PATH 查找系统 OpenSSH，同时保持 BatchMode、host-key 校验、参数边界、进程归属与终结性清理保证。

## Impact

- 替换 `bin/cockpit` 的实现语言，但保留文件路径和主要命令表面；影响根 `package.json`、服务端启动与配置、认证和注册表目录解析、SSH 子进程及 Vite 开发代理。
- 服务端新增仅用于本机 CLI 的认证运行时状态与关闭控制；不代理或修改任何远端 DSH 操作。
- 新增 Node CLI 单元测试及 Windows/Linux 生命周期冒烟测试；不引入 `zx` 或其它运行时依赖。
- 同步更新 `README.md`、`README.en.md` 和 `CONTRIBUTING.md`。
