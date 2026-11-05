## Context

动机见 proposal.md 的 Why。与本设计相关的现状：

- **转发表**（`connectivity/forward-table.ts` 的 `DeviceForwards`）以设备端口为键管理附加条目。条目只有常驻（`pin`）与随持有者（`acquire`）两种寿命，自愈采用 1s→60s 抖动退避，按 `generation` 阻断过期的回调。表经 `ForwardChannelConnector.connect` 驱动 `TunnelManager`，传入 `channelId: fwd-<port>`，`remoteDshPort` 取设备端口。
- **本地端口**由 `TunnelManager.connect` 里的 `reserveCandidatePort(preferred)` 决定：有 preferred 时先试它，失败就**回落到内核分配的端口**；OpenSSH 报绑定失败时也换新端口重试，最多 `maxBindAttempts` 次。附加通道从不传 preferred，所以端口总是随机。
- **常驻标记**写入 `DeviceRecord.forwards: PinnedForwardRecord[]`，只含 `{ devicePort, label? }`。`registry.ts` 的 `validatePinnedForwards` 是容忍式校验：坏条目丢弃并告警，不让整个文件 fail-closed。写入顺序是先落盘再改内存（`ConnectivityService.pinForward` → `mutateDevice` → `table.pin`）。
- **管理端点**：`POST /api/devices/:id/forwards` 与 `DELETE …/:port` 由 cookie 加同源校验保护；业务拒绝统一以 409 `{ code }` 返回，前端 `ForwardList` 的 `CODE_TEXT` 把 code 映射成固定中文，从不显示服务端消息。
- **执行设备命令的先例**：`dsh-auth-discovery.ts` 用 `ssh -T -o BatchMode=yes -o ConnectTimeout=5 -- <alias> <固定脚本>` 读日志尾，`shell: false`，stdout 上限 64 KiB 加 1 字节，8 秒超时，对外只返回 token 或失败枚举，stderr 一律丢弃。
- **iframe 快照**由 `toForwardsSnapshot` 按白名单逐字段复制，投影里新增的字段默认不会泄露到设备页面。

## Goals / Non-Goals

**Goals:**

- 同端口条目在任何重建路径下都绑定 `127.0.0.1:<设备端口>`，失败时可诊断，不会悄悄漂移。重建路径包括自愈、主通道恢复后的重建、别名迁移、驾驶舱重启。
- 「打开」只用现有转发表的数据与一个新的管理端点，前端不轮询。
- 全部沿用现有命名与模式：常驻标记、409 `{ code }`、`CODE_TEXT` 固定文案、创建分组、行首右侧动作、纯文本渲染、主题令牌。

**Non-Goals:**

- 不做 Host 改写代理，也不支持多台设备并存同一本地端口。
- 不支持 IPv6 或非 `127.0.0.1` 回环地址。
- 不改 bridge 接缝：`cockpitBridge.forwards` 不提供同端口选项，快照字段不变，`lib/` 不重建。
- 不新增「编辑条目」对话框或独立面板：通过再次提交创建分组来更新选项，与现有 label 更新路径一致。
- 不对目标服务做协议探测：`ready` 仍只表示 ssh 在监听。

## Decisions

### D1. 同端口是常驻标记上的一个布尔值，不是持久化的端口号

`PinnedForwardRecord` 增加 `sameLocalPort?: true`，条目同样携带 `sameLocalPort: boolean`。本地端口号在运行时由 `devicePort` 推出，因此 spec 中「本地端口 MUST NOT 持久化」这条原则仍然成立，旧记录天然兼容（缺省即 false）。

- 备选：持久化任意 `localPort`（允许本地 8082 → 设备 3082）。这既违背上面那条原则，也不能解决 Host 围栏问题，而围栏正是这次需求的起因。不采用。
- 只允许常驻条目带此标记：bridge 申请的随持有者条目寿命短、端口可变，消费方本来就按最近一次交付的地址工作，不需要同端口。

### D2. 严格绑定在 `TunnelRequest` 上加 `strictLocalPort`，不复用 `preferredLocalPort`

在 `TunnelRequest` 上新增 `strictLocalPort?: number`：

- `reserveCandidatePort` 先试一次该端口，失败时不回落，直接抛出 `ForwardPortInUse`，诊断为 `local port 127.0.0.1:<p> is in use`。
- OpenSSH 早退且 `isPortBindFailure` 命中时，按同样方式抛出；其它早退照旧，在 `maxBindAttempts` 内重试，但始终使用同一端口。
- 漂移告警与持久化回调不受影响：它们只对主通道生效。

`DeviceForwards.#start` 在 `entry.sameLocalPort` 为真时传入 `strictLocalPort: devicePort`。抛错后走现有的 `#fail` → `retrying` → 退避，诊断截断等数据卫生规则全部沿用。

- 备选：把 preferred 加一个「不允许回落」开关。不采用，因为 preferred 的语义是「尽量」，归因逻辑中的 latch（`abandonPreferred`）也是为它服务的；混在一起会让主通道的端口稳定规则变得难读。

### D3. 冲突在创建时检查，范围是整个驾驶舱

`ConnectivityService.pinForward` 在落盘之前检查：请求的 `sameLocalPort` 端口如果等于下列任一端口，就抛出 `ForwardRejection('local-port-conflict')`：

- 其它设备已有的同端口条目的设备端口，包括正在写盘、尚未进入内存的那些（见下文的占位集合）；
- 任一远端设备主通道当前的本地端口，或已持久化的 `localPort`。主通道这一项防的是另一台设备的工作台 origin 被迫漂移。

驾驶舱自身的 `COCKPIT_PORT` 不单独检查：它一直被监听着，严格绑定时会立即失败，报出同一条「端口被占用」诊断。

同一设备的转发表以设备端口为键，同设备内不可能自相冲突。

**并发**：`pinForward` 在检查之后要 `await` 写盘，之后才把条目写进内存转发表；检查本身又不在注册表的串行队列里。所以 `ConnectivityService` 维护一个同步的「写盘中」占位表 `#pendingSamePorts: Map<localPort, deviceId>`：

- 先 `await` 读一次注册表，然后在同一个同步段里完成「检查 + 占位」；
- 写盘结束（无论成败）就移除占位；
- 其余占用来源直接读真相源：各设备内存转发表里的同端口条目、注册表里的同端口标记（覆盖已禁用的设备），以及各远端设备主通道的当前端口和已持久化端口（包括本设备自己的主通道）。

因此删除、取消同端口或删除设备时，不需要另外释放占位。

这样，两个标签页同时给两台设备创建 3082 时，恰有一个成功。

外部进程占用无法在创建时判定，因为它会随时间变化，所以交给 D2 的运行时诊断处理：创建成功，条目进入 `retrying`。用户看到的诊断就是「端口被占用」，释放端口后条目会自动恢复。

- 备选：创建时预绑定一次，占用就直接拒绝。不采用。占用是暂时状态，拒绝会迫使用户先去释放端口再回来操作；常驻条目按期望状态自愈的模型已经能正确表达「想要、但暂时拿不到」。

### D4. 已存在条目再次提交时按字段合并；同端口标记变化时重建子进程

`pinForward(deviceId, devicePort, options)` 中，`options` 包括 `label`、`sameLocalPort`、`openPath`、`urlCommand`。合并规则：

- `undefined` 保留原值，这与现有 `label ?? previous.label` 一致；
- 字符串字段传空串表示清除；
- `sameLocalPort` 由前端显式传布尔值。

`DeviceForwards.pin` 发现 `sameLocalPort` 与条目当前值不同时，执行一次 `generation += 1`，dispose 当前子进程，再调用 `#start`。持有者保留，bridge 侧按现有通知规则收到 `retrying` → `ready`。`openPath` 与 `urlCommand` 只是元数据，不触发重建。

### D5. 「打开」：无命令时在前端组装地址，有命令时调用解析端点

- **无命令**：条目 `ready` 且有 `localPort` 时，执行 `window.open('http://127.0.0.1:<localPort><openPath ?? "/">', '_blank', 'noopener,noreferrer')`。不发请求，数据全部来自已有投影。
- **有命令**：浏览器的弹窗拦截只放行同步用户手势，所以点击时先同步 `window.open('', '_blank')` 打开空白窗，并把 `opener` 置空；随后 `await api.resolveForwardUrl(...)`，成功就把空白窗的 `location` 设为结果 URL，失败就 `close()` 空白窗，在转发区显示固定文案。
- **端点**：`POST /api/devices/:deviceId/forwards/:devicePort/open-url`，返回 `{ url }`，失败返回 409 `{ code }`。前端只在条目配有命令时调用它；对没有命令的条目，端点返回 409 `url-command-no-url`，不执行任何设备命令，也不另写一条组装地址的分支。cookie 门禁沿用 `cockpit-api-auth` 的默认规则，不加入 bridge 回调名单。
- 「打开」按钮放在首行右侧、删除按钮之前，使用现有的次要按钮样式，不另做新按钮组件。

### D6. 打开地址命令：存储自由命令，用户点击时才执行（**已定**，见「人类决策记录」）

这是本 change 唯一需要人做决定的点，用户已采纳推荐方案：

- 注册记录存一条自由命令字符串，限 1–1024 个可打印 ASCII 字符，不允许换行。只有用户点击「打开」时才执行。
- 执行方式：`ssh -T -o BatchMode=yes -o ConnectTimeout=5 -- <alias> <command>`，`shell: false`，stdin 关闭。远端命令由设备上的登录 shell 解释，这正是用户想要的，比如管道和 `grep`。
- 限制：超时 10 秒，超时后 SIGKILL；stdout 上限 64 KiB，超出即终止；stderr 丢弃。
- 解析：用 `http://127\.0\.0\.1:<devicePort>(?:[/?#][^\s"'<>]*)?` 提取候选，从后往前逐个用 `new URL` 校验，要求 `protocol === 'http:'`、`hostname === '127.0.0.1'`、`port === String(devicePort)`。每个候选先去掉末尾连续的 `)`、`.`、`,`、`;`、`]`，以免日志行里包住 URL 的标点被带进 token；然后取第一个通过的候选，把端口换成条目当前的 `localPort`。
- 日志只记录设备 id、端口和结果 code，从不记录命令文本、输出或 URL。

**风险**：注册表文件里多了一条会在设备上执行的命令。注册表在 `~/.dsh-cockpit/` 下，权限已经收紧；能改它的人本来也能直接 `ssh <alias>`，所以不构成额外的提权面。命令只由用户点击触发，不会自动或周期执行；结果被限定为同 origin 的 URL，无法让驾驶舱打开任意外部地址。

**备选**：

1. **结构化来源**：只存「设备上的文件 glob + 正则」，驾驶舱用固定的只读脚本 `ls -t | head -1 | tail -c | grep -o` 去取。好处是注册表里没有任意命令；代价是格式写死，对日志之外的来源（比如某个 CLI 打印的地址）无能为力。
2. **不做 P1**：只做同端口加打开路径；带 token 的地址仍要用户手动打开一次，之后靠浏览器 cookie 或会话维持。

推荐自由命令的理由：部署侧给出的样例本身就是 `ls -t … | xargs grep -o … | tail -1` 这样的管道，备选 1 只是把同一件事做得更窄；风险已由「点击才执行」「同 origin 结果」「不落盘」三点约束住。tasks 中 P1 那一节以本决定为前置条件。

### D7. 错误码与文案

- 新增类型 `ForwardPinErrorCode`，包括 `local-port-conflict`、`invalid-open-path`、`invalid-url-command`。只有面板的创建端点会产生它们，bridge 的 acquire 永远不会返回。它与新增的运行时代码一起放在 `shared/src/forward-options.ts`，不进 `forwards.ts`：bridge 的 `lib/` 内联了 `forwards.ts`，这样 `lib/` 保持不变。
- 新增类型 `ForwardOpenErrorCode`，包括 `forward-not-ready`、`url-command-failed`、`url-command-timed-out`、`url-command-no-url`、`url-command-output-too-large`。它与转发表的业务拒绝码分开，以免扩大 bridge 侧对 `code` 取值的预期。
- 前端 `CODE_TEXT` 增补对应的固定中文，例如「本地端口已被其他设备或驾驶舱占用」「没有在命令输出中找到地址」。

## Risks / Trade-offs

- [外部进程长期占着固定端口，条目一直重试] → 诊断清楚写出端口被占用；退避上限 60 秒，开销可以忽略；用户可以删除条目。
- [主通道已持久化的端口恰好等于某个想要的固定端口] → 创建时以 `local-port-conflict` 拒绝（D3）。如果主通道之后漂移到这个端口，只可能落在内核临时端口段（通常 ≥32768）；用户选的固定端口通常不在这一段，残余风险可以接受。
- [弹窗被浏览器拦截] → 打开空白窗的动作在点击处理器里同步执行（D5）。PWA standalone 窗口中 `window.open` 会打开系统浏览器标签页，这是预期行为。
- [命令输出含 token，被意外写入日志] → 解析函数只返回 URL 或失败枚举，调用方拿不到原始输出。测试用哨兵字符串断言日志、注册表、投影和快照中都不出现它。
- [再次提交同端口开关时，持有者的地址变化] → 走现有通知路径（`retrying` → 新地址的 `ready`），bridge 消费方本来就以最近一次交付的地址为准。

## Migration Plan

- 注册表字段都是可选的，缺省时行为与现在完全一致；旧记录无需迁移。新字段不合规时只丢弃该字段并告警，常驻标记本身保留，告警中不包含命令文本。
- 回滚到旧版本时，旧版 `validatePinnedForwards` 读回时只保留 `devicePort` 和 `label`，常驻条目退化为内核分配端口，不会因此报错。**但旧版的 `mutateDevice` 会把整个注册表写回**（`registry.ts:211-219`），所以回滚后旧版第一次写注册表（例如主通道端口漂移时的持久化），就会把所有设备的 `sameLocalPort`、`openPath`、`urlCommand` 丢掉。重新升级后，需要在面板里对相应端口重新提交这些选项。
- 发布顺序：只涉及 cockpit 的 server、web 与 shared，与 bridge、shim 无关，可以单独发布。

## 人类决策记录

- **2026-11-05**：用户决定，design D6 采用推荐方案「存储自由命令，用户点击时才执行」，不采用结构化来源，也不砍掉 P1。
- **2026-11-05**：用户决定，ponytail-review 的五条建议全部采纳，已写入本文件、spec 与 tasks。五条是：
  1. 同端口冲突检查加同步占位，防止并发创建都通过检查；
  2. 如实写明回滚会丢失新字段；
  3. 解析端点删掉「无命令」分支，改返回 `url-command-no-url`；
  4. 冲突检查去掉 `COCKPIT_PORT`；
  5. 提取 URL 时剥掉末尾标点。
