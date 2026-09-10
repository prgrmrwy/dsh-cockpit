## Why

桥接拒绝的日志级别让服务端日志失去了信号价值。实测本机 `~/.dsh-cockpit/cockpit.log`：**1636 行中 885 行是 WARN（54%）**，其中

```
709  invalid or expired bridge capability
 91  no cockpit device matches origin http://127.0.0.1:3080
 82  no cockpit device matches origin http://127.0.0.1:62595
  3  no cockpit device matches origin http://127.0.0.1:55712
```

而这些拒绝中的绝大多数是**设计内的自愈路径，不是故障**：

- capability 拒绝（`invalid or expired bridge capability`）：bridge 收到 401/400 后向父页面换发新 capability 并在换发成功后重投 outbox 条目（`client/index.ts:199-215`、`Workbench.tsx:181-204`）。设计上隐藏 iframe 就靠这条兜底，`Workbench.tsx:36-38` 的注释明确说明「the bridge reports an invalid/expired capability as backstop for hidden iframes where timers are throttled」。
- origin 不匹配（`no cockpit device matches origin`）：实测这些集中在两次隧道端口漂移留下的残留页面（`127.0.0.1:62595` 仅 9/05 21:51–22:28 共 82 次）与驾驶舱重启窗口的 origin→deviceId 映射尚未建立期（`127.0.0.1:3080` 集中在 9/05–9/06 的 4 次重启附近）。两者都已自愈。

后果有三个，都在实际排查中发生过：

1. **信号淹没**：本次排查「DSH 断线重连」时，必须先滤掉全部 WARN 才能确认连接层零故障；而 WARN 本应是「需要人看」的级别。
2. **级别语义被破坏**：`devices.controller.ts:216-218` 的注释写明这些日志的目的是让「绿点不清」（green dot stopped clearing）可从服务端日志诊断。但当 54% 的日志都是设计内自愈时，真正该报警的事件——**自愈失败**——反而无法被一眼识别。
3. **磁盘与可读性**：按当前速率约 110 条/天、无日志轮转；单机无害，但掩盖真实故障的成本随设备数增长。

根因不是「日志太多」，而是**级别与聚合策略未区分「自愈成功」与「自愈失败」**。诊断价值应来自后者。

## What Changes

- 桥接拒绝的分类日志 SHALL 区分「可自愈的常规拒绝」与「需要人介入的自愈失败」，并把级别与后者对齐：
  - 常规拒绝（capability 过期/失效、错设备、origin 不匹配）SHALL 降为调试级（`debug`），保留充足结构字段（deviceId、origin、协议版本、归因）以便按需开启排查。
  - 仅在**自愈失败**时才提升为告警级：同一设备在同一时间窗内的常规拒绝次数超过阈值，且期间**没有**任何一次成功桥接上报。该条件正是「桥接不再自愈、绿点可能停止清除」的可观测表征。
- 同一设备同一归因的连续常规拒绝 SHALL 聚合计数，避免逐条刷屏；聚合输出 SHALL 包含窗口内条数与归因。
- 系统 SHALL 使调试级桥接日志可被有意开启（当前 `main.ts:11` 的 Nest logger 只启用 `['error','warn','log']`，`debug` 默认不可见），使降级后的诊断能力不丢失。
- 告警级输出的字段 SHALL 保持既有非敏感边界：仅 deviceId、origin、协议版本与归因分类，MUST NOT 包含 token、capability 明文、会话正文或 provider 凭据。
- 既有「桥接端口与认证配置一致且失败可见」要求中「若运行配置无法支持桥接，系统 MUST 明确显示桥接未就绪或配置不兼容」的**用户可见**行为不变：本 change 只改服务端日志的级别与聚合，MUST NOT 改变任何拒绝的 HTTP 状态码、响应体、`bridge-capability-invalid` 错误码，也 MUST NOT 改变桥接的自愈重试行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-workbench`：「桥接端口与认证配置一致且失败可见」补充**服务端桥接拒绝日志的分级与聚合**要求——常规可自愈拒绝降为调试级、自愈失败才提告警级、同设备同归因聚合计数、并保证调试级可被有意开启。该要求现有的用户可见失败呈现（配置不兼容提示、桥接未就绪状态、人工清除兜底）保持不变。

## Impact

- `packages/cockpit-server/src/devices/devices.controller.ts`：`authorizeBridge` 的拒绝日志从「逐条 WARN」改为按归因分类 + 分级 + 聚合。
- `packages/cockpit-server/src/connectivity/connectivity.service.ts`：新增按设备记录桥接拒绝计数与最近一次成功上报时间的最小状态，供分级判定使用；`#recordBridgeSuccess` 已有成功路径可复用作计数器归零信号。
- `packages/cockpit-server/src/main.ts`：Nest logger 级别纳入 `debug`，使降级后的桥接日志可按需开启；默认输出面不因此变噪声（降级条目默认不再出现在 warn 通道）。
- 测试：`devices.controller.test.ts` / `connectivity.service.test.ts` 覆盖分类、降级、聚合计数与自愈失败提升；断言既有 400 + `bridge-capability-invalid` 响应体不变。
- 不改动前端、不改动 bridge 插件、不改动共享类型、不改动远端行为、不新增依赖、不改动任何鉴权边界（拒绝仍然发生，仅记录方式变化）。
