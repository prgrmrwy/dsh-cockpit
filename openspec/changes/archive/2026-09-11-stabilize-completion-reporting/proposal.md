## Why

Device Tab 的「完成未读」上报在 2026-09-03 的可靠协议 v2 上线后仍不稳定：会话明明已打开、或任务明明已完成，绿点却经常残留或缺失。经只读审计（含对上游 `@deepseek-ai/dsh@0.1.1-rc.2` 发布代码的逐条核验）确认，根因不止一个：bridge capability 60 秒过期后无续签且无法自愈；服务端「先拉 `session.list` 基线、再打开事件流」存在确定的丢事件窗口；断线/重连后归档集合与增量事件无法从基线恢复；refresh 基线可能倒置新的事件状态；`host/session-removed` 被错误建模为永久删除。现有单测全绿是因为每个缺口都被拆散在各包测试边界之外。

## What Changes

- **Bridge capability 续签与自愈**：Cockpit Web 依据服务端返回的 `expiresAt` 在到期前自动换发 capability 并重发握手；bridge 收到 capability 失效类响应（400/401）时通过 postMessage 请求父页面换发，不再无限重试旧凭据直到 outbox 过期丢弃确认。
- **消除基线→事件流盲窗**：连接与手动刷新统一改为「先订阅事件并缓冲 → 拉基线 → 按序回放缓冲 → 恢复直通」，使 `session.list` 返回与流开启之间存在的事件不再丢失；refresh 期间到达的增量事件拥有与官方客户端 `listMutations` 等价的合并语义。
- **归档重连基线**：新增只读 `workspace.list` RPC，连接与刷新时以 `archivedSessionIds` 重建归档集合，纠正断线期间归档/恢复造成的幽灵提醒与错误抑制，并防止在途归档事件被陈旧基线回滚。
- **`host/session-removed` 语义修正（非破坏性）**：将其视为「live 会话 detach」而非永久删除：清除该会话的提醒与计数展示（与官方 UI 一致），但保留其运行轮次身份与子代理知识；会话重新出现时不制造新的完成边缘，也不丢已读协调状态。
- **可观测性**：服务端记录 bridge 请求被拒原因（capability 失效/错设备/未知 origin）与事件盲窗相关基线时序，便于日后定位「绿点失灵」无需靠猜测。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `cockpit-device-shell`: 完成提醒的生成/确认/收敛规则不变，但「状态聚合读取官方只读接口与事件流」新增重连归档基线、基线/事件乱序合并与 `session-removed`（live detach）语义；「完成提醒按运行轮次可靠收敛」补充 removed 后恢复与基线竞态场景。
- `cockpit-workbench`: 桥接确认协议新增 capability 到期自动续签与失效自愈，作为现有「失败重试与恢复机会」要求的补充；未装/旧版桥接时人工清除兜底不变。

## Impact

- **服务端**：`rc2-client`（新增 `workspace.list`）、`device-lifecycle`（基线缓冲/回放、归档基线、removed 软语义、子代理知识保留）、`connectivity.service`（bridge 拒绝日志）、相关单元测试与真实 HTTP 集成测试。
- **Web**：`Workbench`（capability 到期定时续签、失效重试、与既有 activation 刷新合并）、相关组件测试。
- **Bridge 插件**：capability 失效时请求父页面换发并继续 outbox 重试；协议版本号递增（v2 兼容扩展，不加新版本）；已发布 `lib/` 产物重新构建。
- **规范与文档**：更新 `cockpit-device-shell`、`cockpit-workbench` 规范与 README；明确「断线期间完成的会话无法回读」为协议限制并保留人工清除兜底。
- **Ops（非代码）**：`host`、`devbox` 两台设备仍运行 bridge 0.1.2（旧协议，无重试/多选无损），应升级至新构建并重启对应 DSH Web，否则行为不一致；本 change 不强制、不代装插件。
- **不改变**：零轮询原则、操作面零协议耦合、不持久化提醒到磁盘、不代理远端写 API、人工清除兜底、非默认 `COCKPIT_PORT` 支持。