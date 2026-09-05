# dsh-cockpit-bridge

官方 DSH web 客户端插件：把"用户点击了哪个会话"从浏览器本地状态无损桥接给
本机 dsh-cockpit，使驾驶舱顶栏的完成提醒（绿点）按官方 select 语义精确清除，
并在快速连续切换会话、打开后立即归档、网络瞬断等场景下也不丢失确认。

## 为什么存在

官方侧栏打开会话（`ctx.sessions.open` → `SessionManager.select`）是纯浏览器端
内存状态，事件流上没有任何"选中"信号；驾驶舱又按架构原则不读 iframe DOM。
**这个插件运行在官方 web 客户端**（同源），订阅 `sessions.list` 的 `current`
变化，在用户点击会话时把该会话 ID 上报给驾驶舱。驾驶舱切回一个已加载的设备
iframe 时，插件会重新确认当前选中的会话，使该会话若刚好处于完成未读状态，
其绿点按官方 select 语义清除。

- 驾驶舱按请求 `Origin` 匹配设备，**插件不需要知道自己是哪台设备**——它也不
  再假设驾驶舱固定跑在某个端口，实际 Origin 由父页面握手动态提供。
- DSH 0.1.2 下同时订阅官方 `ctx.uiSession.pendingInteractions`，变化时只发送
  当前完整的 `sessionId/kind/key` 集合；不注册 approval/question listener，不做决定，
  不读不传交互内容、会话内容、settings、credentials 或 provider token。
- 驾驶舱不可达时保留待确认队列并按退避重试，绝不影响 DSH 页面；outbox 有
  固定容量与 TTL，避免驾驶舱长期离线时无界增长。

## 协议版本 2（可靠确认）

当前版本实现 selection 协议 v2 与 pending snapshot 协议 v3（插件版本 0.3.0）：

1. **父页面握手**：驾驶舱父页面在 iframe `load`、设备被激活、或能力需要刷新
   时，通过精确 `targetOrigin` 向 iframe `postMessage`：
   `{ type: 'dsh-cockpit:bridge-config', cockpitOrigin, capability }`。插件
   只接受 `event.source === window.parent` 且 `event.origin` 与声明的
   `cockpitOrigin` 完全一致的消息，并把该 origin 固定为本页生命周期内的驾驶舱
   目标——不会再退回任何硬编码端口。
2. **hello**：收到握手后，插件 `POST <cockpitOrigin>/api/bridge/hello`，body
   为 `{ version, protocolVersion: 2, current }`，请求头带
   `X-DSH-Cockpit-Bridge-Capability: <capability>`。
3. **会话选择**：订阅回调**立即捕获**变化时的 `current` 值（不是等 250ms
   定时器触发时才重新读取，避免归档在这期间清空 `current` 导致确认丢失），
   写入按 ID 去重的有界 outbox；250ms 只合并网络请求，不合并/丢弃 ID。逐个
   `POST <cockpitOrigin>/api/bridge/session-opened`，body 为
   `{ protocolVersion: 2, sessionId?, current }`；`current` 为空时上报
   `{ current: null }`（省略 `sessionId`）。**只有服务端明确 2xx 成功后才从
   outbox 移除该项**；网络异常、401、其它非 2xx 均保留并按有上限的指数退避
   单飞重试。
4. **capability 失效自愈**：capability 是短期凭据（服务端 TTL 60s）；父页面
   会在到期前自动换发并重发握手，使长时间停留在同一设备也能持续确认。作为
   隐藏 iframe（定时器被浏览器节流）的兜底，插件在收到 **401** 或
   `bridge-capability-invalid`（400）时重置 hello 状态，并向父页面
   `postMessage { type: 'dsh-cockpit:capability-expired' }` 请求换发；换发前
   待确认项继续保留在 outbox 中。
5. **恢复触发**：新的会话选择、设备被重新激活（`dsh-cockpit:device-activated`
   或新的 `bridge-config`）、一次成功的 hello、以及 capability 换发成功，
   都会重新尝试发送 outbox 中尚未确认的项。
6. **outbox 上限**：固定容量与 TTL，容量压力下优先保留当前选择与最近的
   selection，淘汰最旧的非当前项。

旧版本（协议 1）插件仍可继续工作：驾驶舱按尽力而为方式接受其上报，顶栏会
标注为「已连接但非可靠协议」，并保留 Device Tab 上的人工清除兜底。

## 安装

每台要接入驾驶舱的设备，在其 `dsh.yaml`（ohmydsh manifest）的 bundles 里加入：

```yaml
- "dsh-cockpit-bridge"
```

依赖（file: 指向本仓库的包路径）需要出现在 profile 的 dependencies 中，然后
`dsh build`（ohmydsh 会物化到 `~/.dsh/profiles/web`）并重启该设备的 DSH web。

**已经安装旧版本插件的设备**：升级到本版本同样需要重新 `dsh build` 并重启该
设备的 DSH web 才能获得协议 v2 的可靠确认；重启前旧版本仍按尽力而为方式工作，
不影响原生 DSH 工作台。

## 配置

无需手动配置端口或凭据：驾驶舱的实际 Origin（对应其 `COCKPIT_PORT`）与认证
能力均由父页面在运行时通过安全握手动态提供给插件，插件不再需要与驾驶舱端口
保持源码内的硬编码一致，也从不读取持久 HttpOnly token。
