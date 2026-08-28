# 验收自测报告：redesign-device-management-panel

**日期**：2026-08-28  
**Base commit**：4ffe12d075d461822a4c78c213d482c1df4d45e9  
**设备**：both（pc 1280x800；mobile iOS/iPhone 14 390x844）  
**入口**：http://127.0.0.1:3090/  
**来源**：OpenSpec 与用户确认的最新 UI scope；无 QA XMind、Bits 用例、PRD、Figma 或独立验收来源  
**Focus**：all  
**执行引擎事实**：`agent-browser --version 2>/dev/null` exit 127；Chrome DevTools MCP unavailable

## Verdict

**needs-human**

浏览器执行被阻塞：两种允许的引擎均不可用，因此 7 条 trails 全部为 `blocked`，14 个 checkpoints 全部为 `skipped`。本报告是 blocked execution artifacts，不是完成验收；**0 PASS / 0 FAIL / 0 manual-result / 14 skipped**，不能据此验收或宣称 UI 符合预期。

## 主代理补充：非浏览器路径已取得的真实证据

以下由主代理实际执行，**不属于浏览器 trail**，不计入上面的 PASS/FAIL 统计，但可缩小人工确认范围。

### 自动化测试（实际运行，全绿）

```text
pnpm typecheck / test / lint / build
shared 1 · server 34 · web 34 · bridge 6
```

web 用例已覆盖：设备摘要与人类可读状态、类型与次级标识、空状态引导、添加失败原位报错且保留输入、编辑预填与失败保留、启用/禁用、首尾禁用的上移下移且只发一次目标 order、删除确认与取消零请求。

### 构建产物视觉契约（对 `dist/assets/*.css` 实测）

| 契约 | 实测结果 |
| --- | --- |
| 选中 tab 无 border | `.topbar-device.active{...border-color:transparent}` |
| 独立键盘焦点提示 | `.topbar-device:focus-visible{outline:2px solid var(--focus-ring)...}` |
| 宽屏双栏 | `.device-console{...minmax(0,1fr) minmax(280px,360px)}` |
| 窄屏单栏 | `@media (max-width: 860px)` 内 `.device-console{grid-template-columns:minmax(0,1fr)}` |
| 断点存在 | `@media (max-width: 520px)`、`@media (max-width: 860px)` |
| 主题跟随系统 | `@media (prefers-color-scheme: light)` 覆盖组存在 |
| 新增令牌深浅成对 | surface-raised / accent-soft / danger-soft / focus-ring / shadow-panel 各 2 次 |
| 无硬编码主题色 | `.device-*` 规则内未匹配到任何 `#hex` 或 `rgb()` |

### 后端行为（对运行中 3090 与隔离实例实测）

- 设备事实已不含 `outcomeUnknownCount`。
- 隔离实例（独立 `DSH_COCKPIT_HOME`）：未确认 DELETE 返回 `{"removed":false,"requiresConfirmation":true}` 且注册表不变；`?confirmed=true` 后删除成功并进入空状态。
- 临时实例已清理，受管 cockpit 已恢复，host / lumevm 均为 READY。

### 因此仍需人眼确认的，仅为观感层

宽窄屏实际排版与是否溢出、深浅主题对比度与层级、选中 tab 与焦点提示的视觉效果。结构性规则与行为逻辑已有客观证据。

## 独立性

**低**。oracle 仅来自 OpenSpec 与用户补充的同源 scope，没有 QA XMind、Bits 质量中心用例或其他 independent 来源。**oracle 与实现同源，绿不等于免人工**；本轮甚至没有执行结果，故更不能据此免除人工验收。

## 范围声明

### 固定范围

本轮固定范围仅为 `http://127.0.0.1:3090/` 的设备管理 UI 黑盒：

- T1 面板标题/摘要/设备行。
- T2 宽屏深色。
- T3 窄屏浅色无横向溢出。
- T4 顶栏 active 无 border + 键盘 focus。
- T5 编辑预填 + 新增 invalid SSH 失败保留输入。
- T6 排序上移/下移并恢复。
- T7 删除按钮弹确认且取消后设备仍在列表，并断言取消时不发请求。

最新语义已固定：`DeviceStatusFacts` 无 `outcomeUnknownCount`；删除对所有设备无条件确认；取消时前端不发任何请求；只有确认才 `confirmed:true`。本轮不重复后端门禁，只验 UI。

**编号漂移说明**：编号已在最新 UI scope 重编。当前 T6 固定为排序上移/下移并恢复，不能被旧计划所称的“空/异常 T6”覆盖；空状态与异常状态现作为最新 7 trails 之外的额外 `planned-but-execution-blocked` scope。当前 T7 固定为删除确认与取消零请求；旧计划所称的“T7 保存前网络失败”现只记录为 blocked/uncovered gap，不覆盖删除 trail。

真实 live 设备固定为：

- `host`：`device-cuabymib`，local，order 0，READY，enabled。
- `lumevm`：`device-wr3r7ako`，remote，`sshAlias=lumevm`，order 1，READY，enabled。

禁止改名或删除。未来执行 T6 时必须在 `finally` 恢复 `host order 0 / lumevm order 1` 并刷新、回读确认。T7 一律取消，绝不确认删除。

本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能

## Mock 证据

`plan.yaml` 现记录 `meta.mock.status=no-native-mock`。最新 7 条 UI trails 仍直接面向真实 3090 的两台 READY 设备及可恢复场景；仓库无用于空态、异常态或保存前网络失败的原生 mock，本轮未启用、未发明、未修改任何 mock/fixture。

用户已提供可复现的隔离操作方法，状态由“方法 unknown”更新为 **`available setup, execution blocked by browser engine`**：

1. stop managed cockpit；
2. 使用隔离的 `DSH_COCKPIT_HOME=/tmp/cockpit-verify-home`，在端口 3090 启动 built server，先观察 `isolated-empty`；
3. 在隔离 home 中新增指向本机端口 `39999` 的设备，观察 `isolated-abnormal`；
4. cleanup：kill isolated server，删除 `/tmp/cockpit-verify-home`，restart managed cockpit；
5. 最终确认 `host` 与 `lumevm` 两台设备均恢复为 READY。

**这些 shell 步骤本轮没有实际执行。** 强制前置重检仍为 `agent-browser --version 2>/dev/null` exit 127，且当前 session 无 Chrome DevTools MCP；没有浏览器就无法观察隔离 UI，执行 stop/start 无验证收益且会无谓中断 managed 服务。因此 isolated-empty 与 isolated-abnormal 仅为 `planned-but-execution-blocked`，不计入 PASS，也不映射为当前 T6。

| 场景 | 状态 | 证据 | 启用方式 | 覆盖 checkpoint / scope | 用户决定 |
|---|---|---|---|---|---|
| live-two-ready | not_needed | 用户给定 host/lumevm live 事实 | 无；真实 3090 | T1、T2、T3、T4 | 最新 UI scope，待浏览器引擎恢复 |
| invalid-ssh | not_needed | 用户指定真实 UI 提交明显无效 alias；后端门禁不重复 | 无；真实新增表单 | T5 | 仅期待失败，不改现有设备 |
| reorder-restore | not_needed | 用户指定真实共享状态与强制恢复顺序 | 无；真实排序 UI | T6 | single agent；finally 恢复 |
| delete-cancel | not_needed | 用户指定所有设备确认、取消零请求 | 无；真实确认框 | T7 | 一律取消，绝不确认 |
| isolated-empty | planned-but-execution-blocked | 用户提供完整隔离 setup 与 cleanup | isolated home + built server 3090 | 额外 blocked scope；不占用 T6 | 浏览器 engine 恢复后方可执行 setup |
| isolated-abnormal-local-port-39999 | planned-but-execution-blocked | 用户提供 local port 39999 的异常设备构造法 | 同一 isolated home | 额外 blocked scope；不占用 T6 | 浏览器 engine 恢复后方可执行 setup |
| 保存前网络失败 | blocked/uncovered | 仓库无原生 mock；不构造 fixture | 无可执行原生 mock setup | report gap/manual；不是当前 T7 | 保持未覆盖，等待独立可控方案 |

### Surface × 数据态覆盖

| Surface | 数据源 | 数据态 | Trail | 状态 | 缺口 |
|---|---|---|---|---|---|
| device-management-panel-and-topbar | `/api/devices` | live-two-ready | T1、T2、T3、T4 | blocked | 浏览器引擎不可用；DOM、样式、响应式与截图均未观察 |
| device-edit-and-add-form | `/api/devices` | invalid-ssh | T5 | blocked | 浏览器引擎不可用；未填写、未提交、未观察错误与输入保留 |
| device-list-and-topbar-order | `/api/devices` | reorder-restore | T6 | blocked | 浏览器引擎不可用；未执行排序，真实顺序未被修改 |
| delete-confirm-dialog-and-device-list | `/api/devices` | delete-cancel | T7 | blocked | 浏览器引擎不可用；未弹确认框、未取消、未监听网络 |
| device-management-panel-and-topbar | `/api/devices` | isolated-empty | 额外 scope（非 T6） | planned-but-execution-blocked | setup 已知但 engine 不可用；本轮未 stop managed、未启动 isolated 3090 |
| device-management-panel-and-topbar | `/api/devices` | isolated-abnormal / local port 39999 | 额外 scope（非 T6） | planned-but-execution-blocked | setup 已知但 engine 不可用；本轮未新增异常设备 |
| device-add-form | `/api/devices` | 保存前网络失败 | gap/manual（非 T7） | blocked/uncovered | 仓库无原生 mock，不构造 fixture；未覆盖失败反馈、草稿保留或零错误写入 |

## 执行策略

| 推荐 | 用户选择 | 依据 | 风险 | 分工 |
|---|---|---|---|---|
| single_only | single_agent | 用户明确要求直接执行；3090 使用真实共享注册表；T6 有可恢复排序写操作；T7 涉及删除确认安全边界 | 引擎不可用导致整体 blocked；未来 T6 必须 finally 恢复；T7 只能取消 | verifying-acceptance：T1–T7 串行 |

没有启动子 agent，也没有并行执行。用户选择已写入 `plan.yaml`：`recommendation=single_only`、`selected=single_agent`。

## 手动验收项

以下项目保留原本可执行时的 `manual / visual_inspect` 分类；本轮因无法启动浏览器和生成截图，其 checkpoint 结果仍统一为 `skipped`，不是 `manual` 结果：

- [ ] 1280x800 深色主题双栏、READY 与危险/常规操作层级 — 引擎恢复后生成宽屏深色截图，人工检查标题、摘要、列表、表单、主题令牌、对比度及操作区分。
- [ ] 390x844 浅色主题单栏层级 — 引擎恢复后生成窄屏浅色截图，人工检查间距、文字、卡片、表单和操作。
- [ ] 键盘 focus-visible 清晰度 — 引擎恢复后仅用键盘移动焦点，人工检查 focus 与 active 无 border 选中态独立。

## 期望来源缺口

| Checkpoint | Surface | expected_source | 状态 | 说明 |
|---|---|---|---|---|
| — | — | — | none | 14 个 checkpoint 均标记 `expected_source=openspec`、`expected_unverified=false`；但缺少独立 QA/设计来源，整体独立性仍为低 |

## Live API 安全复核

- 本轮没有浏览器引擎，因此没有向 `http://127.0.0.1:3090/` 导航，也没有发出任何 UI/API 请求。
- 没有执行 POST、PUT、DELETE 或其他真实写操作；没有新增无效设备，没有改变排序，没有打开或确认删除。
- `host` 与 `lumevm` 没有被改名或删除；本轮未触碰其 enabled 状态。
- T6 仅保留未来执行安全契约：无论断言成功或失败，都要 `finally` 恢复 `host order 0 / lumevm order 1`。
- T7 仅保留未来执行安全契约：只弹确认并取消；取消时断言请求数为 0；绝不触发 `confirmed:true` 确认路径。
- 旧 superseded `DELETE-GUARDED` / `DELETE-PLAIN` 检查点保持历史 `skipped` 且不计 PASS；它们不再是可执行 checkpoint，也不会被重新引入。当前删除语义唯一以 T7 的“所有设备一律确认、取消零请求”为准。
- 用户提供的 isolated stop/start/cleanup 步骤本轮全部未执行；managed 服务未被无谓中断，`/tmp/cockpit-verify-home` 未由本轮创建，local port 39999 异常设备也未创建。
- screenshots/ 目录已保留为空，没有创建或伪造截图。

## Loop 1

Loop 1 因浏览器引擎不可用，在执行任何页面动作前终止。聚合结果：**0 passed，0 failed，0 manual，14 skipped；7 blocked trails**。

### Integration（0 passed, 0 failed, 0 manual, 3 skipped）

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 1 | lumevm 上移后列表/顶栏同步并刷新持久化 | T6 | skipped | 引擎不可用；未点击、未发送 PUT | 未观察临时顺序；不能判 PASS/FAIL |
| 2 | lumevm 下移并 finally 恢复 host=0、lumevm=1 | T6 | skipped | 引擎不可用；本轮没有真实写操作 | 未执行恢复链路；当前原序也未被本轮改变；不能判 PASS/FAIL |
| 3 | 删除确认取消后不发送任何请求，设备仍在列表且顺序不变 | T7 | skipped | 引擎不可用；未点击删除/取消，未监听网络 | 零请求断言与列表保留均未观察；不能判 PASS/FAIL |

### Interaction（0 passed, 0 failed, 0 manual, 7 skipped）

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 1 | 打开面板后显示标题、两台 READY 摘要及 host/lumevm 完整设备行事实，且不含 outcomeUnknownCount | T1 | skipped | 引擎不可用；无 DOM 或截图 | 面板和设备行未观察；不能判 PASS/FAIL |
| 2 | 390x844 下单栏重排且页面无横向溢出 | T3 | skipped | 引擎不可用；未读取 scrollWidth/clientWidth | 响应式布局未观察；不能判 PASS/FAIL |
| 3 | 点击编辑 lumevm 后现有值正确预填 | T5 | skipped | 引擎不可用；未点击或读取表单值 | 编辑预填未观察；不能判 PASS/FAIL |
| 4 | 取消编辑后恢复新增模式且 lumevm 不变 | T5 | skipped | 引擎不可用；未执行取消 | 表单模式和设备不变未观察；不能判 PASS/FAIL |
| 5 | 填写新增表单后逐字段回显且提交前仍只有两台设备 | T5 | skipped | 引擎不可用；未填表 | 输入回显未观察；不能判 PASS/FAIL |
| 6 | 点击保存后显示 invalid SSH 失败诊断、保留输入且列表仍为两项 | T5 | skipped | 引擎不可用；未提交或读取 DOM | UI 失败状态未观察；不能判 PASS/FAIL |
| 7 | 点击任意设备删除后无条件弹确认，确认语义才携带 confirmed:true | T7 | skipped | 引擎不可用；未点击删除 | 确认框和确认语义未观察；不能判 PASS/FAIL |

### Visual（0 passed, 0 failed, 0 manual, 4 skipped）

| # | 声明 | Trail | 结果 | 证据 | 缺口 |
|---|---|---|---|---|---|
| 1 | 1280x800 深色面板为清晰双栏，主题令牌、READY 状态和危险/常规操作视觉区分正确 | T2 | skipped | 引擎不可用；screenshots/ 为空 | 无截图、未人工观察；不能判 PASS/FAIL/manual |
| 2 | 390x844 浅色主题视觉层级清晰且主要操作不裁切 | T3 | skipped | 引擎不可用；screenshots/ 为空 | 无截图、未人工观察；不能判 PASS/FAIL/manual |
| 3 | 顶栏 active 以主题前景背景区分、无 border 且尺寸稳定 | T4 | skipped | 引擎不可用；未读取 computed style 或 bounding box | active 样式未观察；不能判 PASS/FAIL |
| 4 | Tab 键触发独立清晰的 focus-visible 且无尺寸跳变 | T4 | skipped | 引擎不可用；未发送按键、无截图 | 焦点视觉未观察；不能判 PASS/FAIL/manual |

### 阻塞的 Trails

| Trail | 原因 | 建议 |
|---|---|---|
| T1 面板标题、摘要与设备行 | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 安装/恢复 agent-browser，或为 session 提供 Chrome DevTools MCP 后从 T1 重跑 |
| T2 宽屏深色主题 | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 引擎恢复后以 1280x800 深色执行并生成真实截图 |
| T3 窄屏浅色无横向溢出 | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 引擎恢复后以 390x844 浅色执行 DOM 尺寸断言并生成真实截图 |
| T4 顶栏 active 无 border 与键盘 focus | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 引擎恢复后执行 computed style、尺寸及真实键盘焦点检查 |
| T5 编辑预填与新增 invalid SSH | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 引擎恢复后串行执行；只提交新 invalid SSH，禁止保存现有设备编辑 |
| T6 排序上移、下移并恢复 | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 引擎恢复后单 agent 执行，并在 finally 恢复、刷新、回读原序 |
| T7 删除确认与取消无请求 | `agent-browser exit 127; Chrome DevTools MCP unavailable` | 引擎恢复后只点击取消，监听并断言取消请求数为 0，绝不确认 |

### 未覆盖 / 天然盲区

| 场景 | 原因 | 建议 |
|---|---|---|
| 所有浏览器 UI 行为 | 两种允许的浏览器引擎均不可用 | 恢复 `agent-browser` 或 Chrome DevTools MCP 后完整重跑 T1–T7 |
| 视觉与截图证据 | 页面无法打开，无法生成真实截图 | 引擎恢复后生成截图；禁止以文档或代码推断替代截图 |
| 键盘 focus-visible 清晰度 | 需要真实按键与人工视觉判断 | 在真实浏览器中仅用键盘执行并人工检查 |
| IME composition | 当前 scope 未定义 IME checkpoint，自动 type 也不能代表真实输入法合成 | 若后续纳入输入法要求，增加独立人工 trail |
| 竞态/flaky 行为 | 单次确定性 trail 天然不覆盖偶现竞态；本轮更未执行 | 另行设计多轮、慢网和快速切换策略，不得从本轮推断 |
| isolated-empty / isolated-abnormal | 隔离 setup 已由用户提供，但浏览器 engine 不可用；本轮没有执行任何 stop/start/cleanup shell 步骤 | engine 恢复后按 setup 执行；它们是额外 blocked scope，不覆盖当前 T6 排序 |
| 保存前网络失败 | 仓库无原生 mock，且不构造 fixture；没有可控失败注入证据 | 保持 blocked/uncovered gap/manual；不是当前 T7，不能从 invalid SSH 或删除取消推断 |
| 旧 DELETE-GUARDED / DELETE-PLAIN | 已被最新统一确认语义 supersede，历史结果仅 skipped | 不重新引入为可执行 checkpoint，不计 PASS；当前删除 cancel 为 T7 |
| 后端门禁 | 本轮明确不重复，且隔离服务步骤未执行 | 不要将本 UI blocked 报告表述为后端复验 |

## 声明 × 证据 × 缺口台账

上方 Loop 1 的三个 focus 表格已逐 checkpoint 给出“声明 × 证据 × 缺口”。汇总如下：

| 范围声明 | 本轮证据 | 结论缺口 |
|---|---|---|
| T1 面板标题/摘要/设备行 | 1 个聚合 checkpoint `skipped`；仅有引擎阻塞事实 | 无 DOM/截图，不能验收 |
| T2 宽屏深色 | 1 个聚合 checkpoint `skipped`；screenshots/ 为空 | 无人工视觉证据，不能验收 |
| T3 窄屏浅色无溢出 | 2 个 checkpoint 均 `skipped` | 无尺寸/截图证据，不能验收 |
| T4 active 无 border + 键盘 focus | 2 个 checkpoint 均 `skipped` | 无 computed style、尺寸或焦点截图，不能验收 |
| T5 编辑预填 + invalid SSH 失败保留输入 | 4 个 checkpoint 均 `skipped`；没有请求或真实写操作 | 无预填、回显、失败诊断或草稿保留证据，不能验收 |
| T6 排序上移/下移并恢复 | 2 个 checkpoint 均 `skipped`；没有真实写操作 | 未验证排序与 finally 恢复链路，不能验收 |
| T7 删除确认且取消零请求 | 2 个 checkpoint 均 `skipped`；没有真实写操作 | 未验证确认框、取消零请求和设备保留，不能验收 |

**最终声明**：本轮只完成 blocked execution artifacts 的如实整理，未完成浏览器验收；没有截图、没有 PASS、没有 FAIL、没有真实写操作。
