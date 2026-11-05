## Context

动机见 proposal.md。与设计相关的现状：

- **设备工作台**（`workbench/Workbench.tsx`）：每台设备一个 iframe，懒加载、建了不销毁。
  - 启动走「一次性导航命令」：`pendingNavigationRef` 暂存 URL，`applyPendingNavigation` 赋值 `iframe.src` 后立即把引用置为 `undefined`，load 或 `DEFAULT_NAVIGATION_DEADLINE_MS`（10 秒）后清掉。URL 从不进入 React 状态。
  - 父页面的三个 message 监听器都按 `iframeRefs`（主工作台 iframe）与 `configuredOriginsRef`（已下发过 bridge 配置的 origin）认定发送方：能力串过期、实例结束、bridge 配置下发。
- **bridge**（`dsh-cockpit-bridge/src/client/index.ts:88-110`）：只在收到来源为 `window.parent`、类型为 `BRIDGE_CONFIG_MESSAGE` 的配置后才有 `active`。它所有发往父页面的 postMessage 和对驾驶舱的 fetch 都以 `active` 为前提，未握手时完全不动。
- **`forward-fixed-port-open` 已提供的能力**：同端口严格绑定；`openPath` / `urlCommand`；解析端点 `POST /api/devices/:id/forwards/:port/open-url`（只在 `ready` 时执行，同 origin 校验，返回值不落盘）；前端 `forwardOpenUrl()`。
- **DSH 侧实测与核验**：
  - DSH 的普通 Web 响应不带 `X-Frame-Options`，也不带 CSP `frame-ancestors`。实测 `127.0.0.1:3080` 的 401、404 响应头；源码中只有 `dsh-deepseek-account-platform` 的 OAuth 登录失败页带 `frame-ancestors 'none'`。现有工作台 iframe 一直能正常承载 DSH，也印证了这一点。
  - 认证 cookie 名为 `dsh-auth-` 加 `sha256(authority)`，见 `dsh-client-connection` 的 `cookieName(authority)`，以及本仓的 `dshCookieName`。浏览器的 cookie 不按端口隔离，但 `127.0.0.1:3080` 与 `127.0.0.1:3082` 的名字不同，所以不会互相覆盖。cookie 带 `SameSite=Strict`；驾驶舱页 `127.0.0.1:3090` 与 iframe 同 site（IP 主机，端口不参与 site 判断），所以会随请求发送。这和主工作台现在的情况相同。
- **顶栏**（`components/TopBar.tsx`）：`role="tablist"` 的设备项，右键或长按打开快捷菜单。device-shell 规定顶栏是唯一常驻 UI。

## Goals / Non-Goals

**Goals:**

- 只要条目是同端口常驻条目，并开启了标签页，就能在驾驶舱内操作它的 Web 服务。代码中没有任何服务专属分支。
- 沿用主工作台对启动 URL 的处理规则，以及建了不销毁的生命周期。
- 标签页与主工作台的 bridge 互不干扰。

**Non-Goals:**

- 不探测标签页内服务的认证状态。父页面读不到跨源 iframe 的状态码，所以 token 失效时由用户点「重新加载」。
- 不给标签页做 bridge 能力（会话上报、转发快照等），也不支持标签页内再开转发。
- 不持久化每台设备当前停留的视图，不支持拖拽排序，也不让标签页脱离设备独立存在。
- 不支持非同端口条目做标签页（理由见 D2）。

## Decisions

### D1. 标签页项常驻顶栏，跟在所属设备项之后（**已定**，见「人类决策记录」）

每台已启用设备的标签页项都常驻顶栏，紧跟在各自设备项之后，名称带设备名（`devbox · SA`）。样式和设备项一致，无边框选中态，`aria-selected`；没有标签页条目时顶栏完全不变。

- 理由：
  - 「顶栏为唯一常驻 UI」不需要修改；
  - SA 这类面板要随时一键可达，若只在选中设备后显示，离开设备后就要先点设备再点标签页。
- 交互：点标签页项同时切换当前设备与视图；点设备项总是回到该设备工作台。快捷菜单（「重新加载」）沿用设备项的右键、长按。
- 备选（未采用）：只显示当前设备的标签页（初版实现，验收时用户认为离开设备后标签页消失不便）；或在工作台内加二级标签栏（需修改「顶栏为唯一常驻 UI」）。
- 视图状态：`App` 里维护 `Map<deviceId, tabKey>`，只存在页面内存中，刷新页面后回到工作台。
- 前台上报：`POST /api/foreground` 只在视图为工作台时上报当前设备，在标签页上报 `null`。否则停在标签页期间该设备的会话完成会被当作「正在看」而不补记提醒（c51a8d3 的补记逻辑以前台设备判断）。

### D2. 只允许同端口条目做标签页

标签页 iframe 的 origin 是 `http://127.0.0.1:<localPort>`。

- 非同端口条目每次重建本地端口都会变，iframe 的 origin 随之改变：该服务存在浏览器里的数据会丢失，Host 围栏也会生效。
- 同端口条目的 origin 恒为 `127.0.0.1:<设备端口>`，与服务自己认定的 origin 一致。

校验放在 `DeviceForwards.checkPin`：合并之后的状态若 `workbenchTab && !sameLocalPort`，就以 `workbench-tab-requires-same-port` 拒绝。这条同时覆盖「新建时没开同端口」与「开着标签页时取消同端口」两种情况。`workbenchTab` 是元数据，与 `openPath` 一样不会触发重建。

### D3. 标签页由新组件 `ForwardTabs` 承载，复用一次性导航模式，但不复用 `Workbench` 的状态机

`Workbench.tsx` 的启动状态机绑定在 `(deviceId, endpoint, authGeneration, lifecycle)` 上，还管着 bridge 握手。把标签页塞进去，会让每个 bridge 监听器都要区分 iframe 的类型。所以新建 `workbench/ForwardTabs.tsx`，与 `Workbench` 并列挂在内容区，只负责以 `deviceId:devicePort` 为键的标签页 iframe：

- **注册表**：`Map<tabKey, { state, hasNavigated, failure }>`，React 状态里只放这些非敏感字段。
- **启动**：选中时，如果条目是 `ready` 且尚未导航，就执行启动：
  - 有命令时调用 `api.resolveForwardUrl`，没有命令时用 `forwardOpenUrl(localPort, openPath)`；
  - 结果放进 `pendingRef`（不进 state），由 ref 回调里的 `apply` 赋值 `iframe.src` 后立即清除，并启动 10 秒超时；load 或超时都会清除 pending；
  - 同一个 tabKey 同时只有一次启动在进行（单飞）。
- **失败**：错误码映射到 `ForwardList` 已有的 `CODE_TEXT`，从 `ForwardList` 导出共用。显示「重试」，点一次就重新执行一次启动。
- **重新加载**：由顶栏快捷菜单触发，经 `App` 传入的 `reloadTab(tabKey)` 再执行一次启动，对同一个 iframe 重新导航。
- **iframe 属性**：`sandbox`、`allow`、`referrerPolicy` 抽成 `workbench/frame-attributes.ts` 中的常量，与 `Workbench` 共用，避免两边分叉。
- **生命周期**：条目从投影里消失、`workbenchTab` 被取消、设备被禁用或移除时，从注册表删除并卸载 iframe。条目不是 `ready` 时显示遮罩（复用 `.workbench-overlay` 的样式与文案模式）；已挂载的 iframe 保留在遮罩后面。

### D4. bridge 隔离靠「不握手」，不靠新协议

`ForwardTabs` 的 iframe 不放进 `Workbench` 的 `iframeRefs`，也不进 `configuredOriginsRef`，所以：

- `Workbench` 永远不会向它 postMessage（bridge 配置、激活消息、转发快照的投递目标都只来自 `iframeRefs`）；
- 来自它的能力串过期、实例结束消息，在发送方认定这一步就会失败：`event.source` 不匹配任何主工作台 iframe；source 为 null 时退回按 origin 认定，但 `127.0.0.1:3082` 不在任何设备的已配置 origin 集合里，所以也会失败；
- 页面里的 bridge 因为从未收到配置，所以不会发起任何 fetch，也不会上报会话；它对设备页面表现为「不在驾驶舱中」，消费方会回到本机行为。

这正是 bridge 契约本来就有的路径（spec「不在驾驶舱中时接缝不可用」），bridge 与 SA 都不需要任何改动。我们用测试锁定这种隔离，见 tasks 5.4。

## Risks / Trade-offs

- [token 轮换后标签页停在 401 文本页，用户可能看不懂] → 遮罩无法覆盖这种情况（父页面读不到 401）。标签页项的快捷菜单提供「重新加载」，README 写明用法。DSH 重启后通常仍可复用原有 cookie（见 connectivity spec 中「普通 DSH 重启后复用已有 cookie」），实际需要手动重新加载的情况不多。
- [标签页内的服务自己打开新窗口] → sandbox 与主工作台一致（`allow-popups allow-popups-to-escape-sandbox`），行为相同。
- [条目在 `ready` 与 `retrying` 之间反复切换] → 已挂载的 iframe 只被遮罩盖住，不会重建或重新导航；恢复后由用户决定是否重新加载，避免自动重载打断用户正在进行的操作。
- [设备 A 与 B 都想把 3082 做成标签页] → 同端口冲突已在 `forward-fixed-port-open` D3 中拒绝，每个本地端口最多只有一个标签页。

## Migration Plan

- `workbenchTab` 是可选字段，旧记录缺省为关闭，不需要迁移。新字段不合规时只丢弃该字段，常驻标记保留。
- 回滚时，旧版首次写注册表就会丢掉这个字段（同 `forward-fixed-port-open` 的回滚说明），重新升级后要在面板里重新勾选。
- 只涉及 cockpit 的 server、web、shared，与 bridge、shim、SA 的发布无关。

## Open Questions

- 无。

## 人类决策记录

- **2026-11-06**：用户决定，design D1 采用推荐方案：标签页项放在顶栏、紧跟选中设备项之后；不加工作台内二级标签栏。
- **2026-11-06**：用户采纳 ponytail-review 两条建议：标签页视图下前台设备上报为空（补记完成提醒）；tasks 3.2 的 token 断言不针对 DOM。
- **2026-11-06**：用户验收时决定标签页改为常驻顶栏（所有设备的标签页始终显示，名称带设备名，点击同时切设备），并要求在本 change 内修改，不另开 change。
