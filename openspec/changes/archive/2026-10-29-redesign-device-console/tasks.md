## 1. 令牌与骨架

- [x] 1.1 在 `app.css` 新增 `--console-*` 令牌（深色默认 + `prefers-color-scheme: light` 覆盖），每个注明来源 DSH 令牌名；不改动现有 `:root` 令牌
- [x] 1.2 新建 `panels/console/deviceForm.ts`：抽出 `DeviceForm`、`EMPTY_DEVICE_FORM`、`draftFor`、`isDirty` 与标签常量，供详情页和添加表单共用
- [x] 1.3 新建 `DeviceConsole.tsx`：全屏壳、`initialSelection`、选中状态、窄屏 `view` 状态、可注入的 `confirmDiscard` / `confirmDelete` / `confirmDeleteForward`；所选设备消失时回落到相邻设备或「添加设备」

## 2. Sidebar

- [x] 2.1 `ConsoleSidebar.tsx`：标题、一句话状态摘要、按顺序排列的全部设备（`StateDot` + 显示名，禁用设备弱化并标明「已禁用」）、「添加设备」、分隔线、「通用」；用 `<nav>` 和按钮实现，选中项设 `aria-current="page"`
- [x] 2.2 样式：232px 宽、40px 行高、12px 圆角、悬停与选中令牌、键盘焦点环、独立滚动

## 3. 设备详情

- [x] 3.1 `DeviceDetail.tsx` 标题区：显示名、类型标签、状态、诊断；标题行放上移 / 下移与启用 / 禁用；窄屏显示返回按钮
- [x] 3.2 `ConnectionRoute`：用纯函数把设备事实映射为路径节点与断点（含本机、`CONNECTING`、`DISABLED`、未知状态降级），并写单测；`CONNECTING` 光点动画在 `prefers-reduced-motion` 下改为静态
- [x] 3.3 「连接」分组：预填表单（显示名、SSH 别名、DSH 端口、启用）与只读设备 ID；状态流推送不覆盖草稿
- [x] 3.4 「DSH 认证」分组：认证状态、启动 URL（写后不回显）、清除认证材料、自动恢复开关与说明，行为与现在一致
- [x] 3.5 「端口转发」分组：接入 `ForwardList`，只调整容器类名与样式，满足「转发区与创建区各自成组」、不嵌套带边框卡片
- [x] 3.6 「删除设备」危险分组与底部 sticky 保存栏（「放弃修改」「保存修改」，非 dirty 时禁用）；保存失败时原位报错并保留输入；删除确认后选中相邻项

## 4. 添加设备与通用

- [x] 4.1 `AddDeviceForm.tsx`：空白表单（类型切换、SSH 别名、端口、启动 URL、自动恢复、启用），「验证并添加」，失败原位报错并保留输入，成功后选中新设备
- [x] 4.2 `GeneralSettings.tsx`：数据目录与提示音开关（复用 `ChimeToggle` 逻辑）
- [x] 4.3 `main.tsx`：`devices` 面板传入当前设备作为 `initialSelection`，`settings` 面板打开控制台的「通用」页；删除 `SettingsPanel` 及不再使用的旧 `.device-*` 卡片样式

## 5. 响应式与主题

- [x] 5.1 ≤ 760px 两级导航：sidebar 与详情各占满宽度，可返回；320px 宽时无横向溢出
- [x] 5.2 深浅色逐项核对（sidebar 悬停与选中、分组、输入、主按钮、危险按钮、连接路径各状态）

## 6. 测试与验证

- [x] 6.1 按新结构更新 web 面板测试，覆盖 spec 场景：默认选中、切换、空列表、新增成功与失败、编辑成功与失败、dirty 时取消与确认、排序、删除确认与取消（取消时零请求）、通用页、转发清单既有场景
- [x] 6.2 运行 `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`，全部通过
- [x] 6.3 浏览器实测并截图：宽屏与窄屏、深色与浅色、本机 / 已连接远端 / 断开远端 / 禁用设备 / 无设备；确认顶栏没有任何变化
- [x] 6.4 如有面板截图或描述，同步更新 README 与 CHANGELOG
