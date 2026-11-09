## Context

原生 fileActions 触发 Blob 下载后只能返回 requested；iframe 沙箱拒绝不会成为该调用的异常，导致请求提示出现但浏览器没有下载记录。

## Decisions

在 Workbench 与转发标签页共用的 FRAME_SANDBOX 中增加 allow-downloads，使用浏览器原生下载。保持其它沙箱和 Permissions Policy 令牌不变；不通过 bridge 传输文件，也不在远端插件绕过父页面沙箱。

## Validation

使用同一个真实 DSH ZIP 卡片和真实 HTTP 父页：五令牌沙箱有 requested 提示、零下载事件及明确浏览器拒绝；只增加 allow-downloads 后收到 ZIP，中文文件名和原始字节一致。另运行 Windows 实际仓库 Web 回归、类型检查、lint 与构建，核验运行中静态服务交付新 bundle。用户须刷新整个驾驶舱，使父页面创建具有新权限的 iframe。
