> **落地顺序**：本仓必须先行。完成后能力被 provide 但无消费方，行为零变化；消费方（ohmydsh 的 change `open-worktree-in-remote-editor`）随后升级 bridge pin 才端到端生效。

## 1. 消息契约

- [ ] 1.1 `packages/shared`：扩展 bridge 消息契约类型 —— `bridge-config` 增加可选 `sshAlias`，新增 `open-in-editor` 反向消息（载荷仅 `path`）；若契约类型分散在 bridge 包内则就地扩展并在此记录实际位置
- [ ] 1.2 定义并集中维护 alias 校验谓词（`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`），与 `packages/cockpit-server/src/connectivity/ssh.ts:44` 的既有正则保持单一真相源，不复制第二份字面量
- [ ] 1.3 定义并集中维护路径校验谓词（必须绝对路径、不含 `..` 段）

## 2. 父页面（cockpit-web）

- [ ] 2.1 `src/workbench/Workbench.tsx`：下发 `bridge-config`（`:26` 起的既有路径）时带上当前设备的 `DeviceRecord.sshAlias`；alias 缺失或不合法时不带该字段。确认能力续签与重发路径同样带上，避免续签后能力丢失
- [ ] 2.2 `src/workbench/Workbench.tsx`：新增反向消息接收端，按**封闭动作白名单**分发；未知 `type` 静默丢弃
- [ ] 2.2b 确认全仓无第二条设备页面↔驾驶舱跨文档通道：所有此类通信均经桥接插件
- [ ] 2.3 实现 `open-in-editor` 处理：独立校验 origin 与路径（不因设备侧已校验而跳过），拼装 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并 `window.open`；任一校验失败即拒绝且不产出 URI
- [ ] 2.4 确认监听器随设备切换/卸载正确清理，不泄漏到其它设备（参照既有 capability 续签定时器的清理方式）

## 3. 桥接插件（dsh-cockpit-bridge）

- [ ] 3.1 `src/client/index.ts`：扩展 `:57-69` 的握手解析，读取并校验可选 `sshAlias`；不合法即视为未提供。保持既有 origin 双向校验不变
- [ ] 3.2 provide 可选服务供同页面**任意** DSH 插件经运行时探测消费；仅在握手带来合法 alias 时声明可用。服务名 MUST 稳定且 MUST NOT 引用任何具体消费方；在 README 中把它记为跨仓契约的唯一真相源
- [ ] 3.3 服务方法接收绝对路径，向父页面 post `open-in-editor`（精确 `targetOrigin`，复用 `activeConfig.cockpitOrigin`）
- [ ] 3.4 **确认 `:23` 的 `export const inject` 保持 `['sessions', 'uiSession']` 不变** —— 新增的是 provide 而非 inject；写进 inject 会让缺该服务的 Host 静默不加载
- [ ] 3.5 bump bridge 版本号并更新 `packages/dsh-cockpit-bridge/README.md` 的协议说明

## 4. 测试

- [ ] 4.1 `packages/cockpit-web/tests/workbench.test.tsx`：远端设备下发的 `bridge-config` 含合法 alias；本机设备不含该字段
- [ ] 4.2 同上：`open-in-editor` 产出预期 URI（含 `?windowId=_blank`）
- [ ] 4.3 同上：相对路径被拒、含 `..` 路径被拒、非法 origin 被丢弃、未知 `type` 被丢弃 —— 四者均不产出 URI
- [ ] 4.4 `packages/dsh-cockpit-bridge/tests/client.test.ts`：合法 alias 使能力可用；缺失或非法 alias 使能力不可用
- [ ] 4.5 同上：服务调用向父页面 post 预期消息且 `targetOrigin` 精确
- [ ] 4.6 回归：既有 15 项 bridge 测试与 web 测试全部保持通过，证明只读上报链路无回归

## 5. 文档

- [ ] 5.1 `README.md` 的「桥接插件（可选）：与 DSH 的通信」小节：在协议表中增加 `sshAlias` 下发与 `open-in-editor` 反向请求两行，并说明这是**首条有副作用的反向通道**及其封闭动作集合约束
- [ ] 5.2 `README.md` 的「安全与边界」小节：补记「只传 alias 与路径、父页面独立校验、不新增远端执行面、SSH 用途仍仅端口转发」
- [ ] 5.3 `README.md` 补记前置条件（宿主机装 Remote-SSH）与已知边界（未装扩展时 URI 被静默丢弃、路径含点可能被当作文件打开）
- [ ] 5.4 `README.en.md` 同步

## 6. 验证与归档

- [ ] 6.1 `pnpm build` + typecheck + lint 全绿（五包）
- [ ] 6.2 server / web / bridge 三套 vitest 全绿
- [ ] 6.3 真机验收：远端设备工作台内触发打开，宿主机 VS Code 新窗口经 Remote-SSH 打开该设备上的目录
- [ ] 6.4 真机验收（降级）：本机设备触发打开，能力不可用，设备侧回落其本机行为
- [ ] 6.5 真机验收（故障）：alias 非法或路径非法时不产出 URI，且工作台其余功能不受影响
- [ ] 6.6 发版 `dsh-cockpit-bridge`，确认发布物含 host/client 双入口与 source map
- [ ] 6.7 确认 `openspec/specs/cockpit-workbench/spec.md` 已反映最终行为（含收窄后的「远端边界与安全」）后归档本 change
