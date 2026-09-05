## Context

见 `proposal.md`。当前 `DeviceRecord` 只持久化 `dshLaunchToken`；`createDeviceProtocol()` 每次建立连接代都会先请求根路径，遇到标准 401 后无条件用该 token换取一个仅存在于当前协议对象内存中的 cookie。因 launch token由 DSH process owner生成，每次进程启动变化；cookie签名 secret则由 DSH credential provider持久化，cookie默认 30 天、绑定 authority，普通 DSH 重启后仍可验证。

Workbench 目前仅在 iframe首次 mount时请求一次 tokenized root。已创建 iframe在设备重连时会把 URL覆盖为公开 endpoint，因此服务端即使恢复了认证，浏览器也没有显式的认证代信号来再次交换。

ohmydsh 后台启动固定把 DSH stdout/stderr追加到 `$DSH_HOME/dsh.log`；官方 Web app会输出带当前 process launch token的 URL。用户已明确选择允许 Cockpit 通过受控 SSH 静默发现该 token。本设计因此有意修订原有“绝不读 DSH 日志、cookie只在连接代内存中”的边界，但保持按设备授权、最小路径、只读、BatchMode、有界和严格脱敏。

## Goals / Non-Goals

**Goals:**

- 普通 `dsh restart` 优先靠仍有效的 signed cookie恢复，不依赖已失效 launch token。
- cookie失效时，先复用已有 token；仍失败且设备已授权时才读取 ohmydsh标准日志发现当前 token。
- server认证恢复与 iframe浏览器 cookie恢复通过显式认证代协调，不轮询、不读 iframe cookie。
- UI能说明“配过没有、现在是否需更新、自动恢复是否开启”，同时保持 secret写后不回显。
- 自动发现命令和解析器可独立测试，输出、异常与日志全程脱敏。

**Non-Goals:**

- 不读取或解析 DSH `.credentials.yaml`，不复制签名 secret，不伪造 cookie。
- 不建立通用远端命令执行器、日志浏览器、凭据管理器或 provider token同步。
- 不保证任意启动器/任意日志路径的自动发现；只支持声明的 ohmydsh日志契约。
- 不改变 rc.2 协议、不安装远端插件、不让 bridge参与认证。
- 不处理 Cockpit 自身 `cockpit_token` cookie；该 cookie当前已由 `/api/bootstrap`无条件重新签发，API 401也会携带新的 Set-Cookie。

## Decisions

### D1：认证材料成为带版本的设备私有子记录，而不是继续扩散平铺字段

注册表为每台设备保存私有 `dshAuth` 子记录，概念字段包括：

- `launchToken?`
- `serverCookie?`，同时保存从签名 payload安全解出的 `authority` 与 `expiresAt`
- `autoDiscovery: 'disabled' | 'ohmydsh-log'`
- `updatedAt` 与单调递增 `generation`

公开投影只派生 `configured: boolean`、`state: 'not-configured' | 'ready' | 'recovery-required'`、`autoDiscoveryEnabled`、`expiresAt?` 和 `generation`。不公开 cookie name/value、token长度/hash或日志路径。旧 `dshLaunchToken` 在首次加载时内存迁移到子记录，下一次 registry写入时按新 schema原子落盘；回滚版本仍可通过保留兼容读取在一个发布周期内工作。

选择持久化 cookie而不是仅在内存缓存，是因为 DSH将它设计为跨进程、绝对有效期的浏览器会话。Cockpit当前已持久化能换取同等 cookie的 launch token，0600注册表的保密等级不变；新增风险通过不出 API、到期删除与清除入口控制。

### D2：连接认证采用 cookie → stored token → authorized discovery 的单向恢复链

每个连接代在分类出标准 DSH认证挑战后按顺序执行：

1. 若存在 authority匹配且未到期的 cookie，直接用它调用最小 `session/list` probe；成功即建立 typert client/stream。
2. cookie被 401拒绝或到期时将其从有效候选移除；若有 stored token，执行官方 exchange，验证 303、Location与 `dsh-auth-*` Set-Cookie，再以新 cookie probe。
3. token exchange失败且启用了 `ohmydsh-log`时，调用 discovery；只有发现 token与 stored token不同或当前没有 token时才交换，成功后把新 token/cookie/generation一次原子提交。
4. 全部失败时发布 `recovery-required`，进入现有退避但 discovery也受独立冷却限制，避免每轮重连都 SSH/读日志。

非 401协议错误、非标准认证 challenge、403 trust拒绝、网络错误均不得触发 token发现。这样不会把普通故障转成凭据读取。

### D3：ohmydsh discovery 是封闭适配器，不接受任意命令或路径

本机适配器直接读取由启动契约声明的 `${DSH_HOME:-$HOME/.dsh}/dsh.log`；远端适配器通过现有系统 OpenSSH二进制和设备 `sshAlias`执行固定 argv，继承现有 BatchMode、host key、known_hosts、Agent与超时原则。远端 shell片段只做：确定 `DSH_HOME`默认值、读取固定 basename `dsh.log`的有界尾部并输出；不接受来自 API的路径、命令或 pattern。

为避免日志无限增长，读取器限制最大字节数/行数；解析器从后向前查找严格 URL，复用 `parseDshLaunchUrl(value, remoteDshPort)`校验 `http://127.0.0.1:<registered-port>/?token=<base64url>`。完整 stdout仅在函数局部内存存在，成功只返回 token，失败返回枚举原因。任何 logger、诊断和错误映射只记录原因码，不附 cause中可能含命令输出的 message。

自动发现默认关闭。API只允许布尔/枚举开关，不能配置自定义日志路径或 SSH命令。此限制牺牲任意 supervisor兼容性，换取可审计的最小权限。

### D4：认证材料写入采用连接代 fence，防止旧重连覆盖新 token

Discovery与 exchange可能和用户手工更新、禁用设备、另一轮重连并发。开始恢复时捕获 device record revision和 lifecycle generation；提交前重新读取并比较。若用户已保存新 URL、关闭自动恢复、禁用/删除设备或新连接代已经胜出，则丢弃旧结果，不写盘。registry仍复用现有单写序列与原子 rename。

手工提供新 URL优先级最高：立即清除旧 cookie，增加 auth generation并重建 lifecycle。显式清除同时清除 token、cookie和运行时协议对象，但保留用户对 autoDiscovery开关的选择，便于“清掉旧材料后自动重新发现”；UI文案需明确这一点。

### D5：Workbench以公开 auth generation触发一次性浏览器重认证

`workbench-launch` 返回 tokenized URL时同时返回当前 auth generation；公开设备事实只含 generation，不含 URL。每个 mounted frame记录最后成功/尝试的 generation和endpoint origin：

- 首次 mount照常请求 launch。
- 同一 frame看到更高 generation且设备为 READY/DEGRADED时，再请求一次 launch并导航 tokenized root。
- `onLoad`继续清理 React state中的 query；真实浏览器由 DSH 303使地址回到 `/`。
- 每个 `(deviceId, origin, generation)`至多自动导航一次。连接代变化或失败不会循环；下一次真正更高 generation才重试。

仅服务端 cookie复用成功而浏览器旧 cookie仍有效时无需 bump generation；新 exchange或新发现成功时 bump，从而让 server与iframe各自获得同一 DSH process可接受的会话。

### D6：状态是事实投影，不以输入框是否为空推断

公开认证状态由 registry材料和最近一次权威认证结果合成：

- `not-configured`：无 token且无 cookie；
- `ready`：存在尚未到期的 cookie且最近 probe成功，或存在材料但设备当前不需要认证/尚未判定；
- `recovery-required`：标准认证挑战下所有允许恢复路径已失败。

UI在卡片和编辑区域显示状态徽标/说明。输入框始终为空；placeholder不再承担状态表达。清除采用显式 checkbox/button并在 submit中发送 `clearDshLaunchToken`（实际语义扩展为清除全部 DSH auth material）。若用户同时输入新 URL与清除，前后端继续拒绝冲突请求。

## Risks / Trade-offs

- **[日志含 secret，读取扩大权限面]** → 默认关闭、逐设备显式授权、固定单文件、固定命令、有限尾部、严格解析、输出不落日志；文档明确边界变化。
- **[ohmydsh输出格式变化导致发现失效]** → 复用官方 URL解析器并 fail closed；保留人工粘贴，不尝试启发式全盘搜索。
- **[持久 cookie泄露后可在本机 endpoint复用]** → registry维持 0600/原子存储，不进入 API/SSE/日志；过期和清除时删除。其风险与当前持久 launch token同级，但暴露窗口可能更长。
- **[远端 SSH命令被 alias或参数注入]** → 复用现有 SSH argv builder与严格 `--`边界；用户输入不进入远端脚本，只使用已验证 alias和固定脚本。
- **[日志尾部截断恰好切断 URL]** → 按完整行/严格正则解析；找不到则人工恢复，不拼接猜测。
- **[server恢复但 iframe仍401]** → auth generation驱动一次性 reauth；失败有遮罩且无刷新环。
- **[多连接代竞态写回旧 token]** → record revision + lifecycle generation fence，用户手工更新始终胜出。

## Migration Plan

1. 先增加向后兼容的 registry读取与公开状态字段默认值；旧记录只含 `dshLaunchToken`时迁移为 `dshAuth.launchToken`，自动发现默认关闭。
2. 上线 cookie优先连接链但暂不启用 discovery；验证普通 DSH重启可依靠旧 cookie恢复。
3. 上线本机/SSH ohmydsh适配器、UI开关与 iframe auth generation恢复。
4. 对现有设备不自动扩大权限；用户需在设备编辑中逐台开启自动恢复。
5. 回滚时新版 registry应保留旧字段兼容镜像一个版本窗口，或提供一次性降级迁移；任何无法识别的私有 auth结构必须 fail closed且不得覆盖原文件。

## Open Questions

- 实现 spike需钉死 DSH 0.1.2实际启动 URL输出所在行及最大合理长度，并据此选择尾部字节上限；该数值只影响实现常量，不改变固定日志来源与行为契约。
