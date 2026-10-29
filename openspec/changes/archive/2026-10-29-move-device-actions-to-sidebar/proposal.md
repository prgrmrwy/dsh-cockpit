## Why

设备详情标题上的「上移 / 下移 / 禁用」与左侧设备列表分离，排序时视线来回移动。用户希望将这些操作收进每个 sidebar 设备条目右侧的 more 菜单，同时明确禁用不是删除。

## What Changes

- 每个设备条目右侧增加 `⋯` 按钮，展开该设备的「上移」「下移」「禁用 / 启用」。右侧详情标题不再重复显示这些按钮。
- 已禁用设备保留在 sidebar，显示明确的「已禁用」tag，并可从 more 菜单重新启用；顶部 header 仍只显示已启用设备。
- 操作目标是菜单所属设备，打开菜单不切换详情，不丢弃当前输入；失败在该条目附近提示。
- 删除仍在详情底部，不放入 more 菜单。服务端与现有禁用语义不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cockpit-device-shell`：设备排序与启停的布局位置、菜单交互和禁用标记。

## Impact

仅 web 控制台组件、CSS 与测试，以及两条现行 shell 规范的操作位置描述。不新增依赖，不修改 registry 或 API。已核对：服务端 updateDevice 写 enabled 标志且保留记录；只有 removeDevice 才过滤记录；main.tsx 仅将 enabledDevices 传给顶部栏，控制台仍接收全部 devices。
