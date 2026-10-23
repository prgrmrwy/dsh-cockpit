## MODIFIED Requirements

### Requirement: 可安装性：清单、图标与入口引用

系统 SHALL 提供 PWA 清单（name、short_name、`start_url=/`、`scope=/`、`display=standalone`、theme_color，以及 192x192 与 512x512 两种尺寸的 PNG 图标，另加一枚 `purpose: "maskable"` 的 512x512 PNG 图标），并在入口 HTML 中引用该清单、主题色、SVG favicon（PNG 作回退）与 apple-touch 图标。`127.0.0.1` 属 secure context，安装前提必须可用。

所有图标 MUST 由仓库内入库的矢量源派生；图形 MUST 在 16x16 与 32x32 下仍可辨识主体轮廓；maskable 图标的主体 MUST 完整落在中心 80% 直径的安全区内。

#### Scenario: 打开驾驶舱出现安装入口
- **WHEN** 用户在生产构建的驾驶舱页面（`http://127.0.0.1:3090/`）访问
- **THEN** 浏览器解析到完整清单且图标可达，地址栏出现安装入口

#### Scenario: 清单图标可达
- **WHEN** 浏览器按清单拉取任一图标
- **THEN** 能取到对应尺寸（192 或 512，含 maskable 512）的 PNG 资源

#### Scenario: 小尺寸标签页图标可辨识
- **WHEN** 浏览器在标签页以 16/32px 显示驾驶舱图标
- **THEN** 黄色底、深色窗框与窗内青绿星球仍可分辨，不糊成色块

#### Scenario: 系统以遮罩裁切 maskable 图标
- **WHEN** 系统以圆形或 squircle 遮罩裁切 maskable 图标
- **THEN** 窗框主体（含铆钉与错位色块）不被裁切，背景满铺无透明边

#### Scenario: 从矢量源重新出图
- **WHEN** 维护者修改入库 SVG 源并运行生成脚本
- **THEN** 所有 PNG 图标按规定尺寸重新生成，无需手工编辑位图
