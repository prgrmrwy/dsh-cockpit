## Why

驾驶舱已经知道自己管理了哪几台机器、各自是否可达、上面有哪些会话，但这些事实只服务于宿主机上的人。不同机器上的 DSH 会话要协作时（ohmydsh 的 dsh-collab 跨机协作），既不知道彼此存在，也没有通道互相投递：SSH 隧道只有宿主机→设备方向（`-L`），设备上的会话无法回连驾驶舱。驾驶舱是唯一同时连着所有设备的一方，适合承担"发现 + 投递"这一层，并且可以不理解协作语义。

## What Changes

- 新增可选的设备侧 **DSH Host 插件** `dsh-cockpit-relay`（独立包，和 `dsh-cockpit-bridge` 一样以包路径安装、`lib/` 入库）。它在设备 DSH 的同源 Host 路由上暴露 `handshake`、`outbox`（SSE）、`ack`、`deliver`、`directory` 五个端点（只接受持有该设备 DSH 认证的非浏览器调用），在内存中排队本机未确认的出站信封，并在设备 Host 内提供稳定的进程内服务 `cockpitRelay`（`state` / `directory` / `subscribe` / `send` / `receive`），供同机任意插件使用，不命名具体消费方。
- 驾驶舱新增 **中继**：设备 `READY`/`DEGRADED` 后，驾驶舱以服务端身份、复用访问该设备 DSH 时已持有的认证，经现有隧道（本机设备直连）对插件握手（协议版本 + 租约）、订阅 outbox、按目标设备投递、按 msgId 确认；按出站设备给信封盖章 `origin`；只在能确定目标处理器未被调用时（发给自己、未知目标、未接入、无消费方、繁忙）代为生成 `undeliverable` 回执。中继是尽力而为的：两侧都不持久化信封，可靠性由消费方的超时与幂等负责。信封 body 对驾驶舱不透明，上限 1 MiB。
- 驾驶舱新增 **设备会话目录**：从已有的 `session.list` / `workspace.list` 基线与事件流，整理出"每台已接入设备上未归档的根会话"，连同设备可达性组成带单调 `revision` 的快照，变化时推送给所有已接入设备（合并窗口 ≤500ms，不轮询）。
- 修改两条现有边界的表述，使其覆盖本能力，而核心承诺不变：
  - 状态聚合只调用官方只读接口 → 增加唯一例外：已安装中继插件的设备，驾驶舱调用该插件的五个端点。
  - "bridge 是唯一跨边界通信切面" → 明确它约束的是**设备页面**与驾驶舱之间；由设备侧插件发起的跨设备消息只经中继插件；驾驶舱对设备官方接口的探测、认证与状态聚合流量以及既有 bridge 流量不受影响。
- 不安装中继插件的设备，行为与今天完全相同；工作台、状态聚合、bridge 能力都不依赖它。

## Capabilities

### New Capabilities
- `cockpit-session-relay`: 驾驶舱侧的设备会话目录与不透明信封中继——接入判定、握手、outbox 订阅与确认、origin 盖章、按目标投递、undeliverable 回执、目录快照推送、有界性与故障隔离。
- `cockpit-relay-device-plugin`: 设备侧 Host 插件——五个同源端点及其调用者边界、租约与协议版本、内存出站队列与过期、入站单飞去重、进程内服务 `cockpitRelay` 的契约。

### Modified Capabilities
- `cockpit-device-shell`: 「状态聚合读取官方只读接口与事件流」增加中继插件端点这一受限例外，并重申不轮询。
- `cockpit-workbench`: 「bridge 是唯一跨边界通信切面」把作用范围限定为设备页面，设备 Host 侧的通信由 `cockpit-session-relay` 约束。

## Impact

- 新包 `packages/dsh-cockpit-relay`（Host 插件，tsdown 构建，`lib/` 入库，`cordis.patch.yml` 加入 bundle）。
- `packages/cockpit-server`：新增 `relay` 模块；`DeviceLifecycle` 增加受控的插件请求方法（复用现有协议端点与认证，不暴露凭据），并保留根会话行（sessionId、updatedAt、origin、parentSessionId）与 workspace 反查数据供目录使用。
- `packages/shared`：目录快照与信封类型。
- 不新增驾驶舱入站 HTTP 路由，`cockpit-api-auth` 名单不变；SSH 用法仍只有 `-L`。
- 跨仓契约：ohmydsh change `collab-cross-machine-spi` 中的 collab-cockpit shim 消费 `cockpitRelay`；契约在协作空间 `cross-machine-collab` 的 charter `relay-contract`（v2）中双方确认。
- 文档：README「远端要求」「设计原则」「安全与边界」说明可选中继插件；`docs/assets` 架构图补中继通道。
