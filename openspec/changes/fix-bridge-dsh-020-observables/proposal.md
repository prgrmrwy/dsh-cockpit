## Why

Devbox DSH 0.2.0-rc.2 的完整候选因 bridge 0.5.1 订阅已删除的 `uiSession.pendingInteractions` 而 client boot 失败，同时旧 `SessionListState.current` 读取无法上报实际选择。0.6.0 发布物仍使用旧接口，且端口转发有额外 breaking change，不能机械升级。

## What Changes

- 保持 0.5.x bridge 的现有协议与端口转发服务，增加 DSH 0.2.0 Session selection/status 只读适配。
- 兼容旧 `current` / `pendingInteractions` 与新 `retainedBy.mainView` / Session status observable；明确新 status 只暴露每会话当前最高优先级待交互的语义。
- 未识别 pending 来源时不宣称可观测、不伪造空快照，不阻止原生工作台启动。
- 覆盖双版本、选择变化、待交互出现/消失、缺失来源及 effect 清理回归。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-workbench`: 桥接只读观测兼容 DSH 0.2.0 官方 selection/status；保留旧协议、最小数据与故障隔离。

## Impact

仅 `packages/dsh-cockpit-bridge` 的 client 源码、测试、类型说明及对应规范。不修改 server/web、端口转发协议、凭据路径或操作 API。不自动 push/publish；仅 devbox 隔离构建与候选验证，不触及本机/VM/生产 3080。发布基线 tag 0.5.1 commit `d14a4755675483fbe0920a04f9c523cc4a4d574b`。
