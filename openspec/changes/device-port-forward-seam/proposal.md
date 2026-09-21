## Why

设备上的插件常常自带一个只监听回环的本地 HTTP 服务（第一个真实用例：某设备上的 memex 卡片浏览 UI）。今天驾驶舱为每台设备只建立**一条** SSH 回环转发，且该转发写死指向远端 DSH 端口，因此这类服务在远端设备上**从宿主机浏览器完全不可达**：用户在 iframe 里看到的 `http://localhost:<port>` 会在**宿主机**解析，要么连不上，要么连到宿主机上另一个无关服务——这是静默的错误结果，而不是一次明确的失败。

驾驶舱已经拥有这件事所需的全部设施（OpenSSH 子进程托管、端口分配与持久化、绑定竞态归因、断线重连、终结性清理），也已经拥有把能力交给设备侧插件的稳定接缝（`cockpitBridge.editorOpen`）。缺的只是：允许**一台设备持有多条转发**，并把「一条已打通的转发」作为可消费资源交付给设备侧插件。

## What Changes

- **隧道管理支持一设备多通道**：`TunnelManager` 的活动表由「每设备一条」改为「每设备多条、按用途区分」。工作台主通道语义不变，附加通道与之并列且互不影响。
- **新增附加转发的生命周期**：附加通道可被显式创建与释放；设备禁用/删除/重连/驾驶舱退出时随设备一并清理，遵守既有的终结性清理与「不按端口/命令行相似性猜测归属」约束。
- **新增 bridge 接缝 `cockpitBridge.portForward`**：设备侧插件请求「把本设备上的端口 P 发布到宿主机」，得到一个**绑定该端口**的句柄（含可直接访问的 URL）。句柄一次交付，消费方随后直接使用，不再回头查询。
- **`DeviceRecord.localPort`（单数）扩展**为可承载多条转发的记录；旧记录 SHALL 按迁移规则读入，主通道端口语义与既有「稳定 origin」保证不变。
- **明确安全边界**：这是 bridge 上**第一个真正触发驾驶舱服务端动作**的接缝（`editorOpen` 是纯客户端 URI 生成）。转发目标 SHALL 限定为设备上**已登记可发布**的端口，MUST NOT 成为「任意端口通用隧道」。
- **不做**：不代理任何应用层协议、不解析或重写被转发流量、不接管身份。驾驶舱只建立 TCP 转发，不进入数据路径——因此「操作面零协议耦合」原则保持不变，本变更不修订该原则。

## Capabilities

### New Capabilities
- `cockpit-device-port-forward`: 附加端口转发的登记、建立、交付与回收；bridge 侧 `cockpitBridge.portForward` 接缝契约；可发布端口的准入约束与降级行为。

### Modified Capabilities
- `cockpit-device-connectivity`: 「使用自有 SSH 隧道只监听中央回环并保持有界」与「设备本地转发端口在生命周期内保持稳定」两条要求，从「每设备一条转发 / 一个 `localPort`」放宽为「主通道 + 若干附加通道」，并明确附加通道不享有主通道的稳定端口保证；禁用/删除/清理路径覆盖全部通道。

## Impact

- `packages/cockpit-server/src/connectivity/tunnel-manager.ts`：活动表键、`connect`/`disposeNode`/`disposeAll`。
- `packages/cockpit-server/src/connectivity/device-lifecycle.ts`、`connectivity.service.ts`：附加通道的建立时机与随设备清理。
- `packages/cockpit-server/src/storage/registry.ts`、`packages/shared/src/index.ts`：`DeviceRecord` 端口记录形状与向后兼容读取。
- `packages/dsh-cockpit-bridge/src/client/index.ts`：新增 `portForward` 接缝（与 `editorOpen` 同一 seam 模式）；bridge 版本号与 ohmydsh 侧 pin。
- 新增 HTTP 端点用于「设备侧登记可发布端口 → 驾驶舱据此放行并建立转发」，沿用既有 capability 校验与 Origin 匹配。
- **不修改** `cockpit-workbench`：附加通道的暴露面约束完整落在新 capability 内；该 spec 的「远端边界与安全」正被进行中的 `remote-editor-open-seam` 修改，避免两个 change 改同一条要求。
- 消费方（ohmydsh 的 dsh-memex）：本变更不修改该仓；其依赖以中立服务名表达，缺席时回落本机行为。
