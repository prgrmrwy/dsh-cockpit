## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 — REVISE (R2-C1 existing cookie routes cross-origin; escalated to human, who chose a global guard in this change and accepted the trust relaxations)
- **Reviewer context**: fresh-context subagent (same model family as author; no cross-model CLI used for data-locality reasons)
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - 本 change 的产物：`proposal.md`、`design.md`、4 份 delta spec。
  - 作者提供的轮次摘要：round2-summary。
  - 用 grep 交叉核对的现行 specs：cockpit-workbench / pwa / runtime-launch / device-shell / device-connectivity / device-port-forward。
  - 按小窗口阅读的源码：
    - `token.middleware.ts`、`bootstrap.controller.ts`、`auth.module.ts`；
    - `main.ts:20-45`；
    - `devices.controller.ts`，只读路由表与 `authorizeBridge`；
    - `cockpit-web/src/api/{client,stream}.ts`、`public/sw.js:52-75`、`vite.config.ts`；
    - `dsh-cockpit-bridge/src/client/index.ts`；
    - `bin/cockpit`；
    - `shared/src/index.ts`。
  - 用 Node 24 `fetch` 实测 CLI 请求头：只带 `sec-fetch-mode: cors`，没有 `Origin`，也没有 `Sec-Fetch-Site`。
  - Required Changes 应用后，又用 grep 和小窗口 sed 复核了一遍。

## Round-2 Resolution Check

| finding id | verified? | note |
|---|---|---|
| R2-C1 | yes | 新增 `cockpit-api-auth`：<br>• token 校验之前统一检查 Host、Origin、`Sec-Fetch-Site`，不通过返回 403 `cross-origin-rejected`。<br>• bootstrap 与带能力串的 bridge 回调只豁免 Origin 与 `Sec-Fetch-Site` 检查，不豁免 Host 检查。<br>• CORS 只对 bridge 放行凭据。<br>• workbench-launch、设备 PUT/DELETE 都有场景覆盖。<br>• design D11 已写入，spec 的 REMOVED Reason（port-forward spec:706）也引用了它。<br>• 已逐一核对既有调用方，均不受影响：驾驶舱页面（client.ts:14，`credentials:'same-origin'`）、同源 EventSource（stream.ts:16）、SW 只处理同源 GET（sw.js:61-69）、能力串签发（client.ts:52）、CLI（不带 Origin）。<br>• 本轮发现的 rebinding 缺口（M-A）已按 Required Change 1 修复。 |
| R2-M1 | yes | spec:310-315；场景“主通道断开期间续约被拒仍保持租约”；design D7。 |
| R2-M2 | yes | spec:235；场景 :273；design D5。 |
| R2-M3 | yes | spec:610-611；场景 :629。本轮 M-C 已修复。 |
| R2-M4 | yes | spec:229-234；场景 :268；design D5；proposal:18。 |
| R2-M5 | yes | spec:621；design:231。字符集问题见 📌6。 |
| R2-M6 | yes | spec:126；场景 :180。本轮 M-D 已修复。 |
| R2-M7 | yes | spec:391；场景 :412；proposal:83；design Risks。 |
| S-a | yes | spec:11-14 覆盖 `DeviceState` 的全部 9 个值。 |
| S-b | yes | spec:98；场景 :185。 |
| S-c | yes | 场景 :447。 |
| S-d | yes | spec:305。 |
| S-e | 无法逐字核实 | design 中没有发现残留矛盾。 |
| S-f | yes | Risks。 |
| S-g | partial → 已落地 | test-plan.md 与 tasks.md 已在本 review 之后生成（见 📌11）。 |

## Findings

### 🔴 Critical (blocking)

无。R2-C1 所描述的跨源 cookie 动作，已被新守卫从结构上阻断：

- 跨源非 GET 请求一定带 `Origin`，会被拦截。
- 跨源 GET 与导航会带 `Sec-Fetch-Site: same-site`，也会被拦截。

### 🟡 Moderate

M-A 至 M-F 已由作者按 Required Changes 全部修复，并经复核确认，见 Change Application Check。

- **M-A**：Host 回环要求原先只在请求带 `Origin` 时生效。DNS rebinding 下的同源 GET 可以通过守卫，拿到 401 时下发的 `Set-Cookie` 后，再读取驾驶舱数据。另外，缺少 Host 的情况未定义。
- **M-B**：原文说“跨源带凭据请求一定附带 Origin”，但 no-cors GET 不带 Origin。原文也缺少“有副作用的 cookie 路由不得使用 GET/HEAD”这条不变量。
- **M-C**：旧驾驶舱回退规则与 `seamRequest` 的 401 换发规则互相矛盾，会导致一次无效换发（最长等待 5 秒），并干扰 hello；`forwards.*` 在旧驾驶舱上的行为也未定义。
- **M-D**：规则写的是“租约到期回收时写盘失败，按过期处理”，但到期时间本身不写盘，这条规则无法实现，并且与冻结规则冲突。
- **M-E**：spec:661 写“缺少能力串返回 401”，与新守卫矛盾；场景 :483 的 THEN 不可判定。
- **M-F**：Risks 未写明：被转发的 HTTP 服务可被任意网站经 DNS rebinding 访问。

### 📌 Suggestions

1. **防点击劫持**：驾驶舱 shell 没有 `frame-ancestors` / `X-Frame-Options`，建议加 `Content-Security-Policy: frame-ancestors 'self'`。这是既有问题，且需要用户交互才能利用。
2. **无能力串的 legacy bridge 路径会被 403**：已写入 Risks。✅
3. **非回环主机名访问会被 403**：已写入 Risks。✅
4. **去重需覆盖进行中的申请**：已写入 spec:303。✅
5. **release 与 renew 竞态**：已释放租约的在途续约得到 `lease-expired` 时，bridge 不应再通知持有者。
6. **legacy 持有者标签字符集**：替换非 ASCII 字符，并按码点截断。
7. **只有 legacy 租约的条目**：这类条目不写盘，或在加载时立即回收。
8. **`avoidLocalPorts`**：纳入驾驶舱自身端口，作为纵深防御。
9. **proposal:18 补写别名 rehost**：已补。✅
10. **补场景**：别名变更发生在附加条目处于 `starting` 期间时，generation 失效，旧别名的子进程被立即 dispose。
11. **补齐 tasks.md 与 test-plan**：已补。✅
12. **CORS 凭据**：bridge 的 fetch 不带 cookie，所以 bridge 路由的 `credentials: true` 实际并不需要。这属于人类决策范围，仅作提示。
13. **（复核新增）design D11“实现”段需同步 Host 无条件校验**：Host 检查必须放在 `requiresToken` 的 bootstrap 豁免之前。
14. **（复核新增）design:200 的换发规则**：需排除 `/api/bridge/forwards/*`。
15. **（复核新增）续约中途遇到 401**：这种情况应视为暂时失败，不通知持有者。

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. **（M-A）`specs/cockpit-api-auth/spec.md`**
   - 在拒绝条件首项插入：“请求缺少 Host 头，或 Host 主机名不是 127.0.0.1 或 localhost（无论是否携带 Origin）”。
   - 在豁免段末追加：“Host 主机名校验同样适用于 bootstrap 与 bridge 回调”。
   - 新增场景“DNS rebinding 的同源读取被拒绝”：返回 403，不下发 `Set-Cookie`，不返回设备数据。
   - 修改 `design.md:280`：写明 Host 校验对所有 `/api/` 请求无条件执行。
2. **（M-B）`specs/cockpit-api-auth/spec.md`**
   - 改写放行理由：跨源非 GET 请求一定带 Origin；跨源 GET 与导航由 `Sec-Fetch-Site` 拦截；不支持 Fetch Metadata 的旧浏览器只能发出读不到响应的 no-cors GET。
   - 新增：有副作用的 cookie 路由 MUST NOT 使用 GET 或 HEAD。
3. **（M-C）`specs/cockpit-device-port-forward/spec.md`**
   - :667 的换发规则排除 `/api/bridge/forwards/*`。
   - :611 写明：该路径返回 401 时判定驾驶舱为旧版，不换发能力串；兼容接缝回退旧端点，`forwards.*` 返回“不可用”。
   - 回退场景的 THEN 追加：“期间 bridge 不请求父页面换发能力串”。
   - 同步修改 `design.md:226` 与 `:303`。
4. **（M-D）spec:127 与 `design.md:184`**：残留租约按普通持久化租约恢复（冻结规则，首次可用时刻 + 5 分钟），之后自然到期回收。
5. **（M-E）spec:661 与场景 :483**
   - 能力串无效时返回 400 `bridge-capability-invalid`。
   - 缺少能力串的请求按 `cockpit-api-auth` 处理，来自设备 origin 时返回 403 `cross-origin-rejected`。
   - 场景 THEN 改为可判定的写法：403，或 401（无 Origin、无 cookie）；转发表不变，不启动子进程。
6. **（M-F）design Risks**：新增一条，说明 DNS rebinding 可访问不校验 Host 的被转发 HTTP 服务。这是 `ssh -L` 的固有性质，被转发服务应自行校验 Host。

## Change Application Check

| change# | verified | note |
|---|---|---|
| 1 | yes | spec:14、:30、场景 :87、design:280 已修改。与 bootstrap 流程不冲突：驾驶舱页面与 Vite 代理（`changeOrigin: false`）都保留回环 Host，拒绝发生在签发 cookie 之前。 |
| 2 | yes | spec:39-40 已修改。 |
| 3 | yes | spec:611、:667、场景 :634、design:226、:308 已修改，彼此一致。 |
| 4 | yes | spec:127 与 design:184 已修改，与 spec:128 的冻结规则一致。 |
| 5 | yes | spec:661、场景 :483 已修改，状态码可判定。 |
| 6 | yes | design:303 已修改。 |
| 额外 | yes | 📌4、📌9、📌2/📌3 已落地，未引入新矛盾。 |

CHANGES_APPLIED: yes

## Rebuttals

M9 在第 2 轮被有条件接受：D4 放宽所依赖的安全边界是“不能跨设备”。该条件**现已满足**：

- 设备页面与转发页面无法再带着 cookie 调用 workbench-launch、设备 PUT/DELETE 或管理端点。
- 跨源非 GET 请求被 Origin 检查拦截；跨源 GET 与导航被 `Sec-Fetch-Site` 检查拦截；rebinding 被无条件的 Host 校验拦截。
- bridge 请求按 `Origin` 解析设备，无法指定其他设备。

## Author Post-Review Notes

- 📌13–15 已在复核后应用：
  - design D11“实现”段改为“Host 无条件校验，先于 `requiresToken`/bootstrap 豁免”；
  - design:200 的换发规则排除 `/api/bridge/forwards/*`；
  - spec:611 写明“续约得到 401 按暂时失败处理”。
- 以上修改后 `openspec validate --strict` 通过。三处修改都是按 reviewer 给出的建议文字同步措辞，未引入新的行为。
- 📌1、5、6、7、8、10 作为实现期提示纳入 tasks.md；📌12 留给人类决策。
