<!-- 依赖顺序：D1 确认 → shared → server → web（共用常量 → ForwardTabs → TopBar/main 接线 → 面板）→ 集成验证。每组自带测试，先红后绿。 -->

## 0. 前置条件

- [x] 0.1 确认用户已就 design D1（标签页项放在顶栏，还是放在工作台内的二级标签栏）拍板，并把决定写入 design 的「人类决策记录」。若选备选方案，先修订 device-shell delta 与第 4 组任务。
- [x] 0.2 在基线上运行 `pnpm build && pnpm test`，确认全绿。

## 1. shared 契约

- [x] 1.1 `PinnedForwardRecord` 与 `AdditionalForwardRow` 加 `workbenchTab`（记录中为 `?: true`，行中为 `boolean`）；`forward-options.ts` 的 `ForwardPinErrorCode` 加 `workbench-tab-requires-same-port`。验证：`shared/tests/forward-options.test.ts` 断言 `toForwardsSnapshot` 的输出不含 `workbenchTab`；`pnpm build` 后 `git status` 中不出现 `packages/dsh-cockpit-bridge/lib/`。

## 2. 服务端（design D2）

- [x] 2.1 `DeviceForwards`：`PinOptions.workbenchTab`；`checkPin` 按合并后的状态校验 `workbenchTab && !sameLocalPort`，命中时抛出 `workbench-tab-requires-same-port`；切换该标记不重建子进程；投影输出该字段。验证：`forward-table.test.ts` 新增三个用例：「非同端口开 tab 被拒且不建子进程」「开 tab 时取消同端口被拒且 pid 不变」「只切换 tab 不重建」。
- [x] 2.2 `ConnectivityService.mergePinnedMark` 与恢复路径带上该字段；`registry.ts` 的容忍式校验接受 `workbenchTab: true`，其它值只丢弃该字段并告警。验证：`connectivity.service.test.ts` 新增「重启后标签页标记恢复」，`registry.test.ts` 新增「非法 workbenchTab 只丢字段」。
- [x] 2.3 `devices.controller.ts` 的创建请求体只在值为布尔时接收 `workbenchTab`。验证：`app-forwards.e2e.test.ts` 覆盖成功持久化，以及 409 `workbench-tab-requires-same-port`。

## 3. 标签页承载（design D3、D4）

- [x] 3.1 把 `sandbox`、`allow` 常量抽到 `workbench/frame-attributes.ts`，`Workbench` 改为引用它；`ForwardList` 导出 `CODE_TEXT` 与 `failureText` 供共用。验证：`workbench.test.tsx` 与 `forward-panel.test.tsx` 原样通过。
- [x] 3.2 新建 `workbench/ForwardTabs.tsx`：
  - 注册表与懒挂载，建了不销毁；条目消失、取消标记、设备被禁用或移除时销毁；
  - 未就绪时显示遮罩，不挂载 iframe；
  - 一次性导航：`pendingRef` 加 ref 回调 `apply`，赋值后清除引用，并启动 10 秒超时；
  - 单飞启动；失败遮罩用固定文案并提供「重试」；`reload(tabKey)` 接口。

  验证：新建 `tests/forward-tabs.test.tsx`，覆盖：
  - 首次选中只请求一次、导航一次，切回不重载；
  - 没有命令时直接用本地拼出的地址；
  - 未就绪时不挂载，就绪后再挂载；
  - 解析失败显示固定文案，「重试」后再请求一次；
  - `reload` 再请求一次，并导航同一个 iframe；
  - 取消标记后卸载；
  - React 状态与日志中不出现 token 字符串，解析端点只请求一次（iframe 的 `src` 属性按设计会带上地址，与主工作台一致，不做断言）。
- [x] 3.3 bridge 隔离（design D4）。验证：`tests/forward-tabs.test.tsx` 中把 `Workbench` 与 `ForwardTabs` 一起渲染，断言：
  - `postMessage` 只发往主工作台 iframe；
  - 不为标签页的 origin 调用 `requestBridgeCapability`；
  - 标签页 iframe 发来的能力串过期、实例结束消息，不触发换发能力串，也不触发 `releaseForwardInstance`；
  - source 为 null、origin 为 `127.0.0.1:3082` 的实例结束消息同样被忽略。

## 4. 顶栏与接线（design D1）

- [x] 4.1 `TopBar`：在选中设备项后渲染该设备的标签页项：
  - 名称取条目标签，没有标签时为 `<显示名>:<端口>`，过长截断并用 title 显示全名；
  - 带 `aria-selected`、状态点与文字；
  - 右键或长按打开快捷菜单「重新加载」；
  - 没有标签页条目时不渲染任何元素。

  验证：`topbar.test.tsx` 新增「有标签页条目才显示」「默认名称」「未就绪文字标注」「快捷菜单重新加载」。
- [x] 4.2 `main.tsx`：按设备维护视图（工作台或标签页），只存在页面内存中；切回设备时回到上次的视图；标签页消失时回到工作台；挂载 `ForwardTabs`，让它与 `Workbench` 二选一显示（另一个隐藏但保持挂载）；前台上报只在工作台视图时为当前设备，标签页视图上报 `null`。验证：`app.test.tsx` 新增「点标签页切到标签页、点设备项回到工作台、跨设备切回保持视图」「取消标记后回到工作台」「标签页视图上报前台为 null，回到工作台再上报设备」。
- [x] 4.3 样式：标签页项复用设备项的令牌与无边框选中态，深浅主题都正常，窄屏顶栏横向滚动且无溢出。验证：`styles.test.ts` 新增令牌断言；用 headless Chromium 截取深色、浅色与 400px 宽的图。

## 5. 面板

- [x] 5.1 `ForwardList` 创建分组新增「在工作台显示为标签页」复选框：放在同端口那一行的控件列里，同端口未勾选时禁用；提交时明确传布尔值。行的次行显示「标签页」标记。补充 `CODE_TEXT`。验证：`forward-open.test.tsx` 新增「同端口未勾选时 tab 开关禁用」「提交携带 workbenchTab」「409 文案」。

## 6. 集成验证与文档

- [x] 6.1 运行 `pnpm build && pnpm typecheck && pnpm test && pnpm lint` 并全部通过；确认 bridge 的 `lib/` 无变化。
- [x] 6.2 README 转发小节补充「工作台标签页」：用途、只允许同端口条目、token 轮换后如何「重新加载」、标签页中不启用 bridge；`CHANGELOG.md` 增加条目。
- [x] 6.3 实机验收（部署侧配合）：
  - 3082 条目开启标签页后，在顶栏点开 SA 面板；概览、来源、设置都能正常读写，没有同源 403；
  - SA 重启轮换 token 后，用「重新加载」恢复；
  - 3080 主工作台与会话上报不受影响。

  结果记录到本文件。

  结果（2026-11-06）：用户在操作机上验收通过。验收中发现标签页复选框与同端口复选框共处一个 label、点击被转发到同端口，已在 `6f27fa8` 修复。
- [x] 6.4 在协作空间 `cockpit-shim-publish` 通知部署侧。

## Workflow follow-up

- 用户验收后，按 `openspec-archive-change` 归档，并把 delta 合入 `openspec/specs/`。
