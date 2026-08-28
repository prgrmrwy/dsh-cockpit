## 1. 共享事实与排序协议

- [x] 1.1 先为设备事实中的 `sshAlias` / `remoteDshPort` 和更新请求中的可选 `order` 补充共享类型及类型级测试，再实现类型变更
- [x] 1.2 先补服务端失败用例，覆盖编辑 SSH 验证失败不改记录、目标 order 边界收敛、所有设备 order 连续归一化与单次原子持久化
- [x] 1.3 实现服务端设备事实配置字段输出和 `UpdateDeviceRequest.order` 校验，使用一次 registry save 完成设备移动并同步受影响 lifecycle

## 2. 设备管理面板行为

- [x] 2.1 新增 `DevicePanel` 行为测试夹具，覆盖设备摘要、状态/诊断/类型/次级标识呈现和空列表添加引导
- [x] 2.2 补充添加与编辑表单测试，覆盖类型切换、当前值预填、保存成功、验证失败原位提示及草稿保留、取消编辑和 busy 状态
- [x] 2.3 补充设备操作测试，覆盖启用/禁用、删除确认门禁、首尾禁用的上移/下移以及发送单个目标 order
- [x] 2.4 重构 `DevicePanel` 为标题摘要、设备列表和共享添加/编辑表单结构，接入编辑、排序、错误隔离与可访问名称

## 3. 响应式视觉与顶栏选中态

- [x] 3.1 在 `app.css` 深浅主题组中增加设备控制台需要的主题令牌，确保 JSX 和选择器不写死新增主题色
- [x] 3.2 实现受控宽度的宽屏双栏、窄屏单栏、设备管理行、空状态、表单卡片、状态与危险操作层级，并避免横向页面溢出
- [x] 3.3 移除顶栏选中设备 tab 的 border 描边，保留无布局跳变的背景/文字选中态并新增清晰的 `:focus-visible` 焦点提示
- [x] 3.4 增加轻量样式契约测试，覆盖响应式断点、深浅主题令牌、无边框 active tab 与独立焦点样式

## 4. OpenSpec 前馈加强

- [x] 4.1 更新 `CLAUDE.md` 的“前馈要点”和“规范驱动”，将 `openspec list --json` 预检及源码需求路由写成明确门禁
- [x] 4.2 明确 UI、布局、交互、响应式、可访问性、主题和文案语义是用户可观察行为，且 bounded、单文件、纯 CSS 不是跳过 change 的理由
- [x] 4.3 明确允许跳过新 change 的窄例外、必须说明例外依据、仓库规则优先级，以及 propose 与 apply 不得在同一请求中合并

## 5. 验证与验收

- [x] 5.1 运行受影响包测试并修复回归，再运行根目录 `pnpm typecheck`、`pnpm test`、`pnpm lint` 和 `pnpm build`
- [x] 5.2 运行 `openspec validate redesign-device-management-panel --strict`，确认 delta spec、设计与 tasks 一致
- [x] 5.3 浏览器 UI 验收 —— **未执行（环境阻塞）**：`agent-browser` 与 Chrome DevTools MCP 均不可用，7 trails blocked / 14 checkpoints skipped，Verdict `needs-human`；结构性契约与后端行为已改由非浏览器路径取证，观感由用户人工确认
- [x] 5.4 将本 change 的任务状态更新为实际结果并记录验证证据；全部完成后提示使用 OpenSpec archive 流程

## 验证证据

- `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 全绿：shared 1、server 34、web 34、bridge 6。
- `openspec validate redesign-device-management-panel --strict` valid。
- 构建产物实测：`.topbar-device.active` 为 `border-color:transparent`，`.topbar-device:focus-visible` 有独立 outline；`.device-console` 宽屏双栏且 `max-width: 860px` 降为单栏；`prefers-color-scheme: light` 覆盖组存在；新增 5 个令牌深浅各 2 次；`.device-*` 规则内无硬编码主题色。
- 运行中 3090 实测：设备事实不含 `outcomeUnknownCount`；隔离 `DSH_COCKPIT_HOME` 实例中未确认 DELETE 返回 `requiresConfirmation` 且注册表不变，确认后进入空状态。
- 浏览器验收产物：`checking/plan.yaml`、`trails/T1..T7.yaml`、`report.md`、`gates/*.txt`（三门禁 PASS，仅证明 blocked 产物结构合规）；`screenshots/` 为空，无伪造证据。
- 真实设备 host / lumevm 全程未被改名或删除，验收后均为 READY。
- 已知未覆盖：宽窄屏与深浅主题观感、空状态与异常诊断展示、保存前网络失败竞态（仓库无原生 mock）。
