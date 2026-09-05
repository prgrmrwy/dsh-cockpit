## ADDED Requirements

### Requirement: 桥接观察并上报 pending 交互(typert 设备)
对 typert 网关线的设备,pending approval/question 的观测来源 SHALL 是 `dsh-cockpit-bridge`:bridge 在设备官方 Web UI 内以旁观者身份观察官方 client 的待审批/待提问状态,经既有 capability 通道上报请求与解除事实(含会话与稳定去重键)。观察 MUST NOT 干扰官方 UI 对交互的展示与处理,MUST NOT 代替用户应答。

bridge 依赖设备浏览器页面存活是既有语义:页面不在时该设备的 pending 计数 SHALL 呈现为「不可观测」,MUST NOT 呈现为 0。rc.2 设备的 pending 观测继续走其事件流,不受本要求影响。

#### Scenario: typert 设备出现待审批
- **WHEN** 一台 typert 设备的官方 UI 出现待审批,且其页面已加载 bridge
- **THEN** 驾驶舱该设备的 pending 计数与状态分组反映该审批,解除后计数回落

#### Scenario: 页面未开时不谎报为零
- **WHEN** 一台 typert 设备的浏览器页面未打开(无 bridge 心跳)
- **THEN** 驾驶舱呈现「pending 不可观测」而非 0,状态聚合的其余字段(运行计数等)不受影响

#### Scenario: 观察不干扰官方处理
- **WHEN** bridge 正在观察 pending 状态,用户在官方 UI 上完成审批
- **THEN** 官方流程行为与未安装 bridge 时一致,bridge 只上报解除事实

## MODIFIED Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合

系统 SHALL 在用户选中设备时，通过 iframe 加载该设备原生 DSH Web（`http://127.0.0.1:<localPort>`），让用户直接使用远端的 workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT 接管该设备的 workspace/session API，MUST NOT 改写事件，MUST NOT 在远端安装任何插件。

对要求浏览器会话认证的 DSH 版本(`0.1.2` 线起,index 未认证返回 401),系统 SHALL 提供把认证送达 iframe 的路径(如带 launch token 的首次加载换取持久会话 cookie);认证缺失时 SHALL 呈现说明原因的引导,MUST NOT 呈现裸 401 或无差别加载失败。

#### Scenario: 选中设备即见其完整工作台
- **WHEN** 用户顶栏点击一台 `READY` 设备
- **THEN** 内容区显示该设备原生 DSH Web；该设备的设置、插件、usage 均可正常使用

#### Scenario: 远端零改造
- **WHEN** 用户添加一台仅运行标准 dsh web 的设备
- **THEN** 驾驶舱不要求安装任何远端插件；工作台完整可用

#### Scenario: 认证要求的设备首次打开
- **WHEN** 用户打开一台 `0.1.2` 线设备的工作台且浏览器尚无该设备的有效会话
- **THEN** 系统按引导完成认证送达(而非呈现裸 401),此后会话有效期内直接可用
