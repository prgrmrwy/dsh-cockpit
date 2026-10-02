## 1. 问题 A：建立导航回归基线

- [x] 1.1 记录生产构建、每设备origin与父src赋值/子文档提交数量，区分官方303与额外导航，不记录token/cookie/HAR原文。真实隔离Chromium从fresh app load捕获本机host iframe origin `http://127.0.0.1:3080`：父iframe `src`属性有1次可观测write mutation，tokenized Document request随后官方303至干净根Document request，最后根页面200/commit一次。相同流程在lumevm origin `http://127.0.0.1:54695`观察到1次父src属性mutation、同一个loader/frame的一次tokenized Document request→官方303→干净根request，以及最终根Document 200/commit一次。完整URL/query值均已脱敏且未保存。303是DSH在同一frame/loader内的服务端redirect，不应误计为Cockpit额外父src写入。
- [x] 1.2 添加延迟启动回归：pending期间设备首包/重复SSE/StrictMode不加载裸endpoint；启动失败不导航且保持恢复遮罩。
- [x] 1.3 单测含重复load、deadline后晚load、pending更新与A→B→A不重试。共用DOM `src` mutation oracle覆盖pending期0次、accepted launch 1次、重复load与deadline late-load均无后续赋值、generation恢复/新origin各仅一次，以及设备tab往返不重写；相关workbench tests通过。
- [x] 1.4 覆盖恢复响应新generation、SSE更新、new origin、stale response、显式retry、rc.2干净启动、禁用/删除/重启用生命周期；除API调用外补充src写入计数：rc.2兼容endpoint一次直接赋值且load/SSE不重放；禁用保留期与删除不写入，重新启用新frame仅写入新endpoint一次；旧生命周期晚响应0次写入，当前生命周期成功响应恰一次。rc.2不由Web可见protocol enum区分，本单测从不可配置认证状态及服务端返回clean endpoint响应建模其契约；具体runtime variant选择由server负责。

## 2. 问题 A：仅修改 Cockpit 导航所有权

- [x] 2.1 拆开非敏感endpoint/tuple身份与实际导航命令，状态同步不再抢先填写生产iframe的裸endpoint。
- [x] 2.2 使用稳定iframe与单次imperative导航；生产JSX不绑定动态src、不设置空字符串src，已接受命令消费一次，保留恢复新generation的去重。
- [x] 2.3 load/deadline只清临时引用、更新不可观测阶段并继续bridge握手，不导航干净endpoint、不删除src、不重建frame；timer不捕获带token URL。
- [x] 2.4 卸载/disabled cleanup实现；新测试验证disabled后重启用新的iframe生命周期，并确认旧启动响应不能导航新iframe，当前导航仍可正常消费。
- [x] 2.5 更新README的DOM src残留安全取舍与结果不可观测说明；确认未改后端认证、原生DSH、ohmydsh、node_modules或远端。

## 3. 问题 A：验证并审查

- [x] 3.1 运行pnpm build、pnpm typecheck、pnpm test、pnpm lint；本轮最终代码快照下四项均通过，记录于验证记录。
- [x] 3.2 已用真实隔离Chromium在3090 capture host/lumevm启动导航：两种origin各一次父`iframe src`可观测mutation、一次带query Document request、同一loader的官方303、clean root Document request，最终只一次200文档响应/commit。等待超过10秒导航deadline，reload前检查远端Document request列表无deadline附加导航。随后主动刷新3090一次，又观察lumevm同一模式的一次导航链及单次commit；刷新时默认选中的lumevm页面可用，但并未预先选定某个历史session。真实浏览器中overview面板遮挡了物理点击，但在隔离页面中通过DOM触发实际应用tab事件完成host→lumevm→host切换，selected device随之切换、host和lumevm iframe DOM均保留；该切换前清空Network Document日志，完成往返后仍为0条iframe文档请求，符合保活/无重导航预期。所有trace只保存origin与是否有query，不保存query值。
- [x] 3.3 重建3090实际托管Web产物并在现有本机及远端验证首次进入、整页刷新、A→B→A。实际3090构建已加载；Chromium确认host/lumevm首次进入及lumevm刷新时各一次导航链、官方303和最终clean root 200，刷新后selected tab是lumevm。排除首次提示性overview后，真实locator物理点击由host→lumevm→host往返成功；每次switch前清空Document日志，两次切换皆为0次Document请求，且两iframe在往返后仍保留。导航证据未包含预选session刷新恢复；Problem B以用户手动结果独立记录。
- [x] 3.4 审查改动范围和token引用/DOM残留边界，记录未验证场景。仅Workbench源码、测试、README及此change artifacts有更改；无服务端认证/native/remote patch。

## 4. 问题 B：独立验证会话恢复，原生问题暂不修

- [x] 4.1 用户报告已在Cockpit手动打开一个已有会话。手动操作由用户确认，非隔离浏览器可观察证据；未发送消息、未创建/归档/删除用户会话。
- [x] 4.2 用户报告主动刷新Cockpit后仍显示同一个会话，因此该结果保留为用户手动验收；非代理独立观察，未明确报告A→B→A，也无独立trace；不与frame/tab保活证据混同。
- [x] 4.3 范围处置（非验证通过）：根据用户确认的收口范围，本次不做同origin原生DSH reload/version对照；未取得该证据，不推断native缺陷，也不修改native。本条件诊断明确不属于本change的归档门槛。
- [x] 4.4 问题B手动验收：用户报告选中既有会话后刷新Cockpit，仍保留同一会话，故刷新恢复在该环境下表现正常。不是隔离浏览器可复现证据，也没有native DSH对照；遵循用户边界，不修native DSH、不由Cockpit强制恢复session。

## 5. 收口

- [x] 5.1 A核心修复、全仓验证及真实Chromium首次启动/刷新/host→lumevm→host往返trace均完成。B以用户手动验收为本次可接受的验收证据：用户报告选中既有会话后刷新Cockpit，仍为同一会话；此证据明确标记为用户报告，非代理独立观察。4.3原生对照/version诊断未执行且不属于本次收口要求；不推断native故障，不修改native/ohmydsh或强制恢复session。

## 验证记录（2026-10-01）

- **A / repo（2026-10-01最终快照）**：新增计数测试/iframe-local MutationObserver oracle后，再次运行`pnpm build`、`pnpm typecheck`、`pnpm test`、`pnpm lint`均通过；web suite 8 files / 85 tests，server 21 files / 276 tests，bridge 1 file / 27 tests，shared 8 tests及root 8 tests通过。Workbench聚焦suite 36/36通过。Build有既存npm环境和bridge define warnings，未阻断验证。`git diff --check`通过。
- **A / 3090生产产物**：隔离Headless Chrome 152运行于现有`http://127.0.0.1:3090/`，本机host首次进入（DSH origin `http://127.0.0.1:3080`）和lumevm首次进入/刷新（DSH origin `http://127.0.0.1:54695`）各采集一次父`iframe src` mutation。每次远端trace显示单个带query Document request，同一frame/loader收到官方303、再请求干净根路径，最终干净Document HTTP 200且只commit一次；host首次路径也对应相同303→root 200链。reload时父shell Document 200一次，lumevm亦为一条Document链。等待超过10秒导航deadline后复查Network document列表，未见deadline额外请求。清空Document日志后在隔离页面DOM触发实际app的host→lumevm→host tab事件，选中设备正确变化、两iframe均保留，往返期间新增Document请求为0。真实locator曾受overview遮挡；通过关闭初始提示性overview后，physical click完成host→lumevm→host，每步selected tab变化正确、两iframe持续挂载，清空Document日志后两次切换均无新iframe Document request。完整query/token原文未输出或保存。没有替换/重启3090 app。
- **B / 刷新恢复**：隔离浏览器能看到lumevm既有“查看 lark-cli 新增订阅消息功能”会话，但未能通过自动化选择它；locator受first-run侧栏提示/tooltip hit target阻拦。随后用户手动选中既有会话并确认主动刷新Cockpit后仍为同一会话，因此此环境下刷新恢复表现正常（用户手动验收，未由代理独立观察）。没有同origin原生DSH reload对照或版本证据；不归因native缺陷。
- **边界**：无后端认证、native DSH、ohmydsh、远端或node_modules变更；未新开服务、不重启设备DSH。父页面无法基于cross-origin load确认认证成功；DOM `src`可以残留已签发URL直至合法导航/iframe销毁。
- [x] 5.2 按用户确认的收口范围，问题B采用其手动刷新验收结果，4.3原生DSH同origin reload/version对照保留为本次未执行的条件诊断；不修改native/ohmydsh、不强制恢复session。Delta已同步到published `cockpit-workbench` spec，完成本change归档。
