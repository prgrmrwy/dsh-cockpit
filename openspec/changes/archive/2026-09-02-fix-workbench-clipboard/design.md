## Context

工作台 iframe 由 `packages/cockpit-web/src/workbench/Workbench.tsx` 渲染（懒加载、
建了不销毁，`sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`，
无 `allow` 属性），src 指向设备 DSH（`http://127.0.0.1:<随机隧道端口>`）。
驾驶舱自身在 `127.0.0.1:3090`，端口不同即跨源；Chrome 136+ 收紧
`clipboard-read`/`clipboard-write` 的默认 allowlist（`*` → `self`），跨源 iframe
未显式授权时设备 DSH 页面内的 `navigator.clipboard.writeText()` 抛
`NotAllowedError`，复制按钮「点了没反应」。动机详见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 工作台 iframe 显式声明 `allow="clipboard-read; clipboard-write"`，恢复嵌入的
  原生 DSH 页面在 Chrome 136+ 下的剪贴板能力（复制为主，覆盖粘贴类交互）。
- 保持现有 iframe 行为契约不变：懒加载、建了不销毁、跨源独立、离线遮罩。

**Non-Goals:**

- 不调整 sandbox 令牌；不新增其它权限（`allow-popups-to-escape-sandbox` 与下载/
  弹窗行为相关，属后续独立评估，见 proposal.md）。
- 不代理、不读取、不上报剪贴板内容——权限由浏览器授予 DSH 页面，驾驶舱零参与。
- 不改远端 DSH、桥接插件、cockpit-server、SW/PWA。

## Decisions

1. **用 iframe `allow` 属性而非 `Permissions-Policy` 响应头**
   - 选 `allow`：per-element 声明，直接落在承载页（驾驶舱 web 产物），无需动
     cockpit-server（响应头会影响驾驶舱自身文档，且需按请求路径区分，成本高）。
     DSH 服务端无需任何改造（远端零改造不变量保持）。
   - 备选：在 `src` 指向的 DSH 响应上让远端加 `Permissions-Policy` 头——违反
     远端零改造，放弃。

2. **同时声明 `clipboard-read` 与 `clipboard-write`，而非仅 `write`**
   - DSH 复制按钮走 `writeText`（`MessageIconActions` 单一路径），但 DSH/未来
     插件的粘贴类交互可能走 `clipboard.readText`；一次声明避免同类问题复发。
     两者都仅在标题文档聚焦 + 用户手势下可用，授予面可控。
   - 备选：仅 `clipboard-write`——能修复制，但「为什么粘贴不行」会成为下一个
     问题，且诊断结论推荐双声明。

3. **sandbox 令牌维持现状**
   - `sandbox` 与 `allow`（Permissions Policy）是正交机制；sandbox 本身不拦截
     剪贴板 API。保留 `allow-same-origin` 保证 DSH 页面保留真实 origin 与 secure
     context（`navigator.clipboard` 存在的前提），`allow-scripts` 保证页面脚本
     照常运行。剪贴板权限只由 `allow` 补充。

4. **测试断言落在 iframe 属性，不做浏览器级 E2E**
   - 在 `packages/cockpit-web/tests/workbench.test.tsx` 现有懒加载用例中补充
     `allow` 属性断言（单测无法模拟真实权限策略）。真实权限行为由人工浏览器验证
     （Chrome 136+ 打开驾驶舱 → 工作台复制消息/代码块 → 粘贴可见）。

## Risks / Trade-offs

- **给嵌入页面授予剪贴板读取权限** → 权限对象是用户自己设备上运行的 DSH（用户
  信任的、与驾驶舱同主体的内容）；且 `clipboard-read` 要求页面聚焦 + 用户手势，
  纯后台页面无法静默读取。无新增攻击面：驾驶舱自身代码不触碰剪贴板。
- **旧浏览器/非 Chromium 对 `allow` 的行为差异** → 不识别该属性的引擎忽略之
  （无回归）；识别但特性不存在的引擎视为 no-op。`allow` 声明不改变任何已有
  默认值之外的能力。
- **前端产物缓存** → 改动落在 `cockpit-web` 源码，生产构建产物为带哈希 assets；
  刷新页面即取新文件（3090 静态托管按请求读盘，无需重启服务）。SW 未改动，
  `CACHE_VERSION` 不 bump；工作台 iframe 为跨源端口，SW 本就不拦截。

## Migration Plan

1. `pnpm build`（或 `cockpit build`）产出新前端产物。
2. 刷新浏览器打开 `http://127.0.0.1:3090/` 验证复制可用；必要时硬刷新清旧壳缓存。
3. 回滚：还原属性 + 重新构建（无服务端、无数据目录变更，无迁移副作用）。

## Open Questions

无。
