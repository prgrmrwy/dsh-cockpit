# Cockpit 发布源修复：最终审查和 devbox 验收

## 审查范围与结论

完整范围：`d14a4755675483fbe0920a04f9c523cc4a4d574b` → `7102a12a4b401b674f0255c00a294a55db186f4f`，包括 approved OpenSpec change、源码、测试、README、上游已跟踪的 bundle/map。Native 本执行者审查，未委派 reviewer，未声称存在 SSF 审查回执。

**发布源修复验收通过；正式升级仍 NO-GO。** 本次没有 push/publish、版本号变更、正式 pin 变更或 cockpit-server 升级。

- 0.2.0 的实际接口是 `uiSession.sessionStatus`，不是 `status`。旧 `current/pendingInteractions` 和新 `byId.retainedBy.mainView/sessionStatus` 双路径；未知 pending 来源不发送假零。
- 始终仅投影 sessionId/kind/key；保持 v2/v3 协议和 portForward/editorOpen 服务，不增加 provider token、交互正文、设置读取/外发。
- 初始化异常清理已安装 list 订阅；dispose 后迟到 hello 不读失活 ctx。未知/malformed 初始状态停用该 effect，而非阻断原生 client；不保证该异常自动恢复。
- 审查发现 Important `BR-PENDING-INFLIGHT-1`：旧响应覆盖 pendingDirty，漏发在途期间到达的解除快照。新增测试 RED：31 pass/1 fail；最小修复在成功响应后比较实时 fingerprint、安排补发，GREEN：**32 tests passed**。焦点复审通过，无剩余 Critical/Important 源补丁发现。
- 相关旧版行为测试全部保留；修复原有测试拒绝监听注册太晚导致的 unhandled rejection，不更改端口转发业务逻辑。
- typecheck/build、git diff --check 通过。构建器存在 CJS 建议和 define option 警告；build exit 0，不称无警告。未运行 cockpit server/web 全仓 test/typecheck/lint，未修改这两个包。

## 最终精确候选验证

1. 官方 `dsh plugin --profile web add` 安装本地 tarball；header 源仍为 `a5011e0`，bridge 构建源 `7102a12`，均 cmp 源/安装字节一致。
2. 同版本同路径 tarball 重装第一次被包管理器缓存保留旧字节，cmp 明确拒绝验收；改为 commit-addressed `dsh-cockpit-bridge-7102a12.tgz` 后 cmp 通过。这是验收身份校验发现并纠正的问题，不是绕过检查。
3. 完整 Host 冷启动后，原生工作台与 Settings 正常；原始未插桩页面 boot 在此前 55878fa 已独立通过。最终浏览器探针仅给 bridge apply 插入 ctx 捕获，不改部署文件。
4. 用官方 sessions.create 创建两个候选 Git cwd 的空会话（没有模型调用），经显式 inject 的官方 uiWorkspace.openSession 执行 **A→B→A**；逐次等待并断言真实 bridge session-opened 上报正确。
5. 用官方 uiSession.registerPendingInteraction 发布并解除 question，真实 sessionStatus 驱动上报；逐项精确断言最小三字段。仅 cockpit acknowledgment 使用 browser fetch stub，因此这是官方服务/已装 bridge 集成证明，不是生产 cockpit server 端到端证明。
6. 最终探针 **errors=[] / badResponses=[]**。clock/guard/cost-meter API 200/ok，无 cookie 401，Pet ready，无 fetch stack overflow；guard blocked/degraded=false 为有效出口策略判定，不绕过。
7. 日志：devbox acceptance root 的 logs/joint-browser-probe.json、header-host-probe.json；完整 Host 日志保留在 owner-only logs，原始 cookie/token 日志不交付。

## 单独诊断与保留门禁

- 初始 /worktree-session/api/session-status 400 已定位为 Pet 非 Git workspace → NOT_A_REPOSITORY；候选 Git repo + 实际 Session 查询 200/ok/bound:false。最终 Git cwd 探针无该错误。不改变 worktree-session 安全拒绝策略。
- 上一轮使用默认 cwd、重复空会话导航曾出现官方 Sidebar Session reference released 警告；最终明确 Git cwd 冷启动探针未再出现。未证明其普遍修复，保留非确定性 UI 风险，不归因或修补 DSH core。
- 正式远端版本尚未发布，不能把本仓 pin 指向这些未发布物。发布、pin 审查、剩余升级门禁需后续执行。
- 仍未替代私有 overlay 精确身份、真实设置编辑全矩阵、Session v4/生产回滚、连接 fragment 负向门禁、Pet 全量 live capacity/cold recovery、真实飞书/media、生产备份切换。
- 未改本机部署/VM/生产3080；候选只监听 devbox 127.0.0.1:39521，验收后需核身份停机，最终进程检查另见交付摘要。
