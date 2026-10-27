## 1. 判定逻辑

- [x] 1.1 写失败测试 `packages/cockpit-web/tests/chime.test.ts`：首帧不响、新设备不响、非 READY→READY 首帧不响、完成增加→ding、等待（approval+question）增加→knock、减少/不变不响、禁用设备忽略、多设备同时增加只报一次
- [x] 1.2 实现 `src/chime.ts` 的 `detectChimes` 使 1.1 通过

## 2. 播放与偏好

- [x] 2.1 实现 `playDing()` / `playKnock()`：共享懒建 `AudioContext`、按 design 合成两种音色、每类 1s 节流、同帧先敲门后叮、失败静默；首次 pointerdown/keydown 尝试 resume
- [x] 2.2 偏好读写 `localStorage['cockpit:chime']`（缺省开启），关闭时直接返回；补单测覆盖开关与节流（mock AudioContext）

## 3. 接入

- [x] 3.1 `main.tsx`：SSE 回调与 `refresh()` 经同一判定，按结果播放
- [x] 3.2 设备管理面板（☰）摘要行增加「提示音」开关

## 4. 验证

- [x] 4.1 `pnpm build && pnpm typecheck && pnpm test && pnpm lint` 全绿
- [ ] 4.2 本机实测：后台会话跑完听到「叮」；会话请求审批听到「咚咚」；刷新页面不响；清除/回答不响；关闭开关后不响
