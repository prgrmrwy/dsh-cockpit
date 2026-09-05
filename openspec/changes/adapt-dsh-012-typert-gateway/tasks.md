## 1. Spike:钉死三个 Open Questions(门槛,不通过则停)

- [ ] 1.1 **协议探测判别式**:对 :3080(rc.2)与 :3081(typert)各发同一探测请求,确认响应形状判别式(typert `gateway/*` 错误码族 vs rc.2 zod issues)在两个方向都无歧义;把两份真实响应体存进测试 fixture。
- [ ] 1.2 **waterfall next 的实测语义**:在 :3081 上开两个 `$events` 订阅者,触发一次真实 approval(隔离实例上跑一个需审批的会话),验证:① 驾驶舱侧回 next 后官方 UI 仍能正常收到并处理该审批;② 驾驶舱是唯一订阅者时回 next 等价于无订阅者默认;③ 断线重连后 pendingRemoteEvents 重放不会导致重复应答或计数异常。
- [ ] 1.3 **bridge 观察 seam**:在 :3081 的官方 Web UI 里查定 pending approval/question 的可观察面(官方 client 的哪个 store/服务;0.1.2 的 approval 走 `dsh-client-ui-approval`,question 走 `dsh-client-ui-user-questions`,确认其浏览器侧状态读法),写一个最小 console 验证脚本证明能拿到 requested/resolved 边沿。
- [ ] 1.4 **认证通道定案**:查清 launch token 的可发现性(本机 `$DSH_HOME/dsh.log`;远端设备经 SSH 读同一文件是否可行)与 cookie 换取/持久化方式;确定设备记录里存什么(token?cookie?都不存而每次引导?),形成 D5 的最终决定并回填 design。
- [ ] 1.5 spike 结论回填 design.md 的 Open Questions;任一结论与 design 决策冲突时先改 design 再继续。

## 2. typert 协议客户端(cockpit-server)

- [ ] 2.1 新增 `typert-client.ts`:unary 调用封装(`{args:{…}}` 载荷、`RemoteResult` 解包、认证 header/cookie)、`probe()`(经 `session/list`)、`listSessions()`(`SessionSummary` 直通)。
- [ ] 2.2 新增 mux 流适配:`/api/remote.mux` 单 WebSocket 上开 `$events` 与 `workspace/follow` 两条逻辑流;`ready`/`emit`/`item`/`end`/`error` 帧解析;emit 事件转换为既有 `CockpitEvent` 形状(`api-session/status`→`session-status`、`api-session/added`→`session-added`、`api-session/removed`→`session-removed`、`workspace/follow` 的 `archived` 增量→`archived-sessions-changed`)。
- [ ] 2.3 waterfall 帧处理:收到即经 `$events/result` 回 `{kind:'next'}`;cancel 帧幂等忽略;补 1.2 验证过的重连场景处理。
- [ ] 2.4 `listWorkspaces()` 改读 `workspace/follow` 缓存(D4);流断开时缓存失效并触发既有重连路径。
- [ ] 2.5 协议探测 + 工厂选择:`createClient`/`createStream` 缺省实现改为按 1.1 判别式选 rc.2 或 typert;`device-lifecycle.ts` 本体不改动(如确需接口调整,先回 design 记录)。
- [ ] 2.6 认证按 1.4 定案实现;认证失败落入「可诊断状态 + 引导」(spec 场景)。

## 3. bridge pending 观测(dsh-cockpit-bridge + cockpit-server)

- [ ] 3.1 bridge client 按 1.3 的 seam 观察 requested/resolved 边沿,经既有 capability 通道上报(新消息类型,带稳定去重键与 seam 版本标记);不改 host 半区 no-op 性质。
- [ ] 3.2 cockpit-server 为 bridge 来源开 interaction 进水口,复用 `#trackInteraction`;typert 设备的事件流交互来源关闭(单一来源,D3)。
- [ ] 3.3 「pending 不可观测」状态:typert 设备无 bridge 心跳时,UI 呈现不可观测而非 0(shared 类型与 TopBar 相应调整)。
- [ ] 3.4 rc.2 设备回归:pending 观测仍走其事件流,行为与升级前一致。

## 4. 验收(两实例并行对照;"类型对得上"不构成通过)

- [ ] 4.1 对照矩阵:同时连接 :3080(rc.2)与 :3081(typert),逐项比对 `DeviceStatusFacts`:state、runningSessionCount、sessionStatuses、归档集、会话增删事件到达;两侧行为一致。
- [ ] 4.2 waterfall 安全性实测:驾驶舱连接下在 :3081 触发真实审批,官方 UI 流程零延迟零干扰;驾驶舱断开后再触发一次,行为一致。
- [ ] 4.3 pending 链路实测:bridge 在 :3081 页面内上报 requested→计数升、resolved→计数落;关闭页面→「不可观测」而非 0。
- [ ] 4.4 认证生命周期:cookie 失效(手工清除)后设备落入可诊断状态且引导可恢复。
- [ ] 4.5 全部既有测试通过;新增覆盖:探测判别式(用 1.1 fixture)、typert 客户端 unary/流解析、waterfall next、bridge 上报去重。

## 5. 收尾

- [ ] 5.1 复核 delta specs 与最终实现一致;不一致先改 spec/design。
- [ ] 5.2 openspec validate --strict 通过;独立 commit(协议适配 + bridge 扩展可分两个 commit,但同一 change 内)。
- [ ] 5.3 通知 ohmydsh 侧:本 change 落地并验收后,ohmydsh 的 `dsh-0-1-2-host-api-migration` 任务 6.1(主 checkout 物化)解除阻塞(其 BACKLOG [U002] 同步关闭)。
