## MODIFIED Requirements

### Requirement: typert 使用官方启动 URL完成最小认证握手

对要求浏览器会话认证的typert设备，系统 SHALL接受用户粘贴官方启动URL，严格提取launch token，并在当前loopback endpoint执行官方token→signed cookie交换。交换验证 MUST要求303、干净Location、可解析到期时间，以及cookie名称精确等于当前endpoint authority的确定性名称；仅匹配通用前缀不足以建立authority。系统 SHALL把交换所得cookie/token保存于Cockpit自有0600原子存储，服务端连接优先复用尚未到期且被DSH接受的当前authority cookie。

系统 SHALL在公开事实中只暴露非敏感认证状态；token、cookie及可逆派生值 MUST NOT进入设备查询、SSE、日志、诊断或错误正文。

用户可按设备显式启用ohmydsh自动认证恢复。该授权 SHALL覆盖两个目的：(a) 服务端cookie/token都不能恢复连接；(b) 服务端cookie仍使设备READY，但浏览器工作台需要验证当前launch token而已存token因进程重启失效。两者只能读取固定标准 `$DSH_HOME/dsh.log`（本机）或通过既有BatchMode SSH执行固定、只读、有界命令（远端），从最新匹配登记端口的官方URL提取token；不得读取其它凭据/日志、扫描文件系统或写远端。未授权、来源失败或严格交换失败 SHALL回退人工粘贴且不影响服务端现有健康连接或其它设备。

浏览器启动验证与连接恢复 SHALL按 `(deviceId, endpoint authority, auth generation)`共享operation-owned单飞与有界服务端限频。共享工作不由任一HTTP请求或单一lifecycle调用者独占取消；设备禁用/删除或Cockpit关闭可取消，普通调用者离开只停止等待。结果提交必须经过auth generation与连接代fence；旧结果不得覆盖用户更新或新连接代。有效旧token的验证cookie每次可能不同，验证成功时 SHALL丢弃该临时cookie、不写盘、不增代；只有发现并接受新token时才CAS提交新token/cookie并增加generation。

Cockpit当前协议探测只能区分 `rc2 | typert`，没有兑换前可读取的版本/capability信号；因此所有当前被Cockpit识别为typert的受支持运行时 SHALL遵守已实测的“同一当前token可重复交换”兼容契约。本change不执行不可实现的运行时判别，也不定义 `workbench-auth-incompatible`分支。若未来typert改变此契约，必须先新增可在兑换前读取的capability并另开change；否则该运行时不属于本规范的受支持集合。

#### Scenario: 首次连接 typert 设备
- **GIVEN** endpoint呈现标准DSH认证挑战且用户提供有效官方启动URL
- **WHEN** Cockpit严格交换验证
- **THEN** 保存cookie/token并完成协议确认、HTTP RPC和WebSocket连接

#### Scenario: 普通 DSH 重启后复用已有 cookie
- **GIVEN** DSH重启产生新token但既有cookie仍适用于authority且被接受
- **WHEN** 服务端恢复连接
- **THEN** 优先复用cookie，不为服务端连接读取日志或要求用户操作

#### Scenario: cookie 到期但已保存 token 仍有效
- **GIVEN** cookie无效而已保存token仍被接受
- **WHEN** 服务端恢复连接
- **THEN** 严格交换并原子替换cookie，继续连接

#### Scenario: DSH 重启使旧 token 失效且自动恢复已授权
- **GIVEN** 服务端连接需要认证、cookie不可用、token失效且设备已授权恢复
- **WHEN** endpoint呈现标准挑战
- **THEN** 受限discovery取得当前token，严格交换并CAS替换材料

#### Scenario: 服务端cookie有效但新浏览器需要当前token
- **GIVEN** 设备READY、服务端cookie有效、已保存token因进程重启失效，且设备已授权自动恢复
- **WHEN** 浏览器工作台启动需要当前token
- **THEN** 同一受限discovery权限可用于取得并严格验证当前token；成功CAS提交新材料但不中断服务端现有连接，失败仅影响该浏览器启动

#### Scenario: 未提供或已失效的启动 URL
- **GIVEN** 无有效token且未成功恢复
- **WHEN** 服务端连接或浏览器启动需要认证
- **THEN** 返回对应稳定脱敏诊断/错误并要求人工粘贴，其它设备不受影响

#### Scenario: 自动发现来源不可用
- **GIVEN** 标准日志不存在、无匹配URL、SSH失败或输出非法
- **WHEN** 已授权恢复执行
- **THEN** 不尝试其它路径或宽泛扫描，记录不含输出/secret的失败原因并回退人工更新

#### Scenario: 自动恢复未授权
- **GIVEN** 服务端或浏览器工作台需要新token但设备未授权恢复
- **WHEN** 启动或重连执行
- **THEN** 不读取本机/远端日志，返回人工粘贴路径

#### Scenario: endpoint authority 改变
- **GIVEN** 重连无法复用local port
- **WHEN** 新authority建立
- **THEN** 不跨authority使用旧cookie，以有效token或已授权discovery新token严格交换

#### Scenario: 更新或删除认证材料
- **GIVEN** 用户提供新URL、清除材料或删除设备
- **WHEN** 操作提交
- **THEN** 新材料替换/清除旧持久及内存状态；在途旧验证/discovery不能CAS覆盖

#### Scenario: 查询设备认证状态
- **GIVEN** 用户查看设备
- **WHEN** API返回事实
- **THEN** 仅含非敏感配置/可用性/恢复/时间状态，无token/cookie

#### Scenario: 并发浏览器启动共享有界验证
- **GIVEN** 多个浏览器/标签同时请求同设备、同endpoint authority、同generation启动
- **WHEN** token验证或discovery进行
- **THEN** 服务端共享单飞并施加有界限频；调用者取消不终止其他等待者，设备停止可取消共享工作，最多一次新材料CAS提交

#### Scenario: 当前typert兼容契约
- **GIVEN** endpoint被Cockpit当前协议探测识别为受支持typert，且当前token有效
- **WHEN** 服务端先严格验证token、浏览器随后使用同一token交换
- **THEN** 两次交换均按受支持typert契约成功；实现不尝试从一次消费结果反推token语义
