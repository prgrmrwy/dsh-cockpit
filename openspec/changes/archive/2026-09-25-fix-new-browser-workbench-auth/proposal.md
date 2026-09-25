## Why

Cockpit后端可凭持久化的authority-bound DSH cookie保持设备 `READY`，但新浏览器没有设备cookie；当前 `workbench-launch`仍把注册表中可能因DSH重启而陈旧的launch token交给iframe，导致从Cockpit进入工作台时显示 `dsh web authentication required`。当前受支持typert运行时的有效launch token经实测可重复完成官方token→cookie交换，因此本change在用户既有逐设备授权下验证/发现当前token，同时补齐浏览器请求门禁、竞态和不可观测边界。

## What Changes

- typert工作台启动先有界验证已保存token；失效且设备已显式启用ohmydsh自动恢复时，复用固定路径、只读、有界discovery取得并验证当前token；只有authority精确匹配、连接代仍当前时才返回tokenized URL。
- 明确扩展逐设备自动恢复授权：服务端cookie仍可用但新浏览器需要当前token时，也允许为该设备执行同一受限discovery；未授权、来源不可用或验证失败时仍回退人工粘贴，不扩大文件/命令范围。
- `workbench-launch`除既有 `cockpit_token`外增加精确Cockpit Origin检查，缓解其它loopback网页的浏览器CSRF/CORS读取；明确该检查不防任意本机进程，本机进程仍处于现有loopback信任边界内。
- token验证增加精确authority cookie名称校验、每设备/authority/auth generation单飞和服务端限频；失败使用稳定脱敏错误码。当前Cockpit识别为typert的运行时统一适用经实测的“token可重复交换”兼容契约；未来若上游改变该契约需另开change。成功响应 `no-store`/`no-referrer`，token不得进入日志、SSE、界面或持久状态。
- 父页面无法观察跨源iframe的最终HTTP状态/cookie，因此只承诺URL签发前的验证。tokenized URL不进入React持久状态，只被一次性赋给iframe；load后允许一次明确的干净endpoint导航来擦除DOM属性，deadline先到时则优先不中断在途导航、接受DOM属性暂留到后续load/销毁，不据此宣称认证成功，也不自动循环。
- rc.2、iframe keep-alive、稳定端口、远端零改造和状态聚合独立性保持不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `cockpit-workbench`：新浏览器以当前已验证token启动typert iframe，并明确Origin、错误、竞态、token生命周期和跨源结果不可观测语义。
- `cockpit-device-connectivity`：逐设备ohmydsh自动恢复授权扩展到“服务端cookie仍有效、但浏览器工作台需要当前token”的启动恢复，同时保持既有限制、脱敏与人工回退。

## Impact

- `packages/cockpit-server`：严格token exchange校验；workbench验证/discovery单飞、限频、CAS/generation fence；精确Origin gate；稳定错误码与安全响应头。
- `packages/cockpit-web`：工作台启动错误遮罩、明确重试、乱序协调、token URL有界清理与 `referrerPolicy=no-referrer`。
- 测试覆盖：严格authority、当前/陈旧token、授权/未授权discovery、取消与并发、Origin/Host矩阵、错误脱敏、缓存/引用策略、SSE乱序、超时清理，以及两个隔离浏览器profile的黑盒验收。
- 无registry schema迁移、依赖新增、远端安装、cookie relay、LAN监听、HTTPS或通用代理；Windows SSH/SOCKS启动不在本change内。
