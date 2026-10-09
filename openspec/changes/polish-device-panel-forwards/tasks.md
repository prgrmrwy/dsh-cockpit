> 依 design 的 D1–D6 顺序推进：先让读取区成形，再让写入区成形，最后收对齐与窄屏。每步先写失败测试（jsdom 断言结构/文本，`styles.test.ts` 断言 CSS 规则），再实现，再重构。

## 1. 转发区成组（design D1）

- [x] 1.1 Write failing test: `keeps the forward rows in one labelled section instead of nested cards` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason) — 断言：条目位于同一个带标题的分组内（`region`/`section` + 标题「转发」）、`N / 8` 在该分组内、每行不再是独立的带边框卡片结构
- [x] 1.2 Implement: `ForwardList.tsx` 改为「区头 + 一张列表」，行内字段用统一列模板 to pass 1.1
- [x] 1.3 Refactor; full suite stays green

## 2. 创建区成组（design D2）

- [x] 2.1 Write failing test: `keeps the create controls and their failure text in one labelled group` in `packages/cockpit-web/tests/forward-panel.test.tsx` (assert it fails for the right reason) — 扩展既有「创建失败保留输入」用例：失败说明必须落在创建分组内
- [x] 2.2 Implement: 创建分组（标题 + 说明 + 端口/标签/提交一行 + 组内失败说明，提交用主按钮样式）to pass 2.1
- [x] 2.3 Refactor; full suite stays green

## 3. 卡片操作组对齐（design D3）

- [x] 3.1 Write failing test: `aligns the device action group with the card title` in `packages/cockpit-web/tests/styles.test.ts` (assert it fails for the right reason) — 断言卡片网格两列顶部对齐（`align-items: start` 或等价规则），替换任何依赖旧垂直居中的断言
- [x] 3.2 Implement: 卡片网格顶部对齐规则 to pass 3.1
- [x] 3.3 Refactor; full suite stays green

## 4. 窄屏与可访问性回归（design D5、D6）

- [x] 4.1 Write failing test: `folds the forward row and the create group on narrow screens` in `packages/cockpit-web/tests/styles.test.ts` (assert it fails for the right reason) — 断言窄屏断点下转发行回退为单列/换行且无横向溢出规则
- [x] 4.2 Implement: 窄屏回退规则（沿用 860/520 断点），并确认所有控件保留可访问名（`添加常驻转发`、`删除转发 <port>`、`<displayName> 操作`、`<displayName> 转发`）to pass 4.1
- [x] 4.3 Refactor; full suite stays green

## 5. 收尾验证

- [x] 5.1 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`；确认三个包全绿 —— 复跑 exit=0：shared 8+12 / bridge 50 / web 102 / server 332
- [x] 5.2 真机核对（3090 真机，lumevm 设备卡片，`/tmp/cockpit-shots/forward-{dark,light,narrow}.png`）：深色 1440×1000、浅色 1440×1000、窄屏 390×1300。核对到的事实：转发行字段整体折行不再竖排、行间 1px 分隔线（row2 borderTop=1px rgb(42,46,51)、row1=0px）、行无背景、操作组与标题齐平、窄屏 `scrollWidth === innerWidth === 390` 无横向溢出；顺带在真机上创建并删除了一条 6379 常驻条目（1/8 → 0/8），确认创建/删除路径无行为变化
- [x] 5.3 `openspec validate polish-device-panel-forwards --strict` —— `Change 'polish-device-panel-forwards' is valid`
- [x] 5.4 更新 `packages/cockpit-web/tests/styles.test.ts` 中失效断言（不得删除断言了事）：`folds the forward row and the create group on narrow screens` 重写为 `keeps the forward rows folded as whole fields instead of a fixed column template`（改为断言基础规则：无 `grid-template-columns`、无行背景、`flex-wrap: wrap` + `white-space: nowrap`、`border-top` 分隔 + `:first-child` 归零、删除键不是网格列、520 主按钮全宽）；`styles the forwards list … narrow single-column fallback` 里那条 520 `.forward-row { grid-template-columns: minmax(0,1fr) }` 断言替换为创建区字段名列对齐断言。另新增 3 条：1.1 的成组断言、3.1 的顶部对齐断言（已用去实现回归验证非空转）、4.1 的折行断言
