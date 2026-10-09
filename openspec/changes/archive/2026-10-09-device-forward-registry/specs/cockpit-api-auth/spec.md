## MODIFIED Requirements

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
