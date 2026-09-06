## 1. 认证与 ohmydsh 契约证据

- [x] 1.1 在隔离 DSH 0.1.2 实例实测并固化：launch token 每进程变化、signed cookie 跨普通重启有效、到期/错误 cookie 返回标准 401、当前 token交换返回 303与可解析到期时间。
- [x] 1.2 钉死 ohmydsh 前台/后台 `dsh restart` 的启动 URL日志行、标准 `$DSH_HOME/dsh.log`来源与最大合理单行长度，选择并记录有界尾部读取上限。
- [x] 1.3 为本机与 SSH 远端各建立 fixture，覆盖最新匹配端口 URL、旧端口/旧 token、截断行、畸形 URL、日志缺失、超大输出和命令失败；确认任何失败输出都不会进入诊断或日志。

## 2. 私有认证模型与注册表迁移

- [x] 2.1 在 shared/registry 中定义版本化的私有 DSH auth材料、公开认证状态和按设备自动恢复配置，保持 token/cookie仅存在于私有持久模型。
- [x] 2.2 实现旧 `dshLaunchToken`记录的兼容读取与原子迁移，自动恢复默认关闭；为损坏新结构维持 fail-closed、不覆盖原文件语义。
- [x] 2.3 从 DSH cookie验证并提取 authority/绝对 expiresAt，拒绝畸形、过期或 authority不匹配的材料，且不把 cookie payload/value投影到 API。
- [x] 2.4 更新 add/update/clear/remove路径：手工新 URL清除旧 cookie并提升 auth generation；显式清除删除 token/cookie但保留自动恢复选择；冲突输入继续拒绝。
- [x] 2.5 增加注册表与 API脱敏测试，覆盖 devices响应、SSE、diagnostic、错误正文、日志和测试快照中不存在 token/cookie。

## 3. Cookie 优先的连接恢复链

- [x] 3.1 重构 typert认证上下文，使连接代按 `authority-matched cookie → stored token exchange → authorized discovery`顺序建立 client/stream，rc.2路径不变。
- [x] 3.2 对 cookie直接 probe与 token exchange精确分类 401；非标准 challenge、403、网络错误和协议错误不得触发 discovery。
- [x] 3.3 新 cookie交换成功后以 revision/generation fence原子写回 token、cookie、expiresAt与 auth generation，旧连接代结果不得覆盖用户更新或新连接代。
- [x] 3.4 为 discovery增加独立的有界冷却/单飞控制，避免重连退避期间重复 SSH/读日志；禁用、删除与 shutdown必须取消未完成恢复。
- [x] 3.5 用单测覆盖普通 DSH重启 cookie复用、cookie到期后 stored token续签、旧 token失败后 discovery、自恢复未授权、authority变化及并发更新竞态。

## 4. 受限 ohmydsh Token Discovery

- [x] 4.1 实现纯解析器：仅接受标准 loopback root URL、唯一 token、登记端口，从有界尾部由新到旧选择最新有效项并只返回 opaque token。
- [x] 4.2 实现本机适配器，只读取标准 `${DSH_HOME:-$HOME/.dsh}/dsh.log`的有限尾部，不跟随可疑路径，不扫描其它文件。
- [x] 4.3 实现 SSH适配器，复用系统 OpenSSH与现有 BatchMode/host-key/timeout/argv安全约束，执行固定只读脚本且不接受 API自定义路径、命令或 pattern。
- [x] 4.4 将 discovery失败归一化为脱敏原因码，禁止 stdout/stderr、URL、token、cookie和原始 cause message进入持久诊断或应用日志。
- [x] 4.5 增加注入/边界测试：恶意 SSH alias、shell元字符、非 ohmydsh设备、不同端口 URL、日志轮转/截断、超时和取消均 fail closed。

## 5. 设备认证状态与管理 UI

- [x] 5.1 在 `DeviceStatusFacts`中投影 `not-configured/ready/recovery-required`、是否配置、自动恢复开关、可公开到期时间与 auth generation；为旧/rc.2设备定义稳定默认值。
- [x] 5.2 在设备卡片和编辑表单显示“未配置 / 已配置 / 需更新”，保持 URL输入永远为空且留空不修改。
- [x] 5.3 增加显式清除认证材料控件及冲突校验，并把现有后端 clear语义接到 UI。
- [x] 5.4 增加逐设备 ohmydsh自动恢复开关与安全说明，明确本机或 SSH只读标准日志范围；默认关闭。
- [x] 5.5 补齐深浅主题、窄屏、键盘与辅助技术测试，不以颜色单独表达认证状态。

## 6. Workbench 浏览器 Cookie 静默续签

- [x] 6.1 扩展 workbench launch响应携带 auth generation，并确保 tokenized URL仍只经 cookie认证的同源 POST按需返回。
- [x] 6.2 为每个 mounted iframe跟踪 `(deviceId, origin, authGeneration)`，首次 mount或 generation提升时至多执行一次 tokenized root导航。
- [x] 6.3 保持 DSH 303后的干净 URL、iframe keep-alive与 bridge capability流程；连接代变化或失败时取消旧结果且不得形成刷新循环。
- [x] 6.4 增加 Workbench测试，覆盖首次认证、server仅复用 cookie无需重载、新 token恢复触发一次重载、失败不循环、切换设备后 frame仍保留。

## 7. 集成验证与文档收口

- [x] 7.1 本机真实验收：已配置状态可见；`dsh restart`后 server与已创建 iframe均静默恢复；cookie失效后从本机 ohmydsh日志重新签发。
- [x] 7.2 SSH远端真实验收：BatchMode读取最新 URL后静默恢复；关闭自动恢复或日志不可用时不读日志并显示人工粘贴引导。
- [x] 7.3 故障注入：旧 cookie、旧 token、authority换端口、并发手工更新、SSH断开、日志超大/畸形、Cockpit重启与设备禁用/删除均不泄密、不死循环、不影响其它设备。
- [x] 7.4 更新 README的数据目录、安全边界、远端要求和认证生命周期说明，明确本 change对“cookie不落盘/不读日志”旧承诺的修订与 opt-in条件。
- [x] 7.5 运行 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`并记录结果。
- [x] 7.6 运行 `openspec validate automate-dsh-auth-recovery --strict`，复核 delta specs、design与实现一致后更新任务状态并准备 archive。
