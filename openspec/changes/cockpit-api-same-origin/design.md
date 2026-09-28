## Context

动机见 `proposal.md`，行为要求见 `specs/cockpit-api-auth/spec.md`。以下现状事实均已读码确认（行号为本 change 撰写时的 `main` 分支）：

- **服务端只监听回环**：`packages/cockpit-server/src/main.ts:44` `app.listen(port, '127.0.0.1')`。默认端口 3090（`runtime/config.ts:24`，可由 `COCKPIT_PORT` 覆盖）。
- **CORS 对回环 origin 反射凭据许可**：`main.ts:24-35` 的 `enableCors`：
  - `origin` 回调对主机名为 `127.0.0.1` / `localhost` / `::1` 的任意 origin 返回 `true`（反射 ACAO），无 `Origin` 时返回 `false`；
  - 全局 `credentials: true`，`allowedHeaders` 含 `x-dsh-cockpit-bridge-capability`；
  - 注释（:19-23）写明 bridge **不依赖** cookie，而是用请求头携带能力串。
- **cookie**：`SameSite=Strict; HttpOnly; Path=/`，无 `Domain`、无端口隔离。签发点有两处：
  - `auth/bootstrap.controller.ts:15`，`GET /api/bootstrap` 无条件下发；
  - `auth/token.middleware.ts:38-42`，token 校验失败时在 401 响应上**同时**下发 `Set-Cookie`。这正是 DNS rebinding 页面“第一次 401、第二次带 cookie 读数据”的入口。
- **TokenMiddleware 不看来源**：`token.middleware.ts:16-46`：
  - :26 `requiresToken` 把非 `/api/` 路径与 `/api/bootstrap` 直接放行（:63-65）；
  - :34 带能力串请求头的 bridge 回调直接放行，交由 controller 校验（名单见 :75-81，共 5 条）；
  - 其余只比对 cookie，不读 `Host`、`Origin`、`Sec-Fetch-Site`。
  - 中间件经 `auth.module.ts:34` `forRoutes('/{*splat}')` 挂到全部路径，路径取自 `originalUrl`（:17-25、:54-59）。
- **大小写绕过（已由 hotfix `b1ccc9b` 修复）**：Express 默认大小写不敏感路由，`/API/devices` 会被分派到 `/api/devices` 处理器，而 `requiresToken` 原先按原样比对小写前缀 `/api/`。本 change 的 review（round 1 C1）实测：无 cookie 的 `GET /API/devices` 返回 200 与设备列表，`POST /API/devices/x/workbench-launch` 进入 controller。hotfix 在 `use()` 中先把路径转为小写，`requiresToken` 自身也折叠大小写，并补了 e2e 与单测。本 change 的全部路径判定沿用这一折叠后的路径。
- **无副作用 GET 已成立**：全部路由（`devices.controller.ts`、`runtime.controller.ts`、`bootstrap.controller.ts`）中，GET 只有 `/api/devices`、`/api/devices/stream`、`/api/runtime/status`、`/api/bootstrap`；其中只有 bootstrap 写 cookie，且它不要求 token。`workbench-launch`、`refresh`、`reconnect`、`completed/ack`、`bridge/capability`、`runtime/shutdown` 均为 POST，设备改删为 PUT/DELETE。
- **legacy 无能力串 bridge 路径**：`devices.controller.ts:127-133`、`:264-270` 注释说明，不带能力串的 `session-opened` / `pending-snapshot` / `hello` 只要通过了 cookie 校验就按 legacy（协议 1）处理；`publishable-port` / `publish-port` 则强制要求能力串（:210-217）。
- **合法调用方的请求形态**：
  - 驾驶舱 web：`packages/cockpit-web/src/api/client.ts:12-15` 相对路径 `fetch('/api/...')`，`credentials: 'same-origin'`。同源 GET 不带 `Origin`；同源 POST/PUT/DELETE 带 `Origin: http://<Host>`、`Sec-Fetch-Site: same-origin`。
  - 状态流：`src/api/stream.ts:16` `new EventSource('/api/devices/stream')`，同源、无 `withCredentials`。
  - Service Worker：`public/sw.js:65-67` 只处理同源 GET，非 GET 与跨源请求直接交给网络；SW 转发的 fetch 仍是同源请求。
  - 开发代理：`packages/cockpit-web/vite.config.ts:18` `'/api': { target: 'http://127.0.0.1:<cockpitPort>', changeOrigin: false }`，因此到达服务端的 `Host` 是 `127.0.0.1:5173`，浏览器发出的 `Origin` 也是 `http://127.0.0.1:5173`。
  - CLI：`bin/cockpit:262`（`GET /api/runtime/status`）与 `:494`（`POST /api/runtime/shutdown`）用 Node `fetch` 访问 `http://127.0.0.1:<port>`，只手动设置 `Cookie`（及 `X-Cockpit-Instance`）。前一轮 review 用 Node 24 实测：只附加 `sec-fetch-mode: cors`，无 `Origin`、无 `Sec-Fetch-Site`。
  - bridge：`packages/dsh-cockpit-bridge/src/client/index.ts:136-141` 向 `cockpitOrigin` 发 POST，只带 `content-type` 与能力串请求头，**不设置 `credentials`**（即默认 `same-origin`，跨源时不带 cookie）。`cockpitOrigin` 由父页面 `Workbench.tsx:85` 以 `window.location.origin` 下发。已 pin 版本 0.5.1。
- **没有任何防嵌入响应头**：服务端未设置 `X-Frame-Options` 或 CSP；`main.ts:41` `useStaticAssets` 直接托管 web 产物。
- **测试现状**：`packages/cockpit-server/tests/app-auth.e2e.test.ts` 用 `NestFactory.create(AppModule)` 起真实服务，但**不经过 `main.ts#bootstrap()`**（:80 注释），因此 `main.ts` 中的 CORS 与静态托管配置目前没有 e2e 覆盖。

## Goals / Non-Goals

**Goals:**

- 设备页面及同机任何其它端口的页面，不能借驾驶舱 cookie 调用任何 cookie 认证的 `/api/` 路由，也不能读到响应。
- DNS rebinding 页面拿不到驾驶舱 cookie，也读不到任何 `/api/` 响应。
- 驾驶舱 shell 不能被其它 origin 嵌入（防点击劫持）。
- 所有既有合法调用方（驾驶舱页面、SSE、SW、Vite 代理、CLI、带能力串的 bridge）零改动、零行为变化。

**Non-Goals:**

- 不改 cookie 本身的属性（名称、`SameSite`、不加 `__Host-` 前缀、不做 token 轮换）。
- 不改能力串的签发、校验与既有拒绝状态码（`cockpit-workbench` spec 已固定 400 `bridge-capability-invalid`）。
- 不为静态资源与 shell HTML 做 Host 校验（它们不含机密；rebinding 页面拿到 shell 也调不通 API）。
- 不处理经 `ssh -L` 暴露在回环上的**设备服务自身**的 DNS rebinding（见 Risks）。
- 不引入 helmet 等新依赖。
- 不改 web 与 bridge 包。

## Decisions

### D1. 守卫放在 `TokenMiddleware` 最前面，分两层

在 `TokenMiddleware.use()` 中、`requiresToken` 判断之前：

1. **Host 层（无条件）**：路径以 `/api/` 开头时，`Host` 必须存在且主机名为 `127.0.0.1` 或 `localhost`，否则 403 `cross-origin-rejected`。对 bootstrap 与 bridge 回调同样生效，因此被拒绝时不会走到 :41 的 `Set-Cookie`，也不会走到 bootstrap controller。
2. **来源层（按豁免）**：对 bootstrap 与“带能力串请求头的 bridge 回调”跳过；其余 `/api/` 请求：
   - `Origin` 存在时必须等于 `'http://' + Host`；
   - `Sec-Fetch-Site` 存在时必须为 `same-origin` 或 `none`；
   - 否则 403 `cross-origin-rejected`。
3. 通过后才进入既有的 token 豁免与 cookie 校验。

来源层的豁免判定复用既有的 `isBridgeCallback(pathname) && 请求头存在`，与 token 豁免保持同一条件，避免两份名单漂移。所有路径判定（Host 层是否为 `/api/`、bootstrap、bridge 名单、D4 的 CORS 分流）都使用 `use()` 开头已转为小写的同一个 pathname，并抽成一个导出的 `classifyApiPath(originalUrl)` 供中间件与 CORS 共用。

bridge 回调路由名单以 spec 的“bridge 回调路由名单”requirement 为唯一权威来源；`isBridgeCallback` 是它的实现，测试逐条对照。后续增删 bridge 路由的 change 须以 MODIFIED 更新该 requirement（例如 `device-forward-registry` 会移除 `publishable-port`/`publish-port`、加入 `forwards/acquire`/`forwards/release`）。不带能力串的 bridge 回调不豁免，因此 legacy cookie 路径来自设备 origin 时会被 403（见 Risks）。

- 备选：做成独立的 Nest middleware / guard。否决：Nest guard 在中间件之后执行，401 的 `Set-Cookie` 已经发生；再加一层中间件则要保证挂载顺序，还多一份路径解析。放在同一个中间件里，“Host 先于一切豁免”由代码顺序直接保证。
- 备选：只在有 `Origin` 时校验 Host。否决：rebinding 页面的同源 GET 不带 `Origin`，会漏过（前一轮 review M-A）。

### D2. “驾驶舱自身 origin”取自请求 `Host`，而不是配置端口

规则 `Origin === 'http://' + Host`（加 Host 主机名回环校验）一条就同时覆盖：

- 生产直连（`127.0.0.1:3090`，或非默认 `COCKPIT_PORT`）；
- Vite 开发代理（`changeOrigin: false` 保留 `Host: 127.0.0.1:5173`，`Origin` 也是 5173）；
- `localhost` 与 `127.0.0.1` 两种写法。

跨端口页面的 `Origin` 端口与 `Host` 不同，一定被拒；攻击者无法控制浏览器发出的 `Host`（它由 URL 决定），rebinding 场景下 `Host` 是攻击者域名，被 Host 层拒绝。

- 备选：比对 `resolveCockpitPort()`。否决：误拒开发代理（5173 ≠ 3090），需要额外维护 dev 白名单；e2e 测试用随机端口（`COCKPIT_PORT=0`），也会让配置端口与实际端口不一致。
- 备选：允许 `::1` / `[::1]`。否决：服务端只监听 `127.0.0.1`，IPv6 回环不可能到达；少一种写法少一种解析歧义。
- 比较细节（实现约束）：`Host` 主机名按 URL 解析后小写比较；`Origin` 与 `'http://' + Host` 做字面比较（浏览器生成的 `Origin` 已是规范化小写形式；不同写法视为不同 origin，按拒绝处理，属于 fail closed）。

### D3. 无 `Origin` 放行，靠 `Sec-Fetch-Site` 与“副作用不走 GET/HEAD”兜底

- 跨源带凭据的非 GET/HEAD 请求（fetch、表单 POST）浏览器一定附带 `Origin` → 被来源层拒绝。
- 跨源 GET 与顶层导航不带 `Origin`，但现代浏览器附带 `Sec-Fetch-Site: same-site`（同为 `127.0.0.1` 站点）或 `cross-site` → 被拒绝。
- 不支持 Fetch Metadata 的旧浏览器只能发出 no-cors GET：响应不可读，且 GET 无副作用（spec 固化为不变量），因此不构成泄露或越权。
- CLI、SSE、SW、同源 GET 都不带跨源 `Origin`、不带非同源 `Sec-Fetch-Site`，照常走 cookie 校验。

- 备选：要求所有请求必须带 `Origin`。否决：同源 GET、EventSource、CLI 都不带，全部误伤。
- 备选：CSRF token 双提交。否决：需要改 web 与 CLI，而来源校验已足以覆盖本威胁模型。

### D4. CORS 按路由决定是否允许凭据

`enableCors` 的 `origin` 回调拿不到请求路径，改用 `enableCors` 的 `CorsOptionsDelegate` 形式（`(req, cb) => cb(null, options)`）按 `originalUrl` 决定：

- bridge 回调路由（与 D1 同一份名单、同一个 `classifyApiPath`）：保持现状——对回环 origin 反射 ACAO，`credentials: true`，`allowedHeaders` 含能力串请求头。
- 其它路由：`origin: false`（不输出 ACAO，也不输出 `Access-Control-Allow-Credentials`）。驾驶舱自身页面同源，本就不需要 CORS。

为了让 e2e 覆盖 CORS 与 D5 的响应头，把应用创建从 `main.ts#bootstrap()` 抽成共享工厂 `createCockpitApp()`：内含 `NestFactory.create(AppModule)` 与全部 HTTP 安全配置，`main.ts` 只负责调用它、托管静态资源并 `listen`；`app-auth.e2e.test.ts` 改为调用同一工厂（弥补 Context 中“`main.ts` 配置无 e2e 覆盖”的缺口，也避免“测试调用了、生产没调用”）。

工厂内的注册顺序固定为：`frame-ancestors` 响应头中间件 → `enableCors` → （由调用方）`listen`/`init`。`frame-ancestors` 先于 CORS 注册，使 CORS 自行结束的预检 204 响应也带该头。

- 备选：保留全局 CORS，仅依赖 D1 拦截。否决：D1 已经挡住请求，但“对设备 origin 放行凭据读取”仍是不必要的许可，收窄后多一层纵深防御；spec 已要求。
- bridge 路由上的 `credentials: true` 是否还需要，见 Open Questions。

### D5. `Content-Security-Policy: frame-ancestors 'self'`（前一轮 review 📌1）

在全部响应上设置该头（以最早执行的 Express 中间件或 `app.use` 实现，保证 403/401 与静态资源都带上）。它只约束“谁能嵌入驾驶舱”，策略中不放 `default-src` / `frame-src`，不影响驾驶舱嵌入设备 iframe。

- 威胁：设备页面嵌入驾驶舱并诱导点击（例如“删除设备”）。这是既有问题，需要用户交互才能利用；成本极低，顺手纳入。
- 备选：`X-Frame-Options: SAMEORIGIN`。否决为主方案：已被 CSP `frame-ancestors` 取代；可作为兼容补充，但当前浏览器矩阵无需要，不加。
- 备选：引入 helmet。否决：只需要一个头，不值得新增依赖与其默认策略带来的回归面。

### D6. 错误形态

403 响应体沿用既有 `{ code, message }` 形态，`code: 'cross-origin-rejected'`，message 不回显请求头内容（避免把攻击者可控字符串写回页面或日志）。拒绝以调试级日志记录（结构字段：path、method、归因类别 host/origin/fetch-site），不记录 cookie。

## Risks / Trade-offs

- [旧版 bridge 的无能力串回调被 403] 不带能力串、来自设备 origin 的 `hello` / `session-opened` / `pending-snapshot`（`devices.controller.ts:127-133` 的 legacy cookie 路径）将得到 403。→ 已 pin 的 bridge 0.5.1 总是带能力串，且其 fetch 不设 `credentials`、跨源本就不带 cookie，所以这条 legacy 路径在跨源场景下原本就走不通；预期无实际影响。发布说明中注明。
- [非回环主机名访问被 403] 通过反向代理、hosts 别名或局域网 IP 访问驾驶舱 API 将被拒。→ 驾驶舱只监听 `127.0.0.1`，这些方式本就不是受支持的部署形态；如未来需要，另起 change 引入显式可信主机名配置。
- [被转发服务自身的 DNS rebinding 不在范围内] 设备 DSH 及其它经 `ssh -L` 暴露在宿主机回环上的 HTTP 服务，可被任意网站经 DNS rebinding 访问，只要它们不校验 `Host`。→ 这是回环监听的固有性质，驾驶舱不在数据路径上，无法由本修复缓解；应由被转发服务自行校验 `Host`（设备 DSH 自身有 cookie/token 认证）。
- [未知客户端误伤] 若有浏览器外客户端伪造了跨源 `Origin` 或非同源 `Sec-Fetch-Site`，会被 403。→ 已枚举的仓库内客户端都不带这些头；浏览器内合法驾驶舱页面的 `Origin` 恒等于 `Host`。
- [`localhost` 与 `127.0.0.1` 之间切换] 两种写法各自同源、各自通过；但它们是不同 origin，彼此的请求会互相拒绝。→ 与浏览器 cookie 作用域行为一致，不构成回归。
- [隐私扩展剥离 `Origin`] 少数扩展/代理会删除 `Origin`。→ 删除只会让请求走“无 Origin”分支，仍受 `Sec-Fetch-Site` 与 cookie 约束，不会放宽安全性。

## Migration Plan

1. 单步发布：服务端改动（`token.middleware.ts`、CORS 与响应头配置抽取、`main.ts` 调用）与测试一起合入，web、bridge、CLI 无需同步发布。
2. 发布前在真实浏览器中手工确认：驾驶舱页面、开发代理（`pnpm dev`）、设备 iframe 内 bridge 的 hello/session-opened、PWA 离线 shell、`bin/cockpit status/stop` 均正常。
3. **回滚**：直接回退服务端版本即可。本 change 无持久化数据、无协议或存储格式变更，回滚不丢数据；回滚后恢复为修复前的暴露面。
4. 后续：`device-forward-registry` 新增的 bridge 端点须加入同一 bridge 回调名单（D1/D4 共用），其管理端点自动受本守卫保护。

## Review 记录

- round 1（fresh-context subagent）：APPROVE_WITH_CHANGES。C1 大小写绕过已由 hotfix `b1ccc9b` 先行修复，并写入 spec 的“路径匹配语义”与场景；M1 采用方案 (a)，bridge 回调名单以本 capability 的独立 requirement 为唯一权威；M2 改为共享工厂 `createCockpitApp()` 并固定注册顺序，新增预检携带 `frame-ancestors` 的场景。

## Open Questions

- **bridge 路由是否还需要 `credentials: true`（前一轮 review 📌12）**：bridge 的 `fetch` 不设置 `credentials`，跨源请求不带 cookie，能力串经请求头传递，因此这项许可实际上不被需要。本 change 维持 spec 所写的“只对 bridge 保留”（人类决定暂缓）；收紧为“全部不放行凭据”留待后续，不阻塞本 change。

## 人类决策记录（2026-09-29）

- 接受：不带能力串、来自设备 origin 的旧版 bridge 回调被 403。
- 接受：非回环主机名访问被 403；不预留可信主机名配置（Non-Goal）。
- 接受：`frame-ancestors 'self'` 加在所有响应上，包括 403 与静态资源。
- 接受：Host 白名单只含 `127.0.0.1` 与 `localhost`，不含 `::1`（服务只监听 `127.0.0.1`）。
