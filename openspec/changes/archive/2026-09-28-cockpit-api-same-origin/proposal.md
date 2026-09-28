## Why

驾驶舱的 cookie 认证存在一个与任何新功能无关的既有缺陷：它无法区分“驾驶舱自己的页面”与“同一台机器上其它端口的页面”。

- 设备工作台 iframe 运行在 `http://127.0.0.1:<设备本地端口>`，与驾驶舱（默认 `127.0.0.1:3090`）同属 `127.0.0.1` 站点。cookie 不按端口隔离，`SameSite=Strict` 也只看站点不看端口，所以浏览器会为设备页面发出的请求附带驾驶舱 cookie。
- `main.ts` 的 CORS 又对任意回环 origin 反射 `Access-Control-Allow-Origin` 并允许凭据，`TokenMiddleware` 只校验 cookie、不看来源。
- 结果：任一设备页面中的脚本（设备上的 DSH 插件、被攻破的远端服务、或设备上任意 Web UI）都能带着驾驶舱 cookie：
  - 调用 `POST /api/devices/<任意设备>/workbench-launch`，读到**任意设备**的 DSH 启动 token；
  - 调用 `PUT /api/devices/<id>` 改写设备的 SSH 别名，或 `DELETE` 删除设备。
- 此外还有 DNS rebinding：攻击者域名解析到 `127.0.0.1` 后，其页面的请求在浏览器看来是同源、不带 `Origin`。`TokenMiddleware` 在 401 时会下发 `Set-Cookie`，攻击页面重试一次即可读取设备列表等数据。

一台设备的页面能越权操作其它设备，这打破了“设备之间互相隔离、只有驾驶舱自身能管理设备”的基本边界，应当独立于任何隧道改造先行修复。后续的 `device-forward-registry` change 会把“不能跨设备”作为其信任面放宽的前提，并会让经转发在浏览器中打开的本地页面变多，因此它依赖本修复先落地；但本修复本身不依赖它。

## What Changes

- **全部 `/api/` 请求无条件校验 `Host`**：`Host` 必须存在且主机名为 `127.0.0.1` 或 `localhost`，否则 403 `cross-origin-rejected`。该检查先于一切 token 豁免（含 `/api/bootstrap` 与 bridge 回调），被拒绝时不下发 `Set-Cookie`。堵住 DNS rebinding。
- **cookie 认证的 `/api/` 请求增加来源校验**：
  - 携带 `Origin` 时，必须精确等于 `http://` + 请求自身的 `Host`；
  - 携带 `Sec-Fetch-Site` 时，只接受 `same-origin` 或 `none`；
  - 不满足返回 403 `cross-origin-rejected`，先于任何业务处理。
  - 只有 `/api/bootstrap` 与**携带能力串请求头**的既有 bridge 回调豁免这两项检查（Host 检查不豁免）。
- **不变量**：要求驾驶舱 token 且有副作用的路由 MUST NOT 使用 GET/HEAD（现有路由已满足，写成规范防止回退）。
- **收窄 CORS 凭据许可**：只对 bridge 回调路由返回 `Access-Control-Allow-Credentials: true`；其它 `/api/` 路由不再向外部 origin 放行凭据。
- **防点击劫持**：驾驶舱服务端的每个 HTTP 响应附带 `Content-Security-Policy: frame-ancestors 'self'`，禁止其它页面（含设备页面）嵌入驾驶舱 shell。
- **行为变化（有限的 BREAKING）**：
  - 以非回环主机名（反向代理、hosts 别名）访问驾驶舱 API 将被 403。
  - 不带能力串、来自设备 origin 的 bridge 回调（legacy cookie 路径）将被 403。已 pin 的 bridge 总是携带能力串，且其 `fetch` 本就不带 cookie，预期无实际影响。

## Capabilities

### New Capabilities
- `cockpit-api-auth`：驾驶舱 cookie 认证 API 的 Host/来源校验、CORS 凭据许可范围，以及 shell 的嵌入限制。

### Modified Capabilities
- `cockpit-workbench`：requirement“工作台直接承载远端原生 DSH，零协议耦合”的 Origin gate 改为与本 capability 分层表述——Origin 存在但不等于 `http://`+Host 的启动请求先由全局守卫以 `cross-origin-rejected` 拒绝，其余不满足更严格启动条件的（缺失 Origin、`localhost` Host）仍由启动接口以 `workbench-origin-forbidden` 拒绝；Web 对两者显示同一固定文案。该 requirement 由并行 change `fix-new-browser-workbench-auth` 引入，合并后两层叠加才暴露此不一致（见 design D7）。
- 其余现有 specs 的 requirement 不变：`cockpit-workbench` 的“跨端口认证”场景本就要求 bridge 不依赖跨端口 cookie；`cockpit-pwa` 的同源 GET 缓存策略与 `cockpit-runtime-launch` 的 CLI 调用均不带跨源 `Origin`，不受影响。

## Impact

- **服务端**：
  - `packages/cockpit-server/src/auth/token.middleware.ts`：在既有 token 豁免判断之前加入 Host 与来源校验；新错误码 `cross-origin-rejected`。
  - `packages/cockpit-server/src/main.ts`：CORS 改为按路由决定是否允许凭据；新增 `frame-ancestors` 响应头。
- **测试**：`packages/cockpit-server/tests/app-auth.e2e.test.ts` 增加 origin guard / cors / frame-ancestors 用例。
- **不受影响的调用方**（已读码核对，见 design Context）：驾驶舱 web（`credentials: 'same-origin'`）、同源 EventSource、Service Worker 同源 GET、Vite 开发代理（`changeOrigin: false`）、`bin/cockpit` CLI（Node fetch 不带 `Origin`）、带能力串的 bridge。
- **web**：`Workbench.tsx` 为 `cross-origin-rejected` 增加固定文案（与 `workbench-origin-forbidden` 相同）。
- **不涉及**：bridge 包无需改动；无数据迁移；无依赖变更。
- **后续**：`device-forward-registry` 新增的 bridge 端点须加入同一 bridge 回调名单，并沿用本 capability 的校验。
