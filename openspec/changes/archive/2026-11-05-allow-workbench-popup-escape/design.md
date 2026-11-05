## Context

工作台 iframe 在 `packages/cockpit-web/src/workbench/Workbench.tsx` 中渲染，当前属性为 `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`。src 指向设备的回环隧道端口，与驾驶舱 `127.0.0.1:3090` 跨源。fix-workbench-clipboard 和 fix-workbench-microphone 两个归档 change 都明确把 `allow-popups-to-escape-sandbox` 留作后续独立评估。动机见 proposal.md。

复现证据（2026-11-05，真实 Chrome headless，父页 `127.0.0.1:8811`，子 iframe `127.0.0.1:8812`，经 CDP 发送真实点击）：

| sandbox | 子页 `window.open('about:blank')` → `opener=null` → 300ms 后 `location.replace(同子源/target)` |
|---|---|
| 当前四个令牌 | 能打开标签页，但 `replace` 抛 `SecurityError`，停在 about:blank |
| 加上 `allow-popups-to-escape-sandbox` | 跳转成功，目标页加载 |

## Goals / Non-Goals

**Goals:** 让设备页面打开的新标签页与单独打开 DSH 时一致，使 DSH 浏览器登录在驾驶舱内可用。

**Non-Goals:** 不放宽 iframe 自身的沙箱（顶层导航、模态框、下载等），不改 Permissions Policy，不在驾驶舱侧实现任何登录代开或中转。

## Decisions

1. **添加 `allow-popups-to-escape-sandbox`，而不是去掉 `sandbox`。** 去掉 `sandbox` 会连带放开 iframe 的顶层导航等能力，超出需求。只加这个令牌，影响面限于弹出的新标签页。
2. **不由父页面代开窗口（postMessage 反向通道）。** 跨异步边界后再 `window.open` 会被弹窗拦截，还会引入第一条命令式的反向通道（参见归档 remote-editor-open-seam 的取舍），并且违反「操作面零协议耦合」。
3. **安全取舍。** 设备 DSH 是用户自己的受信页面，单独打开时弹窗本来就不受沙箱约束。脱离沙箱只是让嵌入后的行为与原生一致；新标签页仍按自身 origin 受浏览器同源策略约束，且 DSH 已主动断开 `opener`。

## Risks / Trade-offs

- [设备页面打开的标签页获得完整的顶层能力] → 与单独使用 DSH 时等价，没有新增攻击面；iframe 自身仍不能导航驾驶舱顶层。
- [其它浏览器的继承语义不同] → 该令牌是标准 HTML 令牌，Chrome、Firefox、Safari 均支持，不支持时退化为现状。

## Migration Plan

重新构建 web 产物后刷新驾驶舱页面即可生效，不改 SW，无需 bump `CACHE_VERSION`。回滚只需去掉这个令牌。
