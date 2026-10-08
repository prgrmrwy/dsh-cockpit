## Why

本机 cockpit 源与远端 main 均为 976f854fb21748e9e535abfd6cc0d5ec06cd19ce（bridge-v0.6.0）；没有更新的公开提交可直接升级。实际连接 devbox DSH 0.2.0-rc.2 隔离候选时无法 READY。精确安装 adapter 复现：token GET 成功返回 303、Location `./`、Set-Cookie；exchangeDshLaunchToken 只接受 `/`，误报认证失败。需要严格、最小的新旧认证兼容，而不是反复换 token 或降级鉴权。

## What Changes

- 认证交换接受精确 `/` 或 `./` 两种已知干净根重定向，仍要求303、当前authority cookie名称/有效期等现有检查；不随意跟随重定向。
- 新旧响应矩阵及恶意/不干净Location拒绝回归；工作台launch与服务端连接共用同一规则。
- 在devbox先构建/测试，再备份并更新本机cockpit运行产物（用户已授权本机cockpit升级），验证实际服务端连接与浏览器工作台，不触及本机DSH、VM、devbox生产3080。

## Capabilities

### New Capabilities

无新增产品能力。

### Modified Capabilities

- `cockpit-device-connectivity`: 补充已实测 DSH 0.2.0 干净重定向契约。

## Impact

仅cockpit认证解析/测试及部署验收。保留设备注册数据、token存储、跨源限制、cookie绑定、单飞与代际fence。现有device-forward-registry change不涵盖认证重定向差异；不修改该change。0.6转发与0.5 bridge差异独立记录，不在本次恢复旧转发端点。不自动push/publish，不改ohmydsh正式pin。
