# 验证记录（2026-10-29）

## 范围与代码复核

- 新控制台使用独立 `--console-*` 令牌，原有顶栏源码与样式块未改；总览保留原实现。
- 新增、保存、排序、启停、删除仍调用既有 api；认证 URL 写后清空，不回显持久认证材料。转发组件逻辑未修改，10 个既有转发测试通过。
- 状态流只更新只读事实，不重置输入草稿；切换或关闭确认放弃，保存期间锁定导航。背景节点设 inert 并在卸载时还原，键盘焦点约束于面板。
- 本地完整复核未发现阻断项。修复了复核中发现的浅色小字对比度不足和重复 banner landmark。

## 自动检查

- `pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint` 全部 exit 0。
- 根测试 14、shared 8、server 366、bridge 54 通过；最终 web 126 通过（补充焦点保护测试后再次执行 web build/test/lint）。
- `git diff --check`、`openspec validate redesign-device-console --strict` 通过。
- 构建仍有原有 npm 环境变量/tsdown define 警告；部分旧 app 测试 fixture 缺少端口触发 TimeoutNaNWarning，不影响通过，不在本次范围内修复。

## 浏览器检查

使用 agent-browser 的隔离 session 打开**现有** http://127.0.0.1:3090/（未启动替代服务）。

- 真实 host（local）、lumevm（SSH READY）：新布局可见，原生 iframe 保留；没有保存、删除或启停真实设备。
- 1440×1000 深浅色截图；320×740 窄屏截图，实测 document.scrollWidth = detail.scrollWidth = innerWidth = 320。
- 离线 SSH、禁用、CONNECTING 和空设备列表使用浏览器 init script 截获 fetch/EventSource 的**仅浏览器 fixture**，没有修改真实注册表。核对故障段红色虚线、禁用路径灰化、空列表自动打开添加表单。
- axe 4.12.1 对控制台区域检查：深色 0 violations、浅色 0 violations；关闭按钮的 × 对比度为 incomplete（仅符号，已目视核对），不宣称所有条目均自动判定。
- 临时截图位于 /tmp/cockpit-console-final-dark.png、/tmp/cockpit-console-final-light.png、/tmp/cockpit-console-final-mobile.png，以及 offline/disabled/empty 截图；非产品资产。

## 未执行

- 没有对真实设备执行修改、删除、排序、启停或创建转发；写操作行为由隔离单测覆盖，避免扰动正在运行的设备。
- 没有新增 HTTPS / Cloudflare 连接类型，没有重启 DSH 或驾驶舱服务。
