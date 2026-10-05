## Context

DSH 0.2.0-rc.2（639ed015）删去 list.current 与 uiSession.pendingInteractions；官方 UiSession 通过 status observable 暴露每 Session 的 running、pendingInteraction、completionUnread。bridge 0.5.1 仍读旧字段，devbox 完整候选 boot 失败，现有假对象测试只提供旧字段而未发现问题。

## Goals / Non-Goals

**Goals:** 双版本只读适配；原生 Web 不因桥接失活；保持选择确认、pending 最小快照和清理语义。

**Non-Goals:** 不新增决策 listener/代理 API；不改 cockpit server、凭据、0.5.x portForward/editorOpen；不升级到 0.6.0，不自动发布。

## Decisions

1. 在 bridge 自己的边界解析官方 observable 形状，而不篡改官方 service。新 list 用 `retainedBy.mainView` 找当前选择；旧 list 继续用 current。空选择必须明确清空，不能回退成陈旧 current。
2. 旧 pendingInteractions 优先使用；不存在则读取官方 status，抽取每行 pendingInteraction，按已有协议过滤 approval/question，仅传 sessionId/kind/key。status 是最高优先级当前交互，不是所有隐藏请求队列；不声称能枚举被遮蔽交互。无可靠来源时不发空快照、不宣称 seam 可用。
3. 状态源结构先验证再订阅；effect 安装和清理对称，不允许中途抛错遗留 sessions listener。
4. 保持协议 v2/v3、版本发布策略和 0.5.x 服务名；拒绝直接升级 0.6.0，以免引入无关 server/shim 迁移。
5. 接口类型由轻量本地结构表达，测试分别给出真实新旧形状；补 devbox 精确版本浏览器加载证据，不能仅靠 mock 绿灯。

## Risks / Trade-offs

- 新 status 只给每会话最高优先级交互 → 明确 scope，不推断隐藏请求；如果服务端的现有协议不能承载该语义，应先暂停调整设计，不把未知当零。
- 旧版支持退化 → 原有测试全跑，新增 0.1.x/0.2.0 双矩阵。
- bridge 被移除后异步回调仍访问失活 service → 清理 listener/timer，并测试 dispose 后静默。
- 临时候选绕过正式 pin → 只用隔离验收 manifest/tarball，记录源码 SHA/包 hash，不修改生产或本仓正式 pin。

## Migration Plan

确认后 RED→实现→GREEN→bridge build/typecheck/test→devbox 临时完整候选。审查后交付独立 source patch/commit，用户另行决定发布。正式发布后才审查精确 tarball 并更新 ohmydsh pin。回退临时候选采用原 pin；不改变生产。

## Open Questions

无须现在决定发布版本号或发布权限。实现时须先确认 status/retainedBy 的精确字段类型与服务端每会话计数语义，若不满足当前提案则停止扩大行为。
