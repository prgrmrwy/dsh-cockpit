## Purpose

驾驶舱 Web 应用的可安装与离线壳能力：用户可将驾驶舱安装到桌面/主屏，断网时仍能打开应用壳并查看各设备最后已知状态；同时保证状态事件流与设备工作台 iframe 不被离线缓存机制污染。

## Requirements

### Requirement: 可安装性：清单、图标与入口引用

系统 SHALL 提供 PWA 清单（name、short_name、`start_url=/`、`scope=/`、`display=standalone`、theme_color，以及 192x192 与 512x512 两种尺寸的 PNG 图标），并在入口 HTML 中引用该清单、主题色与 apple-touch 图标。`127.0.0.1` 属 secure context，安装前提必须可用。

#### Scenario: 打开驾驶舱出现安装入口
- **WHEN** 用户在生产构建的驾驶舱页面（`http://127.0.0.1:3090/`）访问
- **THEN** 浏览器解析到完整清单且图标可达，地址栏出现安装入口

#### Scenario: 清单图标可达
- **WHEN** 浏览器按清单拉取任一图标
- **THEN** 能取到对应尺寸（192 或 512）的 PNG 资源

### Requirement: 生产注册 Service Worker，开发模式不注册

系统 SHALL 仅在生产构建中注册 Service Worker；开发模式（vite dev）下不得注册。注册失败只告警，不得阻断页面正常使用。

#### Scenario: dev 模式打开
- **WHEN** 开发模式（vite，5173 端口）下打开驾驶舱
- **THEN** 不注册 service worker，HMR 与热更新行为不受缓存干扰

#### Scenario: 生产模式打开
- **WHEN** 生产构建页面加载完成
- **THEN** 注册 `/sw.js`；若注册失败页面仍正常渲染，仅输出告警

### Requirement: 离线壳：预缓存应用壳与静态资源

系统 SHALL 预缓存应用壳（`/`、`index.html`、清单与图标），并按需缓存带指纹的静态资源（`/assets/*`）。导航请求网络优先、离线时回退到缓存壳。

#### Scenario: 在线导航拿到最新页面
- **WHEN** 在线状态下刷新或导航
- **THEN** 返回网络上的最新 HTML（其指纹资源引用与当前构建一致），缓存同步更新

#### Scenario: 断网后仍能打开壳
- **WHEN** 用户成功访问过至少一次后断开网络并重新打开驾驶舱
- **THEN** 应用壳（HTML、样式、脚本、图标、清单）仍可打开

### Requirement: 状态数据离线兜底：网络优先、最后状态可读

系统 SHALL 对同源 `/api/*` 的 GET 请求执行网络优先，请求失败时回退返回最后一次成功响应；写操作（POST/PUT 等）不得缓存、不得以缓存应答。

#### Scenario: 离线显示最后已知状态
- **WHEN** 断网时打开驾驶舱壳
- **THEN** 设备列表等状态数据展示最后一次成功取得的内容，并继续遵守「不假装实时」（UI 标注离线/最后更新时间）

#### Scenario: 离线时的写操作
- **WHEN** 断网时用户触发重连、确认完成等写操作
- **THEN** 请求直接走网络并如实失败，不返回缓存响应

### Requirement: SSE 事件流与跨源工作台不被缓存拦截

系统 SHALL 让事件流请求（`Accept: text/event-stream`）只走网络、绝不从缓存应答；对跨源请求（设备工作台 iframe 所在的其他 `127.0.0.1:<port>`）不得拦截、不得缓存。

#### Scenario: 状态事件流直连网络
- **WHEN** 状态聚合的 EventSource 请求经过 service worker
- **THEN** 直接转发网络；网络失败时保持 EventSource 自身重连语义，绝不返回缓存（避免缓存死流）

#### Scenario: 设备工作台不受缓存影响
- **WHEN** 设备工作台 iframe 加载或请求其同源资源（跨端口）
- **THEN** 其请求不进入驾驶舱缓存策略、不被拦截

### Requirement: 页面与浏览器外观跟随系统主题

系统 SHALL 提供深/浅两套颜色令牌并使页面外观跟随系统 `prefers-color-scheme`（深色为默认）；入口 HTML 的 `theme-color` 按媒体查询分别给出浅/深值，并声明 `color-scheme: light dark`。页面颜色 MUST 通过令牌表达，不得在样式规则中写死主题色值。

#### Scenario: 系统浅色外观
- **WHEN** 用户系统为浅色外观并打开驾驶舱
- **THEN** 页面成套使用浅色令牌（背景、面板、前景、边框、hover/active 面），浏览器地址栏 chrome 显示浅色 theme-color

#### Scenario: 系统深色外观（默认）
- **WHEN** 用户系统为深色外观或未声明偏好
- **THEN** 页面成套使用深色令牌，浏览器 chrome 显示深色 theme-color；已安装（standalone）窗口的浏览器 chrome 取 manifest 静态 `theme_color`（manifest 无媒体查询能力，属已知限制）

### Requirement: SW 更新语义：自动接管并清理旧缓存

系统 SHALL 在新版本 Service Worker 部署后自动接管（跳过等待并立即控制客户端），并在激活时清理旧版本缓存。

#### Scenario: 新版本自动生效
- **WHEN** 服务器部署了行为变化的 Service Worker（缓存版本号变更）后用户刷新页面
- **THEN** 旧版本缓存被清理，新版本策略立即生效
