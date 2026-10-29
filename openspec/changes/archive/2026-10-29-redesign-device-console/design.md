## Context

- 现状见 proposal.md「Why」。相关代码：`packages/cockpit-web/src/panels/Panels.tsx`（`DevicePanel` / `OverviewPanel` / `SettingsPanel` / `ChimeToggle`）、`ForwardList.tsx`、`styles/app.css`（`.device-*`、`.forward-*`）、`main.tsx`（`panel` 状态与三种面板）。
- 约束：颜色只能走 `app.css` `:root` 令牌 + `prefers-color-scheme: light` 覆盖组（AGENTS.md「主题跟随系统」）；顶栏不改；不新增服务端接口或轮询；`ForwardList` 行为与 spec 场景不变。
- 「DSH 风格」的依据是上游 DSH 0.2.0-rc.2 源码，而不是凭印象：`ui-settings-general/src/client/SettingsRoot.module.css`（188px 导航栏、40px 导航行、12px 圆角、14/22 字号、标题 16/500）与 `ui-theme/src/styles/design-platform.css`（`--dsw-static-neutral-bluish-*`、`--dsw-static-deepseek-*`、`--dsw-specific-sidebar-nav-item-*`）。驾驶舱不依赖 `@deepseek-ai/*` 包，因此令牌值抄录为驾驶舱自有令牌，并注明来源变量名（`state-dot.css` 已有同样的做法）。

## Goals / Non-Goals

**Goals:**
- 设备与设置合成一个 sidebar + 详情的控制台，视觉与设备内原生 DSH 设置页一致。
- 详情页直接编辑，去掉「编辑」模式切换；未保存修改有保护。
- 宽屏并排、窄屏两级导航，深浅色完整。

**Non-Goals:**
- 新设备类型（HTTPS / Cloudflare Access）——另开 change。
- 顶栏、设备总览面板、工作台遮罩的视觉。
- 拖拽排序、搜索、批量操作。
- 把整个驾驶舱 `:root` 主题换成 DSH 色板（会改动顶栏）。

## Design plan

### 色彩（控制台令牌 `--console-*`，括号内为来源 DSH 令牌）

| 角色 | 深色 | 浅色 |
| --- | --- | --- |
| 画布（sidebar 与详情底色） | `#2C2C2E`（neutral-bluish-850 = bg-layer-2） | `#FFFFFF`（neutral-bluish-00） |
| 分组底色 | `#232324`（neutral-bluish-875 = bg-layer-1） | `#F9FAFB`（neutral-bluish-50） |
| 导航悬停 / 选中 | `rgba(255,255,255,.08)` / `#43454A`（interactive-bg-hover / neutral-bluish-750） | `#F1F3F5` / `#EBEEF2`（sidebar-nav-item-hover / active） |
| 文字 主 / 次 / 弱 | `#F9FAFB` / `#CFD3D6` / `#ADB2B8` | `#0F1115` / `#61666B` / `#81858C` |
| 强调（主按钮、焦点环、选中指示） | `#4176E6`（deepseek-500） | `#4176E6` |
| 分隔线 | `rgba(255,255,255,.06)` | `#E1E5EE`（neutral-bluish-200） |

状态色沿用现有 `--ok` / `--warn` / `--error` 与 `state-dot.css`（已对齐 DSH 的 green-500 / amber-500 / red-400）。

### 字体

单一家族：DSH 的系统栈 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', …`（与 `--dsw-font-family` 相同），不引入 webfont。字号阶梯：详情标题 20/28 · 600；sidebar 标题 16/24 · 500（同 DSH navTitle）；正文与导航行 14/22 · 400；分组标题 13/20 · 600、次级文字 12/18。地址、端口、pid 用 `font-variant-numeric: tabular-nums`，不用等宽字体。

### 布局

```
┌──────────────────┬───────────────────────────────────────────────────┐
│ 设备与设置        │ 开发虚拟机                     [↑][↓] [禁用]   ✕ │
│ 3 台已连接，1 台   │ [SSH 远端] ● 已连接                               │
│ 需要处理          │                                                   │
│                  │  此电脑 ━━ ssh lumevm ━━ 127.0.0.1:41123 ━━ DSH :3080│
│ ● 本机            │                                                   │
│ ● 开发虚拟机   ◀  │ 连接                                              │
│ ● devbox          │ ┌───────────────────────────────────────────────┐ │
│ ○ 旧机器（已禁用） │ │ 显示名            [开发虚拟机            ]   │ │
│ ＋ 添加设备        │ │ SSH 别名          [lumevm               ]   │ │
│                  │ │ DSH 端口          [3080 ]                    │ │
│ ─────            │ └───────────────────────────────────────────────┘ │
│ ⚙ 通用            │ DSH 认证        …                                 │
│                  │ 端口转发  2 / 8 …                                 │
│                  │ 删除设备  ……………………………………………… [删除]         │
│                  │                          [放弃修改] [保存修改]    │
└──────────────────┴───────────────────────────────────────────────────┘
  sidebar 232px，可独立滚动        详情内容列 max 720px，左对齐，可独立滚动
```

- 全屏覆盖（与现在相同，`inset: 0`），没有外框卡片和阴影；sidebar 与详情之间只有一条分隔线。
- 分组 = 「分组标题 + 一块分组底色的行容器」，行与行之间用分隔线（DSH 设置表单的形态），不做每组一张浮起卡片。
- 所有内容左对齐；保存栏贴在详情列底部（sticky），只在有未保存修改时启用。
- 窄屏（≤ 760px）：sidebar 占满宽度；选中后详情占满宽度，标题左侧出现「返回」按钮。

### 原则

1. 唯一的记忆点是详情页标题下的**连接路径**：「此电脑 → SSH 别名 → 本地回环地址 → 远端 DSH 端口」（本机设备只有「此电脑 → 127.0.0.1:端口」）。路径按连接层诊断在故障那一跳断开并着色：`SSH_UNREACHABLE` 断在 SSH 段，`TUNNEL_ERROR` 断在本地地址，`DSH_UNAVAILABLE` / `NON_DSH_SERVICE` / `INCOMPATIBLE` 断在最后一个节点；`CONNECTING` 时一个光点沿路径移动（`prefers-reduced-motion` 下改为静态虚线）；`DISABLED` 整条变灰。驾驶舱的本职就是连接，用户在一处就能看到卡在哪一跳。
2. 其余一律安静：不做统计卡片、徽章墙、渐变或阴影；状态只用 `StateDot` 色点加文字。
3. 文案用用户的话：「此电脑」而非 host、「删除设备」而非 remove；按钮写清动作（「验证并添加」「保存修改」）。

### 对照通用默认做法的自查与修订

- 初稿沿用现有的四颗摘要胶囊（总数 / 已连接 / 需处理 / 已禁用）放在详情顶部，这是 SaaS 仪表盘的默认做法，也会与连接路径争夺注意力 → **改为** sidebar 标题下的一句话摘要（「3 台已连接，1 台需要处理」，全部正常时只说「4 台设备均已连接」）。spec 要求的状态摘要依然存在，只是不再是胶囊组。
- 初稿每个分组都是带阴影的圆角卡片（同现在的 `.device-list-section`）→ **改为** DSH 设置表单式的「标题 + 行容器 + 分隔线」，圆角按层级区分：导航行 12px、分组容器 12px、输入框 8px，覆盖层本身不设圆角。
- 现有元信息用「 · 」拼接（`lumevm:3080 · dev-vm`）→ 连接路径已承载别名与端口，deviceId 移到「连接」分组的只读行，不再拼接。
- 考虑过用等宽字体显示地址 → 放弃，只用 tabular-nums，避免「小号等宽数据标签」这个模板化特征。

## Decisions

- **D1 控制台令牌独立于 `:root` 现有令牌。** 新增 `--console-*` 一组（同样有浅色覆盖），只供控制台使用。备选：直接把 `--bg` / `--fg` 等改成 DSH 值——会连带改动顶栏与工作台遮罩，违反「header 不动」。
- **D2 详情即表单，配合脏检查。** 每次选中都用 `draftFor(device)` 生成草稿；草稿与当前值不同即为 dirty。切换选中或关闭面板时，若 dirty 就调用可注入的 `confirmDiscard`（默认 `window.confirm`，与 `confirmDelete` 同一模式，便于测试）。服务端状态流推送新的设备事实时**不覆盖**草稿，只刷新只读部分（状态、路径、认证状态、转发）。备选：保留「编辑」按钮——正是本次要去掉的来回跳转。
- **D3 选中状态归面板所有。** `DevicePanel` 新增 `initialSelection` 属性（`{ kind: 'device', deviceId } | { kind: 'add' } | { kind: 'general' }`）；`main.tsx` 打开时传入当前工作台设备，`panel === 'settings'` 时传 `general`。选中的设备被删除或从事实中消失时，按 spec 回落到相邻设备或「添加设备」。
- **D4 删除 `SettingsPanel` 组件，保留 `PanelName` 中的 `'settings'`。** 它改为打开同一控制台的「通用」页，这样没有调用方需要改名；`data-cockpit-panel="devices"` 保持不变。
- **D5 sidebar 用 `<nav>` 加按钮列表，选中项设 `aria-current="page"`。** 不用 ARIA tabs / listbox：两者都要求方向键漫游，与「Tab 依次访问」的现有键盘模型不一致，代价大于收益。
- **D6 窄屏两级导航由 CSS 断点加 `view: 'list' | 'detail'` 状态共同实现。** 宽屏忽略 `view`；窄屏按 `view` 只显示一栏，选中项变化时置为 `detail`。
- **D7 文件拆分。** `panels/console/`：`DeviceConsole.tsx`（壳与选中状态）、`ConsoleSidebar.tsx`、`DeviceDetail.tsx`（含连接路径 `ConnectionRoute`）、`AddDeviceForm.tsx`、`GeneralSettings.tsx`；表单字段与 `draftFor` 共享到 `deviceForm.ts`。`Panels.tsx` 只保留 `OverviewPanel` 与对外导出。`ForwardList.tsx` 只换外层类名与样式。

## Risks / Trade-offs

- [面板测试依赖旧结构（「编辑」按钮、卡片 aria-label）] → 按新结构重写，场景逐条对照 spec，不减少覆盖；保留 `data-device`、`data-state`、`data-cockpit-panel` 这些稳定钩子。
- [状态流推送与正在编辑的草稿冲突] → D2：推送不覆盖草稿；保存时以草稿为准提交，服务端校验失败照常原位报错。
- [连接路径对诊断的映射与连接层枚举耦合] → 映射集中在一个纯函数里并加单测；未知状态退化为「不标断点、只显示文字诊断」。
- [控制台令牌与 DSH 上游后续调色漂移] → 令牌旁注明来源变量名，升级时可以对照；这是视觉近似，不是契约。

## Migration Plan

纯前端改动：`pnpm build` 后刷新 3090 页面即可生效（静态托管按请求读盘）。回滚就是还原 web 包。`sw.js` 不改；`/assets/*` 带哈希，新产物自然替换旧产物。
