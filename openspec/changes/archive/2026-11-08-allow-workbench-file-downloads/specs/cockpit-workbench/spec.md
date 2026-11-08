## MODIFIED Requirements

### Requirement: 工作台弹出的新标签页不继承 iframe 沙箱

系统 SHALL 让承载设备原生 DSH Web 的工作台 iframe 允许弹出窗口脱离沙箱（sandbox 令牌包含 allow-popups-to-escape-sandbox），使原生页面先预开空白页、再导航的登录流程与独立页面一致。iframe 自身沙箱 MUST 保持最小集合：allow-scripts、allow-same-origin、allow-forms、allow-popups、allow-popups-to-escape-sandbox、allow-downloads；MUST NOT 增加 allow-top-navigation、allow-modals 等其它令牌。驾驶舱 MUST NOT 接触设备页面弹出的标签页及其地址。

#### Scenario: 工作台内 DSH 浏览器登录可完成跳转
- **WHEN** 设备页面先预开 about:blank、断开 opener，再导航到授权地址
- **THEN** 弹出页不继承 iframe 沙箱，导航不因此失败

#### Scenario: iframe 自身沙箱保持不变
- **WHEN** 检查工作台 iframe 的 sandbox 属性
- **THEN** 其令牌恰为 allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads，不包含 allow-top-navigation 等其它令牌

#### Scenario: 驾驶舱不接触弹出标签页
- **WHEN** 设备原生页面打开新标签页
- **THEN** 仅浏览器和设备页面参与，驾驶舱不代开、不改写、不上报或记录地址

## ADDED Requirements

### Requirement: 工作台允许原生页面的浏览器下载

系统 SHALL 在工作台及使用相同沙箱配置的转发标签页 iframe 中声明 allow-downloads，使原生文件下载交给浏览器处理。驾驶舱 MUST NOT 代理文件内容、接管远端文件 API、推断本地保存路径或把已请求下载解释为文件保存完成。

#### Scenario: 用户下载远端交付文件
- **WHEN** 用户点击工作台内原生 DSH 文件卡片的下载按钮
- **THEN** 浏览器不因缺少 iframe 下载令牌而拒绝，文件名和原始字节保持不变

#### Scenario: 浏览器保存策略仍生效
- **WHEN** 浏览器因其它策略或用户设置拒绝或取消下载
- **THEN** 驾驶舱不绕过策略，也不宣称已保存
