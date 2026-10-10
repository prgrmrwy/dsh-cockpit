## Context

动机见 proposal.md — Why。本设计只需在以下现状上报废一个假设：

- 工作台 iframe 由 `packages/cockpit-web/src/workbench/Workbench.tsx` 渲染，src 指向设备原生 DSH（`http://127.0.0.1:<隧道端口>`），驾驶舱自身在 `127.0.0.1:3090`，端口不同即跨源；当前属性为 `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`、`allow="clipboard-read; clipboard-write"`。
- 设备 DSH 语音输入插件（`@deepseek-ai/dsh-experimental-client-ui-voice-input`）在 `getUserMedia` 抛 `NotAllowedError` 时显示「麦克风权限未开启，请在浏览器和系统设置中允许访问。」——该文案把权限策略层的拦截表述成系统设置问题，用户无从据此诊断。
- 驾驶舱仓库内无 `Permissions-Policy` / `Feature-Policy` 相关代码（`grep -rn -i "permissions-policy\|feature-policy" packages/*/src` 无命中）；此前的排查也未在运行中的 DSH 服务端发现该类响应头（见 session-89293cf4 的诊断记录）。因此跨源 iframe 内麦克风被拒只可能来自 iframe 元素未委派该权限。
- 用户侧 A/B 观察与上述代码事实一致：直接访问 `http://127.0.0.1:3080` 语音输入正常，经驾驶舱工作台 iframe 使用即失败；插件在 `getUserMedia` 抛 `NotAllowedError` 时映射为上述文案（`NotAllowedError` → `RecordingError("permission")`）。

## Goals / Non-Goals

**Goals:**

- 工作台 iframe 显式委派 `microphone`，使嵌入的设备 DSH 页面获得与单独访问该 endpoint 一致的麦克风能力（策略层不再拦截）。
- 保持最小授权：权限集合仅剪贴板读写 + 麦克风，逐项由需求证明。
- iframe 既有行为契约零变化：懒加载、建了不销毁、禁用销毁、单次启动导航、跨源独立、离线遮罩。

**Non-Goals:**

- 驾驶舱侧不实现任何媒体处理：无录音 UI、无设备选择、无权限状态展示、无音频转发。
- 不改 DSH 远端、桥接插件、cockpit-server、SW/PWA。
- 不为「将来可能有插件需要 `camera`/`geolocation`」预先授权。
- 不改写设备页面的权限失败文案（属远端零改造边界，见 Decision 5）。

## Decisions

1. **用 iframe `allow` 属性，而非服务端 `Permissions-Policy` 响应头**
   - 选 `allow`：per-element 声明，落点就是承载页，不改变驾驶舱自身文档的策略，也不触碰 cockpit-server。
   - 备选：服务端对驾驶舱 HTML 响应加 `Permissions-Policy: microphone=(self "http://127.0.0.1:*")`——需要对随机隧道端口做 baseline，且扩大了驾驶舱文档的授权面，成本与风险都更高。
   - 与 `archive/2026-09-02-fix-workbench-clipboard` 的既有决策保持一致，避免同类问题出现两套机制。

2. **只委派 `microphone`，不写 `microphone *`**
   - `allow="microphone"` 的语义是把该能力委派给此 iframe 自身 origin（等价于 `microphone 'self'`），正是「设备 DSH 页面自己用麦克风」这一需求。
   - 备选：`microphone *`——会把能力开放给 iframe 内部再嵌套的任意来源，无需求支撑，放弃。

3. **`sandbox` 令牌维持现状**
   - sandbox 与 Permissions Policy 正交，sandbox 本身不授予或拦截媒体权限；`allow-same-origin` 必须保留——媒体权限只能以 origin 为单位授予，缺少真实 origin 时请求连归属都没有。不因本次改动顺带引入 `allow-popups-to-escape-sandbox` 等无关令牌。

4. **测试断言落在渲染出的 iframe 属性，不做浏览器级 E2E**
   - jsdom 不执行真实权限策略，无法在单测中证明授权成功；因此单测只锁定「iframe 携带预期 `allow` 值」这一可判定事实，真实授权由人工浏览器验证（见 Migration Plan 的验证清单）。
   - 与剪贴板 change 的测试策略一致；同时避免为一次属性变更引入浏览器自动化基建。

5. **不改写插件权限失败文案**
   - 「麦克风权限未开启…」由设备侧插件产生，属远端零改造范围。本次只解除策略层钳制；策略委派后用户拒绝授权时，该文案仍是真实且正确的反馈（见 spec 的失败场景）。
   - 备选：驾驶舱注入提示或代理错误——违反零协议耦合与远端零改造，放弃。

## Risks / Trade-offs

- **给嵌入页面授予麦克风** → 授权对象是用户自己设备上运行的 DSH 页面；浏览器仍会按请求方 origin 弹授权框（首次使用时），用户可拒绝；驾驶舱不接触音频流，也不缓存授权结果。
- **「声明了权限」被误读为「已授权」** → 策略委派与用户授权是两层：spec 明确要求用户拒绝时呈现真实失败，不得重试或伪造成功；驾驶舱不展示任何权限状态。
- **授权按 origin 记录，隧道端口会变** → 端口变化即新 origin，浏览器可能重新询问授权；这是浏览器权限模型与既有隧道设计的结果，不是本次改动引入，也不值得为此引入端口固定化（会与随机端口设计冲突）。若用户希望免重复授权，属独立议题。
- **旧引擎/非 Chromium 差异** → 不识别 `allow` 的引擎忽略该属性；识别但无此特性的引擎视为 no-op，无回归。
- **前端产物缓存** → 改动只落 `cockpit-web` 源码，生产 assets 带哈希，3090 静态托管按请求读盘，刷新即生效；`sw.js` 未改，`CACHE_VERSION` 不 bump（跨源 iframe 本就不被 SW 拦截）。

## Migration Plan

1. 修改 `allow` 属性 → `pnpm build` 产出新前端产物 → 刷新驾驶舱页面（无需重启服务）。
2. 回滚：还原 `allow` 值并重新构建。无服务端、数据目录、协议或存储迁移，无副作用。
3. 人工验证清单：① 驾驶舱工作台内 DSH 语音输入可正常录音；② 浏览器授权框中拒绝时设备页面显示真实失败提示；③ 直接访问 `http://127.0.0.1:3080` 行为不变；④ 工作台懒加载/切换/离线遮罩等既有交互无回归。

## Open Questions

无。
