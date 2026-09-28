## Test Plan

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 驾驶舱自身页面正常调用 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | accepts the cockpit page itself (Origin == http://Host, same-origin) | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 开发代理下的驾驶舱页面正常调用 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | accepts the dev-proxy page (Host 127.0.0.1:5173 preserved, matching Origin) | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 不带 Origin 的命令行客户端照常访问 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | accepts a CLI request with cookie and no Origin/Sec-Fetch-Site | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 设备页面带 cookie 获取启动 URL 被拒绝 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | rejects workbench-launch from a device-page origin with 403 and no launch url | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 设备页面带 cookie 修改或删除设备被拒绝 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | rejects PUT and DELETE device from a device-page origin and leaves the registry unchanged | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 跨站点提示头被拒绝 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | rejects Sec-Fetch-Site: same-site without Origin | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | bridge 回调不受来源校验影响 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | lets a capability-bearing bridge callback past the origin check | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 不带能力串的 bridge 回调按 cookie 路由校验来源 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | rejects a capability-less bridge callback from a device origin | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 非 bridge 路由不再获得凭据 CORS 许可 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | omits Access-Control-Allow-Credentials on a non-bridge preflight | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | bridge 回调的预检仍被放行 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | reflects the device origin and allows the capability header on a bridge preflight | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | 大小写变体路径不能绕过校验 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | gates mixed-case /api/ paths for both the token and the Host checks | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求 | DNS rebinding 的同源读取被拒绝 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | rejects a rebinding Host on /api/devices and /api/bootstrap without Set-Cookie | 🟢 green |
| specs/cockpit-api-auth/spec.md → bridge 回调路由名单 | 名单外的 bridge 路径不被豁免 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | does not exempt an unlisted /api/bridge/ path | 🟢 green |
| specs/cockpit-api-auth/spec.md → bridge 回调路由名单 | 名单内路径的大小写变体按名单匹配 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | matches a mixed-case listed bridge path as the listed route | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱页面只允许被驾驶舱自身嵌入 | shell 响应携带 frame-ancestors | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | sends frame-ancestors 'self' on GET / | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱页面只允许被驾驶舱自身嵌入 | 被拒绝的 API 响应同样携带 frame-ancestors | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | sends frame-ancestors 'self' on a 403 rejection | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱页面只允许被驾驶舱自身嵌入 | bridge 预检响应同样携带 frame-ancestors | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | sends frame-ancestors 'self' on a bridge preflight | 🟢 green |
| specs/cockpit-api-auth/spec.md → 驾驶舱页面只允许被驾驶舱自身嵌入 | 设备工作台 iframe 不受影响 | packages/cockpit-server/tests/app-same-origin.e2e.test.ts | sends a CSP with only the frame-ancestors directive | 🟢 green |

## Coverage Notes

- **共享夹具**：全部场景在同一个新 e2e 文件中，经 design D4 的共享工厂 `createCockpitApp()` 启动真实 NestJS + Express 应用（临时 `DSH_COCKPIT_HOME`、`listen(0, '127.0.0.1')`），因此 CORS、`frame-ancestors` 与中间件顺序都由生产同一路径覆盖。另加一个单测断言 `main.ts#bootstrap` 经由该工厂创建应用（防止“测试用了、生产没用”）。
- **Host 相关请求**：Node `fetch` 会静默覆盖自定义 `Host`，因此“开发代理”“DNS rebinding”“大小写变体（Host 违规部分）”用 `node:http.request` 显式设置 `Host`；“缺少 Host”若需覆盖，只能用 HTTP/1.0 原始 socket（作为额外测试，不占场景行）。
- **浏览器头**：`Origin`、`Sec-Fetch-Site` 由测试直接构造，模拟设备页面 origin `http://127.0.0.1:<非驾驶舱端口>`。
- **既有测试**：`app-auth.e2e.test.ts` 改为同样经 `createCockpitApp()` 启动；hotfix `b1ccc9b` 的大小写 e2e 与单测保留，作为额外回归。
- **`GET /` 的静态托管**：e2e 环境可能没有 web 产物，`GET /` 可能是 404；场景断言的是响应头，不依赖状态码。
- **名单一致性**：额外单测逐条对照 spec“bridge 回调路由名单”与 `isBridgeCallback` 的实现名单。
