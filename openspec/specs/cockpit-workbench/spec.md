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

系统 SHALL 首次点入某设备时才创建其 iframe；创建后不因切换设备而销毁（直至用户移除或驾驶舱关闭），以保留其输入内容、滚动位置与连接状态。

#### Scenario: 首次点入设备
- **WHEN** 用户第一次点击某设备
- **THEN** 系统创建该设备的 iframe 并加载其工作台

#### Scenario: 切换设备后保留工作台
- **WHEN** 用户从设备 A 切换到设备 B 再切回 A
- **THEN** A 的工作台保持在原状态（未重新加载），无需再次建立

### Requirement: 工作台与状态聚合独立

系统 SHALL 保持工作台（iframe 内远端 GUI）与驾驶舱状态聚合（驾驶舱直连 ws/RPC）相互独立；一方故障不影响另一方。iframe 加载或运行异常不得影响驾驶舱对设备状态的聚合。

#### Scenario: 工作台 iframe 异常
- **WHEN** 某设备工作台 iframe 加载失败或崩溃
- **THEN** 驾驶舱对该设备的运行状态/待办聚合不受影响

#### Scenario: 状态聚合异常
- **WHEN** 某设备状态聚合 ws 断开
- **THEN** 该设备工作台仍可正常操作，不受影响

### Requirement: 设备离线时保留工作台并覆盖明确遮罩

系统 SHALL 在设备断连时保留其 iframe 内容，覆盖遮罩显示连接层具体原因与最后连接时间；用户可重连。系统不得在遮罩后静默允许操作（以免用户在已断连状态下误操作远端）。

#### Scenario: 当前工作台设备断连
- **WHEN** 用户正在某设备工作台操作，其隧道断开
- **THEN** 系统显示遮罩并阻断误操作，用户可查看原因或等待自动重连

### Requirement: 远端边界与安全

系统 SHALL 在用户对工作台目录/路径操作时，尊重远端环境（例如远端 workspace 路径在中央不映射、且不把远端路径交给本机工具）。系统 MUST NOT 自动下载/同步/devices 共享工作区文件，MUST NOT 调用远端 `host.openPath` 打开本机应用。

#### Scenario: 远端路径给本机工具
- **WHEN** 用户在工作台中复制远端文件路径并希望用本机应用打开
- **THEN** 系统不将远端路径交给本机打开器；用户明确可选择复制路径或在远端适当方式处理

#### Scenario: 目录操作
- **WHEN** 用户在远端工作台选择目录
- **THEN** 目录操作在远端环境下执行，不按本机路径解释
