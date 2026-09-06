## Why

DSH 0.1.2 的 launch token 每个进程都会重生成，但 Cockpit 当前在每次连接代都重新用持久化的旧 token 换 cookie，导致设备执行 `dsh restart` 后永久卡在认证失败；同时设备编辑页不暴露“是否已经配置过启动 URL”，用户无法判断保存是否成功。设备签名 cookie 本可跨普通 DSH 重启继续有效，而 ohmydsh 后台启动又会把新的官方启动 URL写入 DSH 日志，因此需要把认证材料的生命周期补齐为可诊断、可自动恢复的设备能力。

## What Changes

- 设备公开事实增加最小认证状态，只表示启动 URL 是否已配置、当前认证是否可用/需恢复以及最近更新时间或 cookie 到期时间，绝不回显 token、cookie 或其可逆派生值；设备管理页据此明确显示“已配置 / 未配置 / 需更新”。
- 补齐现有 `clearDshLaunchToken` 的前端清除入口；编辑表单继续保持 token 写后不回显和“留空即不修改”的语义。
- 将 DSH server-side signed cookie 作为受保护的设备认证材料持久化在 Cockpit 自有 0600 原子设备注册表中；重连优先验证/使用当前 authority 对应的 cookie，401 时再进入恢复链，而不是无条件重放可能已失效的 launch token。
- 对用户明确允许自动发现的 SSH 远端设备，在标准 DSH 认证挑战且现有 cookie/token 均失败时，通过既有 BatchMode SSH 身份执行一个严格、只读、有界的 ohmydsh 日志读取命令，从最新有效的官方 loopback 启动 URL 中提取 token；token 只用于当前登记端口的官方交换，成功后原子替换旧 token/cookie并继续原连接生命周期。
- 对本机设备采用同一受限读取器读取本机 ohmydsh 的标准 DSH 日志；非 ohmydsh、日志缺失、格式不符、端口不匹配或 SSH 失败时不猜测其它路径，不扩大搜索面，保持现有“粘贴当前启动 URL”的人工恢复路径。
- DSH cookie 到期或被撤销后，server 端在下一次 401/重连时静默重新签发；iframe 端在连接代认证恢复后重新加载一次 tokenized root 来让 DSH 自己设置新的 HttpOnly cookie并回到干净 URL。不会尝试读取 iframe cookie。
- 自动发现默认关闭并按设备显式启用，避免仅因升级就扩大远端读取权限；诊断中可说明自动恢复成功或为何回退人工更新，但不得包含日志内容、token、cookie或命令输出。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `cockpit-device-connectivity`：把 typert 认证从仅人工写入、连接代内 cookie 扩展为认证状态可见、受保护 cookie 复用、按设备显式授权的 ohmydsh token 自动发现与失效自愈。
- `cockpit-device-shell`：设备管理页显示非敏感的启动 URL 配置/恢复状态，并提供显式清除与自动恢复开关。
- `cockpit-workbench`：设备认证恢复后，既有 iframe 能以一次性 tokenized root 静默重新签发 DSH 浏览器 cookie，随后继续保持干净 URL 与 keep-alive 语义。

## Impact

- `packages/shared`：设备记录、设备事实和新增/更新 API 增加认证状态及按设备自动恢复配置；敏感字段仍仅存在持久模型。
- `packages/cockpit-server`：registry schema/迁移、DSH auth material、协议连接代、401 分类、SSH 只读命令与脱敏诊断、workbench launch generation。
- `packages/cockpit-web`：设备表单的已配置状态/清除/自动恢复控件，以及 Workbench 在认证代变化时的一次性重认证。
- 安全边界变化：Cockpit 在用户逐设备授权后可读取本机或 SSH 远端的标准 `$DSH_HOME/dsh.log` 中最新启动 URL；仍不读取 `.credentials.yaml`、provider credential、会话内容或任意日志文件，不安装远端组件，不执行写命令。
- 需要与 ohmydsh 当前后台启动契约联合验收：`dsh restart` 后官方 tokenized URL 必须出现在标准日志中；若上游输出格式变化，系统安全降级到人工粘贴而非宽泛扫描。
