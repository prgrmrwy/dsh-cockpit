## Why

用户在 Cockpit 内下载 DSH 交付的 ZIP，原生页面提示已请求下载但浏览器没有记录。相同文件在顶层 DSH 正常；真实 Chromium 对照确认 iframe 缺少 allow-downloads 时静默拒绝下载。

## What Changes

- 共享工作台 iframe 沙箱增加 allow-downloads，保留其它令牌与权限。
- 更新精确令牌回归及当前规范，允许原生页面把文件下载交给浏览器。

## Capabilities

### Modified Capabilities
- `cockpit-workbench`: 支持用户发起的原生文件下载。

## Impact

仅 Web 沙箱声明、相关测试和规范。不新增文件代理、bridge 消息或远端接口，不读取或转发文件内容。前端构建后刷新驾驶舱生效。
