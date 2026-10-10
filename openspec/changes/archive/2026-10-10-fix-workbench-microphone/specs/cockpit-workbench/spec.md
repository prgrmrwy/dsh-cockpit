## ADDED Requirements

### Requirement: 工作台 iframe 委派麦克风权限给嵌入的 DSH 页面

系统 SHALL 在承载设备原生 DSH Web 的工作台 iframe 上显式声明 `microphone` 权限（iframe `allow` 属性），使跨源 iframe 内的设备 DSH 页面可使用麦克风：Permissions Policy 中 `microphone` 的默认 allowlist 为 `self`，顶层驾驶舱文档不会自动把该能力委派给端口不同（即跨源）的工作台 iframe，未显式委派时设备页面内的 `navigator.mediaDevices.getUserMedia` 在弹出任何授权框之前即抛 `NotAllowedError`。

委派只解除权限策略层面的钳制。实际授权 SHALL 仍由浏览器以设备 DSH 页面自身 origin 为单位向用户请求；用户拒绝时系统 MUST NOT 重试、伪造成功或代替用户授权。系统 MUST NOT 代理、读取、上报、录制或存储设备页面的音频流，也不得记录或推断其麦克风授权状态；媒体采集全部由浏览器在设备 DSH 页面内直接完成，驾驶舱代码零参与，驾驶舱自身 MUST NOT 因此声明而请求麦克风。该声明 MUST NOT 顺带引入其它浏览器权限（如 `camera`、`geolocation`）。

#### Scenario: 工作台内语音输入可用
- **GIVEN** 用户在浏览器中打开驾驶舱并进入某台已启用设备的工作台
- **WHEN** 设备 DSH 内已安装的语音输入插件调用 `navigator.mediaDevices.getUserMedia({ audio: true })`
- **THEN** 请求不再被 Permissions Policy 直接拒绝，浏览器以设备 DSH 页面 origin 弹出麦克风授权；用户允许后录音正常开始

#### Scenario: 驾驶舱不接触音频与授权状态
- **WHEN** 用户在工作台内录音、停止录音或拒绝授权
- **THEN** 只有浏览器与设备 DSH 页面参与媒体采集与授权；驾驶舱不读取、不转发、不持久化音频内容或权限结果，且其自身从未请求麦克风

#### Scenario: 用户拒绝授权仍呈现真实失败
- **GIVEN** 工作台 iframe 已声明 `microphone` 权限
- **WHEN** 用户在浏览器授权框中明确拒绝麦克风
- **THEN** 设备 DSH 页面观察到真实拒绝结果并显示其原有提示，驾驶舱不得静默重试、伪造成功或以任何方式代替用户授权

#### Scenario: 权限声明保持最小集合
- **WHEN** 检查工作台 iframe 的 `allow` 声明
- **THEN** 其权限集合仅为剪贴板读写（`clipboard-read`、`clipboard-write`）与 `microphone`，未包含 `camera`、`geolocation` 等无需求证据的权限
