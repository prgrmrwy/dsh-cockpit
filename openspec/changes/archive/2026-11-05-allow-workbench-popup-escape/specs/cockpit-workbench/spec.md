## ADDED Requirements

### Requirement: 工作台弹出的新标签页不继承 iframe 沙箱

系统 SHALL 让承载设备原生 DSH Web 的工作台 iframe 允许弹出窗口脱离沙箱（`sandbox` 令牌包含 `allow-popups-to-escape-sandbox`）。这样，设备 DSH 页面从工作台打开的新标签页是普通顶层页面，设备页面可以按自身逻辑继续导航它，例如先预开空白页、拿到授权地址后再跳转的浏览器登录流程，行为与单独打开设备 DSH 时一致。

iframe 自身的沙箱 MUST 保持不变。`sandbox` 令牌集合 MUST 恰为 `allow-scripts`、`allow-same-origin`、`allow-forms`、`allow-popups`、`allow-popups-to-escape-sandbox`，MUST NOT 顺带引入 `allow-top-navigation`、`allow-modals`、`allow-downloads` 等无需求证据的令牌。驾驶舱 MUST NOT 代为打开、导航、读取或记录设备页面弹出的标签页及其地址，弹窗由浏览器在设备 DSH 页面内直接完成。

#### Scenario: 工作台内 DSH 浏览器登录可完成跳转
- **GIVEN** 用户在驾驶舱中进入某台设备的工作台
- **WHEN** 用户点击 DSH 的登录，设备页面在点击时预开一个 `about:blank` 标签页、断开 `opener`，随后对该标签页执行 `location.replace(<授权地址>)`
- **THEN** 该标签页跳转到授权地址，不因沙箱继承抛出 `SecurityError`，也不会停在 about:blank

#### Scenario: iframe 自身沙箱保持不变
- **WHEN** 检查工作台 iframe 的 `sandbox` 属性
- **THEN** 令牌集合恰为 `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`，不包含 `allow-top-navigation` 等其它令牌

#### Scenario: 驾驶舱不接触弹出标签页
- **WHEN** 设备 DSH 页面从工作台打开任意新标签页
- **THEN** 只有浏览器与设备页面参与打开和导航；驾驶舱不代开、不改写、不上报或持久化该标签页的地址
