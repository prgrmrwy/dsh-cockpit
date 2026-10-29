# 验证记录（2026-10-29）

- 基线提交：4c5114f。改动仅 web、文档和本 change，不改服务端与顶部栏。
- `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint` 全部 exit 0；web 最终 131 tests 通过，server 366、bridge 54、shared 8、根 14。最终 preventScroll 焦点修正后再次执行 web build/test/lint 通过。
- `openspec validate move-device-actions-to-sidebar --strict` 与 `git diff --check` 通过。
- 菜单单测：非选中设备菜单不切换详情、方向键与 Escape 恢复焦点、外部关闭、边界禁用、草稿保护、目标设备错误、重新启用。
- App 集成：启停事实推送后 header 隐藏/恢复同 ID 设备，sidebar 始终保留设备并显示已禁用 tag。
- 现有 http://127.0.0.1:3090/ 浏览器检查浅色/深色、320×480；右侧标题不再有上移/下移/禁用。未对真实设备执行写操作。
- 浏览器专用 fetch/EventSource fixture 构造 16 台设备，最后一台禁用；320×480 下末行菜单边界 x=152..304、y=328..440，document.scrollWidth=320，无溢出，焦点在「上移测试设备 15」。截图 /tmp/cockpit-menu-last-disabled.png。
- 本地源码复核：选择与 more 是并列按钮，无嵌套；菜单按目标 deviceId 操作；仅当前设备的启停才检查/重置其草稿；删除仍只在详情底部。菜单 Escape 阻止冒泡，不关闭控制台。
- 已有 npm/tsdown 警告与旧 fixture 的 TimeoutNaNWarning 仍存在，均不影响验证通过。
