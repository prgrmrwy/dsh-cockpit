## Why

`forward-fixed-port-open` 让同端口转发能在新浏览器窗口里打开。但有些设备服务本身就是要长时间操作的 Web 控制台，例如部署侧跑在 `127.0.0.1:3082` 的另一个原生 DSH Web。每次都另开窗口，用户就要离开驾驶舱，在两套窗口之间来回切换；token 轮换后，还得重新回到面板点「打开」。驾驶舱本来就承载设备工作台的 iframe，可以把这类同端口条目直接挂在驾驶舱里。这项能力是通用的：任何同端口常驻条目都可以挂，不写任何服务专属逻辑。

## What Changes

- **常驻条目新增可选开关「在工作台显示为标签页」**（`workbenchTab`）。只有带「同端口」标记的常驻条目能开；它作为常驻标记的可选字段持久化，旧记录不需要迁移。不满足条件时以新错误码 `workbench-tab-requires-same-port` 拒绝；对已开 tab 的条目取消「同端口」，也同样拒绝。
- **顶栏常驻显示所有设备的标签页项**，跟在所属设备项之后：名称为 `<设备显示名> · <标签>`，没有标签时为 `<设备显示名>:<端口>`。点标签页项，同时切到该设备与该条目的 iframe；点设备项，回到原生 DSH 工作台。顶栏仍是唯一常驻 UI。
- **标签页 iframe 首次选中时才创建，之后不销毁**。启动方式沿用工作台对启动 URL 的处理规则：
  - 配了打开地址命令的条目，经已有的解析端点取得地址；没配命令的，在本地拼出 `http://127.0.0.1:<端口><打开路径>`；
  - 地址只赋值给 iframe 一次，不写入状态、日志或事件流，load 或超时后清除父页面持有的引用；
  - 失败时显示脱敏后的说明，并提供「重试」。
- **条目未就绪或端口被占用时**，标签页只显示条目的状态文字和诊断，不创建 iframe；已创建的 iframe 保留在遮罩后面。
- **标签页项的快捷菜单提供「重新加载」**，用于 token 轮换后让用户主动重新启动；父页面看不到 iframe 内部的 401，所以不会自动判断。
- **桥接隔离**：标签页 iframe 不接收 bridge 握手配置，父页面也不认来自它的 bridge 消息。设备侧即使装了 `dsh-cockpit-bridge`，在这个 iframe 里也处于静默状态，不会和主工作台的 bridge 串号。
- **不变**：远端零改造；bridge 契约、iframe 快照字段、解析端点都不变；不新增服务端端点。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-port-forward`：新增「常驻条目可在工作台显示为标签页」，包括开关的约束、持久化与投影；`workbenchTab` 不进入 iframe 快照。
- `cockpit-workbench`：新增「同端口转发标签页承载设备上的其它 Web 服务」（启动、生命周期、遮罩、重试与重新加载）和「转发标签页不参与 bridge 握手」。
- `cockpit-device-shell`：新增「顶栏常驻呈现所有设备的转发标签页」；修改「设备管理面板呈现并管理每台设备的转发清单」，在创建分组中加入该开关，并在行内显示标记。

## Impact

- **shared**：`PinnedForwardRecord` 与 `AdditionalForwardRow` 加可选字段 `workbenchTab`；`ForwardPinErrorCode` 加 `workbench-tab-requires-same-port`（放在 `forward-options.ts`，不动 bridge 内联的 `forwards.ts` 运行时代码）。
- **cockpit-server**：`forward-table.ts`（条目字段与校验）、`connectivity.service.ts`（合并持久化）、`registry.ts`（容忍式校验）、`devices.controller.ts`（创建请求体）。
- **cockpit-web**：
  - `components/TopBar.tsx`：标签页项与快捷菜单；
  - `workbench/`：新组件承载标签页 iframe，复用 `Workbench.tsx` 的遮罩、sandbox 与 allow 约定；
  - `App`：记录当前视图是「设备 + 标签页」中的哪一个；
  - `panels/ForwardList.tsx`、`styles/app.css`。
- **测试**：server 的 forward-table / connectivity / registry / e2e；web 的 topbar、新标签页组件、forward-panel、styles。
- **不改动**：`packages/dsh-cockpit-bridge`（源码与 `lib/`）、PWA、认证中间件、解析端点。
