## 1. 实现

- [x] 1.1 在 `packages/cockpit-web/src/workbench/Workbench.tsx` 的工作台 iframe 上将 `allow` 更新为 `clipboard-read; clipboard-write; microphone`；`sandbox`、`src`、`title`、`referrerPolicy`、`onLoad` 与懒加载/常驻/销毁逻辑保持原样。验证：`git diff` 仅含该属性一行变化（`1 file changed, 1 insertion(+), 1 deletion(-)`），`grep -n 'allow=' packages/cockpit-web/src/workbench/Workbench.tsx` 输出新值
- [x] 1.2 确认权限声明保持最小集合且不涉及其它面：无 `camera`/`geolocation` 等新增权限，未新增服务端 `Permissions-Policy` 响应头，未改 `cockpit-server`、桥接插件、`sw.js`。验证：`grep -rn -i "permissions-policy\|feature-policy" packages/*/src` 无命中；`git status --short` 仅显示 web 包源码与测试改动

## 2. 测试

- [x] 2.1 更新 `packages/cockpit-web/tests/workbench.test.tsx` 中 iframe `allow` 断言为新的精确值，并同步注释说明跨源 iframe 需显式委派 `microphone`；验证：`pnpm test` 中 cockpit-web 的 `workbench.test.tsx` 36 个用例全绿且断言覆盖新值
- [x] 2.2 确认既有 iframe 契约用例不回归（懒加载不提前导航、接受响应只导航一次、切换设备保留、禁用销毁、重连跟随新端口）。验证：cockpit-web 包 vitest 10 个文件、107 个用例全部通过，无新增 skip

## 3. 验证

- [x] 3.1 `pnpm typecheck` 与 `pnpm lint` 通过；验证：`pnpm install --frozen-lockfile` 后先 `pnpm build`（shared 产物是 bridge typecheck 的前置），再 `pnpm typecheck`（shared / server / web / bridge 四个包 Done）与 `pnpm lint`（四个包 Done）均退出码 0
- [x] 3.2 `pnpm test` 通过；验证：根 `node --test` 12 + shared 8 + bridge 54 + server 342（25 文件）+ web 107（10 文件），全部 pass、0 fail
- [x] 3.3 `pnpm build` 产出新前端产物并被运行中的 3090 静态托管按请求读盘提供；验证：构建成功，`dist/assets/index-CBaoJs1v.js` 内含 `clipboard-read; clipboard-write; microphone`。（本机没有 3090 监听实例，`curl` 无响应：部署驾驶舱的那台机器刷新页面即取到新 bundle，无需重启服务）
- [x] 3.4 人工浏览器验证（用户已确认通过）：Chrome 打开 `http://127.0.0.1:3090/` → 进入设备工作台 → DSH 语音输入可弹出麦克风授权并成功录音；明确拒绝授权时设备页面仍显示真实失败提示；直接访问 `http://127.0.0.1:3080` 行为不变；工作台懒加载/设备切换/离线遮罩无回归
