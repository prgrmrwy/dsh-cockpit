## Test Plan

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 选中设备即见其完整工作台 | packages/cockpit-web/tests/workbench.test.tsx | `it('lazy-creates an iframe only when a device is selected')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 新浏览器使用当前可重复交换的token首次进入 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('validates a current repeatable token before issuing a new-browser launch URL')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 陈旧token通过已授权自动恢复更新 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('discovers validates and commits a current token for an authorized browser launch')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 自动恢复未授权或失败 | packages/cockpit-web/tests/workbench.test.tsx | `it('shows an actionable auth overlay without creating a token iframe when recovery is unavailable')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 非精确Cockpit Origin被拒绝 | packages/cockpit-server/tests/app-auth.e2e.test.ts | `it('rejects every non-exact workbench launch Origin and Host before secret access')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 精确Origin不受forwarded头影响 | packages/cockpit-server/tests/app-auth.e2e.test.ts | `it('uses raw matching Origin and Host while ignoring forwarded headers')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 启动响应最小暴露认证材料 | packages/cockpit-server/tests/app-auth.e2e.test.ts | `it('returns only the launch URL and generation with no-store and no-referrer headers')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 旧连接代的启动结果不得覆盖新连接代 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('drops a workbench launch result after its connection tuple becomes stale')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 同一认证代失败不循环 | packages/cockpit-web/tests/workbench.test.tsx | `it('does not retry a failed or unknown launch tuple until user retry or tuple change')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | load后清理token DOM属性 | packages/cockpit-web/tests/workbench.test.tsx | `it('performs exactly one clean-endpoint navigation after a token iframe load')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | deadline优先不中断在途导航 | packages/cockpit-web/tests/workbench.test.tsx | `it('clears parent token references at deadline without replacing the in-flight iframe src')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 远端零改造 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('launches a standard remote dsh web without requiring a bridge')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | rc.2 工作台 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('returns the clean rc2 endpoint without token validation or discovery')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | typert 工作台首次认证 | packages/cockpit-web/tests/workbench.test.tsx | `it('assigns one validated token URL then bounds cleanup without showing a raw 401')` ( realised as `uses a tokenized root once then scrubs the steady iframe src` + the launch-authentication suite ) | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | typert 工作台缺少认证材料 | packages/cockpit-web/tests/workbench.test.tsx | `it('renders recovery controls and never navigates when typert auth material is missing')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | DSH cookie 静默重新签发 | packages/cockpit-web/tests/workbench.test.tsx | `it('launches once for a higher auth generation across either load cleanup path')` | 🟢 green |
| specs/cockpit-workbench/spec.md → 工作台直接承载远端原生 DSH，零协议耦合 | 重认证失败 | packages/cockpit-web/tests/workbench.test.tsx | `it('distinguishes observable pre-launch failure from unobservable post-launch outcome')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 首次连接 typert 设备 | packages/cockpit-server/tests/protocol-client.test.ts | `it('distinguishes rc.2, unauthenticated typert, authenticated typert, and a generic 401')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 普通 DSH 重启后复用已有 cookie | packages/cockpit-server/tests/protocol-client.test.ts | `it('reuses an authority-matched unexpired cookie before the stored launch token')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | cookie 到期但已保存 token 仍有效 | packages/cockpit-server/tests/protocol-client.test.ts | `it('exchanges the stored token after an expired cookie and returns accepted auth metadata')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | DSH 重启使旧 token 失效且自动恢复已授权 | packages/cockpit-server/tests/protocol-client.test.ts | `it('invokes recovery only after a cookie or token receives HTTP 401')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 服务端cookie有效但新浏览器需要当前token | packages/cockpit-server/tests/connectivity.service.test.ts | `it('recovers browser launch auth without disturbing the healthy server connection')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 未提供或已失效的启动 URL | packages/cockpit-server/tests/connectivity.service.test.ts | `it('returns a stable redacted auth-required result when no current token can be obtained')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 自动发现来源不可用 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('fails closed to manual recovery without scanning or exposing discovery output')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 自动恢复未授权 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('never invokes local or remote discovery when auto recovery is disabled')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | endpoint authority 改变 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('never reuses an old-authority cookie after the workbench endpoint changes')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 更新或删除认证材料 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('prevents in-flight validation or discovery from restoring replaced or deleted auth')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 查询设备认证状态 | packages/cockpit-server/tests/connectivity.service.test.ts | `it('projects auth status without token cookie or reversible derivatives')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 并发浏览器启动共享有界验证 | packages/cockpit-server/tests/workbench-launch-coordinator.test.ts | `it('shares authority-scoped validation while isolating waiter and device cancellation')` | 🟢 green |
| specs/cockpit-device-connectivity/spec.md → typert 使用官方启动 URL完成最小认证握手 | 当前typert兼容契约 | packages/cockpit-server/tests/dsh-auth.test.ts | `it('allows the same current typert token to validate and then exchange for the browser')` | 🟢 green |

## Coverage Notes

- 全部30个delta scenario均有且只有一个主追踪行；额外参数化case不替代这些命名测试。
- `typert 工作台首次认证`的断言分散在既有 `uses a tokenized root once then scrubs the steady iframe src`（一次tokenized导航后清理）与新增的 launch-authentication suite（无裸401、有界清理）之间，两者共同覆盖该scenario。
- Origin真实HTTP矩阵（`app-auth.e2e.test.ts`）覆盖typert与rc.2、不同端口、`localhost`、缺失/空/重复/非法Host与Origin、scheme-less Origin、forwarded头伪装。`fetch`会静默丢弃调用方设置的`Host`，因此缺失/空/重复Host与重复Origin改用`node:http`原样发送，避免假通过。
- validation failure decision table由`workbench-launch-coordinator.test.ts`的参数化case覆盖：仅官方401拒绝可在授权时触发discovery；网络失败、非DSH 401、畸形exchange、错误authority均不得读取日志。
- secret断言同时检查响应正文、server facts、API client抛出的error对象与渲染UI；`dsh-auth.test.ts`另行固定exchange必须使用确定性authority cookie名。
- `Referrer-Policy`分两条独立断言：成功API响应header为防御性策略；iframe元素 `referrerPolicy="no-referrer"`才是后续跨源导航的控制。
- 夹具说明：`FakeRc2Client.probe`默认成功，typert夹具必须显式关闭rc.2分类，否则设备会被识别为rc.2而根本不经过typert路径。typert协议通过`ConnectivityService`的`createProtocol` seam注入，因为真实typert握手需要真实WebSocket。
- 已实测的既有基线问题：`packages/dsh-cockpit-bridge` 的 `tests/client.test.ts` 报告1个unhandled rejection（24个测试全部通过，退出码1）。该问题在本change实施前即存在，与本次改动无关。
- NestJS 依赖注入不在单元测试覆盖范围内：本change曾在 `ConnectivityService` 增加一个无装饰器构造参数，导致 `Nest can't resolve dependencies` 而生产无法启动，而直接 new 的单元测试全绿。`app-auth.e2e.test.ts` 因此新增 `actually resolves the whole production dependency graph at boot`，用真实 `AppModule` 启动来拦截这一类回归。
