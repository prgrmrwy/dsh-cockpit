## ADDED Requirements

### Requirement: typert 认证支持已验证的新旧干净根重定向

作为现有最小认证握手要求的补充，系统 SHALL 对 token GET 的303响应接受精确Location `/` 或 `./`，MUST 保持当前endpoint authority确定性cookie名称、cookie有效期以及全部既有认证检查。实现 MUST NOT 自动follow重定向，MUST NOT 接受allowlist以外的路径或URL；服务端协议连接和浏览器workbench launch验证 SHALL 使用同一交换规则。该兼容不授予读取其它日志或凭据、修改设备DSH的权限。

#### Scenario: DSH 0.2.0 相对干净根
- **WHEN** 实际DSH endpoint对当前token返回303、Location `./` 和满足现有校验的cookie
- **THEN** 交换成功并可继续协议确认；不能仅因相对根Location将有效token报告失效

#### Scenario: 旧版根重定向保持兼容
- **WHEN** endpoint返回303、Location `/` 和有效authority cookie
- **THEN** 旧版交换、cookie复用与workbench launch行为不变

#### Scenario: 拒绝不干净或跨源重定向
- **WHEN** Location为绝对URL、protocol-relative URL、带query/hash的路径、子路径、编码变体、空或缺失，或状态非303
- **THEN** 交换失败且不跟随、不泄漏token/cookie、不写入错误认证材料

#### Scenario: 允许Location不替代cookie身份验证
- **WHEN** Location为`./`但cookie缺失、值为空、缺少可解析有效期、已过期或authority名称错误
- **THEN** 严格拒绝，不能把Location allowlist当作完整认证依据；最终cookie有效性仍由DSH验证，本地不宣称签名验证
