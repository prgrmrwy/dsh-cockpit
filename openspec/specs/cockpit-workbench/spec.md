## Purpose

驾驶舱承载远端 DSH 工作台的方式：通过 iframe 直接呈现该设备原生 DSH Web（零协议耦合），懒加载、建了不销毁，并规定远端零改造与状态独立性。

## Requirements

### Requirement: 工作台直接承载远端原生 DSH，零协议耦合

系统 SHALL 在用户选中设备时，通过 iframe 加载该设备原生 DSH Web（`http://127.0.0.1:<localPort>`），让用户直接使用远端的 workspace/session/conversation/settings/usage/已装插件。系统 MUST NOT 接管该设备的 workspace/session API，MUST NOT 改写事件，MUST NOT 在远端安装任何插件。

#### Scenario: 选中设备即见其完整工作台
- **WHEN** 用户顶栏点击一台 `READY` 设备
- **THEN** 内容区显示该设备原生 DSH Web；该设备的设置、插件、usage 均可正常使用

#### Scenario: 远端零改造
- **WHEN** 用户添加一台仅运行标准 dsh web 的设备
- **THEN** 驾驶舱不要求安装任何远端插件；工作台完整可用

### Requirement: 工作台懒加载、建了不销毁

系统 SHALL 首次点入某台已启用设备时才创建其 iframe；创建后不因切换设备而销毁，以保留其输入内容、滚动位置与连接状态。设备被禁用或移除时，系统 SHALL 销毁该设备的 iframe 并释放其页面连接；重新启用后再次选中 SHALL 创建新的 iframe，而不是恢复禁用前页面。

#### Scenario: 首次点入设备
- **WHEN** 用户第一次点击某台已启用设备
- **THEN** 系统创建该设备的 iframe 并加载其工作台

#### Scenario: 切换设备后保留工作台
- **WHEN** 用户从已启用设备 A 切换到已启用设备 B 再切回 A
- **THEN** A 的工作台保持在原状态（未重新加载），无需再次建立

#### Scenario: 已加载设备被禁用
- **WHEN** 一台已创建 iframe 的设备被禁用
- **THEN** 系统销毁该设备的 iframe，不再保留或重试其页面连接

#### Scenario: 禁用设备重新启用
- **WHEN** 用户重新启用设备并再次选择它
- **THEN** 系统使用新连接端点创建新的 iframe，不恢复禁用前的页面实例

### Requirement: 工作台与状态聚合独立

系统 SHALL 保持工作台（iframe 内远端 GUI）与驾驶舱状态聚合（驾驶舱直连 ws/RPC）相互独立；一方故障不影响另一方。iframe 加载或运行异常不得影响驾驶舱对设备状态的聚合。

#### Scenario: 工作台 iframe 异常
- **WHEN** 某设备工作台 iframe 加载失败或崩溃
- **THEN** 驾驶舱对该设备的运行状态/待办聚合不受影响

#### Scenario: 状态聚合异常
- **WHEN** 某设备状态聚合 ws 断开
- **THEN** 该设备工作台仍可正常操作，不受影响

### Requirement: 设备离线时保留工作台并覆盖明确遮罩

系统 SHALL 在已启用设备意外断连时保留其 iframe 内容，覆盖遮罩显示连接层具体原因与最后连接时间；用户可重连。系统不得在遮罩后静默允许操作（以免用户在已断连状态下误操作远端）。设备被明确禁用不属于意外离线，MUST NOT 显示连接遮罩或重连操作。

#### Scenario: 当前工作台设备断连
- **WHEN** 用户正在某台已启用设备工作台操作且其隧道意外断开
- **THEN** 系统显示遮罩并阻断误操作，用户可查看原因或等待自动重连

#### Scenario: 当前工作台设备被禁用
- **WHEN** 用户明确禁用当前工作台设备
- **THEN** 系统移除该工作台而不是显示离线遮罩，且不提供对禁用设备的重连操作

### Requirement: 远端边界与安全

系统 SHALL 在用户对工作台目录/路径操作时，尊重远端环境（例如远端 workspace 路径在中央不映射、且不把远端路径交给本机工具）。系统 MUST NOT 自动下载/同步/devices 共享工作区文件，MUST NOT 调用远端 `host.openPath` 打开本机应用。

#### Scenario: 远端路径给本机工具
- **WHEN** 用户在工作台中复制远端文件路径并希望用本机应用打开
- **THEN** 系统不将远端路径交给本机打开器；用户明确可选择复制路径或在远端适当方式处理

#### Scenario: 目录操作
- **WHEN** 用户在远端工作台选择目录
- **THEN** 目录操作在远端环境下执行，不按本机路径解释

### Requirement: 工作台 iframe 显式授予剪贴板读写权限

系统 SHALL 在承载设备原生 DSH Web 的工作台 iframe 上声明剪贴板权限（`clipboard-read` 与 `clipboard-write`），使嵌入的 DSH 页面在浏览器 Permissions Policy 收紧的默认 allowlist（Chrome 136+ 将 `clipboard-read`/`clipboard-write` 默认从 `*` 收紧为 `self`，跨源 iframe 必须显式授权）下仍可直接使用剪贴板 API。系统 MUST NOT 借此读取、代理、上报或存储设备页面剪贴板的内容；剪贴板操作由浏览器在设备 DSH 页面内直接完成，驾驶舱代码零参与。

#### Scenario: 工作台内复制正常可用
- **WHEN** 用户通过驾驶舱工作台操作设备 DSH，点击 DSH 页面中的复制按钮（如复制消息或代码块）
- **THEN** 复制成功完成，无需其它用户操作；粘贴到任意应用可见复制的文本内容

#### Scenario: 驾驶舱不接触剪贴板内容
- **WHEN** 用户在工作台内发起任意复制操作
- **THEN** 仅浏览器按权限策略在设备 DSH 页面与系统剪贴板之间完成写入；驾驶舱不读取、不转发、不持久化剪贴板内容

#### Scenario: 默认策略收紧环境（Chrome 136+）
- **WHEN** 用户在 Chrome 136+ 中打开驾驶舱并进入任一设备工作台
- **THEN** 该工作台 iframe 已携带显式剪贴板权限声明，DSH 页面调用 `navigator.clipboard` 不因权限策略抛出 `NotAllowedError`
