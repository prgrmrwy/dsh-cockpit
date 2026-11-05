<!-- 依赖顺序：shared 契约 → 隧道严格绑定 → 转发表/服务/注册表 → 端点 → web（P0 完成）→ P1 命令解析（以 design D6 的用户决定为前置）→ 集成验证。每组自带测试；测试先红后绿。 -->

## 0. 前置条件

- [x] 0.1 在基线提交上运行 `pnpm test`，确认全绿后再开工

## 1. shared 契约（design D1、D7）

- [x] 1.1 `packages/shared/src/forwards.ts`：
  - `PinnedForwardRecord` 加 `sameLocalPort?: true`、`openPath?`、`urlCommand?`；
  - `AdditionalForwardRow` 加 `sameLocalPort: boolean`、`openPath?`、`urlCommand?`；
  - 新文件 `forward-options.ts`：`ForwardPinErrorCode`（`local-port-conflict`、`invalid-open-path`、`invalid-url-command`）、`ForwardOpenErrorCode`、校验函数 `isValidOpenPath` / `isValidUrlCommand` 与 `forwardOpenUrl`。运行时代码不放进 `forwards.ts`，因为 bridge 的 `lib/` 内联了该模块，放进去 `lib/` 就会变。

  验证：新建 `packages/shared/tests/forward-options.test.ts`，断言，`toForwardsSnapshot` 的输出不含 `sameLocalPort`、`openPath`、`urlCommand`；校验函数覆盖边界值：长度、前导 `/`、换行、`0x7F`。

## 2. 隧道严格绑定（design D2）

- [x] 2.1 `TunnelRequest.strictLocalPort`：只试该端口，不回落到内核端口；预绑定失败或 OpenSSH 绑定失败时抛出端口占用错误，诊断为 `local port 127.0.0.1:<p> is in use`；其它早退在 `maxBindAttempts` 内用同一端口重试。验证：`packages/cockpit-server/tests/ssh-tunnel.test.ts` 新增「严格端口被占用时不漂移」「OpenSSH 绑定失败时报端口占用」「链路早退时用同一端口重试」三个用例。
- [x] 2.2 主通道的复用与回退行为保持不变。验证：`ssh-tunnel.test.ts` 中既有的 persisted-port、drift 系列用例全部仍为绿。

## 3. 转发表、服务与注册表（design D1、D3、D4）

- [x] 3.1 `DeviceForwards`：
  - 条目携带 `sameLocalPort`、`openPath`、`urlCommand`；
  - `#start` 在 `sameLocalPort` 为真时传 `strictLocalPort`；
  - `pin` 按字段合并：`undefined` 保留原值，空串清除；
  - `sameLocalPort` 变化时 bump generation、dispose 子进程并重建，持有者保留；
  - 投影输出这些新字段。

  验证：`forward-table.test.ts` 新增四个用例：「同端口条目自愈后端口不变」「切换同端口标记重建子进程且持有者数不变」「只改 openPath 不重建」「端口占用诊断进入 retrying 且投影不含本地端口」。
- [x] 3.2 `ConnectivityService.pinForward`：先做冲突检查再落盘。检查范围：其它设备的同端口条目（含正在写盘的占位）、各远端主通道的当前端口与已持久化端口；命中时抛 `local-port-conflict`，转发表与注册表都不变。检查和占位在同一个同步段内完成，占位只在写盘期间存在，其余来源直接读内存转发表和注册表（design D3）。另外：恢复常驻条目时带上新字段；bridge acquire 同一端口时复用同端口条目。验证：`connectivity.service.test.ts` 新增四个用例：「跨设备同端口冲突被拒且不落盘」「并发为两台设备创建同一同端口条目恰有一个成功」「与主通道端口冲突被拒」「重启后同端口条目以设备端口重建」。
- [x] 3.3 `registry.ts` 的 `validatePinnedForwards`：新字段不合规时只丢弃该字段并告警，告警中不含命令文本，常驻标记保留；旧记录照常读取。验证：`registry.test.ts` 新增用例「非法 urlCommand 只丢字段且告警不含命令」「旧记录兼容」。

## 4. 管理端点（design D5、D7）

- [x] 4.1 `POST /api/devices/:deviceId/forwards` 接收 `sameLocalPort`、`openPath`、`urlCommand`，非法值分别返回 409 `invalid-open-path` 或 `invalid-url-command`。验证：`forwards.controller.test.ts` 与 `app-forwards.e2e.test.ts` 覆盖成功、各拒绝码、仅带能力串的请求被拒。
- [x] 4.2 新增 `POST /api/devices/:deviceId/forwards/:devicePort/open-url`。P0 阶段的行为：
  - 条目不是 `ready` 时返回 409 `forward-not-ready`；
  - 条目没有命令时返回 409 `url-command-no-url`，不执行命令；
  - 走 cookie 加同源校验，不加入 bridge 回调名单。

  验证：`app-forwards.e2e.test.ts` 新增用例；`bridge-route-list.test.ts` 仍为绿。

## 5. 面板（design D5；P0 收尾）

- [x] 5.1 `ForwardList.tsx` 创建分组新增三项：「本地端口同设备端口」复选框、「打开路径（可选）」输入框、「打开地址命令（可选）」输入框（第 6 组已同期完成，故直接显示）。要求：三项与端口、标签同在一个分组内；失败时保留输入；`CODE_TEXT` 补齐新错误码的固定文案。`api/client.ts` 的 `createForward` 接收这些选项。验证：`forward-panel.test.tsx` 新增「创建同端口常驻条目」「本地端口冲突时保留输入与勾选」。
- [x] 5.2 行内「打开」：仅附加条目在 `ready` 时可用，位于首行右侧、删除按钮之前；system 行没有该按钮。行为：
  - 无命令：执行 `window.open(url, '_blank', 'noopener,noreferrer')`，不发请求；
  - 次行显示「同端口」与打开路径，均为纯文本。

  验证：`forward-panel.test.tsx` 新增「就绪行打开正确地址且不发请求」「未就绪与 system 行没有可用的打开」「次行纯文本渲染」。
- [x] 5.3 样式只用既有令牌，深浅两种主题都正常，窄屏下无横向溢出。验证：`styles.test.ts` 仍为绿，并补充新类名的令牌断言。

## 6. P1 打开地址命令（design D6；以用户对 D6 的决定为前置）

- [x] 6.1 确认用户已就 design D6 拍板，并在 design 的「人类决策记录」中写明决定与日期。若用户选择结构化来源或不做 P1，先修订 spec、design 与本组任务，再继续。
- [x] 6.2 新建 `connectivity/forward-url-command.ts`，要求：
  - 调用 `ssh -T BatchMode ConnectTimeout=5 -- <alias> <command>`，`shell: false`，stdin 关闭；
  - 超时 10 秒后 SIGKILL，stdout 上限 64 KiB，丢弃 stderr；
  - 取最后一个同 origin 的 URL 并把端口换成 `localPort`；
  - 只返回 `{ url }` 或失败枚举。

  验证：新建 `forward-url-command.test.ts`，以可注入的 spawner 覆盖：多个匹配时取最后一个、剥掉行尾标点 `).,;]`、忽略其它端口与 `localhost`、空输出、非零退出、超时后已 kill、输出超限、端口替换。
- [x] 6.3 解析端点在条目配有命令时调用 6.2；日志只记录设备 id、端口与结果 code。验证：`app-forwards.e2e.test.ts` 新增各错误码用例；哨兵用例断言 `SECRET` 不出现在捕获的日志、注册表文件、状态流投影与 iframe 快照中。
- [x] 6.4 面板：显示「打开地址命令（可选）」输入框；配了命令时，「打开」先同步打开空白窗并置空 opener，再请求解析端点，成功则导航，失败则关闭空白窗并原位显示固定文案；次行以纯文本显示命令。验证：`forward-panel.test.tsx` 新增「命令成功导航空白窗」「解析失败关闭空白窗并显示说明、不显示输出」。

## 7. 集成验证与文档

- [x] 7.1 运行 `pnpm build && pnpm typecheck && pnpm test && pnpm lint`，全部通过，并在回复中如实报告。
- [x] 7.2 本机实测：在一台远端设备上创建 3082 同端口常驻条目，然后依次验证四种情况：
  - 在本机预先占用 3082，确认诊断出现；
  - 释放端口后条目自动恢复为 `ready`；
  - 「打开」得到 `http://127.0.0.1:3082/...`；
  - 配了命令时，设备侧服务重启、token 轮换后再次「打开」，拿到的是新 token。

  把结果记录在本 change 中。

  结果（2026-11-06，用户在操作机上实测，部署侧在 devbox 配合）：同端口创建后打开 SA 面板正常，没有同源 403；本机 3082 被占用时诊断显示 in use，端口不漂移；SA 重启后 token 指纹已轮换，重新打开时拿到新 token。四项全部通过。验收中发现「本地端口同设备端口」那一行样式错位，已在 `f57ec9b` 修复。
- [x] 7.3 README 的转发小节补写同端口与「打开」的用途和限制：每个本地端口只能被一台设备占用；不做 Host 改写；回滚到旧版会丢失新选项；`CHANGELOG.md` 增加条目。验证：文档中的描述与 spec 一致。
- [x] 7.4 在协作空间 `cockpit-shim-publish` 通知部署侧成员 change 已落地，请其做部署侧验证：固定 3082、端口占用诊断、token 轮换后重新打开。

## Workflow follow-up

- 用户验收后，按 `openspec-archive-change` 流程归档本 change，并把 delta 合入 `openspec/specs/`。
