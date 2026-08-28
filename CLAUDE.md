# dsh-cockpit 仓库指南

## 项目内涵

本仓库是**多设备 DeepSeek Harness（DSH）驾驶舱**：在一个本地页面里管理多台机器上的 DSH（本机 / VM / devbox），选中设备后直接使用**该设备自己的 DSH 工作台**（iframe 承载），驾驶舱只做两件事——设备管理与连接（SSH 回环隧道、健康探测、断线重连、分级诊断），以及只读状态聚合（常驻消费各设备官方事件流，聚合「几个在跑 / 有无等待人决策」）。

核心原则（架构约束，改动前先读 README 对应小节）：

- **操作面零协议耦合** —— 不代理远端 API、不重写身份、不接管事件；选中设备即承载**原生** DSH Web，远端的 settings、usage、已装插件与未来新增能力天然继承。
- **统筹面只读** —— 只消费官方只读接口（`host.describe`、`session.list`、`/api/events.mux`、`/api/events.host`）；不代理 Settings/Subscriptions/Credentials，不读取或同步 provider token。
- **两通道相互独立** —— 状态聚合（直连）与工作台（iframe）互不故障传染。
- **本机与远端对称** —— 本机 DSH 也只是一台设备（无需隧道），其余处理一致。
- **不假装实时** —— 离线保留最后已知状态但明确标注离线与最后更新时间；连接层知道的诊断原因（SSH 不通 / 隧道失败 / DSH 未运行 / 非 DSH 服务 / 版本不兼容）直接呈现。
- **远端零改造** —— 远端只需标准 `dsh web`（零改造、零插件），驾驶舱不向远端安装任何东西。

## 前馈要点（开工前必读的不变式）

这些是全仓库最容易踩的坑，任何改动前先对照一遍：

- **OpenSpec 路由门禁（先于通用 brainstorming / writing-plans / 实现流程）**
  - 收到任何可能修改源码的需求，MUST 先运行 `openspec list --json`，检查是否已有相关 change；有相关 change 时读取其完整 artifacts，并按对应 OpenSpec skill 继续。
  - 新功能、用户可观察行为变化、兼容性调整和架构决策 MUST 走 OpenSpec change。用户可观察行为包括 UI 视觉、布局、交互、响应式、可访问性、主题与文案语义；`bounded`、改动小、单文件或纯 CSS 均不是跳过理由。
  - 没有相关 change 时，MUST 先使用 `openspec-propose` 生成 proposal/spec/design/tasks；propose 只授权规划，产物完成后必须停止，等待用户下一次明确请求，再使用 `openspec-apply-change` 实施。不得用聊天短设计、todo 或通用 bounded 流程替代，也不得把 propose 与 apply 合并在同一请求中。
  - 仅以下工作可不新建 change：恢复现有 spec 已明确行为的明显 bug、无用户可观察行为变化的内部重构、纯测试补充、纯文档或注释修改。选择例外时 MUST 在回复中说明依据，并引用现有 spec 或明确说明为何无外部行为变化。
  - 仓库级本门禁与通用 skill 的流程分类冲突时，以本门禁为准；已有 change 的实现必须及时更新 tasks，完成并验证后使用 OpenSpec archive 流程收口。
- **PWA / Service Worker**
  - SSE 事件流（`text/event-stream`）**永不缓存**——缓存死流会静默杀死状态聚合；跨源请求（设备 iframe 所在的其他 `127.0.0.1:<port>`）SW 不得拦截。
  - 修改 `public/sw.js` 行为后必须 bump `CACHE_VERSION`，否则旧缓存残留；`/assets/*` 是带哈希的不可变文件，缓存优先按需填充，不要手工写死指纹清单。
  - SW 只在生产构建注册（`src/pwa.ts` 以 `import.meta.env.PROD` 门控）；dev（vite 5173）不注册，避免缓存 HMR 响应。
- **主题跟随系统** —— 颜色全部走 `app.css` 的 `:root` 令牌 + `@media (prefers-color-scheme: light)` 覆盖组（深色为默认）；新颜色必须进令牌，禁止在 CSS 或内联样式写死主题色值。manifest 的 `theme_color` 是静态深色（standalone 窗口 chrome 取它），页面内外观走媒体查询 meta。
- **连接层** —— 隧道仅 BatchMode 免密、`-L 127.0.0.1:<local>:127.0.0.1:<remote>`、argv 严格 `--` 边界防 alias 注入；SIGINT/SIGTERM 必须终结性清理自有 ssh 子进程（无 ppid=1 孤儿，不误杀用户其他 SSH）。
- **数据与认证** —— 服务只监听 `127.0.0.1:3090` + HttpOnly token；数据目录 `~/.dsh-cockpit/`（`DSH_COCKPIT_HOME` 可覆盖），与 `~/.dsh` **严格隔离**，驾驶舱不读写 `~/.dsh`。
- **协议边界（rc.2）** —— approval/question **事件**在驾驶舱离线期间读不回来（无查询字段），这是协议限制不是 bug；进入设备后其自身 UI 正常显示。
- **状态聚合** —— 每设备 READY 后开 mux+host 两条流 + 一次 `session.list` 基线，ws 重连自动重查快照；**无周期轮询**。

## 开始工作前的阅读顺序（渐进披露·第一层）

不要只凭目录名或局部代码猜测需求。开始分析或修改前按顺序建立上下文：

1. 阅读根目录 `README.md` —— 它定义了架构取舍、运行方式、数据目录与安全边界，是全仓库最短的完整背景。
2. 阅读 `openspec/specs/` 下与任务相关的当前规范 —— 这里描述系统当前应当满足的行为，是理解需求的**首要入口**。
3. 检查 `openspec/changes/` 中是否存在相关的进行中 change，阅读其 `proposal.md`、`design.md`、`specs/` 与 `tasks.md`。
4. 需要设计演进、取舍或历史背景时再查 `openspec/changes/archive/` —— 归档 change 是历史证据，**不代表当前要求**。
5. 最后结合相关 package 的源码与 `tests/` 确认实现现状。

若文档与实现不一致，不要静默选择一方：先指出差异，再根据当前 spec 与用户意图决定应修改规范还是实现。

## 关键目录（渐进披露·第二层）

- `README.md`：架构、运行（`bin/cockpit` 命令族）、数据目录、安全边界、验证记录。
- `openspec/`：OpenSpec 仓库 —— `specs/` 当前能力规范，`changes/` 进行中 change，`changes/archive/` 已完成归档（历史证据）。
- `.agents/skills/`：仓库级 skill（OpenSpec 的 propose / apply / archive / explore 流程等）。
- `packages/shared/`：两端共用类型与常量（设备 / 状态 / 事件聚合）。
- `packages/cockpit-server/`：NestJS 后端 —— 连接层（注册表 / SSH 隧道 / 探测 / 重连 / 终结性清理）、状态聚合（ws 双流 + 快照）、HTTP 服务与静态托管。
- `packages/cockpit-web/`：Vite/React 前端 —— 壳 UI（顶栏 / 全屏面板）、工作台 iframe、PWA（`public/manifest.webmanifest`、`public/sw.js`、`src/pwa.ts`）。
- `packages/dsh-cockpit-bridge/`：注入各设备 DSH web 客户端的桥接插件（跨源上报，与驾驶舱的耦合面见 README 与源码）。
- `bin/cockpit`：bootstrap / install / start / restart / stop / status / build 命令族（`start --dev` 前台开发模式）。
- `.github/workflows/ci.yml`：CI（build / typecheck / test / lint）。

## 工作约定

### 规范驱动

- 属于上述 OpenSpec 路由门禁的需求 MUST 先完成 change 规划，不得用聊天中的短设计、todo 列表或通用 bounded 流程替代；实现前确认相关 spec 与 tasks，实现中保持任务状态与进度一致，完成后归档。
- 符合门禁窄例外的明显缺陷也必须先搜索现有 spec，避免破坏已有场景与不变量，并在回复中说明跳过新 change 的依据。
- 构建与依赖：pnpm workspace（`pnpm-workspace.yaml`），根 `package.json` 提供 `build` / `dev` / `test` / `typecheck` / `lint`；要求 Node ≥22。

### 验证

按改动范围实际运行并报告：

```bash
pnpm build        # 三包构建（web 走 tsc -b + vite build）
pnpm typecheck
pnpm test         # 各包 vitest 或 node --test
pnpm lint
```

不要声称未实际执行的验证已经通过。前端产物改动后无需重启服务——运行中的 3090 静态托管按请求读盘，刷新页面即可验证。

### 安全与兼容

- 永远不改远端行为：不向设备安装插件、不代理远端操作 API、不读取或同步 provider token。
- 连接层与清理路径保守处理：身份或状态无法证明时拒绝破坏性操作；注册表写盘原子（tmp+rename）、权限收紧、损坏 fail-closed 不覆盖。
- 归档 change 不等于当前实现要求——当前规范以 `openspec/specs/` 为准。

## 给 AI 的执行提示

回答项目问题或实施改动时，应明确引用实际阅读过的 OpenSpec、README 和代码证据；优先解释「该能力为何存在、受什么不变量约束、当前真相源在哪里」，而不只是描述文件表面结构。涉及 OpenSpec 的提案、实施、探索或归档时，使用仓库提供的对应 skill 与流程。