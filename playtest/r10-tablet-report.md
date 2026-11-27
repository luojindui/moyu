# R10 平板/宽屏试玩报告（768×1024 / 1024×768 / 1440×900）

HEAD 999b0f4（当前 dev server；另见 `git status` 中无关布局的并发改动）。只读探针，未改 src/。

## 评分
layout: 3/10  space: 3/10  input: 4/10

## 三视口测量表

| 视口 | HUD/场景/商店 (px, %) | scale / 虚拟画布 | 角色可见度 | 空白/浪费 | 商店 | 横向溢出 |
|---|---|---|---|---|---|---|
| 768×1024 竖屏 | 131 / 732 / 161（12.8 / 71.5 / 15.8%） | 6 / 128×122；地板 403px=55% | 87%（头顶裁 12px；公告板在画布上方 -94px） | HUD 右侧空 63%；工位宽 403px=52% 视口 | 5/9 全显 +1 边缘，需横滑 580px | 0（页面无横向溢出） |
| 1024×768 横屏 | 131 / 476 / 161（17.1 / 62.0 / 21.0%） | 6 / 171×79；地板 403px=85% | **0%**（角色顶 -268px 全在画布上方；显示器 0%、公告板裁） | HUD 右侧空 72%；地板占 85%；工位仅 39% 宽 | 6/9 全显 +1 边缘，需横滑 324px（触屏可，鼠标滚轮不行） | 0 |
| 1440×900 桌面 | 131 / 608 / 161（14.6 / 67.5 / 17.9%） | 6 / 240×101；地板 403px=66% | **0%**（角色顶 -136px；显示器仅 8%） | HUD 右侧空 80%；商店右侧空 108px；工位仅 28% 宽 | 9/9 全显、不可滚，但仍显示「← 滑动查看更多 →」+ 右缘 mask 渐隐最后卡 | 0 |

- canvas 像素密度：scale 上限 6 → 16u 精灵恒为 96 CSS px；DPR 2 平板 backing 1536×1464 / 2048×952，DPR 1 桌面 1440×608（不糊，无缩放模糊）。
- 真实点击：三视口均 +1 摸鱼值、出浮字、连点×2（触屏/鼠标都正常）。
- 键鼠：1440 下卡片 hover 背景仍 rgb(61,74,107)、cursor:default；canvas cursor:auto。Tab 顺序仅 🔊→📔→#shop-cards；卡片 disabled 时被跳过；卡片可负担后 Enter 可走完「再点一次确认」购买。

## 问题清单（按严重度）
1. **P0 横屏/桌面场景内容被裁到画布上方**：角色、显示器、键盘、公告板全部不可见（角色可见 0%，显示器 0%/8%），只剩墙、地板、挂钟、饮水机。根因：`scene.resize` 只按宽算 scale（round(w/130)，上限 6），而场景以 groundY=vh-4.2u 贴底、工位需 ≥7.75u 垂直空间；1024×768 的 vh=79.3u、1440×900 的 vh=101.3u 都不够 → 桌面首屏看不到核心角色。
2. **P1 竖屏平板同样受影响（较轻）**：768×1024 角色头顶被裁 12px、公告板整体在画布上方被裁 -94px；地板空区 55%。
3. **P1 宽屏空间浪费**：1440 HUD 内容仅 285px=20% 宽（右侧 80% 空条），场景 66% 是空地板，9 张卡止于 x=1332 右留 108px；且不可滚动时仍显示「← 滑动查看更多 →」、mask 把最后一张卡右缘渐隐（8s 后才隐藏 hint）。
4. **P2 桌面悬停无反馈**：card hover 无样式变化、cursor:default；canvas cursor:auto、无 role/aria；点击虽有效但无 affordance。
5. **P2 键盘不可完成核心循环**：canvas tabIndex=-1、无 key 监听，Space/Enter 在页面无效；Tab 只能到 🔊/📔/商店滚动容器（卡片初始 disabled 时连商店都跳过）。商店键盘可滚（Tab 到 #shop-cards 后 → 滚 0→296）。
6. **P2 1024 桌面滚轮不能横滑商店**：deltaY 240 → scrollLeft 0；deltaX 300 → 296；需 shift/触控板/拖拽。
7. **P3 固定定位按钮按手机调**：🔊 bottom 238 / 📔 bottom 186，1440 下悬在场景右下、远离 HUD；🔊 40×40 < 44 tap 推荐值。

## 建议（按代价 1-3）
1. **代价 1：scale 加高度约束（修 P0/P1）**：`scene.resize` 改为 `scale = clamp(min(round(w/130), floor(h/124)), 2, 6)`（124≈4.2u 地面+3.55u 工位+余量）。预期：1024×768 scale 6→3（vh 159，角色 100% 可见）；1440×900→4（vh 152）；768×1024→5。加一条 `workerTop >= 0` 断言。
2. **代价 2：宽屏限宽 + 横屏提示 + 条件化提示**：`#app{max-width:900px;margin:0 auto}`（HUD 内容占比 20%→32%，商店改为限宽居中/卡片 flex 自适应）；`@media (orientation:landscape)` 显示「横屏体验一般，建议竖屏」轻提示（横屏 HUD 17%+商店 21% 挤占场景）；`scrollWidth<=clientWidth` 时隐藏 shop-hint 与右缘 mask。
3. **代价 3：桌面键鼠适配**：canvas/card `cursor:pointer` + `.shop-card:hover` 边框/亮度反馈；canvas 加 `tabindex=0 role=button aria-label` 并监听 Space/Enter 复用 pointerdown（键盘可玩摸鱼）；#shop-cards 非触摸时把 deltaY 转 scrollLeft 或加左右箭头按钮。

## 总评：可交付：否
竖屏平板已接近可交付（修 1 行 scale 约束即可）；**横屏 1024×768 与桌面 1440×900 角色不可见、且无桌面输入适配，宽屏版本不可交付**。

## 证据
- 截图：`playtest/r10-screens/{tablet-portrait-768x1024,tablet-landscape-1024x768,desktop-1440x900}.png`（另 *-shop-end.png、shot-tool-*.png）
- 数据：`playtest/r10-tablet.json`、`playtest/r10-tablet-input.json`
- 探针：`playtest/probe-r10-tablet.mjs`、`playtest/probe-r10-tablet-input.mjs`
