## Why

转发区复核时发现两种条目的读法不一致：system 条目把 `pid` 挤在首行（端口 / 地址 / 状态 / 类型）里，附加条目却把 `pid` 与「标签 / 持有者」放在次行。用户在截图里明确要求 `pid` 与持有者信息一律放次行、不与首行同类字段混排。

## What Changes

- 转发行固定为两行语义：
  - 首行：设备端口、本地地址、状态、类型徽标；附加条目的删除动作位于首行右侧。
  - 次行：就绪时的 `pid`、标签、持有者数、持有者标签与最近一次失败的诊断。
- system 条目同样把 `pid` 放次行，与附加条目一致。
- 次行没有任何内容时 MUST NOT 渲染空行。
- 零行为变更：数据、端点、事件流、确认与错误处理全部不动。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cockpit-device-shell`: 「设备管理面板呈现并管理每台设备的转发清单」补入「每行分两行呈现」的条款与一个场景（`pid` 与持有者信息位于次行，system 条目亦然）。

## Impact

- `packages/cockpit-web/src/panels/ForwardList.tsx`：`pid` 从摘要行移到次行；次行的渲染条件从「仅附加条目」放宽为「有内容就渲染」。
- `packages/cockpit-web/src/styles/app.css`：`.forward-row-meta` 现在对 system 条目也可能存在（样式本身无需新增令牌）。
- `packages/cockpit-web/tests/forward-panel.test.tsx`：补「pid 不在首行、system 条目也有次行」的断言，并覆盖「次行无内容不渲染」。
