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

- README 新增架构图与设备连接状态图（`docs/assets/*.dual.svg`，深浅主题自适应），协议细节与验收记录折叠展示。
- 仓库工程化对齐 ohmydsh：`.editorconfig`、`.nvmrc`、`.gitattributes`、`CODE_OF_CONDUCT.md`、本 CHANGELOG、Dependabot 依赖更新；CI 增加并发取消、最小权限与手动触发。
- 设备回环端口转发（`cockpitBridge.forwards`）与设备转发登记，设备面板可查看与释放转发（bridge 0.5.0 → 0.6.x）。
- 远程编辑器打开切面 `cockpitBridge.editorOpen`（bridge 0.4.0）。
- 适配 DSH 0.1.2 typert 网关与浏览器认证，launch token / 官方 cookie 自动恢复。
- Windows 原生 Node 启动（`node bin/cockpit ...`）。
- PWA：可安装、离线壳缓存、主题跟随系统。
- v1：多设备注册、SSH 回环隧道、健康探测与分级诊断、只读状态聚合、原生工作台 iframe。

### Changed

- 完成未读以设备官方 `completionUnread` 为准（bridge 0.6.4）。
- 运行中的子代理使其根会话计为进行中。
- 驾驶舱 API 只接受同源请求。
- 设备管理面板改版，转发行两行布局。

### Fixed

- 工作台 iframe 委派 microphone / clipboard 权限，DSH 语音输入与复制可用。
- 兼容 DSH 0.2.0 的会话选择、待决交互与认证重定向（bridge 0.6.1）。
- 本地端口按失败归因延续，链路抖动不再漂移工作台 origin。
- typert 握手有界且可中断，重连与拆除不再永久卡死。
