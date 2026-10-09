# cockpit-api-auth Specification

## Purpose
驾驶舱自身 cookie 认证 API 的访问边界：所有 `/api/` 请求的 Host 与请求目标校验、cookie 路由的同源来源校验、bridge 回调路由名单（唯一权威来源）与 CORS 凭据许可范围，以及 shell 只允许被自身嵌入。防止设备页面或 DNS rebinding 页面借驾驶舱 cookie 越权操作其它设备。

## Requirements

### Requirement: 驾驶舱 cookie 认证的 API 只接受驾驶舱同源请求

驾驶舱服务端 SHALL 对所有 `/api/` 请求执行 `Host` 校验，并对所有要求驾驶舱 HttpOnly token 的 `/api/` 路由统一执行来源校验。

**豁免范围**

以下请求不做来源（`Origin` / `Sec-Fetch-Site`）校验，沿用各自既有的认证：

- `/api/bootstrap`；
- 携带 bridge 能力串请求头（`x-dsh-cockpit-bridge-capability`）、且路径在“bridge 回调路由名单”（见本 capability 同名 requirement）中的请求。

Host 主机名校验同样适用于 `/api/bootstrap` 与 bridge 回调（含其 CORS 预检）；只有 `Origin` / `Sec-Fetch-Site` 校验对它们豁免。Host 校验 SHALL 先于 CORS 处理与一切 token 豁免判断执行；Host 不合法的请求（含预检）MUST NOT 获得任何 CORS 许可头。

**路径匹配语义**

- 判定请求是否为 `/api/` 请求、是否为 `/api/bootstrap`、是否在 bridge 回调路由名单中，SHALL 采用与 HTTP 路由器相同的大小写不敏感语义（例如先把路径转为小写再匹配，或让路由器改为大小写敏感，使二者一致）。
- 任何被路由器分派到 `/api/` 处理器的路径变体 MUST NOT 绕过 Host、来源或 token 校验。
- 请求目标（request-target）SHALL 为符合 RFC 9112 的 origin-form：以 `/` 开头，且不含未转义的控制字符、空白、`#`、`\` 或非 ASCII 字符。absolute-form（如 `GET http://x/api/devices`）、authority-form、asterisk-form（`OPTIONS *`）以及不合规的 origin-form（如 `/api\devices#x`）SHALL 在任何路由、CORS 处理与业务处理之前以 400 拒绝（由驾驶舱拒绝时错误码为 `bad-request-target`；HTTP 解析器先行拒绝亦可）：路由器会从这些目标中解析出 `/api/...` 路径并分派到处理器，而按原始请求目标做的判定看不到它。浏览器不会发出这类请求目标，拒绝不影响任何合法调用方。
- CORS 的凭据许可判定（见下文）SHALL 使用同一个匹配函数。

**“驾驶舱自身 origin”的判定**

- 请求的 `Origin` 头 SHALL 与 `http://` 加上该请求自身的 `Host` 头精确相等。
- 同时，`Host` 的主机名 SHALL 为 `127.0.0.1` 或 `localhost`。
- 这样同时涵盖以下三种访问方式，且无需额外配置：
  - 生产环境直接访问服务端端口；
  - 开发时经 Vite 代理访问：代理保留 `Host`，`changeOrigin: false`；
  - 用 `localhost` 或 `127.0.0.1` 任一形式访问。
- 设备工作台页面及同一主机上任何其它端口的本地页面，所在端口与请求 `Host` 不同，因此其 `Origin` 不相等。

**拒绝条件**

满足以下任一条件时，请求 SHALL 以 403 与稳定错误码 `cross-origin-rejected` 被拒绝：

- 请求缺少 `Host` 头，或 `Host` 的主机名不是 `127.0.0.1` 或 `localhost`（无论是否携带 `Origin`，无论路由是否豁免 token）；
- 非豁免请求携带 `Origin` 头，且不满足上述判定；
- 非豁免请求携带 `Sec-Fetch-Site` 头，且其值既不是 `same-origin` 也不是 `none`。

拒绝 SHALL 发生在任何业务处理之前，MUST NOT 产生副作用，响应 MUST NOT 携带 `Set-Cookie`。

**放行条件**

- 通过上述校验且不携带 `Origin` 的请求照常按 token 校验。这涵盖同源 GET 请求与非浏览器客户端（如 `bin/cockpit` CLI）。
- 理由：跨源的带凭据非 GET 请求一定附带 `Origin`；跨源 GET 与导航由 `Sec-Fetch-Site` 拦截。因此不支持 Fetch Metadata 的旧浏览器只能发出读不到响应的 no-cors GET。
- 要求驾驶舱 token 且产生副作用的路由 MUST NOT 使用 GET 或 HEAD 方法。

**CORS**

- 驾驶舱 SHALL 只对 bridge 回调路由返回允许凭据的 CORS 许可；bridge 回调对回环设备 origin 的 CORS 许可（含允许 `x-dsh-cockpit-bridge-capability` 请求头）SHALL 保持可用。
- 对其它 `/api/` 路由，驾驶舱 MUST NOT 向驾驶舱自身 origin 之外的 origin 返回 `Access-Control-Allow-Credentials: true`。

**理由**

- 驾驶舱 cookie 不按端口隔离；设备页面与同一主机上其它端口的本地页面都与驾驶舱同属 `127.0.0.1` 站点，浏览器会为它们的请求附带驾驶舱 cookie。
- 仅靠 cookie，无法区分驾驶舱自身页面与这些页面。

#### Scenario: 驾驶舱自身页面正常调用
- **GIVEN** 驾驶舱在 `127.0.0.1:3090` 提供服务，浏览器持有有效 cookie
- **WHEN** 驾驶舱页面以 `Origin: http://127.0.0.1:3090`、`Host: 127.0.0.1:3090`、`Sec-Fetch-Site: same-origin` 发起 `POST /api/devices/<id>/refresh`
- **THEN** 请求被正常处理，响应不是 403

#### Scenario: 开发代理下的驾驶舱页面正常调用
- **GIVEN** 开发时页面由 `127.0.0.1:5173` 提供，`/api` 经代理转发并保留 `Host: 127.0.0.1:5173`
- **WHEN** 页面以 `Origin: http://127.0.0.1:5173` 发起任一 cookie 认证的 API 请求
- **THEN** 请求被正常处理，响应不是 403

#### Scenario: 不带 Origin 的命令行客户端照常访问
- **GIVEN** `bin/cockpit` 以 `Cookie: cockpit_token=<有效 token>` 访问 `http://127.0.0.1:<port>`，不带 `Origin` 与 `Sec-Fetch-Site`
- **WHEN** 它调用 `GET /api/runtime/status`
- **THEN** 响应为 200，返回运行记录

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
- **WHEN** 它以设备页面 origin、`Host: 127.0.0.1:<驾驶舱端口>` 调用 `/api/bridge/session-opened`
- **THEN** 请求按既有能力串校验被处理，不因来源校验被拒绝

#### Scenario: 不带能力串的 bridge 回调按 cookie 路由校验来源
- **GIVEN** 浏览器持有驾驶舱有效 cookie
- **WHEN** 来自设备页面 origin 的请求不带能力串请求头调用 `/api/bridge/hello`
- **THEN** 响应为 403 `cross-origin-rejected`

#### Scenario: 非 bridge 路由不再获得凭据 CORS 许可
- **GIVEN** 来自设备页面 origin 的预检请求
- **WHEN** 预检目标为 `PUT /api/devices/<id>`
- **THEN** 响应不含 `Access-Control-Allow-Credentials: true`

#### Scenario: bridge 回调的预检仍被放行
- **GIVEN** 来自设备页面 origin `http://127.0.0.1:<设备本地端口>` 的预检请求
- **WHEN** 预检目标为 `POST /api/bridge/hello`，`Access-Control-Request-Headers` 含 `content-type, x-dsh-cockpit-bridge-capability`
- **THEN** 响应的 `Access-Control-Allow-Origin` 等于该设备 origin，`Access-Control-Allow-Headers` 含 `x-dsh-cockpit-bridge-capability`

#### Scenario: 非 origin-form 请求目标被拒绝
- **GIVEN** 驾驶舱正在运行，注册表中有一台设备
- **WHEN** 不带 cookie 的请求以 `Host: 127.0.0.1:<驾驶舱端口>` 发出 `GET http://127.0.0.1:<驾驶舱端口>/api/devices`、`DELETE http://x/api/devices/<id>?confirmed=true`、`OPTIONS *`、`GET /api\devices#x` 或 `DELETE /api\devices\<id>?confirmed=true#`
- **THEN** 响应均为 400 `bad-request-target`，携带 `frame-ancestors 'self'`，响应体不含设备数据，注册表不变

#### Scenario: Host 不合法的 bridge 预检不获得 CORS 许可
- **GIVEN** 来自设备页面 origin 的预检请求
- **WHEN** 以 `Host: evil.example:3090` 预检 `POST /api/bridge/hello`
- **THEN** 响应为 403 `cross-origin-rejected`，不含 `Access-Control-Allow-Origin` 与 `Access-Control-Allow-Credentials`

#### Scenario: 大小写变体路径不能绕过校验
- **GIVEN** 驾驶舱正在运行
- **WHEN** 不带 cookie 的请求以 `Host: 127.0.0.1:<驾驶舱端口>` 调用 `GET /API/devices` 与 `POST /Api/devices/<id>/workbench-launch`；另一请求以 `Host: evil.example:3090` 调用 `GET /API/devices`
- **THEN** 前两者返回 401 `unauthorized`，后者返回 403 `cross-origin-rejected` 且不带 `Set-Cookie`；三者的响应体都不含设备数据、启动 URL 或 token

#### Scenario: DNS rebinding 的同源读取被拒绝
- **GIVEN** 某外部域名被解析到 127.0.0.1，浏览器对该域名持有驾驶舱 cookie
- **WHEN** 该域名页面以 `Host: evil.example:3090`、不带 `Origin` 发起 `GET /api/devices` 或 `GET /api/bootstrap`
- **THEN** 响应为 403 `cross-origin-rejected`，不下发 `Set-Cookie`，响应体不含设备数据

### Requirement: bridge 回调路由名单

驾驶舱 SHALL 维护一份精确的 bridge 回调路由名单，本 requirement 是该名单的唯一权威来源；不按路径前缀推断，未列入名单的路径（即使位于 `/api/bridge/` 下）MUST NOT 获得 bridge 回调的 token 豁免、来源豁免或凭据 CORS 许可。新增或移除 bridge 回调路由的 change MUST 以 MODIFIED 形式更新本 requirement。

当前名单：

- `/api/bridge/hello`
- `/api/bridge/session-opened`
- `/api/bridge/pending-snapshot`
- `/api/bridge/forwards/acquire`
- `/api/bridge/forwards/release`

#### Scenario: 名单外的 bridge 路径不被豁免
- **GIVEN** 浏览器持有驾驶舱有效 cookie
- **WHEN** 来自设备页面 origin 的请求携带能力串请求头调用一个不在名单中的路径 `/api/bridge/unlisted`
- **THEN** 响应为 403 `cross-origin-rejected`，且其预检响应不含 `Access-Control-Allow-Credentials: true`

#### Scenario: 名单内路径的大小写变体按名单匹配
- **GIVEN** 设备页面上的 bridge 持有有效能力串
- **WHEN** 它调用 `/API/Bridge/Hello`
- **THEN** 请求与 `/api/bridge/hello` 同等处理：享受来源豁免并进入能力串校验

### Requirement: 驾驶舱页面只允许被驾驶舱自身嵌入

驾驶舱服务端 SHALL 在其全部 HTTP 响应（shell HTML、静态资源与 `/api/` 响应，含 403 拒绝响应）上附带 `Content-Security-Policy: frame-ancestors 'self'`，使驾驶舱页面不能被其它 origin（包括设备工作台页面）以 iframe 嵌入。该头 MUST NOT 影响驾驶舱自身嵌入设备工作台 iframe。

#### Scenario: shell 响应携带 frame-ancestors
- **GIVEN** 驾驶舱正在运行
- **WHEN** 浏览器导航请求 `GET /`
- **THEN** 响应含 `Content-Security-Policy` 头，其值包含 `frame-ancestors 'self'`

#### Scenario: 被拒绝的 API 响应同样携带 frame-ancestors
- **GIVEN** 驾驶舱正在运行
- **WHEN** 来自设备页面 origin 的请求调用 `POST /api/devices/<id>/workbench-launch` 并被拒绝
- **THEN** 403 响应同样含 `Content-Security-Policy` 头，其值包含 `frame-ancestors 'self'`

#### Scenario: bridge 预检响应同样携带 frame-ancestors
- **GIVEN** 来自设备页面 origin 的预检请求
- **WHEN** 预检目标为 `POST /api/bridge/hello`
- **THEN** 预检响应含 `Content-Security-Policy` 头，其值包含 `frame-ancestors 'self'`

#### Scenario: 设备工作台 iframe 不受影响
- **GIVEN** 驾驶舱已附带 `frame-ancestors 'self'`
- **WHEN** 读取 `GET /` 响应的 `Content-Security-Policy` 头
- **THEN** 其中只有 `frame-ancestors` 指令，不含 `default-src`、`frame-src` 或 `child-src`，因此不限制驾驶舱页面以 iframe 加载 `http://127.0.0.1:<设备本地端口>/`
