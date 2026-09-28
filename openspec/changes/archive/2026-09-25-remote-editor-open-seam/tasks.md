## 1. 消息与服务契约

- [x] 1.1 `packages/shared/src/bridge.ts` 集中定义 bridge 消息名、`BridgeConfigMessage`（可选 `sshAlias`）、稳定服务名 `cockpitBridge.editorOpen` 与服务接口
- [x] 1.2 alias 校验谓词集中到 shared，server `validateSshAlias` 复用同一实现，不复制正则
- [x] 1.3 路径校验与 URI 构造集中到 shared：POSIX/drive 绝对路径、拒绝 `..`、编码 query/fragment 字符

## 2. 父页面（cockpit-web）

- [x] 2.1 `Workbench` 的全部 bridge-config 发送路径（初次、激活、续签）附带合法 `DeviceStatusFacts.sshAlias`；本机/非法 alias 省略
- [x] 2.2 alias 变化纳入 frame 更新与激活 effect 依赖，编辑设备后重发最新 config
- [x] 2.3 确认无新增 iframe→父页面动作消息；全仓设备页面↔驾驶舱通信仍只经既有 Workbench/bridge 通道

## 3. 桥接插件（dsh-cockpit-bridge）

- [x] 3.1 `parseConfig` 读取并校验可选 alias，保持既有 source/origin 校验不变
- [x] 3.2 立即 provide 稳定、消费方无关的 `cockpitBridge.editorOpen` 服务；调用时读取最新异步 config
- [x] 3.3 `open(path)` 校验配置/路径并在原始用户激活链路直接 `window.open(vscode-remote URI, '_blank')`
- [x] 3.4 `inject` 保持 `['sessions', 'uiSession']` 不变；能力是 provide，不是必需依赖
- [x] 3.5 bridge 版本升至 0.4.0；README 记录稳定服务契约、生命周期、前置条件与边界

## 4. 测试

- [x] 4.1 web：远端设备 bridge-config 含合法 alias；本机/非法 alias 均省略
- [x] 4.2 bridge：服务在 config 前可发现但调用拒绝；合法 alias 后产出预期 URI；续签/更新后读取最新 alias
- [x] 4.3 bridge/shared：相对路径、`..`、非法 alias 均拒绝；POSIX/Windows 路径与特殊字符 URI 编码受测试保护
- [x] 4.4 bridge：服务随测试 fiber 清理，且发出的 URI 保持精确 `_blank` target
- [x] 4.5 回归：shared 1、bridge 19、web 63、server 141、root CLI 8 项测试全部通过

## 5. 文档

- [x] 5.1 根 `README.md`：握手增加 `sshAlias?`，补 bridge 唯一通信切面、稳定服务与 Remote-SSH 前置/边界
- [x] 5.2 根 `README.en.md` 同步
- [x] 5.3 bridge README：版本 0.4.0、`cockpitBridge.editorOpen` 跨仓契约、调用/生命周期/安全与失败语义

## 6. 验证与收口

- [x] 6.1 `pnpm build` + `pnpm typecheck` + `pnpm lint` 全绿；bridge 发布 bundle 自包含 shared 代码且 host/client/source map 齐全
- [x] 6.2 `pnpm test` 全绿（root 8 + shared 1 + web 63 + bridge 19 + server 141）
- [x] 6.3 真机验收：消费方 shim 接入后，从远端设备工作台触发打开，宿主机 VS Code 新窗口经 Remote-SSH 打开目标目录（主路径已于 2026-09-24 由所有者验收通过，消费方归档证据为 ohmydsh `b9748d5`，部署 bridge 0.5.1。2026-09-25 补测 Windows 浏览器路径时，点击已成功拉起 Windows VS Code 并进入 `lumevm` Remote-SSH 连接；连接失败归因于 Windows 未具备 Mac 专属 Lume `ProxyCommand`/密钥链路。所有者确认 Windows 不是主路径，本项不以该可选客户端环境为阻塞）
- [x] 6.4 真机验收（降级/故障）：本机设备或非法 alias/path 不产出远程 URI，消费方回落且工作台其它功能正常（本机设备回落由所有者实机验收通过；非法 alias/path、注册方异常与 shim 缺席路径由 web/bridge/shared 及消费方回落测试覆盖，消费方归档账本见 ohmydsh `b9748d5`）
- [x] 6.5 发布 `dsh-cockpit-bridge` 0.4.0，并在 ohmydsh 更新精确 pin（0.4.0 已发布为 GitHub tag/release；当前已后续发布并精确 pin 到兼容超集 0.5.1，远端 tag `dsh-cockpit-bridge-v0.5.1`、ohmydsh `dsh.yaml` 均已核验）
- [x] 6.6 确认 current spec 已同步最终行为后归档 change
