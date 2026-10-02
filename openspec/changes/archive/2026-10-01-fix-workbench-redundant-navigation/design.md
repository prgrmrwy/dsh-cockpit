## Context

动机与范围见 proposal.md。当前 `Workbench.tsx` 有两条与启动请求去重独立的导航路径：状态同步在空URL或新origin时直接写endpoint（350–359行），load从token URL生成干净URL并通过声明式src重新渲染（470–484、520–533行）。`8c34425`仅补齐恢复响应新generation的attempt记录，未阻断这些路径。

现行 `cockpit-workbench` 明确要求load后一次干净导航，因此本change必须修改规范，不能作为“恢复原spec行为”的小修绕过。README要求操作面零协议耦合、远端零改造、bridge可选及两通道独立。用户明确拒绝原生DSH修改与patch。

生产追踪已确认一次launch请求产生多次子文档；原生pending-list持久化竞态仅为本机安装代码推导，尚未证明为所有设备的根因。

## Goals / Non-Goals

**Goals:**
- 一个已接受启动结果对应一次父页面发起的设备导航；DSH官方303是该导航链的服务端跳转，不计作Cockpit额外导航。
- 区分设备endpoint/tuple身份、frame挂载生命周期、导航指令和可观察launch阶段，不让“清引用”变成导航指令。
- 以真实DOM赋值与提交文档数量验证导航，不只统计API调用次数。
- 分开报告导航修复与主动刷新会话恢复。

**Non-Goals:**
- 不保障未验证的原生会话恢复能力，不接管会话选择或新增bridge恢复指令。
- 不编辑原生源码、安装包、launcher-build、node_modules、ohmydsh manifest或远端运行体。
- 不更改服务端token验证、discovery、cookie存储与来源守卫。

## Decisions

### D1：导航由已接受启动结果独占

在生产注入 `requestWorkbenchLaunch` 时，状态同步只更新非敏感事实和目标身份，不填入可导航裸endpoint。首次frame可为空白占位，但不得设置空字符串src（它可能指向父页），且不能把about:blank的load解释为启动结果完成。已有frame在pending或启动失败时保持旧页面并覆盖既有遮罩；新的有效结果才导航一次。

legacy无启动seam测试路径保留直接endpoint行为。生产rc.2仍接受服务端返回的干净endpoint，只有一次导航，不走token清理附加导航。

替代方案“只检查pending而允许idle/failed状态补endpoint”被拒绝：它仍能创建裸401或抢先导航；应按是否存在启动seam控制导航所有权。

### D2：imperative导航，React不拥有可变化的src

frame元素保持稳定key，导航URL经短暂ref/一次性命令向已挂载iframe赋值；不要把token URL放入React的src prop，也不要留在registry。React只呈现frame、阶段与遮罩，因此load、deadline、SSE、切换隐藏与显示不会重新赋值src。

命令与device/origin/generation绑定、单次消费；必须在iframe可用时执行，清掉临时完整URL。若创建与命令时序要求暂存，最晚load/deadline清除，timer闭包仅捕获脱敏身份，不捕获带token的URL/URL对象。卸载时清timer/ref；禁用、删除时清除该设备attempt、target和待执行命令，晚到结果不得复活frame。

拒绝“把React src从token改为空/删属性/干净URL”：都会有导航或React后续覆盖风险。不能同时保证DOM属性擦除与跨源页面不重载。

### D3：明确接受DOM属性残留，保持认证结果不可观测

load/deadline只更新脱敏阶段与清父引用，不改DOM src、不销毁frame；deadline先到后的晚load同样不得导航。子页面官方303仍会清实际地址，但父页不能读取跨源最终地址、状态或cookie来确认结果。

风险变化必须写入README/验证报告：token可在父DOM src保留到合法新导航或销毁，不能称作“已擦除”。继续no-referrer/no-store，不写日志、SSE、持久状态或缓存；不保存token到第二个长期集合。不得使用cookie relay、代理、远端脚本或必装bridge规避取舍。审阅方案即审阅这项安全取舍；若不能接受残留，本方案不能以偷偷加回重载的方式实施。

### D4：沿用tuple去重及stale fences

保留恢复响应更高generation的accepted attempt记录；重复SSE/切回设备不导航。origin变化要等待其对应启动结果，不先加载新裸origin。用户显式retry或合法新tuple可发起一次新导航，不被“永不重载”规则阻止；rc.2不对相同src重复赋值。核对旧结果、禁用后重新启用及同device的frame重建不能跨生命周期误提交。

### D5：第二问题只做独立验证，不做原生修复

选择已存在的测试会话，不发送消息、不创建/归档/删除用户会话。先验证A→B→A页面identity与原选择保持；再单独测试主动刷新Cockpit一次后的恢复。必要时在同一隔离浏览器与相同设备origin直接访问原生DSH进行单次reload对照，确保已选同一已有会话、列表已就绪和origin未变。

报告四类结论：恢复通过；可复现的原生恢复缺陷；仍有失败但归因未明；环境不足无法验证。只有对照实验与版本证据支持才能归因为原生；源码猜测不足。若原生缺陷确认，记录后停止该项修复，不阻塞已通过的问题A、不宣称问题B已解决；不得编辑原生或保存/重放选择。如果发现Cockpit仍有多余导航，继续问题A而不是归咎原生。

## Risks / Trade-offs

- [DOM src含token更久] → 明确残留边界，保持短暂父引用、no-referrer与无持久化，不宣称风险消失；本设计不提供DOM擦除承诺。
- [空白frame load与启动load时序] → 不凭load证明认证，不凭空白load触发导航；用延迟启动与真实浏览器覆盖。
- [React重渲染覆盖imperative src] → JSX不绑定动态src，测试直接观察setAttribute/src赋值和文档数量。
- [真实DSH仍丢选择] → 对照记录并按用户要求不修原生，不在Cockpit增加耦合补偿。
- [jsdom只验证属性，无法证明文档保活] → 增加隔离Chromium观察，使用内存document标记/导航计数与脱敏trace，不保存HAR中的token/cookie。
- [原生301/303、子页内部reload误计] → 报告分别计父src赋值、认证redirect、最终文档commit；不把redirect算额外父导航。

## Migration Plan

无需数据迁移、新依赖或远端部署。实施后运行build/typecheck/test/lint；重建3090实际托管的Web产物，刷新并核对served bundle。无需重启3090或3080。更新token残留说明，不改SW行为；如果实施确需改SW则独立说明并bump CACHE_VERSION。

回滚恢复旧Web构建与对应规范，明确旧行为会重新触发clean导航。部署、回滚不操作设备DSH进程或配置。
