# 贡献指南

感谢你愿意参与 dsh-cockpit。这份文档说明如何搭好环境、如何验证改动，以及本
仓库比较特别的一点——**规范驱动开发**。

## 环境要求

- Node.js **≥ 22**
- pnpm **10.23.0**（仓库已通过 `packageManager` 锁定，建议用 `corepack enable`）
- 要连远端设备时：本机到该设备的 **SSH 免密**，且该设备上跑着 `dsh web`

## 快速开始

```bash
corepack pnpm install
node bin/cockpit build

# Linux / macOS
./bin/cockpit start        # 构建（如需要）+ 后台启动 + 打开 UI
./bin/cockpit start --dev  # 前台开发模式（tsx watch + vite）
./bin/cockpit status       # 查看运行状态
./bin/cockpit stop         # 认证实例身份后优雅停止
```

Windows 使用同一份 Node CLI：

```text
node .\bin\cockpit start
node .\bin\cockpit start --dev
node .\bin\cockpit status
node .\bin\cockpit stop
```

驾驶舱默认监听 `http://127.0.0.1:3090`，可用 `COCKPIT_PORT` 覆盖。数据目录是
操作系统用户目录下的 `.dsh-cockpit/`（可用 `DSH_COCKPIT_HOME` 覆盖），与
`~/.dsh` 严格隔离。OpenSSH 默认通过 PATH 发现 `ssh`/`ssh.exe`，也可用
`DSH_COCKPIT_SSH_EXECUTABLE` 覆盖。

> 想在不碰自己真实设备注册表的前提下试验，用一个独立的 `DSH_COCKPIT_HOME`
> 启动即可，用完删掉那个目录。

## 提交前必须通过

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

CI 跑的是同一组命令。有几点值得先知道，能省掉一轮排查：

- 改了 `packages/shared` 的类型后，**先 `pnpm --filter @dsh-cockpit/shared build`
  再 typecheck**。server/web 通过 `dist/*.d.ts` 解析共享类型，不重建会看到过期报错。
- 前端产物改动**不需要重启服务**——静态托管按请求读盘，刷新页面即可；但改了
  服务端就要通过当前平台的 Node CLI 执行 `restart`。
- 请不要声称未实际执行的验证已经通过。

## 规范驱动开发

本仓库用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理行为契约：

| 目录 | 含义 |
| --- | --- |
| `openspec/specs/` | 各能力**当前**应满足的行为，是理解需求的首要入口 |
| `openspec/changes/` | 进行中的变更提案 |
| `openspec/changes/archive/` | 已完成变更的历史证据（**不代表当前要求**） |

**新功能、用户可观察的行为变化、兼容性调整与架构决策，请先提 change 再写
代码。** 用户可观察行为包括 UI 视觉、布局、交互、响应式、可访问性与文案语义
——改动小、单文件或纯 CSS 都不是跳过的理由。

流程大致是：

1. 先读 `README.md` 和相关的 `openspec/specs/`；
2. 用 `openspec new change "<name>"` 建 change，写 proposal / spec / design / tasks；
3. 实现时保持 tasks 状态同步；
4. 全部验证通过后归档，并把 delta spec 同步进主规范。

可以不新建 change 的窄例外：修复现有 spec 已明确行为的明显 bug、无外部行为
变化的内部重构、纯测试补充、纯文档改动。走例外时请在 PR 描述里说明依据。

## 代码约定

- **颜色必须走令牌**：全部使用 `packages/cockpit-web/src/styles/app.css` 的
  `:root` 变量，并在 `@media (prefers-color-scheme: light)` 中给出对应覆盖。
  禁止在 CSS 或内联样式里写死主题色值。
- **零运行时依赖倾向**：新增依赖前请先在 issue 中讨论。
- **测试断言用户可观察语义**，不要绑定实现细节（例如 SVG 的具体路径坐标、
  完整 DOM 快照）。
- 提交信息推荐 [Conventional Commits](https://www.conventionalcommits.org/)
  风格，例如 `feat(web): ...`、`fix(server): ...`、`docs(openspec): ...`。
- **README 是中英双语的**：`README.md`（简体中文，默认首页）与
  `README.en.md`（English）章节一一对应。改动其一时请同步另一份，避免两版
  内容漂移；只改单侧的 PR 会被要求补齐。

## 不会接受的改动

这些是架构原则，不是可以商量的实现细节：

- 代理远端 DSH 的操作 API、重写身份或接管其事件流；
- 读取、同步或转发 provider token 与任何凭据；
- 向远端设备安装插件作为核心功能的前提（`dsh-cockpit-bridge` 是**可选**增强）；
- 关闭 SSH host-key 校验，或把密钥/口令写进日志；
- 缓存 SSE 事件流（缓存死流会静默杀死状态聚合）。

## 提 Issue

请说明你的操作系统、Node 版本、`dsh-cockpit` 版本或 commit，以及复现步骤。
贴日志前记得删掉主机名、内网地址等敏感信息。
