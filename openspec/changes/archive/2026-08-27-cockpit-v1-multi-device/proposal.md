# Cockpit V1：多设备 DeepSeek Harness 驾驶舱

## Why

拥有多台 DSH 机器（This Mac、VM、未来 devbox）时，切换隧道和页面管理彼此隔离的订阅、workspace 与 session 很费时，且用户希望**知道远端状态（几个在跑、有无等待人决策）而不必逐台点开**。前期语义联合 Host 方案（把多机合成一棵 Node→Workspace→Session 树）经实测后归档为「已探索但不采用」——它需要两个钉死上游 commit 的 compatibility patch，且规范禁止代理远端设置/订阅，换不到 settings/usage/插件继承（见 ohmydsh 仓库 `docs/adr/ADR-0003-adopt-cockpit-over-semantic-federation.md`）。驾驶舱采用**外壳（shell）方案**：选中设备后直接使用该设备**原生** DSH 工作台，驾驶舱只做设备管理与只读状态聚合。

## What Changes

- 新增独立本地服务 `dsh-cockpit`（NestJS 后端 + Vite/React/TS 前端 + shadcn/Base UI），监听 `127.0.0.1:3090`（被占则递增），与本机 DSH 完全解耦：**本机 DSH 不可用时驾驶舱仍可用**。
- **操作面零协议耦合**：驾驶舱不接管任何 workspace/session API。选中设备后在其 iframe 内承载该设备原生 DSH Web（经回环隧道 `127.0.0.1:<localPort>`），因此远端 settings、usage、已装插件与未来新增能力天然继承。
- **统筹面只读**：驾驶舱常驻消费各设备**官方**事件流（`/api/events.mux`、`/api/events.host`）与只读 RPC（`host.describe`、`session.list`），聚合「几个在跑 / 有无等待人决策」。不代理凭据、不写远端、不引入远端插件。
- **设备管理**：add/edit/disable/remove 设备，SSH 隧道的建立、健康探测、断线重连、中断清理都由驾驶舱托管；凭据仅复用用户 `~/.ssh/config` 的免密（公钥/Agent），**不保存密码、私钥、passphrase**。
- **设备数据**：注册表存驾驶舱自有目录（`~/.dsh-cockpit/`），与本机 DSH 的 `~/.dsh` 完全隔离。
- **认证**：驾驶舱本地服务仅回环监听，且要求 token（防其它本地进程/恶意网页访问机器信息）。
- **状态更新模型**：设备 READY 后开 mux+host 两条 ws 并查一次快照 → ws 增量更新；ws 重连自动重查快照；用户可手动刷新；**无周期轮询**。
- **工作台承载**：iframe 懒加载、建了不销毁；设备离线时保留 iframe + 遮罩（显示连接层才知道的具体原因与重连按钮）。
- **UI 结构**：唯一常驻 UI 是一条顶栏（设备项：官方语义状态点 + 数字角标；左键切换、右键菜单）+ menu 按钮；所有页面级内容以全屏面板叠加（设计风格对齐 DSH 自身 settings）。其余空间全部给当前设备的 DSH。
- **启动行为**：进入上次使用的设备；首次使用（无历史）显示设备总览面板以引导添加设备。

### V1 明确不做
- 全局搜索（架构留位，统筹层能力，V1 不实现）
- usage 聚合（各设备自身 DSH 内可见；技术原因：usage 是远端插件路由而非官方 API，且与「远端零改造」原则冲突）
- 跨设备操作（迁移会话、跨设备拖拽）
- 系统托盘通知（浏览器壳无原生通知；若后续需要再评估桌面壳）
- 远端设置代理（永久不做，属架构原则）

## Capabilities

### New Capabilities
- `cockpit-device-connectivity`: 设备注册表、SSH 隧道托管（仅 BatchMode、回环绑定、bind 冲突有界重试、进程跟踪）、健康探测与状态分级（SSH_UNREACHABLE / TUNNEL_ERROR / DSH_UNAVAILABLE / NON_DSH_SERVICE / INCOMPATIBLE / CONNECTING / READY / DEGRADED）、per-device 抖动重连、可捕获信号终结性清理。
- `cockpit-device-shell`: 独立壳 UI（顶栏 + 全屏面板 + 设备项交互），设备状态聚合（只读官方事件流）、离线遮罩、启动行为。
- `cockpit-workbench`: 远端 DSH 工作台 in-iframe 承载（懒加载、建了不销毁），设备离线时的状态表达。

### Modified Capabilities
（无——本 change 为全新独立项目，无现有 spec 被修改。）

## Impact

- 新增：`packages/cockpit-server`（NestJS 后端：连接层、状态聚合、HTTP/WS 服务）、`packages/cockpit-web`（Vite/React 前端与壳 UI）。
- 依赖：Node ≥22、pnpm workspace、NestJS、React、shadcn/Base UI、`ws`；远端要求**标准 `dsh web`**（零改造、零插件），仅需目标机器运行且本机到其 SSH 免密。
- 安全：驾驶舱本地服务仅回环 + token；远端零改造不引入远端插件；凭据永不落盘。
- 兼容：不与任何现有 DSH 插件/route 冲突（驾驶舱是独立壳，不改本机 sidebar）。

## 决策记录
- 支持架构取舍的实测证据（远端双流可开、单消费者不抢占、iframe 可嵌等）见 `ohmydsh` 仓库 ADR-0003 附录。
- 本 change 的设计取舍与未验证项（官方 icon 复用细节、5 台 iframe 真实内存、ws 长时间稳定性）在 `design.md` 中记录为进度项。
