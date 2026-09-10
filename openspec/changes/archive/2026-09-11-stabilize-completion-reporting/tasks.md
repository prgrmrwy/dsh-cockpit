## 1. 基线/事件有序合并例程（D2）

- [x] 1.1 在 `DualEventStream`/连接流程中引入「缓冲模式」标志：缓冲可开关，事件入队不直通；提供 flush/回放入口
- [x] 1.2 将 `device-lifecycle.#connectRc2` 重构为「probe → 创建并 open 双流 → 缓冲模式 → 并行拉取 session.list 与 workspace.list → 应用基线 → 按序回放缓冲 → 恢复直通」的单一 reconciliation 例程
- [x] 1.3 将 `refresh()` 改为复用同一例程（缓冲在基线 RPC 期间全程开启，杜绝陈旧快照覆盖在途事件）
- [x] 1.4 为重连路径接通同一例程（`#replaceLoop`/重连后不再走旧的「先拉基线后开流」顺序）
- [x] 1.5 缓冲保护：上限（如 2000 条）与 5s 超时兜底；超时后先应用基线再回放已缓冲、之后恢复直通，不丢弃状态事件
- [x] 1.6 增加事件「缓冲中禁止直通」的单一写入门，保证 JS 单线程下无交错应用

## 2. 归档重连基线（D3）

- [x] 2.1 `rc2-client` 增加 `workspace.list` 一元 RPC（返回 `items` 与 `archivedSessionIds`）
- [x] 2.2 reconciliation 应用步骤中以 `workspace.list` 结果整体替换 `#archivedSessions`；在途 `archived-sessions-changed` 依赖 D2 回放顺序天然优先（基线后回放）
- [x] 2.3 `workspace.list` RPC 失败的兼容路径：保持事件驱动、记录诊断，行为退化为现状
- [x] 2.4 补充测试：断线期间归档/恢复后重连，归档集合被纠正；workspace.list 在途时归档事件不被陈旧基线回滚

## 3. session-removed 软语义（D4）

- [x] 3.1 `session-removed` 处理改为：清除该会话完成提醒与计数呈现（running=false、清 pending、移出归档集合、若为当前选择则清空选择快照），保留 generation/ack 轮次身份与 `#subagents` 分类知识，不再删除 `#sessions` 条目
- [x] 3.2 会话重新出现在基线时延续既有轮次：空闲无提醒、重新运行才 `generation+1`（与归档恢复语义一致）
- [x] 3.3 `#sessions` 有界保留：保守 LRU 淘汰（非 running、无未读提醒、非当前选择、非归档、不在最近基线中最久未用者；上限为实现常量）
- [x] 3.4 补充测试：removed 后重新出现不制造提醒、子代理 detach 后状态帧不进入根计数、后续真正重新运行仍正常生成提醒

## 4. Bridge capability 续签与自愈（D1、D5）

- [x] 4.1 Workbench 按 `expiresAt` 定时续签：到期前 15s 重请求，成功后重发 `bridge-config` 并重置下一轮定时；失败按 15s→2min 有上限退避；定时器按 deviceId 管理，切换/禁用清理
- [x] 4.2 Workbench 将「换发→重发握手」收敛为与 activation/load/endpoint 变化共用的单一例程
- [x] 4.3 bridge 客户端识别 capability 失效（401 或 400 且 `code=bridge-capability-invalid`）：重置 helloReady 并向父页面发送 `dsh-cockpit:capability-expired`，继续保留 outbox 重试
- [x] 4.4 Workbench 监听 `capability-expired` 消息（校验 source/origin）并触发限频换发（每设备 5s 至多一次）
- [x] 4.5 服务端 bridge 拒绝结构化作 WARN 日志：原因（过期/失效/错设备/未知 origin）、deviceId、协议版本；保持 400 + `bridge-capability-invalid` 响应体不变
- [x] 4.6 bridge 包发布物：`PLUGIN_VERSION` 递增至 0.2.x、重新构建 `lib/` 并通过 tsdown 校验双入口

## 5. 测试与验证

- [x] 5.1 server：连接/刷新/重连的盲窗回归测试（基线 RPC 期间发生 running→idle 必须生成提醒）、陈旧基线不覆盖事件、归档基线纠正、removed 软语义全场景、缓冲超时/上限
- [x] 5.2 web：capability 定时续签（含失败退避、切换设备清理定时器）、capability-expired 自愈、与既有 activation 路径共用不重复请求
- [x] 5.3 bridge：401/400 失效判定触发 capability-expired 且不丢 outbox、限频、换发成功后清除待确认
- [x]  5.4 全量 `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 绿
- [x] 5.5 真实实例验收：同一设备停留 >5 分钟打开完成会话仍能清除绿点；断线期间完成/归档后重连计数与提醒正确；人工清除兜底与未装 bridge 设备不受影响

## 验证记录

- 2026-09-11，本机实跑：`pnpm typecheck` / `pnpm lint` / `pnpm build` exit 0；`pnpm test` 全绿（根 8 + shared 1 + bridge 17 + web 73 + server 172）。
- 2026-09-11，5.5 真实实例验收由用户在本机驾驶舱（host / lumevm / devbox 三设备）执行并确认通过：停留超时后完成会话仍能清除绿点、断线重连后计数与提醒正确、人工清除兜底与未装 bridge 设备行为不受影响。**说明**：此项为运行中人机观察，非本仓库可自动复现的断言。
- 2026-09-11，代码核对：核心实现已落地——`device-lifecycle` 的基线缓冲/回放与 removed 软语义、`rc2-client` 的 `workspace.list`、bridge `PLUGIN_VERSION = 0.3.0`、web 端 capability 定时续签与 `capability-expired` 自愈。
- 2026-09-11，运维待办核对（proposal Impact 原记为「`host`、`devbox` 仍运行 bridge 0.1.2」）：实测三台设备均已装有 **dsh-cockpit-bridge 0.3.0**（`host` → `~/.dsh/profiles/web/node_modules/dsh-cockpit-bridge`，`lumevm` 与 `devbox` 同路径同名同版本），与仓源码 `PLUGIN_VERSION = '0.3.0'` 一致。该待办已不成立，proposal 中的描述为提出时的状态、现已被后续升级覆盖。

## 6. 文档与收口

- [x]  6.1 更新 `README.md`/`README.en.md`：明确「断线期间完成边缘不可回读」为协议已知边界；说明 capability 自动续签与桥接失效自愈；设备桥接升级步骤
- [x]  6.2 更新 bridge README 的协议说明（capability-expired 消息）
- [x]  6.3 核查 `cockpit-device-shell`、`cockpit-workbench` 规范的 removed/归档/聚合表述与本次 delta 一致（含「会话永久删除」表述移除）
- [x] 6.4 全部通过后按 OpenSpec archive 流程收口（含验证记录与截图）

**收口说明（2026-09-11）**：spec delta 已同步至主规范 `openspec/specs/cockpit-device-shell/spec.md`（`归档与恢复不制造完成提醒` 改为 detach 软语义并补齐 3 个场景、`状态聚合读取官方只读接口与事件流` 补 `workspace.list` 基线与回放/乱序收敛、新增 `完成未读 chip 的视觉呈现与常规状态 chip 严格一致`）与 `openspec/specs/cockpit-workbench/spec.md`（`桥接确认可检测失败并最终重试` 补 capability 自动续签与自愈）。`openspec validate --all --strict` 7 passed / 0 failed。截图未附——本 change 的验收证据为代码核对、自动化测试全绿与运行中人机观察，未采集界面截图。
## 7. 验收反馈修复（绿点闪烁）

- [x] 7.1 服务端 `session-removed` 不再清空桥接选择快照：选择快照交由 bridge 的 current 上报流维护（官方 DSH current 仅暂被遮蔽、重列后恢复），避免「detach→完成」窗口丢失完成边缘保护
- [x] 7.2 bridge 纯续签 `bridge-config` 不再重置 helloReady（不重跑 hello / 不重申 current）：只有真实 `device-activated` 才重申当前选择，杜绝「用户没看过却被误清」
- [x] 7.3 回归测试：detach 保留选择快照后完成不点亮、bridge 纯续签 config 零请求、401/400 自愈路径不受影响
- [x] 7.4 更新 spec delta 与 design（D1/D4 措辞）与上述语义一致；全套验证重跑通过（server 130/130、web 60/60、bridge 16/16）
- [x] 7.5 验收反馈：完成 chip（可点击 button）静止状态的盒模型与进行中/等待审批/等待回答 chip 完全一致——不得用 `font` 简写覆盖 `.session-chip` 的 11px/`line-height: 1`（同优先级且声明在其后，会把完成 chip 渲染得明显更大），边框盒与内边距统一，颜色继续走主题令牌；补样式契约测试（新增契约测试与 spec delta 场景，web 73/73、server 164/164、bridge 17/17 + 根 8 + shared 1 全绿）
