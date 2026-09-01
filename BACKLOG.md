# Backlog

本文件记录尚未收敛到可实施范围、因此不应提前创建 active OpenSpec change 的产品方向。条目不是实现承诺、任务列表或当前规范；当进入明确设计时，必须重新检查 `README.md` 的架构原则，并通过 `/openspec-propose` 建立正式 change。

## C001 · DSH Pet 多设备统筹

**状态：** Discovery backlog  
**一期真相源：** `ohmydsh/openspec/changes/add-dsh-pet/`  
**当前仓实现：** 无

### 背景

一期 DSH Pet 是设备本地的 DSH Host+Web 插件：Pet UI、Task/Invocation/snapshot、Skill store 与受管软链投影、普通 executor sessions、Settings 和副作用工具均由安装 Pet 的设备本地拥有。其源码、manifest 与部署 change 位于 ohmydsh，不属于 Cockpit 当前实现。

Cockpit 选中设备后承载该设备原生 DSH Web，因此无需适配即可在 iframe 中使用设备上的 Pet。只有当用户需要跨设备观察、选择或路由 Pet 工作时，Cockpit 才产生独立的统筹职责。

### 候选能力层级

#### A. 只读 Pet 状态聚合（更接近当前 Cockpit 边界）

可能包括：

- 按设备显示是否安装/可用 Pet；
- 聚合活跃、排队、waiting-user、失败或 recovering 的 Pet Task 数量；
- 展示最后更新时间、离线/陈旧标识与设备级诊断；
- 点击摘要后切换到目标设备的原生 DSH/Pet 页面；
- 不复制完整 Invocation 内容、Skill 配置、Bindings、provider credentials 或 executor transcript。

该层仍需 Pet/DSH 提供稳定、官方或明确协商的只读 projection；Cockpit 不应读取远端 Pet SQLite、Skill store 或 iframe DOM。

#### B. 跨设备执行路由（触碰当前写边界）

可能包括：

- 用户选择由哪台设备的 Pet 接收请求；
- 根据 workspace/repository/device capability 建议执行设备；
- 从一个 Cockpit 入口创建远端 Pet Invocation；
- 展示路由结果并跳转目标设备。

这会改变“操作面零协议耦合”和“统筹面只读”的现行原则，不能作为 A 的顺手扩展。若确有需求，正式 proposal 必须说明为什么 iframe 原生操作不足、写操作的认证/授权/幂等/审计/失败语义，以及是否需要修订当前 Cockpit specs 与 README 架构承诺。

#### C. Cockpit Pet Hub / 共享 Lark Bot（新的系统角色）

可能包括：

- Cockpit 或独立 Hub 拥有一个共享 Lark Bot/channel transport；
- 可信地把 conversation/thread/requester binding 路由到设备本地 Pet；
- 处理多设备竞争、设备离线、重试、去重、Task affinity 和回复回送；
- 让设备 Pet 仅接收 Host 签发的绑定引用，而不接受模型生成的 chat/thread/user ID。

该层引入后台生命周期、凭据所有权和写路由，可能不应由现有 Cockpit 进程承担。正式设计必须比较“Cockpit 内置”“独立 Pet Hub”“每设备 transport”三种所有权方案，且不得直接复用当前仅上报 active session ID 的 `dsh-cockpit-bridge` 作为通用写隧道。

### 保持不变的约束

在正式 OpenSpec change 接受前：

- 不修改 Cockpit server/web/shared 或 `dsh-cockpit-bridge` 来支持 Pet；
- 不代理 Pet Settings、Skills、Bindings、provider credentials 或任意 DSH RPC；
- 不从 Cockpit 读取或同步 `$DSH_HOME/plugins/dsh-pet/`；
- 不把 Pet Task 建成 Cockpit 自有第二真相源；
- 不假装设备离线期间的状态实时或可恢复；
- 一期 Pet 的产品和持久化真相继续由设备本地 DSH/ohmydsh change 拥有。

### 升级为 OpenSpec change 的触发条件

至少满足以下条件后，再在本仓运行 `/openspec-propose`：

1. ohmydsh 的一期 Pet 已有可运行实现和稳定的设备本地 Task/Invocation 行为；
2. 用户明确选择要做 A、B 或 C 中的哪一层，而不是笼统的“统筹”；
3. 已列出 Cockpit 必须展示或执行的最小用户故事；
4. 已确定状态/命令接口由 DSH core、Pet 插件还是独立 Hub 提供；
5. 已决定是否保持当前只读/零代理原则，若不保持则明确提出架构规范修订；
6. 已定义多设备离线、陈旧、重复投递、权限和可信 Channel Binding 的最小语义。

正式 change 应引用本条目和 ohmydsh 的 canonical Pet change，但重新生成 proposal/spec/design/tasks；不得把本 backlog 当成可直接 apply 的实现计划。
