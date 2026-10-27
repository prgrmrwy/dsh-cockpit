## Context

等待（`approval` / `question`）与完成未读（`completed`）已由服务端聚合为每设备 `sessionStatuses`，经 `/api/devices/stream`（SSE）推到前端，`main.tsx` 的 `subscribeDevices(setDevices)` 是唯一入口。提示音只需在前端比较前后两帧的计数。

## Goals / Non-Goals

**Goals:**
- 等待增加 → 敲门声；完成未读增加 → 叮声；听声可区分。
- 首帧 / 新设备 / 重新 READY 只建基线；同类短窗口合并。
- 一个本地开关，默认开。

**Non-Goals:**
- 系统通知（Notification API）、用户自定义音效、按设备区分音色、分别开关两种声音。
- 服务端或 bridge 任何改动。

## Decisions

1. **纯函数判定 + 薄播放层**：新建 `src/chime.ts`。
   - `detectChimes(prev: Map<deviceId, { waiting, completed }> | undefined, devices) → { next, knock: boolean, ding: boolean }`，纯函数便于 vitest。
   - 只把 `enabled && state === 'READY'` 的设备写入 `next`；`prev` 为 `undefined`（页面首帧）或 `prev` 中无该设备（新设备 / 刚恢复 READY）时只建基线。非 READY 的设备从 `next` 中移除，从而重新 READY 的首帧自然成为基线——避免重连时把已有的等待/未读当作新增。
   - `waiting = count(approval) + count(question)`，`completed = count(completed)`。
2. **Web Audio 合成**：共享一个懒创建的 `AudioContext`。
   - 叮：正弦约 1320Hz，起音 ~5ms、指数衰减 ~600ms，叠一个低音量八度泛音，听感为「叮~」。
   - 敲门：两下间隔 ~150ms 的叩击，每下为 ~120Hz 正弦 + 短促噪声/三角波包络（~80ms 快衰减），听感为「咚咚」。
   - 无静态资源，不涉及 SW 缓存清单，不 bump `CACHE_VERSION`。`resume()` 失败静默吞掉；首次 `pointerdown`/`keydown` 时尝试 `resume()` 解锁。
3. **合并窗口**：每类声音各自记录上次播放时间，1000ms 内同类重复调用忽略（节流，首声即时）。同一帧既有 knock 又有 ding 时先敲门、~400ms 后叮，避免叠音含糊。
4. **接入点**：`main.tsx` 用 `useRef` 保存上一帧计数，SSE 回调与 `refresh()` 结果都经 `detectChimes`，再按结果调用播放。
5. **偏好**：`localStorage['cockpit:chime']`，值 `'off'` 表示关闭，其余（含缺省）开启。设置面板加 checkbox 读写该键；播放函数每次读取，避免跨组件状态同步。

## Risks / Trade-offs

- [浏览器在页面从未交互时拒绝发声] → 静默失败；常驻标签页/PWA 通常已交互过，可接受。
- [官方完成快照晚于 READY 到达，驾驶舱重启后补回的旧未读会在 READY 后从 0 升到 N] → 会叮一声。这是「驾驶舱此刻新看到一个未读」，可接受，不为此增加状态。
- [等待事件离线期间读不回来（rc.2 协议边界）] → 只影响是否显示，不会误响；回来后的新等待照常敲门。
- [清除后官方标记翻转] → 服务端已保证清除后不跳回（现有 spec），不会误叮。
