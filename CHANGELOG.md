# Changelog

本文件记录 dsh-cockpit 仓库的显著变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> **范围说明**
>
> - 每次变更的完整动机、设计与验收记录见 `openspec/changes/archive/`；当前行为契约以 `openspec/specs/` 为准。
> - 桥接插件 `dsh-cockpit-bridge` 独立发版（`packages/dsh-cockpit-bridge/package.json` 的 `version`），本文件只记录其显著版本。
> - 驾驶舱本体（server / web / shared）尚未发布带 tag 的版本，所有变更暂归入 Unreleased。

## [Unreleased]

### Added

- 同端口常驻转发可显示为工作台标签页：顶栏常驻列出（跟在所属设备后），点开即在驾驶舱内承载设备上的其它 Web 服务（如另一个 DSH Web），右键「重新加载」应对 token 轮换；标签页不参与 bridge 握手（change `forward-workbench-tab`）。
- 常驻转发可选「本地端口同设备端口」：端口被占用时不换端口，跨设备冲突以 `local-port-conflict` 拒绝。设备面板就绪行新增「打开」，支持打开路径，并可经设备命令取出带 token 的打开地址（`POST /api/devices/:id/forwards/:port/open-url`）。bridge 与 iframe 快照不变（change `forward-fixed-port-open`）。
- README 新增架构图与设备连接状态图（`docs/assets/*.dual.svg`，深浅主题自适应），协议细节与验收记录折叠展示。
- 仓库工程化对齐 ohmydsh：`.editorconfig`、`.nvmrc`、`.gitattributes`、`CODE_OF_CONDUCT.md`、本 CHANGELOG、Dependabot 依赖更新；CI 增加并发取消、最小权限与手动触发。
- 设备回环端口转发（`cockpitBridge.forwards`）与设备转发登记，设备面板可查看与释放转发（bridge 0.5.0 → 0.6.x）。
- 远程编辑器打开切面 `cockpitBridge.editorOpen`（bridge 0.4.0）。
- 适配 DSH 0.1.2 typert 网关与浏览器认证，launch token / 官方 cookie 自动恢复。
- Windows 原生 Node 启动（`node bin/cockpit ...`）。
- PWA：可安装、离线壳缓存、主题跟随系统。
- v1：多设备注册、SSH 回环隧道、健康探测与分级诊断、只读状态聚合、原生工作台 iframe。

### Changed

- 设备管理与设置合为 DSH 风格控制台：左侧设备导航、右侧直接编辑，提供连接路径、未保存修改保护及窄屏两级导航；顶部 header 不变。

- PWA 图标更换为复古舷窗与青绿星球，新增 SVG favicon、maskable 图标及可重复出图的矢量源与脚本。
- 完成未读以设备官方 `completionUnread` 为准（bridge 0.6.4）。
- 运行中的子代理使其根会话计为进行中。
- 驾驶舱 API 只接受同源请求。
- 设备管理面板改版，转发行两行布局。

### Fixed

- 设备 Host 重启后工作台停在连接错误页（白屏）时，顶栏 ↻（现为「重连并重新加载当前设备」）、同一菜单项与离线遮罩的重连按钮，会在新连接就绪后重新加载当前设备一次，不必整页刷新驾驶舱；服务端为每次工作台启动记录一行不含 token 的诊断日志。
- 工作台 iframe 委派 microphone / clipboard 权限，DSH 语音输入与复制可用。
- 兼容 DSH 0.2.0 的会话选择、待决交互与认证重定向（bridge 0.6.1）。
- 本地端口按失败归因延续，链路抖动不再漂移工作台 origin。
- typert 握手有界且可中断，重连与拆除不再永久卡死。
