## Verification Results

### Task Completion
- [ ] All tasks marked `[x]` in tasks.md: 175 of 177 are done.
- Remaining open tasks: both need a real browser and a person to drive it, so the agent cannot complete them.
  - **12.4**: run `node scripts/acceptance/forward-grace.mjs --device <id>` against a real browser session. This is a human decision recorded in the design: the 30s grace period must be measured in a real browser. The script decides pass/fail itself.
    - Precondition: the target device has a held (non-pinned) forward on 3939 with exactly one holder. A consumer in the device page must create it; the script cannot, because it has no browser page id.
  - **12.5**: manual browser check. It covers:
    - creating and deleting pinned entries in the device panel;
    - reloading the device page releases its holders;
    - the DSH settings section is read-only.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test. There are 59 scenario rows. The acceptance row is `N/A — non-executable`, and its script is task 12.4 (see Evidence).
- [x] Every test-plan.md row flipped to 🟢 green (59/59; no 🔴 row left).
- [x] Full suite passes.
- [x] Zero skipped/pending/commented-out tests. A grep for `it.skip|it.only|describe.skip|.todo(|xit(` over `packages/*/tests` and `tests/` finds nothing.
- [x] No test weakened or deleted without a REMOVED requirement. The deletions all follow the spec REMOVED requirement "端口发布须经设备侧登记…" and design D8, which removes the old seam in the same release:
  - the server group `publishable port registration and publishing`;
  - five bridge `cockpitBridge.portForward` tests.

  The behaviors that survive were carried over, not dropped:
  - The three group-1 ownership tests ("additional forwards survive workbench connection replacement") now drive `acquireForward`.
  - The `app-auth.e2e` bridge allow-list regression now targets `forwards/acquire|release`.
  - Capability renewal on 400/401 got an equivalent `forwards` test.
- Tests that were green when first written are annotated in tasks.md. Each was confirmed by a mutation that makes it fail: 2.13, 2.25, 3.19, 4.4, 4.7, 4.10, 6.7, 6.10, 6.22, plus the batch-written tests of groups 7 and 10.

### Evidence
- Final full-suite command: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`. It exited 0, run fresh at commit `fc88e40`.
- Result summary (0 failed, 0 skipped):

  | Suite | Files | Passed |
  |---|---|---|
  | root `node --test tests/*.test.mjs` | — | 12 |
  | shared | — | 8 |
  | server | 24 | 302 |
  | web | 10 | 92 |
  | bridge | 3 | 31 |

- `openspec validate device-forward-registry --strict` reports `Change 'device-forward-registry' is valid`.
  - ⚠️ 2026-10-08 复核：这条在 `fc88e40` 之后**曾经不再成立**。主 spec 后来被 `8e2b2bb`（归档前同步）改过，而本 change 的两个 MODIFIED 块改写了主 spec 的场景名（`设备禁用时终止全部附加转发`、`驾驶舱退出时自有转发`、`能力串无效时以既有响应拒绝`），校验器按场景名判定，于是把改名判成丢场景并拒绝归档；`附加转发失败不影响工作台` 则是被整个丢掉。组 14 把三个名字改回主 spec 逐字名称并恢复被丢掉的场景，validate 重新通过（修复过程与补测记在 tasks 组 14）。**教训**：MODIFIED 块替换的是整块 requirement，场景名是身份，改名等于删除。
- Non-executable checks run:
  - `node --test tests/forward-grace.test.mjs`: 4/4 pass. It pins the acceptance script's judgments: precondition, pid stability, the 30–40s reclaim window, argument parsing.
  - `node scripts/acceptance/forward-grace.mjs` with no `--device` exits 1. With a missing token file it also exits 1.
  - The real-browser run itself is task 12.4 and is still open.
- 2026-10-08 组 13/15 复跑（`pnpm build && pnpm typecheck && pnpm lint && pnpm test`，exit 0）：root 12、shared 8、server 332、web 95、bridge 50（新增 `forwards-styles.test.ts`、`nav-icon.test.ts`）；`openspec validate --strict` 报 `is valid`。设置区块与导航字形的视觉核对在**仓库外**的真实 DSH 令牌夹具里完成（深浅色 + 380px 窄栏 + 5x 放大的导航字形），未进入仓库。
- 11.5 stale-reference grep: `grep -rn "publish-port\|publishable-port\|已登记端口" README.md BACKLOG.md packages/*/src` finds nothing (exit 1).
- 11.4 bundle: `pnpm --filter dsh-cockpit-bridge build` produces `lib/client.js`, with `react` external and supplied by the DSH profile.

### Review Integrity
- [x] review.md has `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes`.
- [x] The verdict is not stale. `git log 80589ad..HEAD` shows no commits touching `proposal.md`, `design.md`, `specs/` or `review.md` during implementation.
  - Implementation-time notes live in tasks.md only. One example: the snapshot keeps the system row without pid, so the D9 settings section can show the workbench channel as its spec scenario requires.
- [x] **范围追加已由 owner 接受（2026-10-08）**：owner 明确表示接受把「设置区块可读性与样式」与「设置导航行图标」并入本 change，**不重跑 review**。下面保留当时记下的影响面，作为审计痕迹。上面的“verdict 不过期”只对 `fc88e40` 那次验证成立。此后按 owner 决定把「设置区块可读性与样式」并入本 change（tasks 组 13），改动了 `proposal.md`（What Changes 的区块表述）、`design.md`（D9 扩写为「区块要回答什么 + 宿主拥有主题 + 一个记忆点」）与 `specs/cockpit-device-port-forward/spec.md`（设置区块 requirement 增加自解释、状态文字与主题约束及 5 条新场景）。因此 `review.md` 的 APPROVE_WITH_CHANGES 严格说不能直接沿用——owner 已在上面明确接受这次追加，故**不重跑 review**，归档时以 owner 接受为凭。组 14 的场景身份修正不动语义，只把被改名的场景改回主 spec 的逐字名称并恢复被丢掉的场景。
- [x] All findings fixed or rebutted. 🟡-1 through 🟡-8 are fixed and accepted by the reviewer. 📌-9, 📌-10 and 📌-11 were deferred by the author as non-blocking; 📌-9 was addressed in code anyway:
  - `release-instance` validates `pageId` → 400 `invalid-page`;
  - it starts the page grace timer, so an ended-instance set cannot stay resident forever.

### Acceptance Round（2026-10-08，0.6.2 发布后）

- **发布**：bridge 0.6.2 已发布为 GitHub release（tag `dsh-cockpit-bridge-v0.6.2`，资产 48718 B，`sha256 99c24ff2…46a4`，下载物与本地字节一致，URL 实测 200）。本机与 lumevm 的 ohmydsh manifest pin 均已指向该 URL 并完成 `dsh build`（两边部署物 `version=0.6.2`，`lib/client.js` 含 `dsh-cockpit-forwards-nav` 与 `dshcf-meter`）。
- **12.4 实测 PASS**：`PASS  offline-watch=60s background=360s reclaim=30.2s`（lumevm，`additional:3939 ready, 1 holder, pid 69907`）。
- **已修复：设备页面重载不释放旧实例的持有者**（2026-10-08，见 tasks 组 16）。根因实测定位：bridge 在 `pagehide` 发出的实例结束消息**确实送达父页面**，但父页面「按 `event.source` 归属」这一步在跨文档导航后必然失败——发送方窗口已消失，处理消息时 `event.source === null`（浏览器控制台实测），于是 `release-instance` 从未被调用，旧实例的持有者只能靠驾驶舱页面的 30 秒宽限兜底。修法：`source` 为 `null` 时归属到**唯一**一台「已向该 origin 下发过配置且 iframe 仍挂载」的设备；非 `null` 的 source 不匹配仍拒绝（既有 `ignores instance-ended from a foreign source…` 测试当场抓到第一版放宽过度）。真机复验：导航设备页后持有者**3 秒内**清零（修复前一直存活到驾驶舱页断开 + 30 秒）。规范里「实例结束」的归属规则已相应改成两步判定并写明理由。
- **历史记录（修复前）**：**设备页面重载不会释放旧实例的持有者**。owner 真机核对：重载后条目未消失；数据佐证 —— 同一设备端口上有两个不同 bindingId 的持有者（shim 每次页面加载生成一次 bindingId，两个绑定 = 两次页面加载，若重载释放旧实例则只应剩一个）。`pagehide` → 父页面 `release-instance` 这一段没有产生效果，根因未定位。影响有界：持有者最终由驾驶舱页面宽限兜底（12.4 第③步实测 30.2 秒回收），条目始终可见可删，隧道不会变成死缓存。**归档前置：先决定修还是显式记为已知限制；决定前不得归档**（否则会把已知为假的场景并入主 spec）。
- **12.5 三项中两项已真机核对**（详见 tasks 12.5 的逐项记录）：面板建/删常驻与区块同步、区块只读与新呈现、本机设备态、导航字形；**唯一未完成**的是「设备页重载释放持有」，原因是本次的浏览器驱动无法在跨源 frame 内发起 reload，已给出人工复核步骤。
- **不需要重启本机 DSH**（修正早先的判断）：DSH 的客户端插件由宿主**按请求从磁盘提供**，`dsh build` 后本机 3080 的页面刷新即可加载 0.6.2 —— 已由「本机设备区块显示新版 `本机设备无需转发` + 新说明」实测证明；本 change 又只改客户端半区（host 半区 `lib/index.js` 未变），故无需重启。原计划里「重启会终结会话」的顾虑随之消失。
- **环境陷阱（运维）**：lumevm 的 SSH 别名走 `lume-ssh-proxy`，它调用裸 `lume`；若驾驶舱从 PATH 不含 `~/.local/bin` 的 shell 启动，lumevm 会静默降级为 `SSH_UNREACHABLE`（devbox 不受影响）。用带 `~/.local/bin` 的 PATH 重启驾驶舱后即 READY。

### Delivery Decisions（owner，2026-10-08）

- **不 bump 版本**：owner 决定本次不动 `packages/dsh-cockpit-bridge` 的版本号（仍为 0.6.1），到正式发包时再 bump。
  - 由此产生的已知不一致：仓库里重建的 `lib/client.js`（含设置区块改版与图标）与本机/ohmydsh 已部署的 0.6.1 发布物**内容不同、版本号相同**。任何本地部署（验收用）都必须以临时路径或别名区分，或先发包再部署，避免把「改动过的 0.6.1」当成已发布的 0.6.1。
  - 版本 bump 与 GitHub release 资产、ohmydsh manifest 的 `spec`/`version`/`integrity` 三者必须在同一次发包里一起更新。

### Change Delivery
- Commit range on branch `ws/dsh-cockpit-openspec-change-device-forward-regis`: `42e2f31..fc88e40`, 14 implementation commits on top of base `80589ad`, plus this verify commit.
- The branch has not been merged or archived. That needs the owner's approval, together with the outcome of 12.4 and 12.5.
- Dependency change (made after `ws promote`): `dsh-cockpit-bridge` gains a `react` peer (`^18.2.0`) and a dev dependency (`~18.3.1`), plus `@types/react`. The lockfile diff is only the two importer lines, because the versions were already locked by `cockpit-web`.

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ PASS WITH WARNINGS:
1. Tasks 12.4 (real-browser 30s grace acceptance) and 12.5 (manual browser check) are still open. They are human-run and must pass before archive. 12.5 现在还要覆盖设置区块改版后的深浅色呈现（13.17 的自有预览夹具只能证明样式与令牌，不能替代真实宿主）。
2. **范围追加已由 owner 接受，无需重跑 review**（见 Review Integrity）。仍待人工完成的是 12.4/12.5 两项浏览器验收。
3. Release coupling. The cockpit and bridge 0.6.0 must ship and roll back together. Downstream `cockpitBridge.portForward` consumers, such as the ohmydsh memex shim, fall back to local addresses until they migrate. Rolling back drops pinned marks on the old version's next registry write. All of this is documented in the bridge README's "0.6.0 发布说明" (release notes).
