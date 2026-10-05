# Cockpit真实集成补验与升级边界

## 精确对象

本机cockpit source976f854 + 已批准认证修复构建d13befa，运行PID85847；devbox隔离DSH0.2.0-rc.2，header a5011e0、bridge7102a12。所有浏览器执行和候选Host均在devbox。没有部署本机DSH、VM或devbox生产3080。

## 成功证据

本轮bash-71正常退出0；原始结果留ignored .validation/real-cockpit-result.json，不含凭据。

|检查|观察结果|
|---|---|
|真实root token exchange|303，Location ./，随后iframe文档200|
|官方工作台|iframe实际显示DSH原生页面|
|服务端兼容/连接|READY / SUPPORTED|
|真实capability签发与hello|签发成功，/api/bridge/hello 201|
|当前会话操作|通过官方uiWorkspace进行A→B→A，真实session-opened回调均201|
|Pending上报|官方uiSession注册交互→真实pending-snapshot 201，GET /api/devices读数1|
|Pending解除|官方disposer→真实pending-snapshot 201，GET /api/devices读数0|
|回调汇总|1 hello、4 session-opened（含初始）、3 pending-snapshot均201|

## 独立性与限制

这是同源规范下、带测试观察点的真实服务端集成测试，不是独立QA黑盒验收：父页面取自真实cockpit，脚本追加可见iframe、调用真实capability端点、postMessage配置；浏览器收到的bridge bundle只增加ctx观察点，未stub任何cockpit确认响应。会话/交互通过官方服务产生，而非直接构造服务端回调。

probe结果中的parent文本“minimal same-origin acceptance harness”表示我们没有依赖完整cockpit UI点击路径，不代表实际HTTP文档是mock。日志还有父页默认host iframe在devbox回环3080的401以及默认Pet cwd工作树400；这不是候选认证/bridge回调失败，但不能宣称全页零错误。没有向生产3080执行写操作或重启。

bridge为0.5.1修复候选，本机服务端0.6；本次不证明新forwards协议。未运行新verifying-acceptance skill的独立多agent/QA流程，不冒称该技能验收完成。

## 探针根因

1. route.fulfill合成父页触发Chromium Local Network Access；真实父页消除此问题，不关闭安全开关。
2. 屏外iframe已执行bundle/apply且ctx存在，但Playwright默认raf轮询超时。改为可见fixed iframe及100ms计时轮询后通过。
3. 只拦截包含bridge的脚本批次，避免读取所有大型插件资源/SSE；原始错误日志可能含请求Cookie，保持ignored私有，不交付。

## 清理

本轮临时device-lvxuhiki已通过DELETE confirmed=true精确删除；原host/VM/devbox三设备均READY。已核验devbox候选PID2294289并SIGTERM，bash-65 exit0；反向隧道bash-66终止，临时凭据传输文件删除。本机已验证hotfix保持运行。未push/publish或修改正式pin。

## 仍未完成的全量升级门禁

- 上游header/bridge/auth修复发布、正式manifest精确pin和生产切换；未经授权不执行。
- 私有overlay身份、完整Settings编辑矩阵、Session v4迁移/回滚、连接fragment负向、Pet live/coldcapacity及真实Feishu/media等，不能由此联调代替。
- 如要求独立黑盒前端验收，应单独确认oracle、测试计划与执行策略；当前只记本原生集成证据。

整体升级仍NO-GO；本次认证修复和最小真实cockpit选择/pending链路已通过。
