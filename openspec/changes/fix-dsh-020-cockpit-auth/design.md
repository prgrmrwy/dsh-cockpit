## Context

运行本机cockpit 3090的源仓干净、HEAD 976f854；devbox候选39521携带header a5011e0与bridge7102a12修复。现有认证实现认为Location只能是`/`，而官方0.2候选实测为`./`；303和cookie均存在。只认严格旧字符串导致token有效却永远重连。

## Goals / Non-Goals

**Goals:** 接受两种已知干净根Location，保留全部cookie身份和过期检查；旧0.1.x回归；用真实本机服务端和devbox候选验收，不再仅mock确认端。

**Non-Goals:** 不更改官方DSH；不允许任意相对/绝对重定向；不扩大发现凭据路径；不更新任何设备上的DSH或生产3080；不在本次迁移0.6转发协议或自动发布。

## Decisions

1. 使用显式allowlist `/`、`./`，不用URL归一化泛化接受等价路径。两者对于当前根token GET都指向同origin干净根；拒绝`//host`、绝对URL、查询、fragment、子路径和编码绕过。
2. 保持既有303、cookie非空值、确定性authority名称与由Set-Cookie Expires/Max-Age推导的有效期检查；响应不自动follow。当前inspectDshCookie不解析签名payload、不验证签名，最终cookie有效性由DSH协议探测验证；本修复不虚称或新增本地签名校验。不把协议差异误当token过期触发未授权discovery。
3. 共用exchangeDshLaunchToken，服务端/浏览器launch一致，保留重复交换、single-flight、CAS和abort语义。
4. devbox隔离分支fix/dsh-020-auth基于当前976f854；所有编译/测试先在devbox进行。本机只按用户授权备份后部署cockpit目标，重启前核对进程归属与现有设备配置；原3台设备保持配置不变。
5. 测试新增临时候选设备，删除时只删除精确测试ID；不能整份覆盖devices.json而丢失用户并发编辑。失败回滚本机cockpit产物/启动绑定，不回滚或写其它设备。

## Risks / Trade-offs

- 修复首个认证门槛后可能暴露RPC/WS协议差异 → 逐层诊断，不提前承诺全链路支持；超出本提案的行为再报。
- 本机cockpit重新启动会短暂中断其聚合/隧道 → 留回滚点，身份核验，保持DSH进程不变。
- 本机已是0.6服务端，修复候选bridge为0.5.1 → 当前仅验证现存hello/selection/pending协议；转发差异不是本认证修复通过的证据。

## Migration Plan

确认实施→devbox RED/GREEN→server范围测试/typecheck/build→完整差异审查→本机备份/部署/restart→真实候选连接和launch→安全回收临时设备/隧道→报告。未通过时停止上线或恢复本机cockpit旧产物。不上游push/publish。

## Open Questions

修复认证后RPC/WS是否仍兼容要由实际联调证明，不扩大本提案预先修改未知协议。
