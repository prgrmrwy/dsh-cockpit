# Tasks

实施已完成并全绿。任务在实施过程中按「一组场景一次 red→green→refactor 循环」执行（而不是每个被审计场景单独三次提交），因此这里记录的是**实际**做过的工作单元及其 TDD 顺序；30 个场景与测试的逐条对应关系见 `test-plan.md`，证据见 `verify.md`。

## 1. Strict DSH authentication primitives

- [x] 1.1 Write failing test: `dsh-auth.test.ts` — `allows the same current typert token to validate and then exchange for the browser`（先确认失败原因是「错误 authority 未被拒绝」，而不是语法/导入错误）
- [x] 1.2 Implement 固定 `dshCookieName(authority)` 单一定义、导出并在 `inspectDshCookie`/`exchangeDshLaunchToken` 中共用；exchange 必须要求 cookie 名精确等于当前 endpoint authority 的确定性名称
- [x] 1.3 Refactor `dsh-auth.ts` 校验顺序；`dsh-auth.test.ts` 4/4 绿
- [x] 1.4 Write failing test: `protocol-client.test.ts` — 首次连接严格 exchange（`distinguishes rc.2, unauthenticated typert, authenticated typert, and a generic 401`）
- [x] 1.5 Implement/keep 首次连接严格 exchange 与受保护持久化
- [x] 1.6 Refactor 首次连接组合；`protocol-client.test.ts` 绿
- [x] 1.7 Write failing test: `protocol-client.test.ts` — `reuses an authority-matched unexpired cookie before the stored launch token`
- [x] 1.8 Implement cookie 优先且不触发 discovery
- [x] 1.9 Refactor cookie 复用路径；suite 保持绿
- [x] 1.10 Write failing test: `protocol-client.test.ts` — `exchanges the stored token after an expired cookie and returns accepted auth metadata`
- [x] 1.11 Implement 过期 cookie 回退到严格 token exchange
- [x] 1.12 Refactor 回退路径；suite 保持绿
- [x] 1.13 Write failing test: `protocol-client.test.ts` — `invokes recovery only after a cookie or token receives HTTP 401`，并断言 403/网络/协议失败不触发 discovery
- [x] 1.14 Implement 失败分类决策表（仅官方 401 拒绝可 discovery）与授权后 discovery
- [x] 1.15 Refactor typed 失败分类；`protocol-client` 与 `dsh-auth` suites 绿
- [x] 1.16 Write failing test: `connectivity.service.test.ts` — `fails closed to manual recovery without scanning or exposing discovery output`
- [x] 1.17 Implement/retain 固定来源、有界、只读 discovery 与脱敏失败处理
- [x] 1.18 Refactor discovery 诊断；`dsh-auth-discovery` 与 `dsh-auth` suites 绿

## 2. Workbench launch coordinator and lifecycle fences

- [x] 2.1 Write failing test: `connectivity.service.test.ts` — `validates a current repeatable token before issuing a new-browser launch URL`
- [x] 2.2 Implement `workbench-launch.ts` 严格验证；旧 token 验证成功时丢弃临时 cookie、不写盘、不增代
- [x] 2.3 Refactor 验证结果模型；connectivity/auth suites 绿
- [x] 2.4 Write failing test: `connectivity.service.test.ts` — `discovers validates and commits a current token for an authorized browser launch`
- [x] 2.5 Implement 授权 discovery + 严格验证 + generation CAS 提交
- [x] 2.6 Refactor recovered material 构造；connectivity/registry suites 绿
- [x] 2.7 Write failing test: `connectivity.service.test.ts` — `recovers browser launch auth without disturbing the healthy server connection`
- [x] 2.8 Implement 浏览器专用恢复，保持服务端连接与事件流不变
- [x] 2.9 Refactor 两个独立消费者路径；connectivity/lifecycle suites 绿
- [x] 2.10 Write failing test: `connectivity.service.test.ts` — `returns a stable redacted auth-required result when no current token can be obtained`
- [x] 2.11 Implement typed `workbench-auth-required`，不返回旧 URL 或原始 cause
- [x] 2.12 Refactor 稳定启动错误；connectivity suite 绿
- [x] 2.13 Write failing test: `connectivity.service.test.ts` — `never invokes local or remote discovery when auto recovery is disabled`
- [x] 2.14 Implement 每设备 discovery 授权对服务端与浏览器两条路径一致生效
- [x] 2.15 Refactor 授权判断为单一策略边界；suites 绿
- [x] 2.16 Write failing test: `connectivity.service.test.ts` — `never reuses an old-authority cookie after the workbench endpoint changes`
- [x] 2.17 Implement authority 同时进入认证有效性与 coordinator key
- [x] 2.18 Refactor authority key 构造；suites 绿
- [x] 2.19 Write failing test: `connectivity.service.test.ts` — `prevents in-flight validation or discovery from restoring replaced or deleted auth`
- [x] 2.20 Implement 用户更新/删除的 generation fence 与共享操作取消
- [x] 2.21 Refactor CAS 败者与 abort 清理；suites 绿
- [x] 2.22 Write failing test: `connectivity.service.test.ts` — `projects auth status without token cookie or reversible derivatives`
- [x] 2.23 Implement 新增启动状态在 facts/SSE/诊断中保持脱敏
- [x] 2.24 Refactor 公开认证投影；shared/server suites 绿
- [x] 2.25 Write failing test: `workbench-launch-coordinator.test.ts` — `shares authority-scoped validation while isolating waiter and device cancellation`（并以真实请求计数断言共享）
- [x] 2.26 Implement operation-owned `(deviceId, authority, authGeneration)` 单飞、有界结果窗口与取消归属
- [x] 2.27 Refactor coordinator 生命周期与限频窗口；concurrency/connectivity suites 绿
- [x] 2.28 Write failing test: `connectivity.service.test.ts` — `drops a workbench launch result after its connection tuple becomes stale`
- [x] 2.29 Implement lifecycle identity、连接代、endpoint 与 auth generation 的异步后 fence
- [x] 2.30 Refactor 快照/fence helper；suites 绿
- [x] 2.31 Write failing test: `connectivity.service.test.ts` — `launches a standard remote dsh web without requiring a bridge`
- [x] 2.32 Implement 远端工作台只依赖标准 `dsh web` endpoint/认证行为
- [x] 2.33 Refactor 且不引入 bridge/代理耦合；suites 绿
- [x] 2.34 Write failing test: `connectivity.service.test.ts` — `returns the clean rc2 endpoint without token validation or discovery`
- [x] 2.35 Implement 保留 rc.2 干净端点分支，同时共用请求门禁
- [x] 2.36 Refactor 协议分派；rc.2 与 typert suites 绿

## 3. HTTP origin gate, error contract and response secrecy

- [x] 3.1 Write failing test: `app-auth.e2e.test.ts` — `rejects every non-exact workbench launch Origin and Host before secret access`（参数化 typert/rc.2、缺失/空/重复/非法、其它端口、localhost、scheme-less）
- [x] 3.2 Implement 在调用 service 之前 fail-closed 解析原始 Origin/Host；缺失/重复/非法 Host 用 `node:http` 原样发送（`fetch` 会静默丢弃 `Host`）
- [x] 3.3 Refactor 精确 Origin helper；真实 HTTP 测试绿
- [x] 3.4 Write failing test: `app-auth.e2e.test.ts` — `uses raw matching Origin and Host while ignoring forwarded headers`
- [x] 3.5 Implement 忽略 `Forwarded`/`X-Forwarded-*`，仅以原始 Origin/Host 判定
- [x] 3.6 Refactor forwarded header 覆盖；Origin 矩阵绿
- [x] 3.7 Write failing test: `app-auth.e2e.test.ts` — `returns only the launch URL and generation with no-store and no-referrer headers`
- [x] 3.8 Implement typed 状态/错误码映射、固定安全文案、`Cache-Control: no-store` 与防御性 `Referrer-Policy: no-referrer`
- [x] 3.9 Refactor controller 响应/错误 helper；server e2e 与单测绿

## 4. Workbench browser launch state and bounded navigation

- [x] 4.1 Write failing test: `workbench.test.tsx` — 选中即见完整工作台（`lazy-creates an iframe only when a device is selected` 等既有覆盖）
- [x] 4.2 Implement/keep selected-device 原生 iframe 行为
- [x] 4.3 Refactor frame 注册且不破坏 keep-alive；web suite 绿
- [x] 4.4 Write failing test: `workbench.test.tsx` — `shows an actionable auth overlay without creating a token iframe when recovery is unavailable`
- [x] 4.5 Implement typed 启动失败状态与固定恢复文案，不显示原始服务端诊断
- [x] 4.6 Refactor overlay 优先级（连接层遮罩优先）；suites 绿
- [x] 4.7 Write failing test: `workbench.test.tsx` — `does not retry a failed or unknown launch tuple until user retry or tuple change`
- [x] 4.8 Implement 每 tuple 仅自动一次 + 明确重试
- [x] 4.9 Refactor attempt key/重试记录；suite 绿
- [x] 4.10 Write failing test: `workbench.test.tsx` — `performs exactly one clean-endpoint navigation after a token iframe load`
- [x] 4.11 Implement load 后至多一次干净 endpoint 导航，且不把 load 当作认证成功
- [x] 4.12 Refactor load 阶段迁移；suite 绿
- [x] 4.13 Write failing test: `workbench.test.tsx` — `clears parent token references at deadline without replacing the in-flight iframe src`
- [x] 4.14 Implement 可注入导航 deadline 与超时仅清内存引用（不改写在途 `src`）
- [x] 4.15 Refactor 定时器清理（load/卸载/设备切换）；suite 绿
- [x] 4.16 Write failing test: `workbench.test.tsx` — tokenized URL 只赋一次并随后有界清理、不出现裸 401
- [x] 4.17 Implement tokenized URL 经 ref 一次性交付、iframe `referrerPolicy="no-referrer"` 与有界清理
- [x] 4.18 Refactor 一次性交付，使 token 不进入长期 frame 状态；suite 绿
- [x] 4.19 Write failing test: `workbench.test.tsx` — `renders recovery controls and never navigates when typert auth material is missing`
- [x] 4.20 Implement `workbench-auth-required` 映射到可操作控件且不赋 tokenized `src`
- [x] 4.21 Refactor typed API client 错误；断言抛出对象、渲染 UI 与诊断均无 secret；suite 绿
- [x] 4.22 Write failing test: `workbench.test.tsx` — `launches once for a higher auth generation across either load cleanup path`
- [x] 4.23 Implement 响应/SSE generation 顺序协调与两种清理路径
- [x] 4.24 Refactor latest-generation 单调跟踪；竞态测试绿
- [x] 4.25 Write failing test: `workbench.test.tsx` — `distinguishes observable pre-launch failure from unobservable post-launch outcome`
- [x] 4.26 Implement 诚实的「签发前失败」与「签发后不可观测」阶段
- [x] 4.27 Refactor 阶段命名与可访问文案；web suite 绿

## 5. Integrated regression and acceptance

- [x] 5.1 Write failing assertion: `connectivity.service.test.ts` — `serves two fresh browsers the same validated current token while the server cookie stays valid`
- [x] 5.2 Implement 所需 server/web 集成 seam（协议工厂与 fetch seam），不引入 cookie relay 或代理
- [x] 5.3 Refactor 共享夹具；server 241 + web 81 + shared 1 + root 8 全绿
- [x] 5.4 Run `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm lint`；仅修复本 change 相关回归
- [x] 5.5 Run `openspec validate fix-new-browser-workbench-auth --strict`；确认 test-plan 全部30行为 🟢
- [x] 5.6 黑盒验收（已执行）：`bin/cockpit restart` 激活新构建后，对 host/lumevm/devbox 三台真实设备验证——跨源/缺失 Origin 全部 403、精确 Origin 返回带 `no-store`/`no-referrer` 的已校验 token，且全新浏览器 cookie jar 自行交换得到 authority-bound cookie；devbox 现场走完「陈旧 token → 授权 discovery → CAS 提交」真实路径（gen4→gen5）。脚本 `/tmp/cockpit-blackbox.py`，证据见 `verify.md`
- [x] 5.7 修复激活期间发现的 NestJS 依赖注入缺陷（无装饰器构造参数导致生产无法启动），并将 seam 收进单一 `@Optional()` 参数；补 `AppModule` 真实启动回归测试
