## MODIFIED Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合
系统 SHALL 在用户选中设备时，通过 iframe 加载该设备原生 DSH Web，让用户直接使用远端 workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT 接管该设备的操作 API、改写其事件或代替其处理交互。

对要求浏览器会话认证的 typert 版本，iframe 首次创建或连接层确认浏览器认证需要恢复时 SHALL 加载当前 endpoint 的官方 tokenized root URL，使 DSH 自己设置 authority-bound HttpOnly cookie 并重定向到干净根路径。Cockpit MUST NOT 读取 iframe cookie，也不得在 iframe 后续 URL、界面或日志中保留 token。一次恢复 SHALL 只触发一个受连接代约束的重认证导航；成功后继续既有 keep-alive 语义，失败则由连接遮罩提供恢复路径，不得形成无界刷新循环。rc.2 iframe 继续加载原 endpoint，不增加认证步骤。

#### Scenario: 选中设备即见其完整工作台
- **WHEN** 用户顶栏点击一台 `READY` 设备
- **THEN** 内容区显示该设备原生 DSH Web；该设备的设置、插件、usage 均可正常使用

#### Scenario: 远端零改造
- **WHEN** 用户添加一台仅运行标准 `dsh web` 的设备
- **THEN** 驾驶舱不要求安装 bridge 即可使用工作台；typert 设备只需按官方要求完成启动 URL认证握手

#### Scenario: rc.2 工作台
- **WHEN** 用户选中一台 `READY` 的 rc.2 设备
- **THEN** iframe 按现有方式直接加载设备 endpoint，完整工作台可用

#### Scenario: typert 工作台首次认证
- **WHEN** 用户选中一台已有有效 launch token、但浏览器尚无当前 authority cookie 的 typert 设备
- **THEN** iframe 完成官方 token→cookie→干净根路径交换后显示完整原生工作台，不呈现裸 401

#### Scenario: typert 工作台缺少认证材料
- **WHEN** typert 设备需要认证但没有有效 launch token
- **THEN** Cockpit 显示粘贴当前官方启动 URL或启用受支持自动恢复的引导，不反复加载裸 401 iframe

#### Scenario: DSH cookie 静默重新签发
- **WHEN** 连接层在同一 endpoint 上确认设备 cookie失效并成功取得当前 launch token
- **THEN** 已创建的 iframe执行一次官方 tokenized root 导航、获得新 HttpOnly cookie并回到干净根路径，无需用户重建或重新选择设备

#### Scenario: 重认证失败
- **WHEN** tokenized root未成功建立浏览器会话或连接代在交换期间变化
- **THEN** 系统停止该次重认证并显示当前连接诊断，不循环刷新 iframe，也不让旧连接代结果覆盖新连接代
