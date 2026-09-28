## Why

驾驶舱会为设备建立若干条 `ssh -L` 转发。除主通道外，其余转发都只记在进程内存里：界面上看不到，也查不到 pid。已发布的 URL 被永久缓存，对应 ssh 进程死掉后仍会被返回。主通道一重连，这些附加转发会被连带杀掉，却不会重建。用户看不到 bridge 正在管理哪些隧道，担心 ssh 进程越开越多。

用户期望的分工是：
- 驾驶舱管理全部转发。
- bridge 只负责在 DSH 与驾驶舱之间申请转发，并在 DSH 设置页展示链接与状态。
- 组件只拿到一个地址，不感知 bridge 或驾驶舱。

## What Changes

- **每台设备一张转发表**，它是该设备全部 `ssh -L` 进程的唯一真相源。
  - 主通道以不可删除的 `system` 条目出现在表中。
  - 附加条目以设备端口为键，同一设备端口至多一个条目，多方申请时复用并按持有者计数。
  - 每台设备的附加条目上限为 8（`N / 8`），常驻条目与随持有者条目共用这个上限。
- **寿命只有两种**：
  - **常驻**：只能在驾驶舱设备面板手动创建、手动删除，并持久化。
  - **随持有者**：经 bridge `acquire` 建立或复用。以下任一情况发生时回收：
    - 所有持有者都已释放；
    - 持有者所属的 bridge 页面实例结束；
    - 持有者所属的驾驶舱页面（按页面标识 `pageId`）的设备状态流连接全部断开满 30 秒。
  - 随持有者条目不持久化，驾驶舱重启后不恢复。
  - 没有 TTL、续约或墓碑。
- **期望状态与自愈**：
  - 附加转发就绪后意外退出，按退避重建（1s→60s，带抖动）。
  - 主通道不可用时，只暂停新建。
  - 只在条目 `ready` 时交付地址，不再返回死缓存。
- **主通道重连、认证材料更新不再连带杀死附加转发**。SSH 别名变更时，附加条目先暂停，待主通道在新别名上就绪后重建。
- **附加转发的本地端口不持久化**。重建后端口可能变化，经转发表快照通知持有者。主通道端口的既有持久化行为不变。
- **取消“先登记后发布”**：调用方直接传设备端口。**BREAKING（规范层面）**：推翻归档 change `device-port-forward-seam` 的 D4“不可传端口号”。边界改由结构性约束承担：
  - 只转发设备的 `127.0.0.1:<port>`；
  - 只在宿主机回环监听；
  - 按 `Origin` 限定到本设备；
  - 有条目上限；
  - 全部条目可见、可删。
- **新 bridge 接缝 `cockpitBridge.forwards`**，提供 acquire / release / list / subscribe。**BREAKING**：它在 bridge 0.6.0 中直接替换 `cockpitBridge.portForward`，同一版本移除旧端点 `publishable-port` 与 `publish-port`，不保留兼容层。
- **驾驶舱父页面向设备 iframe 推送转发表快照**，`targetOrigin` 精确到设备 origin，bridge 不轮询。
- **bridge 在 DSH 设置页只读展示**本设备的转发清单、状态与 `N / 8` 占用，不提供创建或删除。
- **驾驶舱设备管理面板新增每设备转发清单**：可查看，可手动创建常驻条目，可删除；同时显示上限占用与 pid。
- **数据卫生**：
  - 标签只能是 1–64 个可打印 ASCII 字符；
  - 诊断信息截断到 300 字符以内，并以纯文本渲染；
  - 持有者实例标识不进入投影，也不写入日志。

## 前置依赖

本 change 依赖独立 change `cockpit-api-same-origin`（capability `cockpit-api-auth`）**先落地并归档**。
- 驾驶舱面板使用的转发表管理端点，以及父页面代为释放实例的端点，都是 cookie 路由，依赖它提供的同源保护。
- “调用方只能作用于本设备”的前提也依赖它：设备页面不能再带着 cookie 调用设备管理 API。
- 本 change 不重复定义校验规则，只引用。

bridge 回调路由名单的唯一权威来源，是 `cockpit-api-auth` 中的 requirement“bridge 回调路由名单”，由前置 change 新增。本 change 以 MODIFIED 更新该 requirement：移除 `publishable-port` 与 `publish-port`，加入 `/api/bridge/forwards/acquire` 与 `/api/bridge/forwards/release`。

这个 MODIFIED delta 以前置 change 引入的 requirement 为基线。因此只有 `cockpit-api-same-origin` 归档、该 requirement 进入主 spec 之后，本 change 的 `cockpit-api-auth` delta 才能对上主 spec；本 change 的归档必须排在它之后。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-port-forward`：
  - 移除“须经设备侧登记”和旧 `portForward` 接缝。
  - 新增：转发表；两种寿命及实例结束回收；自愈；`forwards` 接缝；快照推送；数据卫生；管理端点；DSH 设置页只读清单。
  - 修改：
    - 生命周期回收：主通道替换不再连带附加转发。
    - capability 校验：覆盖新端点；缺少能力串的请求由端点自身拒绝；路由名单改为引用 `cockpit-api-auth`。
- `cockpit-device-connectivity`：“设备本地转发端口在生命周期内保持稳定”中，附加通道部分改写为“随条目重建而重新分配、不持久化，经快照通知”。原场景“随主通道重连取得新端口”与“主通道重连不连带附加转发”相矛盾，一并修改。
- `cockpit-device-shell`：设备管理面板新增每设备转发清单。
- `cockpit-api-auth`：以 MODIFIED 更新“bridge 回调路由名单”，移除两条旧路由，加入两条 forwards 路由。其余条目与场景原样保留。

## Impact

- **cockpit-server**：
  - 新增 `connectivity/forward-table.ts`，替换 `connectivity.service.ts` 中的 `#publishablePorts` 与 `#publishedChannels`。
  - 调整 `#detach`、`updateDevice`、`removeDevice`。
  - `device-lifecycle.ts` 只处置主通道。
  - `tunnel-manager.ts` 增加就绪后退出上报，并提供 pid。
  - `device-events.service.ts` 与 `devices.controller.ts` 统计 SSE 连接数。
  - `storage/registry.ts` 只持久化常驻条目。
  - 新增 bridge 端点与面板端点，删除旧端点。
  - 更新 `token.middleware.ts` 中的 bridge 回调名单。
- **shared**：`DeviceRecord.forwards`（仅常驻条目）、转发表投影类型，以及实例结束与快照两类 postMessage 类型。移除 `COCKPIT_PORT_FORWARD_SERVICE` 等旧类型。
- **cockpit-web**：
  - `Workbench.tsx`：推送快照，并转发实例结束消息。
  - `panels/Panels.tsx`：新增转发清单。
- **dsh-cockpit-bridge 0.6.0**：
  - 新增 `forwards` 接缝、实例 id 与 `pagehide` 通知、只读设置区块。
  - 调整 `seamRequest` 的错误分层。
  - 删除 `portForward`。
- **文档**：README 端口发布段落与 BACKLOG 中相关条目。
- **下游（不在本 change 内）**：ohmydsh 另起 change，更新 bridge pin，并把 memex shim 迁移到 `forwards.acquire`。
- **信任面**：DSH 页面能做的操作从“登记 + 发布”变为“为本设备任意回环端口申请或释放随持有者转发”；页面不能建立常驻条目，也不能删除任何条目。转发出来的端口对宿主机上任何本地进程都无认证可达，这一点与主通道相同。驾驶舱仍不进入数据路径。
