## ADDED Requirements

### Requirement: 可选桥接上报官方完成未读状态

当设备安装兼容的桥接插件时，系统 SHALL 让桥接上报每会话的官方状态快照，供 Cockpit 以设备真相源显示完成未读：每条为 `sessionId` 与两个布尔值 `running`、`completionUnread`。快照 MUST 覆盖「当前有未读完成」与「正在运行」的全部根会话，并 MUST 在官方状态变化时更新（不依赖轮询）。桥接只可传输设备来源、插件版本、会话标识与这两个布尔值，MUST NOT 读取或传输会话内容、工作区文件、settings、credentials 或 provider token。

#### Scenario: 上报官方未读集合
- **WHEN** 设备上两个根会话处于官方「已完成未读」状态、一个正在运行
- **THEN** 桥接上报三条记录（各自的 `running` 与 `completionUnread`），Cockpit 无需自行推导即可判定完成未读数量

#### Scenario: 用户打开未读会话后官方标记翻转
- **WHEN** 用户打开某个未读完成会话，设备官方把该会话的 `completionUnread` 置为 false
- **THEN** 桥接在下一次快照中反映该变化，Cockpit 据此清除该会话的完成呈现

#### Scenario: 状态快照最小字段
- **WHEN** 桥接提交状态快照
- **THEN** 请求不包含对话正文、工作区文件内容、settings、credentials 或 provider token
