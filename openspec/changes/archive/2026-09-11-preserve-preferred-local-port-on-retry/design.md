## Context

见 `proposal.md` — Why。此处只记录塑造实现方式的现状与约束。

`TunnelManager.connect` 的重试循环当前用尝试序号决定首选端口：

```
const preferred = attempt === 1 ? sanitizePort(request.preferredLocalPort) : undefined
const localPort = await reserveCandidatePort(preferred)
```

失败分支只有一条判据 `outcome.kind === 'exit'`（OpenSSH 在 readiness 之前退出），不携带任何归因，因此循环无法区分「端口不可用」与「链路抖动」。

两处结构性约束决定了归因只能是启发式的：

1. **`reserveCandidatePort` 丢弃了它已经掌握的归因。** `ssh.ts` 中它以 `attempt(preferredPort).catch(() => attempt(0))` 静默回退，调用方拿到一个端口号却无法知道首选端口是否被拒。这一层归因是**确定的**（`EADDRINUSE`/`EACCES` 来自本进程的 `listen`），只是没有向上传递。
2. **OpenSSH 退出的归因只能来自 stderr 文本。** 端口占用与链路失败都以退出码 255 结束（本机实测），唯一区分信号是 stderr 内容。本次实测的两类真实输出：

   - 端口占用：`bind [127.0.0.1]:58819: Address already in use` / `channel_setup_fwd_listener_tcpip: cannot listen to port: 58819` / `Could not request local forwarding.`
   - 链路类：`ssh: connect to host 10.255.255.1 port 22: Operation timed out`、`ssh: Could not resolve hostname …`

   stderr 是**不可信输入**：它来自远端可影响的通道（远端 shell 的 banner、MOTD、代理提示都可能出现在这里）。归因必须只用于「是否保留一个本地端口号」这一个决定，且默认方向为保守。

`tunnel-manager.ts` 现有 stderr 处理已有 `maxStderrBytes`（默认 8192）上界与截断，本设计沿用该缓冲，不新增读取路径。

## Goals / Non-Goals

**Goals:**

- 让「放弃首选端口」的判定基于失败归因而非尝试序号，且在归因不确定时偏向保留端口（spec 的 `#### Scenario: 无法归因的提前退出保留已持久化端口`）。
- 把 `reserveCandidatePort` 已经掌握的确定归因暴露给调用方，使最可靠的那条判据不再依赖 stderr 猜测。
- 让端口漂移与持久化失败在服务端日志中可定位。

**Non-Goals:**

- 不改变重试次数上限，不引入新的重试维度（例如「为链路失败额外多试几次」）。
- 不试图穷举 OpenSSH 的错误文本或做本地化匹配；归因是有限的白名单启发式，不是完备解析器。
- 不改变端口持久化的写盘路径、原子性与 fail-closed 校验。
- 不改变设备状态分级与诊断分类（隧道错误仍归类为隧道错误）。
- 不解决「已消失 origin 上的残留页面继续回调」这一现象本身——本设计只让其成因可观测；抑制那类噪音属独立关注点。

## Decisions

### D1：归因分两级——确定归因优先，stderr 启发式兜底

**决定**：`reserveCandidatePort` 回报首选端口是否被拒（确定归因）；仅当预绑定验证通过、OpenSSH 仍提前退出时，才用 stderr 做启发式归因。

**理由**：预绑定失败的归因来自本进程的 `listen` 系统调用，完全可信且零歧义，应当作为第一判据。只有 TOCTOU 窗口内被抢占这一种情况需要落到 stderr——它恰好也是既有 spec 唯一授权的降级情形。这样设计把不可信输入的作用面压到最小。

**备选**：全部依赖 stderr 匹配。否决：把一条确定信号降级成文本猜测，且预绑定失败时 stderr 根本不存在（进程从未启动）。

### D2：stderr 归因用「端口占用」白名单，默认保留端口

**决定**：只有 stderr 命中端口绑定失败的特征（`Address already in use`、`cannot listen to port`、`Could not request local forwarding` 之类与本地转发绑定直接相关的信号，且需与本次使用的端口号一致时才更可信）才判为端口不可用；其余一切情形——包括空 stderr、纯链路错误、无法识别的文本——判为与端口无关并保留首选端口。

**理由**：两类错误的代价不对称。误判为「端口不可用」会让 origin 永久漂移、抹掉设备 DSH 的本地状态，正是本 change 要消除的缺陷；误判为「与端口无关」只会让本次连接多消耗一次注定失败的重试，上限不变、用户不可感知。因此默认方向必须是保留。

**备选**：用「链路错误」白名单，未命中即放弃端口。否决：默认方向错了——任何未来新增的 OpenSSH 错误文本都会退化成 origin 漂移。

### D3：归因不改变重试预算，只改变端口选择

**决定**：`maxBindAttempts` 与循环结构不变；归因只影响下一次尝试传给 `reserveCandidatePort` 的 `preferred` 值。

**理由**：保持与既有 spec「重试次数上限不变、MUST NOT 引入无界重试」一致。链路抖动本就应由上层的 `#reconnectDelay` 退避循环兜住，隧道层不该自行扩张预算。

**备选**：链路失败时增加重试次数。否决：越权且与 spec 冲突。

### D4：漂移日志放在已知原端口的那一层

**决定**：漂移告警由能同时看到「原持久化端口」与「实际端口」的层发出。`TunnelManager` 收到 `preferredLocalPort` 且实际绑定端口与之不同时即可判定漂移，同时携带归因；`connectivity.service.ts` 的 `#persistLocalPort` 只补记持久化失败告警。

**理由**：归因信息在隧道层产生，日志应在该层落地，避免把归因原因再往上传一层只为打印。`TunnelManager` 目前没有 logger（实测日志语句数为 0），需要注入一个可选 logger 以保持其可测试性——不注入时静默，单测据此断言。

**备选**：把归因回传给 `device-lifecycle` 由其记录。否决：为一条日志扩大 `TunnelHandle` 的契约面。

## Risks / Trade-offs

- **[stderr 启发式漏判：端口确实被抢占却未命中白名单]** → 后果是本次连接在该端口上多失败一次，随后仍受 `maxBindAttempts` 上界约束；若上界耗尽则连接失败并归类为隧道错误，与今日同类失败的表现一致。以「多一次注定失败的重试」换「不误漂移 origin」是 D2 明确接受的取舍。
- **[stderr 启发式误判：链路错误文本中恰好含端口占用特征（例如远端 banner 回显）]** → 命中条件要求与本地转发绑定直接相关的信号，并在可得时校验端口号一致；即便误判，后果也只是退化为今日行为（放弃首选端口），不会引入新的失败模式。
- **[远端可影响 stderr 内容]** → 归因结果只用于选择一个本地回环端口号，不进入 argv、不影响 host-key 校验、不改变任何安全边界；stderr 仍走既有 `maxStderrBytes` 上界与截断，不新增读取面。
- **[保留首选端口后，该端口在后续尝试中真的被别的设备占用]** → 每次尝试前的 `reserveCandidatePort` 都会实际 `listen` 验证，届时转为确定归因并按 D1 放弃该端口，不存在「带着一个已失效的端口反复重试」。
- **[新增日志泄漏敏感信息]** → 只记录 deviceId、两个端口号与归因分类标签；不记录 stderr 原文、不记录 SSH 别名之外的连接材料，符合 spec 既有的「MUST NOT 把密钥/口令暴露给模型或日志」。

## Migration Plan

无数据迁移：注册表 `localPort` 字段语义与写入路径均不变，既有记录无需转换。

回滚策略：改动集中在 `tunnel-manager.ts` 的端口选择分支、`ssh.ts` 的归因回报与两处日志；回退到按尝试序号决定首选端口即恢复今日行为，不留下任何持久化状态差异。

部署无特殊步骤：驾驶舱重启后新逻辑对既有设备立即生效；已发生漂移的设备在下一次成功连接后把当前端口持久化为首选端口，此后保持稳定。
