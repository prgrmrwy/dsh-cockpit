## ADDED Requirements

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
