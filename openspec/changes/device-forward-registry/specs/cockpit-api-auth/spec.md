## ADDED Requirements

### Requirement: 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求

驾驶舱服务端 SHALL 对所有要求驾驶舱 HttpOnly token 的 `/api/` 路由统一执行来源校验。

**豁免范围**

以下请求不做来源校验，沿用各自既有的认证：

- `/api/bootstrap`；
- 携带 bridge 能力串请求头的 bridge 回调路由（既有豁免名单，以及本 change 新增的 `/api/bridge/forwards/*`）。

Host 主机名校验同样适用于 `/api/bootstrap` 与 bridge 回调；只有 Origin/`Sec-Fetch-Site` 校验对它们豁免。

**“驾驶舱自身 origin”的判定**

- 请求的 `Origin` 头 SHALL 与 `http://` 加上该请求自身的 `Host` 头精确相等。
- 同时，`Host` 的主机名 SHALL 为 `127.0.0.1` 或 `localhost`。
- 这样同时涵盖以下三种访问方式，且无需额外配置：
  - 生产环境直接访问服务端端口；
  - 开发时经 Vite 代理访问：代理保留 `Host`，`changeOrigin: false`；
  - 用 `localhost` 或 `127.0.0.1` 任一形式访问。
- 设备页面及任何经转发暴露的本地页面，所在端口与请求 `Host` 不同，因此其 `Origin` 不相等。

**拒绝条件**

满足以下任一条件时，请求 SHALL 以 403 与稳定错误码 `cross-origin-rejected` 被拒绝：

- 请求缺少 `Host` 头，或 `Host` 的主机名不是 `127.0.0.1` 或 `localhost`（无论是否携带 `Origin`）；
- 携带 `Origin` 头，且不满足上述判定；
- 携带 `Sec-Fetch-Site` 头，且其值既不是 `same-origin` 也不是 `none`。

拒绝 SHALL 发生在任何业务处理之前，MUST NOT 产生副作用。

**放行条件**

- 不携带 `Origin` 的请求照常按 token 校验。这涵盖同源 GET 请求与非浏览器客户端。
- 理由：跨源的带凭据非 GET 请求一定附带 `Origin`；跨源 GET 与导航由 `Sec-Fetch-Site` 拦截。因此不支持 Fetch Metadata 的旧浏览器只能发出读不到响应的 no-cors GET。
- 要求驾驶舱 token 且产生副作用的路由 MUST NOT 使用 GET 或 HEAD 方法，包括本 change 新增的转发表管理端点。

**CORS**

- 驾驶舱 SHALL 只对 bridge 回调路由返回允许凭据的 CORS 许可。
- 对其它 `/api/` 路由，MUST NOT 向驾驶舱自身 origin 之外的 origin 返回 `Access-Control-Allow-Credentials: true`。

**理由**

- 驾驶舱 cookie 不按端口隔离；设备页面与经转发打开的本地服务都与驾驶舱同属 `127.0.0.1` 站点，浏览器会为它们的请求附带驾驶舱 cookie。
- 仅靠 cookie，无法区分驾驶舱自身页面与这些页面。

#### Scenario: 驾驶舱自身页面正常调用
- **GIVEN** 驾驶舱在 `127.0.0.1:3090` 提供服务，浏览器持有有效 cookie
- **WHEN** 驾驶舱页面以 `Origin: http://127.0.0.1:3090`、`Host: 127.0.0.1:3090` 发起 `POST /api/devices/<id>/refresh`
- **THEN** 请求被正常处理

#### Scenario: 开发代理下的驾驶舱页面正常调用
- **GIVEN** 开发时页面由 `127.0.0.1:5173` 提供，`/api` 经代理转发并保留 `Host: 127.0.0.1:5173`
- **WHEN** 页面以 `Origin: http://127.0.0.1:5173` 发起任一 cookie 认证的 API 请求
- **THEN** 请求被正常处理

#### Scenario: 设备页面带 cookie 获取启动 URL 被拒绝
- **GIVEN** 浏览器持有驾驶舱有效 cookie
- **WHEN** 来自 `http://127.0.0.1:<某设备本地端口>` 的带凭据跨源请求调用 `POST /api/devices/<任意设备>/workbench-launch`
- **THEN** 响应为 403 `cross-origin-rejected`，响应体中没有任何启动 URL 或 token

#### Scenario: 设备页面带 cookie 修改或删除设备被拒绝
- **GIVEN** 浏览器持有驾驶舱有效 cookie
- **WHEN** 来自设备页面 origin 的带凭据请求调用 `PUT /api/devices/<id>`（修改 SSH 别名）或 `DELETE /api/devices/<id>?confirmed=true`
- **THEN** 两者均返回 403 `cross-origin-rejected`，注册记录与连接均不变

#### Scenario: 跨站点提示头被拒绝
- **GIVEN** 浏览器持有驾驶舱有效 cookie
- **WHEN** 请求不带 `Origin` 头，但带 `Sec-Fetch-Site: same-site`，调用任一 cookie 认证的 API
- **THEN** 响应为 403 `cross-origin-rejected`

#### Scenario: bridge 回调不受来源校验影响
- **GIVEN** 设备页面上的 bridge 持有有效能力串
- **WHEN** 它以设备页面 origin 调用 `/api/bridge/session-opened`
- **THEN** 请求按既有能力串校验被处理，不因来源校验被拒绝

#### Scenario: 非 bridge 路由不再获得凭据 CORS 许可
- **GIVEN** 来自设备页面 origin 的预检请求
- **WHEN** 预检目标为 `PUT /api/devices/<id>`
- **THEN** 响应不含 `Access-Control-Allow-Credentials: true`

#### Scenario: DNS rebinding 的同源读取被拒绝
- **GIVEN** 某外部域名被解析到 127.0.0.1，浏览器对该域名持有驾驶舱 cookie
- **WHEN** 该域名页面以 `Host: evil.example:3090`、不带 `Origin` 发起 `GET /api/devices` 或 `GET /api/bootstrap`
- **THEN** 响应为 403 `cross-origin-rejected`，不下发 `Set-Cookie`，响应体不含设备数据
