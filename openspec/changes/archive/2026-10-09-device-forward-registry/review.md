## Review Metadata

- **Review round**: 5（RC7/RC8 复核已追加于 Rebuttals）
- **Prior round**: round 4 APPROVE_WITH_CHANGES（0 🔴 / 6 🟡 / 8 📌）；作者应用了 🟡-1 到 🟡-6，并采纳 📌-1/2/3/4/6/7，因内容变更 round 4 verdict 作废
- **Reviewer context**: fresh-context subagent (same model family; cross-model CLI not used for data locality)
- **Tool restrictions**: read-only（bash sed/grep/diff 窗口）；唯一写操作为本文件
- **Artifacts reviewed**: `diff -ru /tmp/dfr-v2-pre-r4 openspec/changes/device-forward-registry` 全部 hunk；新增 `specs/cockpit-api-auth/spec.md`（与 `cockpit-api-same-origin` 中同名 requirement 逐行 diff）；port-forward spec :105-190、:250-300、:420-450；design D4(a)(b)(e)、D7、Round 4 取舍节；proposal 前置依赖与 Capabilities
- **源码复核**：`devices.controller.ts:256-263`（`requireBridgeCapability` 缺头 401）、`:280-283`（`authorizeBridge` 无头即放行）、`:385-396`（`toHttp`）；`connectivity.service.ts:394-433`（`issueBridgeCapability` 要求 endpoint；`validateBridgeCapability` 先 `#lifecycleByOrigin` 再校验 grant）；bridge `client/index.ts:110/199/492`（`apply` → `ctx.effect` → dispose）

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## 一致性扫描结论（非 finding）

- 残留旧说法已清除：grep `仅限这两条|各接缝所属|由定义各接缝|所有页面` 在 proposal/spec 中无命中；design:201 与收敛表中的“全部页面断开”仅作为历史对照出现。
- `cockpit-api-auth` delta：标题与前置 change 逐字一致，块完整；与基线的 diff 只有名单两行替换，两个场景原样保留。归档顺序依赖已写入 proposal 与 design Context。
- 新错误码在 design D7 与 spec “拒绝”段的枚举一致（`invalid-page` 为 400，签发路由；`device-unavailable` 为 409，forwards 路由）。
- pid 只在 SSE 投影与面板中出现，快照与设置区块均不含 pid，三处一致。
- 删除常驻条目写盘失败：design D3 与 spec 一致。
- 60 秒观测窗口：场景可机械断言。
- D5 别名变更归属说明：已写入，理由成立。

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

**🟡-7 `device-unavailable` 与 `bridge-capability-invalid` 的判定顺序未定义，两条 SHALL 对同一输入给出不同结果；release 在主通道中断期间必然失败。**

先说冲突：
- spec :435 规定，请求 `Origin` 无法解析到有主通道端点的设备时，返回 409 `device-unavailable`。
- spec :434 与场景 :444-447 规定，能力串“与请求 `Origin` 不匹配”时返回 400 `bridge-capability-invalid`。
- 现有 `validateBridgeCapability` 先执行 `#lifecycleByOrigin(origin)`，后校验 grant（`connectivity.service.ts:405-413`）。按这个顺序，“设备 A 的能力串，从一个不对应任何在线设备的回环 origin 发来”会得到 409；按 :444 场景则应得到 400。两种实现都能自称合规，测试结果取决于实现顺序。
- 附带问题：如果 409 在校验能力串之前返回，任何回环页面只要带上一个垃圾能力串头，就能探测某个 origin 是否对应在线设备。能力串头会让请求豁免来源校验。

再说 release：
- spec :256 只写了“申请”以 `device-unavailable` 失败。但现有代码对所有 bridge 请求都经 `#lifecycleByOrigin` 解析设备（design:21），主通道断开时 `release` 同样会失败。
- 主通道断开期间，设备页面仍可能活着（iframe 由遮罩盖住但保持挂载）。此时持有者调用 `release` 会被拒绝，释放丢失，持有一直残留到实例结束或页面关闭。
- 授权记录本身带有 `deviceId`，release 完全可以按 grant 定位设备，不依赖主通道端点。

见 Required Change 7。

**🟡-8 “已结束实例”集合让实例标识复用变成永久拒绝，并与 design 的 bfcache 叙述矛盾。**

D4(e) 把 `instanceId` 记入 `pageId` 的已结束集合，之后同一 `(pageId, instanceId)` 的 acquire 一律以 `invalid-holder` 拒绝，直到该页面宽限回收。但 spec :111 只规定“每次页面加载生成新的实例标识”，而 :120 要求 bridge 在 `pagehide` **以及自身 dispose** 时发送实例结束消息。至少有两条路径会让同一个 bridge 在发送实例结束之后继续使用原标识：

1. **bfcache**：`pagehide` 在 `event.persisted === true` 时同样会触发。页面从 bfcache 恢复（`pageshow`）后 JS 状态原样保留，`instanceId` 不变。父页面处理这条消息后，服务端把该标识记为已结束，于是 bridge 此后的每次申请都被拒绝，并且一直持续到驾驶舱页面关闭。design:319 写的是“页面恢复后……由消费方决定是否重新申请”。只要驾驶舱 SSE 在 30 秒内重连，已结束集合就不会被清除，这句叙述就不成立。
2. **fiber 重启**：`instanceId` 在 `apply` 中生成（design:166），而实例结束消息在 `ctx.effect` 的 dispose 中发送（bridge `client/index.ts:199/492`）。如果宿主在同一页面内 dispose 后重跑 effect（插件停用再启用、热重载），新的 effect 会沿用已结束的标识。宿主是否有这条路径，本轮未能读码确认，但 artifacts 没有排除它。

结果：消费方看到的 `invalid-holder` 无法与“标签不合规”（:317）区分，也无法自愈。

见 Required Change 8。

### 📌 Suggestions

- 📌-9 `release-instance` 请求体新增了 `pageId`，但未规定它的格式校验与不合规时的响应。建议与签发路由一致，返回 400 `invalid-page`。另外，如果该 `pageId` 当前没有连接，建议像 acquire 一样启动宽限计时，否则该页面的已结束集合可能因为没有触发宽限回收而永久驻留（量很小，属于卫生问题）。
- 📌-10 签发路由 `POST /api/devices/:deviceId/bridge/capability` 服务于 `cockpit-workbench` 的 capability 换发流程。本 change 在 port-forward 中给它加了必填 `pageId`，并规定“授权记录缺 `pageId` 的能力串一律无效”，这会影响 hello、session-opened 等全部 bridge 回调。主 spec 没有定义该路由的请求体，所以不构成 MODIFIED 遗漏。建议在 design Migration 中写一句：旧 cockpit-web 缓存页面签发失败时，打开确认也会一起暂停，直到页面刷新。
- 📌-11 design:43 的 Context 仍然写着“iframe 内部导航后……这种归属依然成立”（指的是既有的 source 加 origin 比对）。建议在紧随其后的 origin 漂移条目补一句“因此 D4(a) 不沿用 `:180-206` 的 origin 比对”，免得实现者直接复用那个处理器。

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

APPROVE WITH CHANGES：round 4 的 6 条 Required Changes 全部到位。采纳建议后新增的内容引入了 2 条 Moderate，修法都很小且明确；没有 Critical。

## Required Changes (if APPROVE WITH CHANGES)

7. **（🟡-7）** 在 port-forward MODIFIED “拒绝”段写明 forwards 端点的判定顺序：
   1. 缺能力串头 → 401 `unauthorized`；
   2. 能力串不存在、已过期，或 grant 的 origin 不等于请求 `Origin` → 400 `bridge-capability-invalid`（按 grant 自身判定，**不**依赖主通道端点）；
   3. grant 有效，但其 `deviceId` 当前没有主通道端点 → acquire 返回 409 `device-unavailable`；
   4. 其余业务校验。

   同时规定：`release` 按 grant 的 `deviceId` 定位设备，主通道不可用时 SHALL 照常移除持有者。design D7 与 :277 同步修改。补两个场景：主通道断开期间 release 成功、持有者被移除；不对应在线设备的 origin 携带无效能力串时返回 400 而非 409。

8. **（🟡-8）** 在 spec “标识 / 实例结束”与 design D4(a)(e) 中规定：bridge 发出实例结束消息后 MUST NOT 再以该实例标识申请或释放；bridge SHALL 在每次 bridge effect 启动时，以及 `pageshow` 且 `event.persisted === true` 时，生成新的实例标识。design Risks 中 bfcache 一段（:319）相应改写。补一个场景：设备页面经 bfcache 恢复后，以新实例标识申请成功，旧标识对应的持有已被释放。

CHANGES_APPLIED: yes

## Rebuttals

- **🟡-1（origin 漂移下的实例结束消息）**：已修复。spec 按 `event.source` 归属，`event.origin` 需在该 iframe 已加载过的 origin 集合中，iframe 卸载或设备移除时清空；新增漂移场景，负向场景也同步更新。design D4(a) 给出了放宽的风险论证（实例标识不可猜测、端点按设备限定）。**accepted by reviewer**
- **🟡-2（释放实例与在途申请的竞争）**：已按方案 (ii) 修复。已结束实例集合按 `pageId` 维护，不按时间过期，随宽限回收清除，并有场景“释放实例先于同实例的在途申请到达”。**accepted by reviewer**。它衍生出的标识复用问题另列为 🟡-8。
- **🟡-3（proposal 与 design 的兜底语义矛盾）**：已修复。proposal 第 21 行改为按 `pageId` 断开满 30 秒。**accepted by reviewer**
- **🟡-4（pageId 输入契约）**：已修复。格式为 16–64 个 `[A-Za-z0-9_-]` 字符、≥128 位随机量；签发请求缺失或不合规返回 400 `invalid-page`；缺少页面标识的能力串视为无效；不带 `page` 的 SSE 照常推送但不计数；有对应场景。**accepted by reviewer**。`release-instance` 请求体的校验见 📌-9。
- **🟡-5（缺少能力串的拒绝归属）**：已修复。改为由端点自身返回 401 `unauthorized`，且先于按 `Origin` 解析设备，与 `requireBridgeCapability`（`devices.controller.ts:256-263`）的现状一致；新增“同源页面只带 cookie 调用申请端点被拒绝”场景。**accepted by reviewer**
- **🟡-6（bridge 回调名单缺 delta）**：已修复。新增 `specs/cockpit-api-auth/spec.md` 的 MODIFIED，只替换名单两行；port-forward 删除了自有名单声明，改为引用；proposal、design、REMOVED 的 Migration 同步；归档顺序依赖已写明。**accepted by reviewer**
- **🟡-7（forwards 端点判定顺序与主通道断开期间的 release）**：已修复（复核 `diff -ru /tmp/dfr-v2-pre-r5 …`）。spec “拒绝”段写明四步顺序：401 → 400（只依据授权记录，MUST NOT 依赖主通道端点）→ 仅申请返回 409 `device-unavailable` → 其余业务校验；release 按授权记录中的设备定位，主通道不可用时照常移除持有者。“操作”段与“不可用”段也改为按授权记录定位，与之一致。design D7 同步改写，并点明不得沿用 `validateBridgeCapability` 的现有顺序，理由包括存在性探测。新增两个场景：非在线设备 origin 带无效能力串返回 400；主通道断开期间释放照常生效。:444 场景措辞相应收紧。残留 grep：“按 `Origin` 解析”只剩 design:21 Context 对现状代码的描述，属正确的现状事实。**accepted by reviewer**
- **🟡-8（实例标识复用导致永久拒绝）**：已修复。spec “标识”段规定：每次 bridge effect 启动时、以及 `pageshow` 且 `persisted === true` 时生成新标识；标识一次性，发出实例结束后 MUST NOT 再用；换标识时丢弃旧的本地持有记录，并以 `removed` 通知持有者。design D4(a) 同步，D4(e) 注明依赖这一一次性约定，集合规模改为按“实例结束次数”约束；Risks 的 bfcache 段已改写，与 spec 一致。新增场景“设备页面经 bfcache 恢复后以新实例标识申请”。**accepted by reviewer**
- **📌-9 / 📌-10 / 📌-11**：deferred by author (non-blocking)。
- **范围检查**：round 5 的 diff 只涉及 design.md 与 port-forward spec，全部改动都可追溯到 RC7 或 RC8（包括“操作”段、“不可用”段的定位措辞，以及 401 检查改为“先于其它任何校验”），没有超出范围的改动，本轮 verdict 不作废。
- **📌-8（README/BACKLOG 改写留待实现阶段）**：作者婉拒，接受。Migration 第 5 步已经覆盖。
