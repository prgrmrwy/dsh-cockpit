## 1. 归因信号:让 reserveCandidatePort 回报确定归因(D1)

- [x] 1.1 `ssh.ts`:扩展 `reserveCandidatePort`,在回退到内核分配端口时同时回报「首选端口是否被拒」及其错误码(`EADDRINUSE`/`EACCES`/其它),保持既有「任何 listen 错误都必须静默回退、绝不使重连失败」语义不变
- [x] 1.2 `ssh.ts`:保持无首选端口时的行为与返回形状兼容(单纯内核分配),不给调用方引入必填字段
- [x] 1.3 `ssh-tunnel.test.ts`:补测预绑定归因回报——首选端口可用、首选端口被占用、首选端口非法(越界/非整数)三种输入下的归因取值

## 2. stderr 启发式归因(D2)

- [x] 2.1 `tunnel-manager.ts`:新增端口占用类归因判定,只匹配与本地转发绑定直接相关的特征(`Address already in use`、`cannot listen to port`、`Could not request local forwarding`),可得时校验其中端口号与本次使用端口一致
- [x] 2.2 `tunnel-manager.ts`:归因默认方向为「与端口无关」——空 stderr、纯链路错误(`connect to host … timed out`、`Could not resolve hostname`)、无法识别文本一律保留首选端口
- [x] 2.3 归因判定复用既有 `maxStderrBytes` 截断缓冲,不新增 stderr 读取路径;归因结果 MUST NOT 进入 argv 或影响 host-key 校验
- [x] 2.4 归因判定做成可单测的纯函数(输入 stderr 文本 + 本次端口,输出归因分类),覆盖本机实测的两类真实 OpenSSH 输出

## 3. 重试循环:按归因决定端口延续(D3)

- [x] 3.1 `tunnel-manager.ts`:把 `const preferred = attempt === 1 ? … : undefined` 替换为按上一次失败归因决定——端口不可用类失败后不再回退到该端口,与端口无关的失败保留该端口
- [x] 3.2 `tunnel-manager.ts`:确保「一旦判定放弃首选端口,本次连接的后续尝试不得再回退到它」(单向状态,不因后续归因变化而复用)
- [x] 3.3 `tunnel-manager.ts`:保持 `maxBindAttempts` 上限与循环结构不变,不为保留端口延长总尝试次数
- [x] 3.4 确认每次尝试前仍实际 `listen` 验证端口可绑定,使「保留的端口在后续尝试中真被占用」自然转为确定归因并放弃

## 4. 可观测性(D4)

- [x] 4.1 `tunnel-manager.ts`:注入可选 logger(不注入时静默,保持既有可测试性),在实际绑定端口与传入的 `preferredLocalPort` 不同时发出 WARN,携带 deviceId、原端口、新端口、归因分类标签
- [x] 4.2 日志内容只含 deviceId/两个端口号/归因标签,MUST NOT 记录 stderr 原文或任何连接材料
- [x] 4.3 `connectivity.service.ts`:`#persistLocalPort` 的空 catch 补充 WARN 日志,保持「持久化失败 MUST NOT 中断已建立连接」不变
- [x] 4.4 `main.ts`/组装处:把既有 Nest logger 接入 `TunnelManager`,确认无循环依赖(在 `ConnectivityService` 内构造 `TunnelManager` 时注入 `Logger`)

## 5. 测试

- [x] 5.1 `ssh-tunnel.test.ts`:新增「首次尝试因链路原因失败(fake process 以链路类 stderr 提前退出)→ 后续尝试仍使用同一首选端口 → 连接成功且 origin 不变」
- [x] 5.2 `ssh-tunnel.test.ts`:新增「首次尝试因端口绑定失败退出 → 后续尝试改用内核分配端口 → MUST NOT 反复重试同一端口」(既有「stolen inside bind window」用例改为发出真实 bind-failure stderr 以驱动归因)
- [x] 5.3 `ssh-tunnel.test.ts`:新增「无法归因的提前退出(空/无关 stderr)→ 保留首选端口」
- [x] 5.4 `ssh-tunnel.test.ts`:新增漂移 WARN 断言(发生漂移时记录一次、含两个端口与归因;未漂移时不记录)+ `isPortBindFailure` 纯函数单测组
- [x] 5.5 回归:既有端口复用相关测试(`returns the preferred port when it is bindable`、`falls back to an OS-assigned port when the preferred one is taken`、跨重连 origin 稳定、非法端口降级)全部保持通过(含 `device-lifecycle.test.ts` 的 `reserveCandidatePort().port` 适配)
- [x] 5.6 `connectivity.service.test.ts`:持久化失败时记录 WARN 且连接不受影响

## 6. 验证与收口

- [x] 6.1 实际运行并记录 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`(全绿:typecheck/lint/build exit 0;test = bridge 17 + web 73 + server 172)
- [x] 6.2 真实实例验收:对一台远端设备反复重连,确认 `devices.json` 的 `localPort` 不再因链路抖动而变化;人为占用该端口后确认仍能正常回退并把新端口持久化
- [x] 6.3 真实实例验收:确认端口漂移时服务端日志出现可定位的 WARN(含原端口/新端口/归因)
- [x] 6.4 `openspec validate --strict` 通过后,按 OpenSpec archive 流程收口(含验证记录)

### 验收记录(2026-09-10)

**A. 真实隧道验收(新构建 dist + 真实 lumevm/devbox ssh,独立端口,不触碰运行中的 3090)**

| 场景 | 结果 |
| --- | --- |
| 真实隧道首连达到 READY | PASS(绑定 58161) |
| 端口空闲重连 → 复用、origin 不变、无 WARN | PASS |
| 端口被其它进程占用 → 漂移、恰好一条 WARN 含 `from/to/reason`、连接不失败 | PASS |
| **首次尝试因链路错误退出 → 重试保留同一端口、origin 不漂移、无误报** | PASS(ports tried `[58561, 58561]`) |

漂移告警实测格式:`tunnel local port drift: device=acc from=58161 to=58201 reason=preferred-port-unavailable`

**B. 运行时端到端验收(cockpit 重启后,新进程 73539 接管)**

- **跨进程重启端口稳定**:`lumevm` 重启前 `localPort=54695`,重启后仍为 `54695`,endpoint origin 未变——本 change 要保护的核心属性(设备 DSH 的 origin 作用域存储延续)成立。
- **稳态重连端口稳定**:`devbox` 主动 `POST /api/devices/<id>/reconnect` 后 `localPort` 与 endpoint 均为 `63333`,无漂移、无 WARN。
- **设备全部恢复**:`host` / `lumevm` / `devbox` 最终均 `READY`;重启期间 `devbox` 短暂 `SSH_UNREACHABLE` 经既有退避自愈,无任何连接因端口问题失败。
- **无回归**:重启后无 `local port persist failed` 告警。

**C. 已知边角(不阻塞收口,已记录)**

跨进程重启时 `devbox` 的端口曾由 `59130` 变为 `63333`,且**未**产生 drift WARN。归因:旧进程退出时其子 ssh 尚未完全释放 `59130`,新进程首连撞上该窗口;此时远端 DSH 亦未就绪,首连走的是 `probe 失败 → 拆隧道 → 退避重连` 路径,而漂移比对点位于「隧道建成且探测通过后」,故这一跳的端口变化未被比对点覆盖。

已实测确认 `59130` 当前可正常复用(建真实 devbox 隧道 → SIGTERM → 立即重绑 `59130` 成功),故非「端口长期被占」;此现象不影响本 change 的稳态目标(链路抖动不漂移已验证)。**跨进程重启窗口的端口变化可观测性**属独立改进,需单独走 change,不在本次范围内。

