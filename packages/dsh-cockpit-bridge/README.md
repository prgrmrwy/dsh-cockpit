# dsh-cockpit-bridge

官方 DSH web 客户端插件：把"用户点击了哪个会话"从浏览器本地状态桥接给本机
dsh-cockpit，使驾驶舱顶栏的完成提醒（绿点）按官方 select 语义精确清除。

## 为什么存在

官方侧栏打开会话（`ctx.sessions.open` → `SessionManager.select`）是纯浏览器端
内存状态，事件流上没有任何"选中"信号；驾驶舱又按架构原则不读 iframe DOM。
**这个插件运行在官方 web 客户端**（同源），订阅 `sessions.list` 的 `current`
变化，在用户点击会话时把 `{ sessionId }` POST 给驾驶舱。驾驶舱切回一个已加载的
设备 iframe 时，`0.1.2` 还会重新确认该 iframe 当前选中的会话，使该会话若刚好
处于完成未读状态，其绿点按官方 select 语义清除。

- 驾驶舱按请求 `Origin`（`127.0.0.1:<设备端口>`）匹配设备，**插件不需要知道自己是哪台设备**
- 只传 `sessionId`——不读不传会话内容、settings、credentials
- 驾驶舱不可达时静默失败，绝不影响 DSH 页面

## 安装

每台要接入驾驶舱的设备，在其 `dsh.yaml`（ohmydsh manifest）的 bundles 里加入：

```yaml
- "dsh-cockpit-bridge"
```

依赖（file: 指向本仓库的包路径）需要出现在 profile 的 dependencies 中，然后
`dsh build`（ohmydsh 会物化到 `~/.dsh/profiles/web`）并重启该设备的 DSH web。

## 配置

无需配置：驾驶舱固定监听 `127.0.0.1:3090`（若未来端口可配，改
`src/client/index.ts` 的 `COCKPIT_BASE` 与驾驶舱保持一致即可）。
