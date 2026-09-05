## MODIFIED Requirements

### Requirement: typert 使用官方启动 URL完成最小认证握手
对要求浏览器会话认证的 typert 设备，系统 SHALL 接受用户粘贴该设备 `dsh web` 打印的官方启动 URL，从中校验并提取唯一 launch token，在当前设备 loopback endpoint 上执行 DSH 官方 `GET /?token=...` → signed cookie 交换。系统 SHALL 将交换所得 cookie 与 token 一同作为受保护的设备认证材料保存于 Cockpit 自有、权限收紧且原子写入的设备存储，并在连接时优先复用适用于当前 endpoint authority 且尚未到期的 cookie；只有 cookie 缺失、到期或被服务端拒绝时才重新交换 token。

系统 SHALL 在公开设备事实中只暴露认证材料是否已配置、认证是否可用或需恢复、自动恢复是否启用，以及可安全公开的更新时间/到期时间；token、cookie及其可逆派生值 MUST NOT 出现在设备查询 API、日志、诊断、错误正文或 iframe 完成交换后的干净 URL 中。

系统 SHALL 支持用户按设备显式启用 ohmydsh 自动认证恢复。启用后，仅当 endpoint 呈现标准 DSH authentication-required 响应且既有 cookie/token 不能恢复时，系统才可对本机读取标准 `$DSH_HOME/dsh.log`，或使用该设备既有 BatchMode SSH 身份执行严格固定、只读、有界的读取命令，从最新匹配登记端口的官方 loopback 启动 URL提取 token。系统 MUST NOT 读取 `.credentials.yaml`、provider credential、会话内容或任意其它日志，不得宽泛扫描文件系统，不得执行远端写操作。自动发现失败时 SHALL 安全降级到“粘贴当前 dsh web 启动 URL”的人工恢复路径，且不得影响其它设备。

#### Scenario: 首次连接 typert 设备
- **WHEN** 设备呈现标准 DSH authentication-required 响应，且用户提供有效的官方启动 URL
- **THEN** server 在当前 endpoint 上换取并受保护地保存 cookie，以该 cookie 完成协议确认、HTTP RPC 与 WebSocket upgrade，并进入正常连接生命周期

#### Scenario: 普通 DSH 重启后复用已有 cookie
- **WHEN** DSH 进程重启并生成新 launch token，但已有 cookie 的签名密钥、authority 与有效期仍然有效
- **THEN** 系统优先用已有 cookie 恢复 HTTP RPC 与 WebSocket，不要求旧 launch token 再次交换，也不要求用户操作

#### Scenario: cookie 到期但已保存 token 仍有效
- **WHEN** 已保存 cookie 到期或被拒绝，而已保存 launch token 仍被当前 DSH 进程接受
- **THEN** 系统静默执行官方 token→cookie 交换，原子替换 cookie 并继续连接

#### Scenario: DSH 重启使旧 token 失效且自动恢复已授权
- **WHEN** cookie 不可用、旧 token 已失效、设备呈现标准认证挑战，且用户已为该设备启用 ohmydsh 自动恢复
- **THEN** 系统通过受限读取器取得最新匹配端口的官方启动 URL，完成交换并原子替换旧认证材料，无需用户粘贴

#### Scenario: 未提供或已失效的启动 URL
- **WHEN** typert 设备需要认证，但没有有效 launch token，或现有 cookie和 token均已失效且未成功自动恢复
- **THEN** 设备保持不可用并给出“粘贴当前 dsh web 启动 URL”的可执行诊断；其它设备不受影响

#### Scenario: 自动发现来源不可用
- **WHEN** 设备不是受支持的 ohmydsh 部署、标准日志不存在、没有匹配登记端口的有效 URL、SSH 失败或输出格式不合法
- **THEN** 系统不尝试其它凭据路径或宽泛扫描，设备保持不可用并给出人工粘贴当前启动 URL的可执行诊断

#### Scenario: 自动恢复未授权
- **WHEN** 设备需要新 launch token，但用户未为该设备启用自动恢复
- **THEN** 系统不得读取本机或远端 DSH 日志，并继续要求用户粘贴当前官方启动 URL

#### Scenario: endpoint authority 改变
- **WHEN** SSH 重连无法复用原 local port
- **THEN** 系统不得跨 authority 使用旧 cookie，并以仍有效的 token或已授权自动发现的新 token在新 authority 上重新执行官方交换

#### Scenario: 更新或删除认证材料
- **WHEN** 用户提供新的启动 URL、显式清除认证材料或删除设备
- **THEN** 系统以新材料替换旧值，或清除对应持久及内存认证状态；任何读取接口均不回显旧值或新值

#### Scenario: 查询设备认证状态
- **WHEN** 用户查看设备列表或编辑设备
- **THEN** 系统可返回非敏感的已配置、可用性、自动恢复与时间状态，但不得返回 token、cookie或可用于伪造认证的值
