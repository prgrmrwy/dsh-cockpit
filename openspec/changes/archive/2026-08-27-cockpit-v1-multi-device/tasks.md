# Tasks: Cockpit V1

## 1. 项目骨架与工具链

- [x] 1.1 建立 pnpm workspace（`packages/cockpit-server`、`packages/cockpit-web`），根脚本 `build`/`dev`/`test`/`typecheck`/`lint`
- [x] 1.2 初始化 NestJS 后端（`cockpit-server`）：`@nestjs/core`、`@nestjs/websockets`、`@nestjs/platform-express`，TypeScript strict，`node --test` 或 Jest 任选其一作为测试
- [x] 1.3 初始化前端（`cockpit-web`）：Vite + React + TypeScript strict，shadcn/Base UI（按当前默认 Base UI），Tailwind
- [x] 1.4 添加共享类型包或约定（设备/状态/事件聚合类型），两端共用
- [x] 1.5 配置 lint/format（eslint + prettier）与 CI 基础（build/typecheck/test）

## 2. 连接层：设备注册（参考已提取资产由 ohmydsh committed `5060459` 提供的实现）

- [x] 2.1 实现 `NodeRegistry`：设备数据模型（deviceId、displayName、kind、sshAlias、remoteDshPort、localPort、enabled、order），原子持久化（tmp+rename、0600、父目录 0700、损坏 fail-closed 不覆盖）
- [x] 2.2 实现设备新增流程：先系统 OpenSSH 仅 BatchMode 非交互验证（`-N -T -o SessionType=none -o BatchMode=yes`），验证通过才写盘；失败不落盘
- [x] 2.3 实现 SSH tunnel 生命周期：本地候选端口 + bind 冲突有界重试、`-L 127.0.0.1:<local>:127.0.0.1:<remote>`、`BatchMode`、`ExitOnForwardFailure`、keepalive；argv 严格 `--` 边界防 alias 注入；stderr 有界采集与脱敏（不泄漏 home 路径/token/私钥）
- [x] 2.4 实现健康探测与状态分级：READY/CONNECTING/DEGRADED/SSH_UNREACHABLE/TUNNEL_ERROR/DSH_UNAVAILABLE/NON_DSH_SERVICE/INCOMPATIBLE
- [x] 2.5 实现 per-device 抖动退避重连（有上限，单设备故障不阻塞）
- [x] 2.6 实现可捕获信号终结性清理（SIGINT/SIGTERM 终止自有子进程、停止重连、无 `ppid=1` 孤儿；不误杀用户其他 SSH）
- [x] 2.7 实现设备删除：无未知写操作直接删除并清理连接；有未知写操作需显式确认；保留最小脱敏诊断（不含 rpcId/sessionId）
- [x] 2.8 实现设备启用/禁用与排序；禁用停止其连接与重连

## 3. 连接层：认证与存储

- [x] 3.1 本地服务仅监听 127.0.0.1；实现 token 认证（生成并持久化 token，前端请求附带；拒绝无 token 访问）
- [x] 3.2 实现配置与数据目录（`~/.dsh-cockpit/`），docs 到 README

## 4. 状态聚合

- [x] 4.1 设备 READY 后打开其 `/api/events.mux` 与 `/api/events.host` ws；实现优雅重连（指数退避）与旧 generation 丢弃
- [x] 4.2 实现基线拉取：一次 `session.list` 统计 running/待办；ws 增量更新（session-status、approval/question requested/resolved）
- [x] 4.3 实现 ws 重连后自动重查快照 + 手动刷新接口
- [x] 4.4 实现状态聚合模型（每设备：runningCount、pendingInteractionCount、状态、最后更新时间），对外暴露只读 API
- [x] 4.5 实现能力探测：`host.describe` 判定是否标准 DSH、版本；`session.search` 等可选用

## 5. 壳 UI（cockpit-web）

- [x] 5.1 实现顶栏：设备项（状态点 + 数字角标），左键切换、右键/长按菜单（重连、查看状态、编辑、移除）；menu 按钮
- [x] 5.2 实现全屏面板承载：设备管理（add/edit/order/remove）、设备总览、设置；面板完成后关闭回到常规态
- [x] 5.3 实现状态点语义：复用官方 session row 状态语义（有特殊状态才显示，多个并排；不发明动画/映射）
- [x] 5.4 实现数字角标：等待人决策/在跑数量展示
- [x] 5.5 实现启动行为：进入上次设备；首次显示总览
- [x] 5.6 实现设备管理面板交互：添加验证失败保留输入并提示；删除确认（未知写操作需显式确认）

## 6. 工作台承载

- [x] 6.1 实现工作台 iframe 懒加载 + 建了不销毁；保留输入/滚动/连接
- [x] 6.2 实现离线遮罩：保留 iframe，覆盖遮罩显示连接层原因 + 最后更新 + 重连；MUST NOT 伪装实时
- [x] 6.3 实现恢复：设备重连后撤销遮罩恢复工作台
- [x] 6.4 实现跨域独立性：状态聚合与工作台独立（父页面不依赖 iframe DOM）

## 7. 集成与验证

- [x] 7.1 端到端：真实 lumevm（或本机 + 一台远端）添加设备 → 隧道建 → READY → 顶栏显示 → 工作台加载 → 状态聚合收到事件
- [x] 7.2 故障注入：杀掉 ssh 子进程 → 重连 → 恢复；启动窗口 SIGTERM → 无孤儿
- [x] 7.3 内存基准：5 台设备（含 iframe 常驻）实测，对照设计 Risk R2
- [x] 7.4 文档：README（运行/数据目录/安全），OpenSpec 构建通过
- [x] 7.5 最终安全/兼容审查与验收报告
