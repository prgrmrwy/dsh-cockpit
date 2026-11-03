## Test Plan

每个 scenario 一条测试，测试名即 `scenario: <场景名>`（vitest `it` 标题），便于按名称核对。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 驾驶舱服务端请求被受理 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 驾驶舱服务端请求被受理` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 已认证的同源浏览器页面被拒 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 已认证的同源浏览器页面被拒` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 官方防护拒绝时不改变状态 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 官方防护拒绝时不改变状态` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 超大请求在读取中被截断 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 超大请求在读取中被截断` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 错误方法被拒 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 错误方法被拒` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 读取请求体期间被取代 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 读取请求体期间被取代` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | Host 重启后旧租约得到 no-lease | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: Host 重启后旧租约得到 no-lease` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 中继插件是可选的设备侧 Host 插件，只接受经 DSH 认证的非浏览器调用 | 只注册五个路由 | packages/dsh-cockpit-relay/tests/routes.test.ts | `scenario: 只注册五个路由` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 握手建立租约与协议版本，旧租约的一切操作被拒 | 握手返回租约 | packages/dsh-cockpit-relay/tests/handshake.test.ts | `scenario: 握手返回租约` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 握手建立租约与协议版本，旧租约的一切操作被拒 | 新握手使旧租约的迟到操作失效 | packages/dsh-cockpit-relay/tests/handshake.test.ts | `scenario: 新握手使旧租约的迟到操作失效` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 握手建立租约与协议版本，旧租约的一切操作被拒 | 身份变化丢弃旧身份的出站信封 | packages/dsh-cockpit-relay/tests/handshake.test.ts | `scenario: 身份变化丢弃旧身份的出站信封` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 握手建立租约与协议版本，旧租约的一切操作被拒 | 协议版本不符 | packages/dsh-cockpit-relay/tests/handshake.test.ts | `scenario: 协议版本不符` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 出站信封在内存中排队，按订阅重放并按 msgId 确认 | 重新订阅时重放未确认信封 | packages/dsh-cockpit-relay/tests/outbox.test.ts | `scenario: 重新订阅时重放未确认信封` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 出站信封在内存中排队，按订阅重放并按 msgId 确认 | 过期信封不发送 | packages/dsh-cockpit-relay/tests/outbox.test.ts | `scenario: 过期信封不发送` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 出站信封在内存中排队，按订阅重放并按 msgId 确认 | 慢订阅者被断开而信封保留 | packages/dsh-cockpit-relay/tests/outbox.test.ts | `scenario: 慢订阅者被断开而信封保留` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 出站信封在内存中排队，按订阅重放并按 msgId 确认 | outbox 满时拒绝入队 | packages/dsh-cockpit-relay/tests/outbox.test.ts | `scenario: outbox 满时拒绝入队` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 首次投递被受理并调用处理器 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 首次投递被受理并调用处理器` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 并发的同一信封只调用一次处理器 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 并发的同一信封只调用一次处理器` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 处理器失败不导致重投 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 处理器失败不导致重投` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 去重窗口过期后可再次受理 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 去重窗口过期后可再次受理` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 插件重载后已受理集合清空 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 插件重载后已受理集合清空` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 受理后 Host 在调用前退出则调用丢失 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 受理后 Host 在调用前退出则调用丢失` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 无处理器或繁忙时确定未调用 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 无处理器或繁忙时确定未调用` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 处理器容量满时返回 busy | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 处理器容量满时返回 busy` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 入站信封单飞去重后异步交给唯一处理器 | 目标不是本机时拒绝 | packages/dsh-cockpit-relay/tests/deliver.test.ts | `scenario: 目标不是本机时拒绝` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 目录快照按 revision 单调接收 | 新快照替换旧快照 | packages/dsh-cockpit-relay/tests/directory.test.ts | `scenario: 新快照替换旧快照` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 目录快照按 revision 单调接收 | 乱序的旧快照被忽略 | packages/dsh-cockpit-relay/tests/directory.test.ts | `scenario: 乱序的旧快照被忽略` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 目录快照按 revision 单调接收 | 超出规模的快照被拒 | packages/dsh-cockpit-relay/tests/directory.test.ts | `scenario: 超出规模的快照被拒` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 进程内服务 `cockpitRelay` 契约 | 未握手时 send 失败 | packages/dsh-cockpit-relay/tests/service.test.ts | `scenario: 未握手时 send 失败` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 进程内服务 `cockpitRelay` 契约 | 同 msgId 重复 send 幂等，内容不同则冲突 | packages/dsh-cockpit-relay/tests/service.test.ts | `scenario: 同 msgId 重复 send 幂等，内容不同则冲突` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 进程内服务 `cockpitRelay` 契约 | 保留字符与超长 msgId 被拒 | packages/dsh-cockpit-relay/tests/service.test.ts | `scenario: 保留字符与超长 msgId 被拒` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 进程内服务 `cockpitRelay` 契约 | 超大 body 被拒 | packages/dsh-cockpit-relay/tests/service.test.ts | `scenario: 超大 body 被拒` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 进程内服务 `cockpitRelay` 契约 | 契约版本可探测 | packages/dsh-cockpit-relay/tests/service.test.ts | `scenario: 契约版本可探测` | 🔴 red |
| specs/cockpit-relay-device-plugin/spec.md → 进程内服务 `cockpitRelay` 契约 | 第二个处理器被拒 | packages/dsh-cockpit-relay/tests/service.test.ts | `scenario: 第二个处理器被拒` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 装有插件的设备接入 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 装有插件的设备接入` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 未装插件的设备不被反复探测 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 未装插件的设备不被反复探测` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 被取代后不再自动抢回 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 被取代后不再自动抢回` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 静默断开的订阅先用原租约恢复 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 静默断开的订阅先用原租约恢复` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 插件重启后自动重新握手 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 插件重启后自动重新握手` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 旧代际的迟到握手结果不生效 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 旧代际的迟到握手结果不生效` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 退出时在途控制请求被中止 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 退出时在途控制请求被中止` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 挂起的控制请求按截止失败 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 挂起的控制请求按截止失败` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继接入在设备 READY 或 DEGRADED 后由驾驶舱发起，并复用该设备现有认证 | 中继失败不影响设备状态 | packages/cockpit-server/tests/relay/access.test.ts | `scenario: 中继失败不影响设备状态` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 正常投递并确认 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 正常投递并确认` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 重放的已处理信封不重复投递 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 重放的已处理信封不重复投递` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 不合规信封被丢弃 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 不合规信封被丢弃` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 无法解析的帧使订阅进入退避 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 无法解析的帧使订阅进入退避` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 静默断流被识别 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 静默断流被识别` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 未结束的超长帧被截断 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 未结束的超长帧被截断` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 驾驶舱订阅 outbox，盖章 origin 后尽力投递，并按 msgId 确认 | 去重窗口过后同一 msgId 被重新投递 | packages/cockpit-server/tests/relay/forwarding.test.ts | `scenario: 去重窗口过后同一 msgId 被重新投递` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 目标未接入时回 not-connected | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 目标未接入时回 not-connected` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 设备伪造的 relay 标记被删除 | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 设备伪造的 relay 标记被删除` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 不合格式的 deviceId 不参与中继 | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 不合格式的 deviceId 不参与中继` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 发给自己 | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 发给自己` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 超时时不生成回执 | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 超时时不生成回执` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 目标繁忙时回 busy | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 目标繁忙时回 busy` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 只有确定未投递时驾驶舱才代为生成回执 | 回执不可投递时不再生成回执 | packages/cockpit-server/tests/relay/receipts.test.ts | `scenario: 回执不可投递时不再生成回执` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 归档会话从目录消失 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 归档会话从目录消失` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 子会话不进入目录 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 子会话不进入目录` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 新建会话在手动刷新后出现 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 新建会话在手动刷新后出现` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 设备离线时 presence 变化且保留会话 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 设备离线时 presence 变化且保留会话` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 推送失败后重试最新快照 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 推送失败后重试最新快照` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 超出规模时确定地裁剪并标记 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 超出规模时确定地裁剪并标记` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 字节超限时按确定顺序删减并在缩小后恢复 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 字节超限时按确定顺序删减并在缩小后恢复` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 元数据被省略时标记 truncated | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 元数据被省略时标记 truncated` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 超过 64 台设备时保留可达者 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 超过 64 台设备时保留可达者` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 设备会话目录快照 | 无变化不推送 | packages/cockpit-server/tests/relay/directory.test.ts | `scenario: 无变化不推送` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继不进入驾驶舱的入站 API 与持久化 | 驾驶舱 API 面不变 | packages/cockpit-server/tests/relay/boundary.test.ts | `scenario: 驾驶舱 API 面不变` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继不进入驾驶舱的入站 API 与持久化 | 不写持久文件 | packages/cockpit-server/tests/relay/boundary.test.ts | `scenario: 不写持久文件` | 🔴 red |
| specs/cockpit-session-relay/spec.md → 中继不进入驾驶舱的入站 API 与持久化 | 退出时停止中继 | packages/cockpit-server/tests/relay/boundary.test.ts | `scenario: 退出时停止中继` | 🔴 red |
| specs/cockpit-device-shell/spec.md → 状态聚合读取官方只读接口与事件流 | 中继例外不新增轮询 | packages/cockpit-server/tests/relay/aggregation-exception.test.ts | `scenario: 中继例外不新增轮询` | 🔴 red |
| specs/cockpit-device-shell/spec.md → 状态聚合读取官方只读接口与事件流 | 设备打开后状态变化 | packages/cockpit-server/tests/relay/aggregation-exception.test.ts | `scenario: 设备打开后状态变化` | 🔴 red |
| specs/cockpit-device-shell/spec.md → 状态聚合读取官方只读接口与事件流 | ws 重连 | packages/cockpit-server/tests/relay/aggregation-exception.test.ts | `scenario: ws 重连` | 🔴 red |
| specs/cockpit-device-shell/spec.md → 状态聚合读取官方只读接口与事件流 | 基线请求期间的完成边缘 | packages/cockpit-server/tests/relay/aggregation-exception.test.ts | `scenario: 基线请求期间的完成边缘` | 🔴 red |
| specs/cockpit-device-shell/spec.md → 状态聚合读取官方只读接口与事件流 | 陈旧基线不覆盖新事件 | packages/cockpit-server/tests/relay/aggregation-exception.test.ts | `scenario: 陈旧基线不覆盖新事件` | 🔴 red |
| specs/cockpit-device-shell/spec.md → 状态聚合读取官方只读接口与事件流 | 归档集合重连纠正 | packages/cockpit-server/tests/relay/aggregation-exception.test.ts | `scenario: 归档集合重连纠正` | 🔴 red |
| specs/cockpit-workbench/spec.md → bridge 是唯一跨边界通信切面 | 不新增第二条跨文档通道 | packages/cockpit-server/tests/relay/workbench-boundary.test.ts | `scenario: 不新增第二条跨文档通道` | 🔴 red |
| specs/cockpit-workbench/spec.md → bridge 是唯一跨边界通信切面 | 能力不绑定具体消费方 | packages/cockpit-server/tests/relay/workbench-boundary.test.ts | `scenario: 能力不绑定具体消费方` | 🔴 red |
| specs/cockpit-workbench/spec.md → bridge 是唯一跨边界通信切面 | 服务契约封闭 | packages/cockpit-server/tests/relay/workbench-boundary.test.ts | `scenario: 服务契约封闭` | 🔴 red |
| specs/cockpit-workbench/spec.md → bridge 是唯一跨边界通信切面 | 不新增远端执行面 | packages/cockpit-server/tests/relay/workbench-boundary.test.ts | `scenario: 不新增远端执行面` | 🔴 red |
| specs/cockpit-workbench/spec.md → bridge 是唯一跨边界通信切面 | 接缝故障不影响工作台 | packages/cockpit-server/tests/relay/workbench-boundary.test.ts | `scenario: 接缝故障不影响工作台` | 🔴 red |
| specs/cockpit-workbench/spec.md → bridge 是唯一跨边界通信切面 | 中继不经过设备页面 | packages/cockpit-server/tests/relay/workbench-boundary.test.ts | `scenario: 中继不经过设备页面` | 🔴 red |

## Coverage Notes

- 共 82 个 scenario，全部映射为可执行测试，没有 `N/A — non-executable` 行。
- **插件测试夹具**（`packages/dsh-cockpit-relay/tests/support/`）：假 `webServer`（记录注册路由，按 method+path 分发）、可控 `connection.requestRejection`、可流式写入的假请求体（用于读取中被取代、超长、超时）、可暂停的假 SSE 响应（用于慢订阅者与待写缓冲）、注入的测试时钟（10 分钟窗口、过期、心跳）。
- **崩溃场景**「受理后 Host 在调用前退出则调用丢失」用真实子进程：`child_process.fork` 一个最小 Host 运行插件，处理器写标记文件，测试在收到 `accepted` 后 SIGKILL 子进程并断言标记不存在，再重启子进程断言已受理集合为空。
- **驾驶舱测试夹具**（`packages/cockpit-server/tests/relay/support/`）：内存版设备插件（实现五个端点、租约、outbox 与回执语义，可注入 404/409/500/挂起/超长帧/静默断流），配合现有 `DeviceLifecycle` 测试替身驱动 READY/DEGRADED/主通道替换；测试时钟与固定抖动用于退避与 500ms 合并窗口；HTTP 请求记录器用于"不轮询"与"API 面不变"断言；文件写入插桩包装 `node:fs/promises` 写入函数用于"不写持久文件"。
- 「驾驶舱 API 面不变」以本 change 引入前的路由集合快照（由现有 Nest 应用枚举）为基线比较。
- 「中继例外不新增轮询」「中继不经过设备页面」放在 cockpit-server 测试中，用 HTTP 请求记录器与父页面 postMessage 计数（对 bridge 能力串头的断言在请求记录上完成）。
- 额外的端到端契约夹具（不占用 scenario 行）：两个内存插件 + 真实驾驶舱中继，跑一次 A→B→A（wake 后 B 回 reply）与一次 B 无消费方得到 `relay:true` 的 `no-consumer` 回执，固定 `contractVersion: 1`、`protocol: 1`、`undeliverable:` 前缀与 JSON 语义相等，作为与 ohmydsh collab-cockpit shim 的跨仓契约回归。
