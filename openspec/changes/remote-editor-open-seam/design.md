## Context

**现状**：驾驶舱与设备 DSH 页面之间已有一条 postMessage 通道（`packages/dsh-cockpit-bridge/src/client/index.ts`）：

- `:25` `dsh-cockpit:bridge-config` —— 父页面下发 `cockpitOrigin` 与短 TTL `capability`。
- `:57-69` 严格校验：`type` 匹配、字段类型、`url.origin === data.cockpitOrigin` 且 `event.origin === data.cockpitOrigin`。
- `:207` 反向 post `capability-expired`，向父页面请求换发能力。

即：**双向通道与 origin 校验均已存在**，本变更复用它，不新建。

**失败场景**：设备侧插件产出 `vscode://file/<VM 路径>`，宿主机浏览器交给系统 handler，宿主机 VS Code 在本地找不到该路径。2026-09-15 实测。

**为何驾驶舱是唯一可行的实现位置**：拼装 `ssh-remote+<alias><path>` 需要同时知道 alias 与 path。设备侧插件不知道自己经哪个 alias 被访问；宿主机浏览器不知道路径属于哪台机器；只有驾驶舱两边都知道（`DeviceRecord.sshAlias` + iframe 上报的 path）。

**既有材料的巧合优势**：`packages/cockpit-server/src/connectivity/ssh.ts:44` 的 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` 恰好排除 `@` 与 `:`，保证 alias 是干净的 SSH config 别名，拼进 URI 无需转义，也不会出现 `user@host:port` 形态在 Remote-SSH 各版本间的兼容问题。

## Goals / Non-Goals

**Goals:**

- 经驾驶舱访问远端设备时，设备侧插件能在宿主机编辑器中打开远端路径。
- 本机设备、未升级设备、未安装 bridge 的设备行为**完全不变**。
- 反向通道的信任边界显式成文（这是本仓第一条有副作用的 iframe→父页面通道）。
- 不新增远端执行面，不扩大 SSH 用途。

**Non-Goals:**

- 支持 `tunnel+` / `dev-container+` / `wsl+` 等其它 authority 形态。
- 代理任何远端操作或新增远端 API 调用。
- 为设备侧提供通用 RPC；动作集合封闭且仅此一项。
- 在驾驶舱 UI 中新增该能力的可见状态（见 proposal 的 Open Questions）。

## Decisions

### D1：URI 在父页面产出，iframe 只发路径

**决定**：iframe post `{type, path}`；父页面持有 alias、校验、拼装、`window.open`。

**理由**：

1. **技术必需** —— 跨源 iframe 内 `window.open('vscode://...')` 会被浏览器导航策略拦截。
2. **信任边界正确** —— alias 是驾驶舱侧事实，不必下发到 iframe 内；iframe 知道得越少越好。
3. **校验位置正确** —— 唯一能产出 URI 的一侧必须是把关的一侧。

**备选**：把 alias 下发给 iframe、由 iframe 自行拼装并 `window.open`。**否决** —— 被导航策略拦截，且无必要地把 alias 暴露进内嵌文档。

### D2：复用 `bridge-config` 握手，不新建通道

**决定**：`bridge-config` 增加可选 `sshAlias` 字段；新增 `open-in-editor` 作为反向消息 `type`。

**理由**：该通道已有经过实测的双向 origin 校验与 capability 续签逻辑。新建通道等于重复实现同一套校验，徒增攻击面与维护点。

**兼容性**：旧版 bridge 忽略未知字段；新版 bridge 遇到缺 `sshAlias` 的握手按能力不可用处理。两个方向都安全降级。

### D3：反向请求的动作集合封闭

**决定**：父页面维护一个已知 `type` 白名单，未知 `type` 静默丢弃。

**理由**：现有五条 bridge requirement 全部是只读上报；本变更让内嵌文档能触发父页面**执行动作**，是信任模型的类别变化。封闭集合把「将来可能被追加任意动作」的滑坡在结构上堵死 —— 加新动作必须显式改白名单并过 spec，而不是复用一个通用入口。

这条写进了 spec 而非仅 design，因为它约束的是**未来的改动**，不只是本次实现。

### D4：父页面独立校验，不信任 iframe 的校验声明

**决定**：即使设备侧已校验路径，父页面仍独立完成 origin 与参数校验。

**理由**：iframe 内运行的是**设备上的**代码，其可信度取决于该设备的 DSH 与其已装插件。驾驶舱不应假设它未被篡改或不存在 bug。设备侧的校验是为了早失败与省一次往返，不是信任依据。

### D5：路径校验限于「绝对路径 + 拒 `..`」

**决定**：不做目录白名单。

**理由**：worktree 路径由设备 DSH 的绑定元数据决定，合法值域本身就是任意绝对路径；过严的白名单会误伤正常场景。校验目标是**阻止路径穿越与相对路径歧义**，不是做授权 —— 授权边界是「用户已经把这台设备加进了驾驶舱并建立了免密 SSH」。

### D6：`windowId=_blank` 强制新窗口

**决定**：URI 带 `?windowId=_blank`。

**理由**：VS Code 1.67 起该参数强制在新窗口处理 URI；不带则可能复用当前窗口，顶掉用户正在看的本地项目。

### D7：只支持 `ssh-remote+`

**决定**：本次不为其它 authority 形态做抽象。

**理由**：驾驶舱的连接模型就是 SSH（`tunnel-manager.ts` 走 `-L` 端口转发），`DeviceRecord` 中也只有 `sshAlias`。为 `tunnel+` 等做抽象没有对应的数据来源，属投机设计。

## Risks / Trade-offs

- **[规范禁令冲突]** `Requirement: 远端边界与安全` 原文「不把远端路径交给本机工具」与本方案字面冲突。→ **处理**：本 change 以 MODIFIED **收窄**该禁令为「不以本机路径语义交给」，并明确允许携带显式 remote authority 的引用。理由记录在 proposal：该禁令写于没有 `vscode-remote` 通道的前提下，其保护意图是「远端路径不被误解为本机路径」，而 `vscode-remote` authority 的语义与该担忧相反。原禁令中关于 `host.openPath` 与自动同步文件的两条**保持不变**。这是用户明确确认后的决定，不是实现者单方判定。

- **[信任模型类别变化]** 首次出现 iframe→父页面的有副作用通道，后续容易被追加更多动作。→ **缓解**：D3 的封闭动作集合 + spec 中的「桥接反向请求的信任边界」requirement；新增动作必须过 spec。

- **[宿主机未装 Remote-SSH]** URI 被 VS Code **静默丢弃**，无任何提示。→ **缓解**：spec 要求不伪造成功；README 中列为前置条件。浏览器侧无法探测扩展是否安装，这是不可消除的边界。

- **[目录 vs 文件歧义]** URI handler 无法 stat 远端路径，只能靠扩展名猜测；路径含点（如仓库名 `foo.bar`）可能被当作文件打开。→ **缓解**：接受并在文档注明；这是 VS Code 深链的固有行为，非本设计引入。CLI 的 `--folder-uri` 可强制，深链没有对应参数。

- **[首次连接需交互]** host key 确认或密钥密码会让 VS Code 停在连接中。→ **缓解**：属正常行为，文档说明；不视为失败。

- **[跨仓版本偏移]** bridge 与父页面必须同步升级。→ **缓解**：缺 `sshAlias` 即按能力缺失降级，偏移表现为「回落设备侧本机行为」而非报错。

## Migration Plan

1. 实施并发版 `dsh-cockpit-bridge`。此时能力被 provide 但**无消费方**，行为零变化。
2. 消费方（ohmydsh 的 `open-worktree-in-remote-editor`）升级 pin 后端到端生效。
3. **回滚**：任一侧回退即自动回落设备侧本机行为 —— 降级路径是设计的一部分，回滚无需额外动作。

## Open Questions

- 服务名与消息 `type` 的最终命名，按仓内 `dsh-cockpit:` 前缀惯例在实施时确定。
- 是否在诊断面暴露「该设备远程打开可用/不可用」。倾向不加，见 proposal。
