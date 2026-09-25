## Why

驾驶舱现在会为设备建立若干条 `ssh -L` 转发。可是除了主通道，其余转发全都记在进程内存里：没有界面能看到，没有 pid 可查，也没有空闲回收。已发布的 URL 被永久缓存，即使对应的 ssh 进程已经死掉，缓存仍然会返回。用户担心“后面生成多了都不知道有多少 ssh 进程”，这正是问题所在。

与此同时，下游组件（例如 memex 卡片浏览）希望转发能按需自动建立、用完自动回收，而组件本身不感知驾驶舱或 bridge。这就要求驾驶舱维护**一张**可见、可管理、会自愈的转发表，并通过 bridge 提供“申请 / 续约 / 释放 / 列出”能力。

## What Changes

- **每台设备维护唯一一张转发表**，它是该设备全部 ssh 转发进程的唯一真相源。
  - 工作台主通道以不可删除的 `system` 条目出现在表中。
  - 其余条目逐条记录设备端口、本地端口、来源、寿命、持有者、状态、pid 与时间戳。
  - 同一设备端口至多一个条目。附加条目每设备上限 8 条（`N / 8`），上限由所有来源共享。
- **寿命分两种**。
  - **常驻**：手动创建，来自驾驶舱界面或 DSH 设置页，直到被删除为止。
  - **租约**：经 bridge 按需申请，持有者续约。所有持有者都释放或过期后自动回收。
  - 多方申请同一设备端口时复用同一条目，按持有者计数。
- **期望状态加自愈**：条目意外断开后按退避重建。bridge 只在条目就绪时交付地址，不再返回过期缓存。
  - 主通道重连、以及认证材料变更导致的连接替换，都不再连带杀死附加转发。转发表归 `ConnectivityService` 按设备持有，只在设备禁用、删除或驾驶舱退出时整体回收；SSH 别名变更时暂停附加转发，待主通道在新别名上就绪后重建。
  - 主通道不可用期间冻结租约计时，避免因 bridge 无法续约而误回收。
- **附加转发的本地端口也持久化**，跨重连、跨驾驶舱重启保持稳定。**BREAKING（规范层面）**：推翻 `device-port-forward-seam` 的 D3 “附加通道端口不持久化”。
- **取消“先登记后发布”的两段式**：调用方可以直接传设备端口。**BREAKING（规范层面）**：明确推翻 `device-port-forward-seam` D4 中“消费方不能传端口号”的规则。
  - 理由：D4 已论证，登记与发布出自同一个可信页面，登记本身挡不住一个想要任意端口的页面。
  - 安全边界保持为结构性约束：只转发设备的 `127.0.0.1:<port>`、只在宿主机回环监听、句柄绑定单个端口、每设备有上限、按 `Origin` 限定本设备、全部可见可删。
- **新增 bridge 接缝 `cockpitBridge.forwards`**，提供 acquire / release / list / subscribe，以及创建常驻、取消常驻、删除。
  - acquire 立即返回，地址在就绪后通过通知交付。
  - 租约由 bridge 在页面存活期间自动续约，页面关闭后自然到期。
  - 地址变化或租约被撤销、过期时通知持有者，bridge 不自动重新申请。
  - DSH 侧的管理操作不能删除或取消驾驶舱面板建立的常驻条目。
  - 业务拒绝统一用 409 加稳定 `code`，与能力串失效（400/401）分开，避免多余的换发重试。
- **bridge 在 DSH 设置页注册“驾驶舱转发”区块**，列出本设备全部转发及其状态，并可在此手动创建或删除常驻转发。
- **驾驶舱设备管理面板新增每设备转发清单**：可查看、手动创建、删除，并显示上限占用与进程 pid。
- **全部 cookie 认证 API 增加同源校验（新 capability `cockpit-api-auth`）**：
  - 修复既有缺陷：设备页面和经转发打开的本地页面，能带着驾驶舱 cookie 调用 `workbench-launch`（拿到任意设备启动 token）、修改或删除设备。
  - 本 change 让这类页面成为常态，且放宽 D4 依赖“不能跨设备”，所以修复一并纳入。
  - 仅 bridge 回调保留凭据 CORS。
- **驾驶舱父页面向设备 iframe 推送转发表快照**（精确 targetOrigin），bridge 不轮询。
- **标签、诊断、租约标识的数据卫生约束**：标签限定为可打印 ASCII，诊断截断并以纯文本渲染，租约标识不出现在任何投影或日志中。
- **旧接缝 `cockpitBridge.portForward` 与旧端点标记为弃用但保持可用**，改为建立在新转发表之上。移除留给后续 change，前提是下游全部迁移完。

## Capabilities

### New Capabilities

- `cockpit-api-auth`：驾驶舱 cookie 认证 API 的来源校验与 CORS 凭据许可范围。

### Modified Capabilities

- `cockpit-device-port-forward`：
  - 移除“须经设备侧登记”的要求。
  - 新增转发表、寿命与租约、自愈、新接缝、DSH 设置页清单等要求。
  - 新增父页面推送快照、数据卫生、管理端点同源校验等要求。
  - 修改生命周期回收、旧接缝与 capability 校验要求。
- `cockpit-device-connectivity`：“设备本地转发端口在生命周期内保持稳定”的保证从仅限主通道扩展到附加转发，删去“附加通道端口 MUST NOT 持久化”。附加条目不得抢占任何设备的主通道持久端口。
- `cockpit-device-shell`：设备管理面板新增转发清单的呈现与管理。

## Impact

- **cockpit-server**：
  - 新增 `connectivity/forward-table.ts`，用转发表替换 `connectivity/connectivity.service.ts` 中的 `#publishablePorts` 与 `#publishedChannels`。
    - `#detach` 区分“替换 lifecycle”（认证或自动恢复变更）与“终结设备”（禁用、删除）。
    - `removeDevice` 改用 `mutateDevices`。
    - `updateDevice`：SSH 别名变更时替换 lifecycle，并暂停、重建附加转发；远端端口冲突检查与转发表同串行域。
  - `connectivity/device-lifecycle.ts`：`stop()` 与重连只处置主通道。
  - `connectivity/tunnel-manager.ts`：新增就绪后退出上报；`TunnelHandle` 增加 pid。
  - `storage/registry.ts`：设备记录新增 `forwards` 字段，旧记录兼容读取。
  - `devices/devices.controller.ts`：新增 bridge 转发端点与驾驶舱面板端点，旧端点保留。
  - `auth/token.middleware.ts`：全部 cookie 路由增加 Origin / `Sec-Fetch-Site` 同源校验；新 bridge 端点加入能力串豁免名单。
  - `main.ts`：CORS 凭据许可只对 bridge 回调路由开放。
- **shared**：
  - `DeviceRecord` 新增 `forwards`。
  - 新增转发条目的只读投影类型，随设备状态流下发。
- **cockpit-web**：
  - `panels/Panels.tsx`：设备管理面板新增转发清单与表单。
  - `workbench/Workbench.tsx`：向设备 iframe 推送转发表快照。
- **dsh-cockpit-bridge**：
  - 新接缝 `cockpitBridge.forwards`，负责租约续约与失效通知。
  - 新增 DSH 设置区块。
  - `portForward` 改为基于新接缝的兼容实现；遇到旧驾驶舱（新端点返回 401 或 404）时回退旧端点。
  - `seamRequest` 只在能力串失效时换发，其余拒绝时透传 `code`。
  - 发布 minor 版本，下游 ohmydsh 按精确版本 pin 升级。
- **文档**：`README.md` 的端口发布段落与 `BACKLOG.md` 的“不得作为通用写隧道”条目，按新边界改写。
- **下游（不在本 change 内）**：ohmydsh 另起 change，内容是 memex 的“访问地址”配置，以及 memex shim 改为经 `forwards.acquire` 自动申请、写入并回收。
- **信任面（用户已确认）**：DSH 页面可发起的动作从“登记 + 发布”扩展到“申请 / 续约 / 释放 / 手动创建 / 删除本设备转发”（后两项不作用于驾驶舱建立的常驻条目）。转发出来的端口对宿主机上任何本地进程都无认证可达，与主通道相同。
  - 仍然只作用于调用方自身所在的设备（按 `Origin` 解析），仍受结构性约束。
  - 驾驶舱仍不进入数据路径。
