## MODIFIED Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合

系统 SHALL在用户选中设备时通过iframe加载该设备原生DSH Web，让用户直接使用远端workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT接管设备操作API、改写事件或代替其处理交互。

对typert设备，Cockpit SHALL把服务端连接认证与当前浏览器认证视为独立生命周期。iframe首次创建、auth generation变化或用户明确重试时，Web客户端 SHALL通过受 `cockpit_token`保护的启动请求取得当前tokenized root URL；服务端 SHALL在当前endpoint严格验证已保存launch token，或在失效且设备已显式授权ohmydsh自动恢复时取得并验证当前token。验证 MUST要求官方303、干净Location、可解析到期时间，以及cookie名称精确等于当前endpoint authority的确定性名称；仅有 `dsh-auth-`前缀不足以通过。

`workbench-launch` MUST在任何token读取/discovery前要求浏览器 `Origin`精确等于服务端观察到的 `http://127.0.0.1:<当前Host端口>`，并拒绝缺失/重复/非法Origin或Host。该接口同时位于 `cockpit-api-auth`全局Host/来源守卫之后：Host非法、携带与 `http://`+Host不相等的Origin、或 `Sec-Fetch-Site`不是 `same-origin`/`none`的请求 SHALL先由全局守卫以403 `cross-origin-rejected`拒绝而不进入本接口；通过全局守卫但不满足本接口更严格条件的请求（缺失Origin、重复Host、`localhost`形式的Host等）SHALL由本接口以403 `workbench-origin-forbidden`拒绝。两种拒绝都 MUST发生在任何token读取/discovery之前且不泄露认证材料，Web SHALL对两个错误码显示同一固定“来源不被允许”文案。以 `localhost`访问Cockpit时可通过全局守卫但不能启动工作台，这是有意保留的更严格边界。`Forwarded`/`X-Forwarded-*`一律忽略：它们不得改变expected origin；若原始Origin与Host本来精确匹配，请求可继续，否则仍403。该gate SHALL缓解其它loopback网页的浏览器CSRF/CORS读取，但 MUST NOT声明能阻止任意本机进程；任意本机进程仍属于既有loopback信任边界。成功响应 SHALL为 `Cache-Control: no-store`且不得通过referrer泄露token。Cockpit不得接受客户端指定token/authority/endpoint；DSH cookie不得经过Cockpit响应；token不得进入SSE、日志、界面、持久前端状态或缓存。启动JSON与父页面临时引用 SHALL有界存在；已赋给iframe的DOM `src`属性 SHALL按下述不中断导航契约处理。

父页面在跨源iframe导航后无法权威观察HTTP状态、最终cookie或认证成功。系统 SHALL只把“URL签发前验证成功”作为可判定事实；iframe load不得被解释为认证成功。tokenized URL不得写入业务React/registry状态，只可为已接受的启动结果向iframe赋值一次。系统 MUST NOT在等待启动结果时因状态更新抢先加载裸endpoint；已有页面 SHALL保留至合法启动结果到来。load或deadline发生后，系统 SHALL清除父页面临时token引用，但 MUST NOT为擦除DOM `src`而导航干净endpoint、删除/改写 `src`或重建iframe。DOM `src`可以继续保留启动URL直到iframe销毁或合法新导航，系统 MUST明确记录该残留边界，不宣称DOM已清理或认证成功。目标DSH自己的官方303继续清理其实际文档URL；这不等于父页面可以确认认证结果或DOM属性已清理。失败的启动API SHALL不导航裸401 iframe，显示稳定脱敏恢复遮罩；同一tuple只自动一次，用户可明确重试。rc.2继续加载原endpoint，不执行typert token逻辑。

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
- **THEN** Cockpit忽略forwarded头并按原始Origin/Host在读取认证材料前拒绝，无token、cookie或可逆派生值泄露：携带与 `http://`+Host不相等Origin（含空Origin）的请求由全局守卫返回403 `cross-origin-rejected`；缺失Origin、重复Host、`localhost`形式Host等通过全局守卫的请求由本接口返回403 `workbench-origin-forbidden`；无可用Host的请求可在路由前以400拒绝

#### Scenario: 来源被拒时Web显示固定文案
- **GIVEN** 工作台启动请求被以 `cross-origin-rejected`或 `workbench-origin-forbidden`拒绝
- **WHEN** Web渲染启动失败遮罩
- **THEN** 两者都显示“请求来源不被允许。”，不显示服务端message，也不创建tokenized iframe

#### Scenario: 精确Origin不受forwarded头影响
- **GIVEN** 原始Origin与Host精确匹配当前Cockpit origin，但请求附带任意Forwarded/X-Forwarded-*值
- **WHEN** 请求调用工作台启动接口
- **THEN** Cockpit忽略forwarded头并继续正常鉴权，而不是用这些头改写expected origin或仅因其存在而拒绝

#### Scenario: 启动响应最小暴露认证材料
- **GIVEN** 当前token已严格验证
- **WHEN** Cockpit生成启动响应并由Web客户端处理
- **THEN** JSON只含tokenized URL和非敏感generation，响应为no-store，iframe使用no-referrer；token不进入SSE、日志、界面、前端持久状态或缓存；父页面临时引用在load或deadline时清除，DOM属性残留不被误报为已擦除

#### Scenario: 旧连接代的启动结果不得覆盖新连接代
- **GIVEN** 启动期间endpoint、auth generation或连接代变化
- **WHEN** 旧验证/discovery/响应晚到
- **THEN** 服务端不提交旧结果，Web不导航旧URL；新tuple可独立尝试

#### Scenario: 同一认证代失败不循环
- **GIVEN** 一个tuple的启动API已失败或导航后结果不可观测
- **WHEN** React重渲染、iframe load或重复SSE发生且tuple未变
- **THEN** Cockpit不隐式重复请求/刷新；API失败保持遮罩，导航未知则保留iframe且不宣称成功，只有tuple变化或用户明确重试才再请求

#### Scenario: 启动等待期不抢先加载裸endpoint
- **GIVEN** 启动请求尚未返回，首次创建的iframe尚未加载设备页面，或已有页面正在等待新tuple启动
- **WHEN** 首包快照、重复SSE、StrictMode或状态重渲染发生
- **THEN** Cockpit不导航裸endpoint；首次页面等待启动结果，已有页面保持挂载；接受启动结果后只为该结果导航一次

#### Scenario: load后清理token DOM属性

此历史场景名保留以兼容delta合并；本change将其原“DOM属性擦除”承诺改为下述“父引用清理且不重载”，不再承诺DOM属性清除。

- **GIVEN** iframe已获得tokenized URL并触发无法判定成败的load
- **WHEN** 父页面收到该load及后续重复load或状态更新
- **THEN** 父页面清除临时token引用，不改写/删除iframe `src`、不重建iframe、不导航干净endpoint；接受DOM属性残留，不把load解释为认证成功

#### Scenario: deadline优先不中断在途导航
- **GIVEN** iframe已获得tokenized URL但在deadline前没有load
- **WHEN** deadline到期以及后续load、状态更新或设备切换发生
- **THEN** 父页面清除临时引用但不改写在途或已加载iframe `src`，明确接受DOM属性残留至销毁或合法新导航，不宣称认证成功或DOM已清理且不自动重试

#### Scenario: 远端零改造
- **GIVEN** 设备仅运行标准受支持 `dsh web`
- **WHEN** 用户启动工作台
- **THEN** 无需bridge或其它远端组件

#### Scenario: rc.2 工作台
- **GIVEN** 用户选中 `READY` rc.2设备且Origin gate通过
- **WHEN** Cockpit创建/恢复iframe
- **THEN** iframe直接加载endpoint一次，不执行typert token验证/discovery，load不追加导航

#### Scenario: typert 工作台首次认证
- **GIVEN** 当前token通过严格验证且浏览器无authority cookie
- **WHEN** 用户首次选择设备
- **THEN** iframe获得一次tokenized导航，父页面随后有界清理临时引用但不主动重载；URL签发前失败不呈现由启动API导致的裸401，签发后结果仍不可观测

#### Scenario: typert 工作台缺少认证材料
- **GIVEN** 无可严格验证token且未成功自动恢复
- **WHEN** 用户启动工作台
- **THEN** 显示可操作恢复遮罩，不返回旧token、不创建裸401 iframe

#### Scenario: DSH cookie 静默重新签发
- **GIVEN** 连接层恢复出新token/cookie并增加公开generation
- **WHEN** 已挂载iframe观察到新generation，或启动响应先返回该新generation而后SSE同步
- **THEN** 对已接受的新tuple最多签发并导航一次tokenized URL；load或deadline只清父页面临时引用不再导航，后续同步和设备切换不重复启动，且不把load解释为成功确认

#### Scenario: 重认证失败
- **GIVEN** URL签发前token验证/discovery失败，或连接代变化；或者URL签发后交换结果不可观测
- **WHEN** Cockpit处理对应阶段
- **THEN** 可观测的前置失败显示脱敏恢复遮罩且不导航；签发后的未知结果只做有界父引用清理、不自动循环、不声称成功或失败

## ADDED Requirements

### Requirement: 会话选择恢复维持原生边界

用户主动刷新后，会话选择的持久化与恢复 SHALL仍由设备原生DSH负责。Cockpit MUST NOT为掩盖恢复缺陷读取跨源iframe DOM、保存并强制重放会话选择、代理远端会话操作或向设备安装补丁。验证报告 SHALL把“没有多余导航”与“主动刷新后恢复原会话”分别记录；未证明的原生缺陷 MUST NOT被报告为已确认原因，未通过的会话恢复 MUST NOT被报告为已修复。

#### Scenario: 无多余导航后仍未恢复会话
- **GIVEN** 用户此前选中已有会话，Cockpit仅执行合法单次启动导航
- **WHEN** 主动刷新后仍进入新会话
- **THEN** 验证报告独立记录该失败，区分已确认原生问题与原因未明，不修改原生DSH或部署patch，不以保活成功宣称会话恢复通过
