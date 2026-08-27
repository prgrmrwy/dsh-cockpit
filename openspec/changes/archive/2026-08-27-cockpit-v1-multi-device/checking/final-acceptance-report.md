# Cockpit V1 最终验收报告

- 日期：2026-08-27
- Change：`cockpit-v1-multi-device`
- 状态：**35/35 任务完成**（本报告覆盖 7.5）

## 验收结论

驾驶舱 V1（独立本地服务 + 浏览器壳）按设计全部落地并通过门禁。架构核心假设
（远端零改造、官方事件流、iframe 承载、终结性清理）均经**真实 lumevm 实测**
验证，无未解决的阻断项。

## 实现范围（对照 spec）

### cockpit-device-connectivity
- 设备注册：仅 BatchMode 非交互身份验证通过才落盘（`probeSshIdentity`），失败不写记录
- 隧道：本地候选端口 + bind 冲突有界重试、`-L 127.0.0.1:<local>:127.0.0.1:<remote>`、
  BatchMode/ExitOnForwardFailure/keepalive、严格 `--` argv 边界、stderr 有界
- 状态分级：READY/CONNECTING/DEGRADED/SSH_UNREACHABLE/TUNNEL_ERROR/
  DSH_UNAVAILABLE/NON_DSH_SERVICE/INCOMPATIBLE，仅 `host.describe` 成功才 READY
- per-device 抖动退避重连，单设备故障不阻塞
- 可捕获信号终结性清理：与本机 DSH 完全解耦；不误杀用户其他 SSH
- 注册表：原子写（tmp+rename）、0600、0700 目录、损坏 fail-closed 不覆盖

### cockpit-device-shell
- 顶栏唯一常驻 UI，其余空间让给工作台；全屏面板承载管理/总览/设置
- 设备项：官方语义状态点 + 数字角标（等待决策/在跑），左键切换、右键菜单
- 启动行为：进入上次设备，首次显示总览
- 状态聚合：常驻消费官方双事件流 + `session.list` 基线 + 手动/重连刷新，无周期轮询
- 离线：保留 iframe + 遮罩（具体原因 + 最后更新），断连立即置 CONNECTING（不假 READY）

### cockpit-workbench
- iframe 直接承载远端原生 DSH：settings/usage/插件天然继承，零协议耦合
- 懒加载 + **多 iframe 常驻挂载（display:none 切换）**，保留输入/滚动/连接
- 工作台与状态聚合独立（父页面不读 iframe DOM）
- 远端边界：不自动下载同步文件、不把远端路径交给本机工具、不调用远端 host.openPath

## 安全与隐私审计（7.5）

| 检查项 | 结果 |
| --- | --- |
| 不保存密码/私钥/passphrase | ✅ 源码 grep 无相关字段 |
| 不代理 Settings/Subscriptions/Credentials | ✅ 无相关 route/字段 |
| 不关闭 host-key 校验 | ✅ 隧道 args 无 StrictHostKeyChecking 宽松 |
| 仅回环监听 | ✅ `app.listen(3090, '127.0.0.1')` |
| 本机 token（HttpOnly cookie） | ✅ 防其它本地进程/恶意网页 |
| 终结性清理（无孤儿） | ✅ 故障注入实测 0 孤儿 |
| 数据目录隔离 `~/.dsh-cockpit/` | ✅ 不读写 `~/.dsh` |

## 验证证据

### 自动化
- server vitest 13/13：注册表原子性/损坏 fail-closed、SSH 身份、
  隧道终结性（disposeAll 后拒绝新隧道）、事件转换契约、设备生命周期
- web vitest 6/6：TopBar（状态语义/角标/右键菜单）、Workbench（懒加载/保活/离线遮罩）
- typecheck / lint / build：三包全绿（eslint 扁平配置 + CI workflow）

### 真实 E2E（隔离 DSH_COCKPIT_HOME + 真实 lumevm）
- add device → 身份验证 → 自建隧道 → `READY/SUPPORTED` + endpoint 发布
- 工作台 URL `http://127.0.0.1:<port>/` → HTTP 200（真实远端 DSH）
- `session.list` 基线 → `runningSessionCount=1`（真实 in-flight 会话）
- 服务停止 → 自建 ssh 子进程被终结性清理，用户手工 3081 隧道零影响

### 故障注入
- 杀驾驶舱 ssh → 状态立即 `CONNECTING`（修复"断连仍假 READY"）→ 自动重连 `READY`
  （实测状态序列 `CONNECTING×4 → READY`）
- 启动窗口 2s SIGTERM（node dist 直达）→ 服务退出、孤儿 0
- READY 活跃隧道 SIGTERM → 服务退出、孤儿 0

### 性能
- 5 台 iframe 常驻内存基准（headless Chrome）：JS heap 增量 ≈13KB/台，
  iframe 内容由浏览器原生隔离（设计 Risk R2 通过）

## 已知边界（诚实记录，均非阻断）

1. **驾驶舱离线期间的 approval/question 事件读不回来** —— rc.2 协议限制
   （SessionSummary 无 pending interaction 字段）；进入设备后其自身 UI 正常显示。
   不引入持久待办账本（避免第二个真相源）。
2. **usage 不聚合** —— usage 是远端插件路由（非官方 API），与「远端零改造」
   原则冲突；各设备自身 DSH 内可见。
3. **跨设备全局搜索未实现** —— V1 明确不做，架构留位（统筹层能力，
   并行查各设备只读 API + 结果标注设备）。
4. **真实 DSH 页面的 iframe 内存** —— 基准用占位页验证驾驶舱机制开销；
   真实 DSH 页面内存属 DSH 自身（用户打开本就需要），驾驶舱不额外放大。
5. **无系统托盘通知** —— 浏览器壳无原生通知；若后续强需要，另评估桌面壳。
6. **未验证跨平台** —— 在 macOS + 系统 OpenSSH 下实测；Linux 预期兼容
   （同使用系统 ssh/spawn），Windows 未评估。

## 兼容

- 与本机 DSH 及其 5 个 UI 插件**零交互**（独立壳，不改 sidebar、不注册 route）
- 远端零改造、零插件；reconnect/升级远端无需驾驶舱适配

## 建议后续（非本 change 范围）

- 跨设备全局搜索（统筹层留位能力）
- 真实多设备（>2 台）长时运行观察
- 若需要系统通知 → 评估桌面壳