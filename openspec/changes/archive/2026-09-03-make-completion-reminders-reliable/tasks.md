## 1. 完成提醒状态机与归档事实

- [x] 1.1 将服务端每会话的 `prevRunning`/`completed` 裸集合重构为易失 generation 状态，保持首次 idle 基线不提醒、子代理排除和新一轮重新点亮语义。
- [x] 1.2 实现按会话打开确认与完成边缘的双向乱序收敛，覆盖 ack-before-edge、edge-before-ack、当前选中会话完成和下一轮 re-arm。
- [x] 1.3 扩展共享事件契约及 rc.2 转换器以消费完整 `host/archived-sessions-changed` 集合，并区分归档/恢复与权威 `host/session-removed`。
- [x] 1.4 实现归档即清除该会话当前提醒、恢复不生成新完成边缘、永久删除清理全部会话协调状态；旧设备无归档事件时不从列表缺席推导删除。
- [x] 1.5 为状态机增加单元测试，覆盖多个会话独立确认、归档/恢复、临时基线缺席、永久删除、重连基线与子代理场景。

## 2. Bridge 协议、端口与认证

- [x] 2.1 设计并实现 bridge 专用短期 capability 的签发与验证，绑定设备 Origin、用途和过期时间，拒绝伪造、过期、错设备和禁用设备请求，且不向插件暴露持久 HttpOnly token。
- [x] 2.2 扩展父页面到 iframe 的握手消息，使用精确设备 target origin 传递实际 Cockpit origin 与短期 capability，并在 iframe load、设备 activation 和 capability 刷新时重发。
- [x] 2.3 更新 bridge hello/selection/ack 请求契约与服务端 controller/service：支持协议版本、当前 selection（含 cleared）和明确成功响应，同时为旧版 `{sessionId}` 请求保留兼容路径并标记 legacy。
- [x] 2.4 移除 bridge 对固定 `127.0.0.1:3090` 和跨端口 `SameSite=Strict` cookie 的依赖，验证默认端口与 `COCKPIT_PORT` 非默认端口均使用实际 Cockpit origin。
- [x] 2.5 增加服务端及 Web 安全测试，覆盖 capability 生命周期、Origin 匹配、CORS/header、父消息 source/origin 校验、配置端口和不支持配置的明确降级。

## 3. Bridge 无损确认与失败恢复

- [x] 3.1 在 selection 变化回调中立即捕获当时的 session ID；将 250ms trailing 覆盖改为按 ID 去重的有界 outbox，使快速 A→B→C 全部可交付。
- [x] 3.2 处理 `current: undefined` 的 selection-cleared 上报与同值闩重置，确保打开后立即归档不丢已捕获 ID、恢复相同 ID 可再次确认。
- [x] 3.3 只在成功响应后移除 outbox 项；为网络异常、401 和其它非成功 HTTP 响应实现单飞、有上限退避的静默重试，并由新选择、activation 和成功 hello 触发恢复。
- [x] 3.4 为 outbox 实现固定容量/TTL 与“当前及最近选择优先”的淘汰规则，避免 Cockpit 长期不可达时无界增长。
- [x] 3.5 扩充 bridge 测试，覆盖快速多选无损、archive-before-flush、失败后同 current 重试、非 401 错误、selection cleared、activation 重申、outbox 上限及 DSH 页面不受失败影响。

## 4. Device Tab 人工兜底与健康呈现

- [x] 4.1 恢复设备级 clear-all API，并使用 generation 确认语义使重复调用幂等且能抵抗随后到达的同轮 idle frame；通过 SSE 发布更新。
- [x] 4.2 重构 TopBar 设备项为无嵌套交互的 tab 主控件与 completed 清除控件，保持现有视觉布局、主题、右键菜单与焦点提示。
- [x] 4.3 将 completed 控件接入 clear-all API，提供明确 title/可访问名称，阻止误切设备；approval、question 和 running chip 保持纯展示。
- [x] 4.4 按 bridge 协议版本、最近成功 hello/ack 和活跃期限区分可靠、legacy、过期、缺失状态；activation 后即时刷新，且不新增周期网络轮询。
- [x] 4.5 增加 Web/服务端测试，覆盖鼠标和键盘清除、不冒泡、多状态互不影响、ack-before-edge、legacy/过期提示和未安装 bridge 时人工兜底。

## 5. 文档、发布与验证

- [x] 5.1 更新 `README.md`、`README.en.md` 与 bridge README，说明完成提醒轮次语义、归档即处置、人工清除、可靠/legacy bridge、动态端口与认证边界。
- [x] 5.2 递增 bridge 包及协议版本，重新构建并检查发布物包含 host/client 入口、source map 和 cordis patch；记录设备侧升级与重启 DSH Web 步骤。
- [x] 5.3 运行 `pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`，并单独核对 server、web、bridge 新增竞态测试结果。
- [x] 5.4 在默认端口和一个非默认 `COCKPIT_PORT` 上做浏览器验收：完成→打开、打开→迟到完成、打开后立即归档/恢复、快速多选、bridge 断开恢复、人工清除及未装 bridge 降级。
- [x] 5.5 更新本 tasks 的实际完成状态和验证证据；所有行为与规范一致后使用 OpenSpec archive 流程收口。
