## MODIFIED Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合

系统 SHALL在用户选中设备时通过iframe加载该设备原生DSH Web，让用户直接使用远端workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT接管设备操作API、改写事件或代替其处理交互。

对typert设备，Cockpit SHALL把服务端连接认证与当前浏览器认证视为独立生命周期。iframe首次创建、auth generation变化或用户明确重试时，Web客户端 SHALL通过受 `cockpit_token`保护的启动请求取得当前tokenized root URL；服务端 SHALL在当前endpoint严格验证已保存launch token，或在失效且设备已显式授权ohmydsh自动恢复时取得并验证当前token。验证 MUST要求官方303、干净Location、可解析到期时间，以及cookie名称精确等于当前endpoint authority的确定性名称；仅有 `dsh-auth-`前缀不足以通过。

`workbench-launch` MUST在任何token读取/discovery前要求浏览器 `Origin`精确等于服务端观察到的 `http://127.0.0.1:<当前Host端口>`，并拒绝缺失/重复/非法Origin或Host。`Forwarded`/`X-Forwarded-*`一律忽略：它们不得改变expected origin；若原始Origin与Host本来精确匹配，请求可继续，否则仍403。该gate SHALL缓解其它loopback网页的浏览器CSRF/CORS读取，但 MUST NOT声明能阻止任意本机进程；任意本机进程仍属于既有loopback信任边界。成功响应 SHALL为 `Cache-Control: no-store`且不得通过referrer泄露token。Cockpit不得接受客户端指定token/authority/endpoint；DSH cookie不得经过Cockpit响应；token只能短暂存在于启动JSON和iframe导航URL，不得进入SSE、日志、界面、持久前端状态或缓存。

父页面在跨源iframe导航后无法权威观察HTTP状态、最终cookie或认证成功。系统 SHALL只把“URL签发前验证成功”作为可判定事实；iframe load不得被解释为认证成功。tokenized URL不得写入长期React/registry状态，只可一次性赋给iframe。load发生后，系统 SHALL执行一次明确的干净endpoint导航以擦除可控DOM `src`中的token；这次导航是允许且有界的。若deadline先于load，系统 SHALL优先不中断在途导航，仅清除父页面内存引用，接受DOM `src`可能暂留token直到后续load、frame销毁或设备切换；不得宣称deadline已清理DOM，也不得基于未知结果自动刷新。失败的启动API SHALL不创建裸401 iframe，显示稳定脱敏恢复遮罩；同一tuple只自动一次，用户可明确重试。rc.2继续加载原endpoint，不执行typert token逻辑。

#### Scenario: 选中设备即见其完整工作台
- **GIVEN** 一台 `READY`设备具有当前可启动的原生DSH Web
- **WHEN** 用户在Cockpit顶栏选中设备
- **THEN** 内容区显示其原生工作台，设置、插件和usage可用

#### Scenario: 新浏览器使用当前可重复交换的token首次进入
- **GIVEN** 服务端cookie保持typert设备 `READY`，新浏览器无设备cookie，且已保存token仍被当前受支持DSH进程接受
- **WHEN** 浏览器从Cockpit首次选中设备
- **THEN** 服务端严格验证token后返回当前endpoint的tokenized URL，iframe发起官方交换；父页面只记录“URL已签发”且不把load当作成功证明

#### Scenario: 陈旧token通过已授权自动恢复更新
- **GIVEN** 服务端cookie仍有效、token因DSH重启失效，且设备已显式授权ohmydsh自动恢复
- **WHEN** 新浏览器请求启动工作台
- **THEN** Cockpit用既有受限discovery取得并严格验证当前token，以generation fence提交新材料，并返回当前tokenized URL

#### Scenario: 自动恢复未授权或失败
- **GIVEN** token失效且自动恢复未授权，或受限discovery未取得可严格验证的当前token
- **WHEN** 浏览器请求启动工作台
- **THEN** Cockpit返回稳定 `workbench-auth-required`错误，不返回旧token/URL；Web显示人工粘贴或启用恢复的遮罩且不创建裸401 iframe

#### Scenario: 非精确Cockpit Origin被拒绝
- **GIVEN** 请求可能带有效cookie，但Origin/Host缺失、重复、非法或来自另一loopback端口/host
- **WHEN** 请求调用工作台启动接口（typert或rc.2），即使附带Forwarded/X-Forwarded-*试图改变expected origin
- **THEN** Cockpit忽略forwarded头并按原始Origin/Host在读取认证材料前返回403 `workbench-origin-forbidden`，无token、cookie或可逆派生值泄露

#### Scenario: 精确Origin不受forwarded头影响
- **GIVEN** 原始Origin与Host精确匹配当前Cockpit origin，但请求附带任意Forwarded/X-Forwarded-*值
- **WHEN** 请求调用工作台启动接口
- **THEN** Cockpit忽略forwarded头并继续正常鉴权，而不是用这些头改写expected origin或仅因其存在而拒绝

#### Scenario: 启动响应最小暴露认证材料
- **GIVEN** 当前token已严格验证
- **WHEN** Cockpit生成启动响应并由Web客户端处理
- **THEN** JSON只含tokenized URL和非敏感generation，响应为no-store，iframe使用no-referrer；token不进入SSE、日志、界面、前端持久状态或缓存

#### Scenario: 旧连接代的启动结果不得覆盖新连接代
- **GIVEN** 启动期间endpoint、auth generation或连接代变化
- **WHEN** 旧验证/discovery/响应晚到
- **THEN** 服务端不提交旧结果，Web不导航旧URL；新tuple可独立尝试

#### Scenario: 同一认证代失败不循环
- **GIVEN** 一个tuple的启动API已失败或导航后结果不可观测
- **WHEN** React重渲染、iframe load或重复SSE发生且tuple未变
- **THEN** Cockpit不隐式重复请求/刷新；API失败保持遮罩，导航未知则保留iframe且不宣称成功，只有tuple变化或用户明确重试才再请求

#### Scenario: load后清理token DOM属性
- **GIVEN** iframe已获得tokenized URL并触发无法判定成败的load
- **WHEN** 父页面收到该load
- **THEN** 父页面执行至多一次干净endpoint导航来擦除其可控DOM `src`中的token，不把load解释为认证成功且不再发tokenized URL

#### Scenario: deadline优先不中断在途导航
- **GIVEN** iframe已获得tokenized URL但在deadline前没有load
- **WHEN** deadline到期
- **THEN** 父页面清除内存引用但不改写在途iframe `src`，明确接受DOM属性暂留至后续load/销毁，不宣称认证成功或DOM已清理且不自动重试

#### Scenario: 远端零改造
- **GIVEN** 设备仅运行标准受支持 `dsh web`
- **WHEN** 用户启动工作台
- **THEN** 无需bridge或其它远端组件

#### Scenario: rc.2 工作台
- **GIVEN** 用户选中 `READY` rc.2设备且Origin gate通过
- **WHEN** Cockpit创建/恢复iframe
- **THEN** iframe直接加载endpoint，不执行typert token验证/discovery

#### Scenario: typert 工作台首次认证
- **GIVEN** 当前token通过严格验证且浏览器无authority cookie
- **WHEN** 用户首次选择设备
- **THEN** iframe获得一次tokenized导航，父页面随后有界清理token URL且不呈现由启动API导致的裸401

#### Scenario: typert 工作台缺少认证材料
- **GIVEN** 无可严格验证token且未成功自动恢复
- **WHEN** 用户启动工作台
- **THEN** 显示可操作恢复遮罩，不返回旧token、不创建裸401 iframe

#### Scenario: DSH cookie 静默重新签发
- **GIVEN** 连接层恢复出新token/cookie并增加公开generation
- **WHEN** 已挂载iframe观察到新generation
- **THEN** 对新tuple最多签发一次tokenized URL；load后至多一次干净导航擦除DOM token，deadline先到则只清父内存引用并保留在途DOM `src`，且不把load解释为成功确认

#### Scenario: 重认证失败
- **GIVEN** URL签发前token验证/discovery失败，或连接代变化；或者URL签发后交换结果不可观测
- **WHEN** Cockpit处理对应阶段
- **THEN** 可观测的前置失败显示脱敏恢复遮罩且不导航；签发后的未知结果只做有界token清理、不自动循环、不声称成功或失败
