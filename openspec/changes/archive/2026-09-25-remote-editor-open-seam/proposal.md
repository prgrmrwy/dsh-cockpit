## Why

驾驶舱的核心价值是「用宿主机的一个页面操作多台机器上的 DSH」。但有一类动作始终断在边界上：**在编辑器里打开远端 worktree 目录**。

设备侧 DSH 插件（如 ohmydsh 的 worktree-session）产出 `vscode://file/<path>` deep link，由宿主机浏览器交给系统 handler；宿主机 VS Code 在**自己的文件系统**上查找该路径，而路径属于 VM，打开失败。2026-09-15 实测确认。

关键事实是：**deep link 本身不需要跨机器传输** —— 触发它的浏览器进程本来就在宿主机上。缺的只是把路径标注成「属于哪台机器」的 authority 信息。VS Code 为此提供 `vscode://vscode-remote/ssh-remote+<alias><path>`，由宿主机的 Remote-SSH 扩展解析并建立连接。

驾驶舱**恰好是全系统唯一持有该信息的一方**：`DeviceRecord.sshAlias` 就是所需的 authority 材料，且 `ssh.ts` 的校验正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` 恰好排除 `@` 与 `:`，保证它是干净的 SSH config alias，拼进 `ssh-remote+<alias>` 零转义问题。设备侧插件无从得知自己经哪个 alias 被访问，宿主机浏览器无从得知路径属于哪台机器 —— 只有驾驶舱两边都知道。

## What Changes

- 既有 `bridge-config` 握手**增带可选 `sshAlias`**，使设备侧插件得知「远程编辑器打开」能力可用。本机设备不带该字段。
- bridge 插件向所在页面 **provide 一个稳定服务**，供同页面其它 DSH 插件经运行时探测消费；服务在调用时读取最新握手配置，合法 alias 可用时直接在原始用户手势中产出 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并交给系统 handler。
- 不新增 iframe→父页面反向动作消息：现有 `vscode://file/` 已能从 iframe 拉起宿主机 VS Code，失败仅因路径被按本机语义解释；保留原始用户激活链路也避免异步 postMessage 后被 popup blocker 拦截。
- 全部失败路径（无 alias、alias 非法、路径非法、origin 不匹配、能力缺失）一律**安全降级**，设备侧回落其本机默认行为，不伪造成功。

**BREAKING**：无。`bridge-config` 增加可选字段对旧版 bridge 无影响；未升级的设备表现为能力不可用并回落既有行为。

## Capabilities

### New Capabilities

无。本变更完全落在既有工作台与桥接能力的边界内。

### Modified Capabilities

- `cockpit-workbench`：
  - **MODIFIED** `Requirement: 远端边界与安全` —— 现行表述「不将远端路径交给本机打开器」与本方案字面冲突，需**收窄**为「不以本机路径语义交给本机打开器」，明确允许携带 remote authority 的显式远端引用。该禁令写于没有 `vscode-remote` 通道的前提下，其保护意图是「远端路径不被误当作本机路径解释」；`vscode-remote` authority 的语义与该担忧**相反** —— 它显式标注了路径属于哪台机器。禁令中「MUST NOT 调用远端 `host.openPath` 打开本机应用」与「MUST NOT 自动下载/同步工作区文件」两条**保持不变**。
  - **ADDED** `Requirement: 驾驶舱为设备提供远程编辑器打开接缝` —— 定义 alias 下发与校验、bridge 服务契约、URI 产出位置、路径校验与降级语义。
  - **ADDED** `Requirement: bridge 是唯一跨边界通信切面` —— 一切设备页面↔驾驶舱通信必须经 bridge，不新增第二条跨文档通道；bridge 暴露的能力面向任意同页面插件，以稳定完整服务名标识，MUST NOT 引用或假设任何具体消费方。

## Impact

**代码**

- `packages/cockpit-web`：父页面 `bridge-config` 下发增带 `sshAlias`；无新增反向监听器。
- `packages/dsh-cockpit-bridge`：握手解析增带 alias 字段校验；provide 稳定服务；服务在调用时校验路径并直接产出 URI。现有 `inject = ['sessions', 'uiSession']` 不变。
- `packages/shared`：如消息契约类型集中维护，需同步扩展。
- 需发版 `dsh-cockpit-bridge`（设备侧按其自身 manifest 升级 pin）。

**架构原则符合性**（逐条对照 README）

- **操作面零协议耦合** —— 不代理远端 API、不接管事件；本能力只在宿主机浏览器内产出一个 URI。
- **统筹面只读** —— 状态聚合面不变；本变更不读取任何新的远端数据。
- **远端零改造** —— 设备侧仍只需标准 `dsh web`；bridge 保持可选，不装则能力不可用，核心工作台不受影响。
- **两通道独立** —— 本能力位于 iframe 通道，失败不影响状态聚合。
- **不新增远端执行面** —— SSH 连接用途保持仅 `-L` 端口转发；URI 交给本地系统 handler，不经 SSH 执行任何命令。

**跨仓协调**

- 本 change 只覆盖驾驶舱侧。消费方位于 ohmydsh 仓，其 change `open-worktree-in-remote-editor` 已完成规划并记录了同一份契约。
- **消费方不直接对接本能力**：ohmydsh 侧采用三段式（驾驶舱能力 → 该仓的专用 shim → 目标插件的注册点），使目标插件与驾驶舱互不知晓。本仓无需知道该结构，只需保证能力面向任意插件且服务名稳定。
- **落地顺序**：驾驶舱侧必须先行。驾驶舱侧完成后能力被 provide 但无人消费，**无任何行为变化**；消费方随后升级 pin 才端到端生效。

## Open Questions

- 服务名与消息 `type` 的最终命名（现有前缀为 `dsh-cockpit:`），实施时按仓内惯例确定。
- 是否需要在设置或诊断面暴露「该设备远程打开可用/不可用」的可见状态。倾向不加：能力缺失时设备侧静默回落本机行为，与 bridge 既有的静默降级风格一致；但若用户难以判断为何打开行为不同，可后续补。
