## 1. 精确契约与 RED

- [x] 1.1 核验 DSH 0.2.0-rc.2 的 retainedBy/status 结构与服务端 pending 计数语义，记录精确源身份
- [x] 1.2 新增 0.2.0 fixture：mainView 快速切换/清空、status pending 出现/替换/移除，证明旧 bridge 失败
- [x] 1.3 补缺失/异常 observable 与初始化失败清理测试，保留旧版完整回归

## 2. 最小兼容修复

- [x] 2.1 实现新旧选择适配，不把新形状的空选择回退到陈旧 current
- [x] 2.2 实现 pending observable 适配与最小投影；缺失来源不假装零
- [x] 2.3 保证 effect 订阅/清理对称，不改变端口转发、认证、重试及 server 协议
- [x] 2.4 更新 bridge 文档与适用版本说明，不擅自发布或变更版本 pin

## 3. devbox 验证与交付

- [x] 3.1 bridge 全量 test/typecheck/build 通过，明确记录未运行的其它 workspace 验证
- [x] 3.2 devbox 隔离候选装载精确构建产物，证明完整 client boot、选择上报与 pending 出现/解除；不触及生产
- [x] 3.3 审查完整源码差异、运行 OpenSpec strict，交付 source commit/patch 与轻量证据，未发布物不得写入 ohmydsh 正式 pin
