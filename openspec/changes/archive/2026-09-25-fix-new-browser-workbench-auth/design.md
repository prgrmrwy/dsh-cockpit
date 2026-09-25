## Context

当前typert认证有两个消费者：服务端连接优先复用持久signed cookie；浏览器iframe必须在自己的cookie jar中完成官方token→cookie交换。DSH重启可保留服务端cookie有效，却更换launch token；于是设备仍 `READY`，新浏览器却收到陈旧token。

实测当前受支持运行时：同一当前token连续三次均返回严格303与cookie；cookie值每次不同、属性稳定。故token可重复用于“服务端验证一次 + 浏览器再交换”，但这属于已验证版本兼容前提，不能泛化到所有未来typert。

既有discovery固定读取标准日志、有界尾部、严格端口URL、BatchMode固定SSH命令、超时/取消和脱敏；其现有spec只授权“服务端cookie/token均失败”场景。本change需要显式扩展逐设备授权到浏览器bootstrap，但不扩大读取来源/命令。

安全边界：Cockpit只监听回环，`/api/bootstrap`允许本机客户端取得cookie；精确Origin检查只能阻止其它loopback网页通过浏览器读取敏感响应，不能阻止能自行发HTTP的本机进程。任意本机进程属于现有loopback信任边界，这一残余风险明确接受。跨端口cookie relay被拒绝，因为同host服务都会收到cookie。

跨源iframe的HTTP状态、最终URL和cookie对父页面不可见，`load`对401也会触发；可选bridge不能作为核心oracle。因此本change只保证URL签发前可验证，不声称能确认导航后成功。

## Goals / Non-Goals

**Goals:**

- 当前token先严格验证；陈旧时按扩展后的逐设备授权discovery当前token。
- authority精确验证、operation-owned单飞、限频、generation/连接代fence与稳定脱敏错误。
- 精确Origin gate缓解browser-origin CSRF/CORS读取，并诚实记录本机进程残余风险。
- iframe token URL有界存在；API失败可操作，导航后结果明确为不可观测且不循环。
- 双capability规范一致，远端零改造，rc.2兼容。

**Non-Goals:**

- 不防任意本机进程、不把loopback模型升级为多用户安全边界。
- 不代理DSH、不relay cookie、不读取iframe cookie、不修改DSH协议/安装远端组件。
- 不增加LAN监听、HTTPS、通用代理或Windows启动器。
- 不以可选bridge确认核心认证结果。

## Decisions

### D1：严格验证当前token，只有新token才持久化

新增 `validateDshLaunchToken(endpoint, token)`（可由现有exchange原语强化/抽取）：

- 要求HTTP 303与 `Location: /`；
- 解析 `Set-Cookie`并要求单一合法 `name=value`、绝对到期时间；
- cookie名称 MUST精确等于 `sha256(authority)`派生的确定性名称（复用 `inspectDshCookie`或公开窄helper），通用前缀不够；
- 任意响应体/cookie不进入错误或日志。

已保存token验证成功时，丢弃本次随机cookie，不写registry、不增generation；返回原generation的tokenized URL。验证失败且autoDiscovery已授权时，发现不同的当前token并严格验证；仅此分支把新token和验证cookie用 `commitRecoveredAuth(expectedGeneration)` CAS提交并增代。失败/竞态不返回token。

替代方案：直接返回旧token无法识别重启；cookie relay扩大同host暴露；强制服务端重连破坏两通道独立；修改DSH需跨仓协议。

### D2：浏览器bootstrap显式纳入逐设备discovery授权

`cockpit-device-connectivity`明确：用户打开 `ohmydsh-log` 自动恢复时，同时同意服务端连接恢复和新浏览器bootstrap读取同一个固定日志。UI现有开关语义/文案在实施时更新为这两个用途；默认仍关闭。

浏览器失败只返回稳定 `workbench-auth-required`，不改变设备 `READY`、不中断现有流。discovery失败记录枚举原因（debug/既有诊断），不含输出/token；不尝试其它文件/命令。

### D3：operation-owned验证/发现协调器

新增每设备+auth generation的内部coordinator，而非直接复用“首个调用者signal拥有promise”的现状：

- key：`deviceId + authGeneration + endpoint origin`；
- 共享operation持有自己的AbortController；HTTP请求断开或单个lifecycle调用取消只停止该调用者等待，不abort共享工作；
- 设备禁用/删除、endpoint/connection generation替换、Cockpit关闭可abort共享operation；
- token验证和discovery组成同一single-flight；成功/失败设置短TTL结果缓存和15秒有界attempt窗口，避免每次重试让DSH签发丢弃cookie；
- TTL内只复用“该token已在此endpoint/generation验证”的非secret判定和当前record引用，不缓存额外raw cookie；
- CAS最多一次，败者读取registry胜出值后按当前tuple判定。

具体TTL作为可注入常量（建议15秒，与现有discovery窗口一致），单测用fake clock覆盖；不周期轮询。

### D4：Origin gate是浏览器CSRF缓解，不是本机进程授权

Controller在service/token读取前验证：

- 单一Origin header存在、可解析且无列表/重复；
- `request.protocol === http`；单一Host严格为 `127.0.0.1:<1..65535>`；
- `new URL(origin).origin === http://<validated Host>`；
- 不读取/信任Forwarded或X-Forwarded-*（服务未启用trust proxy）；这些头被忽略，存在本身不拒绝请求：原始Origin/Host匹配则继续，不匹配则403。

失败为403 `workbench-origin-forbidden`。该gate覆盖typert与rc.2工作台POST。真实HTTP测试覆盖不同端口、localhost、缺失/重复/非法Host/Origin、绝对形式、forwarded头。

明确残余风险：本机进程可取得/伪造请求，本change不防；这与现有loopback-only工具模型一致。若未来监听LAN或要求抵御本机进程，必须另行引入不可由任意loopback客户端取得的认证机制。

### D5：验证失败分类、稳定错误合同与响应安全头

只有当前endpoint明确返回官方DSH authentication-required 401（或token exchange的官方“token拒绝”结果）才把已保存token判为陈旧，并在已授权时进入日志discovery。分类表：

| 观察结果 | 对外code | 是否discovery |
|---|---|---|
| 官方token拒绝/标准DSH 401，tuple仍当前 | `workbench-auth-required`（未授权/发现失败） | 仅已授权时是 |
| 网络错误、连接拒绝、超时、5xx | `workbench-unavailable` | 否 |
| 非303、错误Location、畸形/错误authority cookie、非标准401 | `workbench-unavailable`（内部记安全枚举） | 否 |
| endpoint/连接代/auth generation改变 | `workbench-launch-stale` | 否 |

这样临时故障/非DSH响应不会触发日志读取，也不会被误报为认证失效。每格都有服务级测试，并断言discovery调用次数。

Controller映射内部typed errors：

- 403 `workbench-origin-forbidden`；
- 409 `workbench-launch-stale`；
- 424 `workbench-auth-required`（需粘贴/启用恢复）；
- 503 `workbench-unavailable`。

所有正文为固定安全文案，不含cause/URL/token/cookie/SSH输出。成功和失败均 `Cache-Control: no-store`；成功另设 `Referrer-Policy: no-referrer`。JSON成功仍为 `{url, authGeneration}`。API client保留 `ApiError.code`（typed client error）供UI映射固定文案，不显示raw服务端cause。

### D6：服务端与前端双fence协调generation升级

开始时捕获lifecycle identity、connection generation、endpoint origin、record auth generation。异步后核对同一lifecycle仍存在、READY/DEGRADED、tuple未变；否则 `workbench-launch-stale`且不提交。

旧token验证成功返回请求generation。discovery CAS成功返回新generation。前端不能继续硬编码 `response.authGeneration === requestedGeneration`：

- 保存请求target的device/origin和开始generation；
- 响应origin必须仍等于当前endpoint；
- 响应generation不得小于请求generation，且必须等于当时最新公开generation；若SSE尚未到，可把该响应generation登记为latest并等待/接受同一响应，但后续较小SSE不得回退；
- endpoint/device改变则丢弃。

测试覆盖SSE先到、响应先到、endpoint切换和CAS败者。

### D7：导航后不可观测，token URL有界清理

FrameInfo增加非敏感launch phase/error，不保存解析后的token。API成功后把完整URL短暂赋给iframe，并设置 `referrerPolicy="no-referrer"`及可注入导航deadline（建议10秒）：

- `load`发生：允许并要求一次明确的 `src = clean endpoint` 导航来擦除父页面可控DOM属性；该干净导航的后续load不得再次导航。不得把任一次load标记为“认证成功”。
- deadline先到：优先不中断在途导航，只移除React/registry/token closure等父内存引用，不修改已挂载DOM `src`；明确接受DOM属性暂留直到后续load触发上述干净导航、frame销毁或设备切换。记录“结果不可观测”，不自动重试；用户可明确重试。
- API失败：不设置tokenized src，显示按稳定code映射的遮罩与重试。

浏览器DOM的实际已提交URL在跨源情形不可读。测试分开断言：load路径最终DOM `src`干净且只多一次clean导航；deadline路径内存引用清除、DOM允许暂留且导航不中断。日志/错误/console不得保留token。

### D8：兼容性边界

用户裁定：Cockpit当前只能机械区分 `rc2 | typert`，没有兑换前可读取的版本/capability，因此所有当前被识别为typert的受支持运行时统一适用已实测的“当前token可重复交换”契约。实现不增加虚假的allowlist/运行时判别，也不定义 `workbench-auth-incompatible`。

自动化兼容测试以忠实fake固定“服务端严格exchange后，同一token的浏览器exchange仍303”。若上游未来引入一次性token，必须先提供兑换前可读取的capability并另开change；否则该版本不属于当前Cockpit的受支持typert集合。

## Risks / Trade-offs

- **[本机进程可调用敏感接口]** → 明确接受现有loopback信任边界；Origin只防浏览器跨源读取，不做虚假授权声明。
- **[验证会签发随机cookie]** → operation single-flight+短TTL限频；cookie立即丢弃；仅新token提交。
- **[共享取消竞态]** → operation-owned controller，只有设备/进程生命周期终止共享工作。
- **[导航成功不可判定]** → 规范诚实标未知；仅前置API失败显示确定遮罩；无自动循环。
- **[token在iframe导航中短暂存在]** → no-store/no-referrer、父状态deadline清理、无日志/SSE/持久状态；目标DSH 303自行清URL。
- **[未来版本改为一次性token]** → 当前typert支持契约要求可重复；未来必须先增加兑换前capability并另开change，不做不可实现的运行时猜测。
- **[扩大日志读取用途]** → 同一逐设备显式授权、同一固定读取器；UI文案和connectivity spec显式说明。

## Migration Plan

1. Red tests：严格authority、重复exchange兼容、Origin/Host矩阵、错误码/headers、自动恢复授权扩展、single-flight取消/限频/CAS。
2. 实现服务端strict validator、coordinator、双fence、typed errors与安全headers。
3. Red tests并实现Web error overlay、generation乱序、明确重试、no-referrer和deadline父状态清理。
4. 跑相关测试及全仓typecheck/test/build/lint；strict OpenSpec validate。
5. 两个隔离Chromium profile经SSH/SOCKS验证host/lumevm/devbox；验证API失败路径、URL最终清理能观察的边界和无日志泄露。
6. 无数据迁移；回滚代码即可。构建后需重启Cockpit，实施结束单独询问。

## Open Questions

- 无阻塞问题。导航deadline/validation TTL的具体常量可在实现时基于测试调整，但必须可注入、有界，且不改变不可观测/不自动循环契约。
