## 1. 隧道管理支持一设备多通道

- [x] 1.1 在 `tunnel-manager.ts` 把 `#active` 与 `#generations` 的键由 `deviceId` 改为 `deviceId + channelId`，主通道使用保留的 `workbench` channelId
- [x] 1.2 `connect()` 接受 channelId 与目标设备端口（主通道沿用 `remoteDshPort`），`tunnelArgs()` 的 `-L` 远端端口改由参数决定，其余 OpenSSH 安全参数保持不变
- [x] 1.3 `disposeNode(deviceId)` 改为清理该设备**全部**通道；`disposeAll()` 与「shutDown 后不得再 spawn」的终结性保证在多通道下仍成立
- [x] 1.4 补单测：同设备并存主通道 + 2 条附加通道互不覆盖；`disposeNode` 清空全部；`disposeAll` 之后 `connect` 被拒
- [x] 1.5 回归：现有 tunnel-manager 与 device-lifecycle 测试全绿，主通道行为零变化（这是后续任务的前置条件）

## 2. 端口记录形状与向后兼容

- [x] 2.1 在 `packages/shared/src/index.ts` 扩展 `DeviceRecord`，使主通道端口语义明确，且旧的单数 `localPort` 在读取时被识别为主通道端口
- [x] 2.2 `storage/registry.ts` 的读路径兼容旧记录；迁移只读不写，不主动改写既有记录
- [x] 2.3 确认附加通道端口**不**写入注册表（按 design D3），并补一条测试断言它不被持久化
- [x] 2.4 补单测：只含单数 `localPort` 的旧记录读入后主通道端口稳定复用

## 3. 可发布端口的登记与准入

- [x] 3.1 定义设备侧登记的数据形状（channelId + devicePort），并在驾驶舱侧维护每设备白名单
- [x] 3.2 新增登记端点，沿用既有 capability 校验与 `Origin` 设备匹配；校验失败拒绝且不建立子进程
- [x] 3.3 实现「未登记端口一律拒绝」与稳定的结构化拒绝原因
- [x] 3.4 实现「同一 channelId 复用既有转发」，不建立第二条
- [x] 3.5 实现每设备附加通道数量上限，超限拒绝并给稳定原因（上限具体值见 design Open Questions）
- [x] 3.6 补单测：未登记拒绝、重复登记复用、超限拒绝、能力串无效拒绝

## 4. bridge 接缝 `cockpitBridge.portForward`

- [x] 4.1 在 `packages/dsh-cockpit-bridge/src/client/index.ts` 按 `editorOpen` 同一模式提供服务：立即 `ctx.provide`、不依赖加载顺序、不引用任何具体消费方
- [x] 4.2 实现句柄交付：绑定单个已登记端口，携带宿主机可直接访问的 URL；交付后消费方无需再查询
- [x] 4.3 实现能力不可用的稳定表达：握手未完成 / 本机设备 / 端口未登记 / 转发失败，均使消费方可确定性回落本机行为
- [x] 4.4 补单测：服务在握手前后均可被发现；四类不可用路径各自返回稳定原因；本机设备不建立转发

## 5. 故障域隔离与生命周期

- [x] 5.1 确认附加通道建立失败或断开 MUST NOT 改变设备状态分级、MUST NOT 触发工作台重连
- [x] 5.2 设备禁用/删除路径清理全部附加通道，并清除其仅代表活跃连接的事实
- [x] 5.3 SIGINT/SIGTERM 路径在多通道下仍在有界时间内清理完毕，不遗留 `ppid=1` 孤儿，不依赖 SIGKILL
- [x] 5.4 补单测：附加通道断开时设备状态与主通道 endpoint 不变；禁用设备后全部通道消失

## 6. 文档、发布与验收

- [x] 6.1 更新 `README.md` 桥接插件章节：新增 `cockpitBridge.portForward` 的契约描述与「不是通用隧道」的边界说明
- [x] 6.2 在 `BACKLOG.md` 中标注「不得把 bridge 当作通用写隧道」这条约束与本 change 的关系（本 change 以「登记白名单 + 绑定端口句柄」满足该约束，而非豁免它）
- [x] 6.3 运行仓库既有检查（lint / typecheck / 单测）并记录实际执行的命令与结果
- [ ] 6.4 真机验收：远端设备上登记一个回环服务端口，从设备工作台触发发布，宿主机浏览器经交付的 URL 可访问该服务
- [ ] 6.5 真机验收（降级）：本机设备、未登记端口、bridge 未安装三种情形下消费方均确定性回落，工作台其它功能正常
- [ ] 6.6 发布新版本 `dsh-cockpit-bridge`，并在 ohmydsh 侧更新精确 pin
- [ ] 6.7 确认 current specs 已同步最终行为后归档 change
