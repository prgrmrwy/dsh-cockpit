# 真机验证记录（2026-10-09，host 设备 · DSH 0.2.0-rc.2 · bridge 0.6.4 经 `dsh build` 物化）

物化证据：ohmydsh pin → 0.6.4（`b22e60c`）；`dsh build` 输出 `spec drift … -> …v0.6.4… re-adding`、`2 change(s) applied`；
profile 内 `lib/client.js` sha256 `6cca32f68adb891ec2056210c8df965718ef43a35d4ac929f6f8f897b8c94bcb` == 下载到的 release 产物内同路径文件；
hello 报 `{"version":"0.6.4"}`；DSH web 进程未重启（PID 42553）。

## 4.1 驾驶舱重启后仍显示官方未读（旧模型做不到的场景）

| 步骤 | 驾驶舱 `sessionStatuses` | DSH 侧栏 |
|---|---|---|
| 新建会话跑 `sleep 12`，切走，等完成 | `running×1, completed×1` | 1 行「已完成」 |
| **仅重启驾驶舱服务端**（不碰任何页面） | t+5s…15s `running×1`（重连中），**t+20s 起恢复 `running×1, completed×1`** 并持续稳定到 t+70s | 仍为 1 行「已完成」 |

即：驾驶舱未观测到完成边缘、新进程内存清零之后，提醒由 bridge 上报的官方 `completionUnread` 补回（修复前这条提醒永远丢失）。

## 4.2 手动清除不跳回

`POST /devices/device-n7cr6mnv/completed/ack` → 201；之后每 5 秒采样 30 秒（期间 bridge 持续重发含 `completionUnread:true` 的同一快照）均为 `running×1`，没有恢复显示。

## 过程中暴露并修复的缺陷

1. **`/api/bridge/status-snapshot` 的 CORS 预检被 403**：新路由漏登记到 `BRIDGE_CALLBACK_ROUTES`（该名单在 `cockpit-api-auth` 里是唯一权威来源）；表现为 bridge 的上报在浏览器预检阶段被拒，控制器单测完全看不到。修复：规格 delta（`cockpit-api-auth` MODIFIED）+ 实现 + 一条遍历整张名单发真预检的端到端测试（去掉新路由即变红，已验证）。
2. **bridge 对不含该路由的旧驾驶舱要宽容**：404/405 视为可选增强被拒绝，本次激活内不再重试，且不阻塞其后的会话打开确认（新增测试；54 passed）。

## 已知边界（记录，不是缺陷）

- 官方 `completionUnread` 保存在 **DSH 页面内存**（`dsh-client-ui-session` 的 `completionUnread` Set），页面重载即清零。所以「重载 DSH 页面」之后 DSH 自己也不再显示那条绿点，驾驶舱随之清除——两侧仍然一致，这是官方语义。本 change 解决的是**驾驶舱侧**重启/离线/断连期间的漏报。
- 4.3（回退路径）：lumevm / devbox 仍是旧 bridge，按你的要求未动；回退模型由 `keeps the run-round model for a device that never sent the official snapshot` 等测试覆盖，真机回退验证待你升级其中一台之外的状态下确认（当前 `bridgeSeenAt: null`）。
