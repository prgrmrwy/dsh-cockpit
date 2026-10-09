## Context

见 `proposal.md` 的 Why。相关现状（刚合并进主 spec 的 `polish-device-panel-forwards`）：

- 转发行结构是「`.forward-row-line`（网格：摘要 + 右侧动作列）+ `.forward-row-meta`（标签 / 持有者 / 诊断）」；`pid` 目前在摘要行里，且只有附加条目才渲染 `.forward-row-meta`。
- 摘要在 323px 行宽下已经会整字段折行（`flex-wrap` + 字段 `nowrap`），把 `pid` 留在摘要行会挤走位置、也让 system 行与附加行读法不一致。
- `.forward-row-meta` 已有完整样式（`--fg-dim`、`overflow-wrap: anywhere`、诊断 `flex-basis: 100%`），无需新令牌。

## Goals / Non-Goals

**Goals**

- 两种条目的读法一致：首行只有端口 / 地址 / 状态 / 类型（附加条目另有删除），次行承载 `pid`、标签与持有者信息。
- 次行无内容时不产生空行（system 条目在非就绪态只有一行）。

**Non-Goals**

- 不动删除动作的位置（仍在首行右侧）。
- 不动诊断的呈现（仍在次行、仍占满整行）。
- 不新增样式令牌，不改窄屏折行策略。

## Decisions

### D1 次行的渲染条件是「有内容」而不是「是附加条目」

`pid` 移入次行后，system 条目也可能需要次行。渲染条件改为：`row.kind === 'additional' || (row.state === 'ready' && row.pid !== undefined)`。

- 备选：无条件渲染次行（否决——非就绪的 system 条目会多出一条空行，行高翻倍且没有信息）。
- 备选：只让附加条目有次行、system 行的 pid 留在首行（否决——这正是本次要消除的不一致）。

### D2 删除动作留在首行右侧

复核时删除动作刚从「标签 / 持有者」那一行挪到首行右侧并得到认可（截图勾选），本次不动；`pid` 下移后首行右侧只剩动作，token 与网格列不变。

- 备选：把删除也挪到次行右端（否决——会和持有者文本重新挤在一起，正是上一轮修掉的问题）。

### D3 只改结构，不加样式

`.forward-row-meta` 复用现有规则；`pid` 在次行时保持 `tabular-nums` 与 `--fg-dim`（与标签 / 持有者同级）。CSS 层面预期零新增规则。

## Risks / Trade-offs

- **行高**：附加条目本来就两行，system 条目在就绪态也从一行变两行，卡片整体会略高；这是用户明确要求的一致读法，接受。
- **测试面**：现有断言以 `textContent` 为主（跨行仍成立），需要新增的是「pid 不在摘要行」「非就绪 system 行没有次行」这类结构断言，避免只测文本存在。
