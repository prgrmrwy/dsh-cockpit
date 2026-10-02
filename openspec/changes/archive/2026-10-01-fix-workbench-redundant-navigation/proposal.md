## Why

生产页面在 `8c34425` 合入后仍存在“一次启动请求，多次 iframe 文档加载”：启动等待期间状态同步先导航裸 endpoint，启动响应导航 token URL，load 后又主动导航干净 endpoint。重复加载破坏页面内存状态，并可能放大会话恢复问题；只统计启动 API 次数无法验收。

## What Changes

- 问题 A（本次实施）：Cockpit 在启动结果返回前不加载设备 endpoint；每个已接受的设备/origin/auth generation 启动结果只向 iframe 发起一次导航。
- 将现行“load 后主动干净导航擦除 DOM token”改为“不中断、不重载；load 或 deadline 清父页面临时 token 引用”。明确接受 iframe `src` 属性可保留启动 token 至 frame 销毁或合法的新导航，不能宣称 DOM 已擦除或认证成功。
- 保留严格启动鉴权、generation fence、显式重试、rc.2 原生 endpoint、设备切换保活与可选 bridge；不增加 cookie relay、代理或远端依赖。
- 问题 B（独立验证，非承诺修复）：在无多余导航前提下验证主动刷新后的原生会话恢复，分别记录恢复成功、原生缺陷已确认、原因未明或无法验证，不以 iframe 保活替代该验证。
- 用户明确排除原生 DSH/ohmydsh 修改、patch、依赖热改、远端安装/更新/重启及 Cockpit 强制恢复会话。若确认是原生问题，只报告并暂不处理。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-workbench`: 修改启动导航与 token 清理契约，禁止 pending 状态更新及 load/deadline 引发多余导航；明确会话恢复仍由原生 DSH 负责，不以该 change 接管选择。

## Impact

- 实施范围：`packages/cockpit-web/src/workbench/Workbench.tsx`、相关单测与隔离浏览器回归证据，必要的 README 安全边界说明。
- 规范范围：`cockpit-workbench` 的 load 清理、deadline、静默重认证场景。
- 后端启动接口、认证材料存储与发现流程不改变；不新增依赖或必装插件。
- 安全取舍变化：不再保证 DOM `src` 在 load 后无 token。维持 token 不进入业务 React 状态、registry、持久存储、日志、SSE、缓存，导航始终 no-referrer；DOM 属性残留为明确接受的风险，不等同于无泄露风险。

## Non-goals

- 不修复原生 DSH 的选择持久化，不向原生注入补丁。
- 不在 Cockpit 保存/重放会话选择，不读跨源 iframe DOM，不调用远端会话选择 API。
- 不把源码推导的 pending-list 竞态当作已验证根因，不承诺本次能修复所有“新会话”落点。
- 本阶段仅规划；审阅后另行请求实施。
