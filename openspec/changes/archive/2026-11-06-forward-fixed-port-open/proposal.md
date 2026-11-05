## Why

设备上只监听回环的 Web 面板，有一类带**同源围栏**：只接受 `Host` 为 `127.0.0.1:<自身端口>` 的请求（例如部署侧某个只监听 `127.0.0.1:3082` 的管理面板）。驾驶舱已有常驻转发，但附加条目的本地端口由内核随机分配，浏览器经 `127.0.0.1:<随机端口>` 访问时，`Host` 与设备端口不一致，于是被围栏拒绝。用户只能在操作机上手动 `ssh -L 3082:127.0.0.1:3082`，再自己拼地址打开；如果地址带 token，设备侧服务每次重启后还要重新去日志里翻找。

这是通用能力缺口，不针对任何具体服务：把「设备端口在本机浏览器打开」做成驾驶舱设备面板里的一键操作，并沿用现有的常驻转发托管（自愈、退出清理、随 SSH 别名迁移）。

## What Changes

- **常驻条目可选「本地端口同设备端口」**（P0）：在设备面板创建常驻条目时可以勾选此项，此后该条目每次建立都严格绑定 `127.0.0.1:<设备端口>`。
  - 端口被占用时**不改用别的端口**：条目进入 `retrying`，带固定诊断「本地端口被占用」，沿用既有退避，端口释放后自行恢复。
  - 同一本地端口在驾驶舱内只能有一个持有方：另一台设备再申请同端口的同端口条目，以新错误码 `local-port-conflict` 拒绝。
  - 投影标出该属性，注册记录持久化一个布尔标记（仍不持久化任何本地端口号）。
- **「在浏览器打开」**（P0）：附加条目为 `ready` 时，面板在该行显示「打开」动作，在新窗口打开 `http://127.0.0.1:<localPort><打开路径>`。打开路径在创建常驻条目时可选填，持久化在该常驻标记上，默认 `/`。
- **「用设备命令产出打开地址」**（P1，可后置）：常驻条目可选配一条**在设备上执行的命令**。配置了命令时，「打开」会经 SSH 在设备上执行它，从 stdout 中取**最后一个** origin 精确等于 `http://127.0.0.1:<设备端口>` 的 URL，换成本地端口后打开。
  - 执行有超时、有输出上限；空输出、非零退出、超时、无匹配各返回明确的错误码。
  - 输出与结果 URL（可能带 token）只在内存中流转，不写日志、不进注册表、不进投影或快照。
  - 该项要在注册表里存一条任意远端命令，安全取舍见 design D6，**需用户拍板**。
- **不变**：bridge 的 `cockpitBridge.forwards` / `editorOpen` 契约与随持有者条目的内核分配端口行为不变；iframe 快照不新增字段；不新增组件体系，复用 ForwardList 的行、创建分组与既有按钮样式。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-port-forward`：
  - 「附加条目按期望状态自愈，且只在就绪时交付地址」：本地端口由内核分配这条规则改为默认行为，并增加「同端口」例外。
  - 「附加条目只有常驻与随持有者两种寿命」：常驻标记可以携带同端口标记、打开路径与地址命令。
  - 「转发表的投影、标签与诊断受数据卫生约束」：新增打开路径、命令的校验规则，以及「命令输出不出服务端」。
  - 「转发表管理端点仅供驾驶舱自身页面使用」：新增「解析打开地址」端点和对应错误码。
- `cockpit-device-connectivity`：「设备本地转发端口在生命周期内保持稳定」中，「附加通道端口由内核分配」这一句加上同端口例外，主通道规则不变。
- `cockpit-device-shell`：「设备管理面板呈现并管理每台设备的转发清单」新增两处：创建分组里的「本地端口同设备端口」「打开路径」「打开地址命令」三个可选输入，以及就绪行的「打开」动作和对应失败说明。

## Impact

- **shared**：`forwards.ts` 改动如下：
  - `PinnedForwardRecord` 与 `AdditionalForwardRow` 增加可选字段 `sameLocalPort`、`openPath`、`urlCommand`；
  - 新增错误码 `local-port-conflict`，以及打开地址的错误码类型；
  - `toForwardsSnapshot` 的白名单不变，新字段不进 iframe。
- **cockpit-server**：
  - `tunnel-manager.ts` / `ssh.ts`：严格端口模式，绑定失败不回落；
  - `forward-table.ts`：条目携带同端口属性，属性变化时重建子进程；
  - `connectivity.service.ts`：跨设备冲突检查、持久化；
  - `storage/registry.ts`：容忍式校验新增字段；
  - `devices.controller.ts`：创建端点接收新字段，新增 `POST /api/devices/:deviceId/forwards/:devicePort/open-url`；
  - 新文件 `connectivity/forward-url-command.ts`：有界执行设备命令并解析地址，结构参照 `dsh-auth-discovery.ts`。
- **cockpit-web**：`panels/ForwardList.tsx`（创建分组的可选项、就绪行的「打开」）、`api/client.ts`、`styles/app.css`（复用既有令牌）。
- **测试**：server 的 `forward-table` / `ssh-tunnel` / `connectivity.service` / `registry` / 新命令解析测试；web 的 `forward-panel` 测试。
- **不改动**：`packages/dsh-cockpit-bridge`（源码与 `lib/` 均不动）、PWA、认证中间件的 bridge 回调路由名单。新端点走既有的 cookie 加同源校验。
