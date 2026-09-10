## 1. 归因分类(D1)

- [x] 1.1 `connectivity.service.ts`：把既有桥接拒绝归因映射为分类——`capability`（`invalid or expired bridge capability`，含过期/失效/错设备）与 `unknown-origin`（`no cockpit device matches origin …`）；分类函数为纯函数、可单测，不改动抛错文本与抛错时机
- [x] 1.2 保持 `validateBridgeCapability` 与 `#lifecycleByOrigin` 的既有错误消息不变（它们是既有测试与日志字段的依据），分类只做读取映射

## 2. 分级与聚合(D2、D3、D4)

- [x] 2.1 `connectivity.service.ts`：新增按设备的最小桥接拒绝状态——窗口起点、按归因的计数；数据结构上限为「启用设备数 × 归因类别数」
- [x] 2.2 归零信号复用既有 `#recordBridgeSuccess`：任一成功桥接上报即清除该设备的拒绝计数与窗口
- [x] 2.3 阈值与窗口作为集中定义的常量（保守值，数量级为数十次 / 约十分钟级窗口），并在注释中说明取值理由与两类错误代价不对称
- [x] 2.4 `devices.controller.ts`：`authorizeBridge` 的拒绝日志改为——常规拒绝走调试级并携带 deviceId/origin/协议版本/归因；同一设备同一归因在窗口内聚合计数而非逐条输出
- [x] 2.5 自愈失败（窗口内拒绝达阈值且期间无成功上报）提升为告警级，输出含设备标识、归因分类与窗口内条数
- [x] 2.6 设备删除或禁用时清理其桥接拒绝状态，避免残留（随既有注册表变更路径）
- [x] 2.7 确认日志字段不含 token / capability 明文 / 会话正文 / provider 凭据

## 3. 调试级可开启(D5)

- [x] 3.1 `main.ts`：Nest logger 级别在既有 `['error','warn','log']` 基础上纳入 `debug`，使降级后的桥接条目可被有意开启
- [x] 3.2 确认纳入 `debug` 后默认输出面不再出现常规拒绝刷屏（降级条目不进入 warn 通道）

## 4. 不变式与回归

- [x] 4.1 确认拒绝语义完全不变：capability 类失效仍返回 400 且错误码为 `bridge-capability-invalid`；状态码、响应体、换发与重投行为、人工清除兜底、鉴权边界均不受日志分级影响
- [x] 4.2 确认端口漂移与本地端口持久化失败仍为告警级（它们是真故障信号，不在本次降级范围）
- [x] 4.3 回归：既有桥接相关测试（`devices.controller.test.ts`、`connectivity.service.test.ts`、`bridge-capability.test.ts`）全部保持通过

## 5. 测试

- [x] 5.1 分类纯函数单测：两类归因各自映射正确，未知归因有确定的兜底分类
- [x] 5.2 常规拒绝 → 调试级记录且不含告警级条目；断言字段含 deviceId/origin/协议版本/归因
- [x] 5.3 自愈成功 → 计数与窗口归零，随后不产生告警
- [x] 5.4 窗口内拒绝达阈值且无成功上报 → 恰好一条告警级记录，含设备标识、归因与条数
- [x] 5.5 聚合：同设备同归因连续拒绝 N 次只产生一条聚合输出，且条数正确
- [x] 5.6 拒绝语义不变：断言 400 + `bridge-capability-invalid` 响应体与拒绝行为不受分级影响

## 6. 验证与收口

- [x] 6.1 实际运行并记录 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`
- [x] 6.2 真实实例验收：重启驾驶舱后观察一段时间，确认新产生的常规桥接拒绝不再进入告警级、既有告警级（端口漂移/持久化失败）仍正常
- [x] 6.3 真实实例验收：开启调试级后确认常规拒绝的结构化条目可见且可按设备/归因排查
- [x] 6.4 `openspec validate --strict` 通过后，按 OpenSpec archive 流程收口（含验证记录）

## 验证记录（2026-09-11）

**A. 自动化验证（本机实跑）**

- `pnpm typecheck` / `pnpm lint` / `pnpm build` exit 0；`pnpm test` 全绿（根 8 + shared 1 + bridge 17 + web 73 + server **189**）。
- 新增 `tests/bridge-rejection-log.test.ts` 17 条：分类纯函数（两类归因 + 未知兜底）、常规拒绝保持 debug、按 device+class 独立聚合计数、阈值处恰好提升一次、告警携带窗口条数、窗口内成功上报的设备不提升、成功归零、窗口过期重开、设备独立计费、forget 清理；控制器层断言 debug 条目含 device/origin/protocolVersion/reason/class/count、告警含 `self-healing failed` 与条数、**400 + `bridge-capability-invalid` 响应体与分级无关**、以及分级方法缺失时仍原样抛出原拒绝。
- 既有 172 条测试全部保持通过（含 `devices.controller.test.ts` 的伪造 capability 用例）。

**B. 真实实例验收（隔离实例，端口 3099 + 独立 `DSH_COCKPIT_HOME`，不触碰运行中的 3090）**

- 以真实 HTTP 请求向 `/api/bridge/session-opened` 发送带伪造 capability 的回调：响应为 `400` 且 `message` 仍为 `no cockpit device matches origin …`——拒绝语义未变。
- 3 次拒绝后日志级别分布为 `26 LOG + 3 DEBUG + 0 WARN`：常规拒绝**不再进入告警级**，且 DEBUG 条目实际可见（证明 `main.ts` 纳入 `debug` 生效，降级不等于丢失）。
- 条目形态：`DEBUG [DevicesController] bridge callback rejected: device=unknown origin=http://127.0.0.1:62595 protocolVersion=2 reason=… class=unknown-origin count=3` —— 具备按设备/归因排查所需的全部结构字段。
- 累计 25 次拒绝（阈值 20）后：**恰好 1 条** WARN，内容为 `bridge self-healing failed: … class=unknown-origin count=20`；其后 5 次拒绝未再产生告警——一个 episode 一次告警。
- 隔离实例停止后 3099 释放，运行中的 3090 实例（pid 28609）不受影响。

**C. 运行实例验收（`bin/cockpit restart` 后，pid 56247，真实 3090 + 真实三设备）**

- 重启前基线：日志共 1640 行，WARN **889 条且全部**为 `bridge callback rejected`——即旧构建下告警级被单一自愈路径占满。
- `restart` 后新进程（56247）加载新构建（`dist/main.js` 的 `logger: ['error','warn','log','debug']`）。三设备全部恢复 `READY`，且 `lumevm` 端口保持 `54695`、`devbox` 保持 `63333`——端口持久化未受重启影响。
- 对**真实设备 origin**（`http://127.0.0.1:3080`）发送带伪造 capability 的桥接回调，命中主导路径（capability 失效而非 origin 不匹配）：响应 `400` + `{"code":"bridge-capability-invalid","message":"invalid or expired bridge capability"}`——**拒绝语义逐字未变**。
- 该拒绝被记录为 DEBUG：`DEBUG [DevicesController] bridge callback rejected: device=device-cuabymib origin=http://127.0.0.1:3080 protocolVersion=2 reason=invalid or expired bridge capability class=capability count=1`——能力项路径在运行实例上同样降级且字段完整（补上了 B/C 之前只覆盖 origin 路径的缺口）。
- 两次强制拒绝的条目均为 `count=1`，说明计数器在两次之间被**真实成功上报**归零（D2 的「健康设备保持安静」在真机上生效）。
- 重启后至观察结束：`26 LOG + 2 DEBUG + 0 WARN`，WARN 中桥接拒绝 **0 条**。

**D. 说明与证据边界**

- 隔离实例的设备注册需先通过非交互 SSH 身份验证（既有要求），未在本轮深入，因此 B 段的能力项端到端证据当时以控制器层测试为主；该缺口已由 C 段的真实设备 origin 用例补齐。
- **稳态窗口不足以独立证明自然降噪**：重启后 150 秒观察窗内真实桥接**未自然产生**拒绝（该窗口内仅有两笔人为强制拒绝），而此前自然拒绝速率约为「几天内 889 条」量级，故「无 WARN」在此窗口内不构成对降级行为的独立证明。降级行为的证据来自 B 段隔离实例（含阈值提升与聚合）与 C 段真实 origin 用例，二者均为受控触发。自然速率的长期确认属运行观察，不在本 change 的断言范围。
- `bridge-rejection-log.ts` 为新增模块，聚合状态为进程内存态、不持久化；设备删除/禁用经 `#detach` 清理。
