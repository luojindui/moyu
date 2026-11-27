# 摸鱼工位 · R6 移动端 UX 评审报告（CDP 真实浏览器实测）

- HEAD：`a786a53`；被测：http://127.0.0.1:5173/（Vite dev）
- 工具：Chrome 158 headless + CDP，DPR3 + touch 真机模拟；`Emulation.setDeviceMetricsOverride` 三视口 + `Emulation.setSafeAreaInsetsOverride` 安全区
- 探针：`playtest/probe-r6-ux-cdp.mjs`（布局/可读性/交互/性能/截图）、`playtest/probe-r6-ux-extra.mjs`（领取时延、resize 修复、不可买点按、canvas 像素校核）
- 证据：`playtest/r6-ux-evidence.json`、`playtest/r6-ux-extra.json`、`playtest/r6-ux-rank-r7.json`、截图 `playtest/r6-screens/`（13 张，含三视口主界面/日报、飘字前后、可买卡、HUD 压力态）
- 快照说明：测量期间 HEAD 由 `a786a53` 被推进到 `8969d10`（r7）。r7 未改 `src/style.css` / `index.html` / `src/render/scene.ts` / `src/ui/*`，仅改 engine/main（日报奖励 ×10、段位扩到 14 档等），故布局/可读性/热区结论对两版均成立；文中所引日报 +500、段位「宇宙尽头」等数值为 `a786a53` 实测。已对 r7 新增最长段位补测（见 P3-13）。

## 评分

| layout | readability | feedback | perf |
|---|---|---|---|
| **6/10** | **5/10** | **6/10** | **9/10** |

## 1. 三视口测量

| 指标 | 390×844 | 375×667 | 360×740 |
|---|---|---|---|
| HUD rect | 390×81 @y0 | 375×81 @y0 | 360×81 @y0 |
| 场景容器 #stage-wrap | 390×601 | 375×424 | 360×497 |
| 画布 #stage（CSS） | 390×**643**（+42） | 375×**466**（+42） | 360×**539**（+42） |
| 商店 #shop | 390×162 @y682 | 375×162 @y505 | 360×162 @y578 |
| 📔 按钮 #btn-journal | **39×26** @(339,45) | **39×26** @(324,45) | **39×26** @(309,45) |
| 横向溢出（doc.scrollW-vw） | 0 | 0 | 0 |
| 商店卡：容器/内容 scrollWidth | 374 / 1126 | 359 / 1126 | 344 / 1126 |
| 首屏完整可见卡数 / 第 4 张露出 | **3 张 / 0px** | 3 张 / 11px（91%） | 3 张 / 26px（78%） |
| 商店横滑到底 | scrollLeft 752=max，末卡完整 | 767=max，末卡完整 | 782=max，末卡完整 |
| 日报面板 | 340×662，面板不滚 | 330×547，面板内滚 55px | 317×607，面板内滚 20px |
| 图鉴网格（55 格 2 列） | 可视 287 / 内容 779，可滚到底 | 227 / 779 | 252 / 779 |
| 领取按钮 | 300×47 可见 | 290×47 可见 | 277×47 可见 |
| 日报 ✕ 关闭 | **13.7×21** | **13.7×21** | **13.7×21** |
| <12px 文本项 | 5 项（10–11px） | 5 项 | 5 项 |
| 对比度 <4.5:1 项 | 9 项（全部商店卡，opacity .55） | 9 项 | 9 项 |
| 安全区（注入 top59/bottom34） | app padding=59/0/34/0，HUD y=59，商店 bottom=810 → 无遮挡 | — | — |
| 首屏 | cold ready 136ms / FCP 100ms；warm ready 18–29ms / FCP 32ms | warm 23ms | warm 18ms |

其他实测：布局无横向溢出；`stage` 与 `shop` 重叠 42px（画布底部被商店盖住）；HUD 子行在极端档位（9.88亿/宇宙尽头/🔥连胜 12/挂机 14.00万）下 scrollWidth=clientWidth（390:366/366，360:336/336）→ 无裁切。

### 点击热区

| 目标 | 尺寸 | 命中覆盖率 | ≥44×44 |
|---|---|---|---|
| 📔 日报按钮 | 39×26 | 1.00 | ❌ 高 26 |
| 日报 ✕ 关闭 | 13.7×21 | 1.00 | ❌ |
| 日报领取按钮 | 300×47（390） | 1.00 | ✅ |
| 商店卡 | 118×144 | — | ✅ |
| 场景 | 390×601（可见区） | 100% 由 canvas 接收 | ✅ |

### 触摸行为

- 无 300ms 延迟：pointerdown→click 实测 **35.3–42.7ms**（含 25ms 模拟按压），点击在 touchend 即触发。
- 无双击缩放：连点两次后 `visualViewport.scale` 仍 =1（meta `user-scalable=no` + `touch-action: manipulation`，canvas 为 none）。
- 商店横滑真实手势可用：`Input.synthesizeScrollGesture` 一次滑 181px（scrollLeft 0→181）。
- 图鉴网格触摸滚动可用：scrollTop 0→138（max 521）。

### 可读性（真实字号 + 对比度）

- HUD：摸鱼值 30px（11.19:1）、标签 13px（7.75:1）、子行 12px（6.18–9.83:1）→ 合格。
- 商店：名称 14px；描述 **11px**；增量/性价比/彩蛋 **10px**；价格 12px。
  - 开局全部不可买（opacity .55，实测像素合成）：名称 **4.31:1**、描述 **2.70:1（像素 2.72）**、增量 **3.68:1**、性价比 **3.66:1**、价格 **3.66:1**、彩蛋 **2.33:1** → 全部 <4.5。
  - 可买态（opacity 1）：名称 7.78、增量 6.34、性价比/价格 6.36 达标；描述仍 **4.17:1** 不达标。
- 日报：标题 18（11.54）、目标 13（9.17）、领取 15（10.35 可用 / 禁用 2.83）、关闭 ✕ 5.21、图鉴标签 **9px（未解锁 2.65、已解锁 4.37）**、图鉴内容 **10px**、最新彩蛋 11px（4.99）。
- Canvas 内「戳屏幕摸鱼」引导：**10px、3.81:1**（像素实测），且后期（9.88 亿）仍常驻。

### 交互反馈

- 场景点击：state.moyu +1；canvas 飘字验证——点击点区域亮像素 0→1269（bbox 324,244–348,266），画面变化 4019px；fps 不变（60）。
- 买卡：点击后 **≤84ms** 价格 15→18、Lv.1、affordable→disabled、HUD 26.7→14.4，即时。
- 日报领取：红点 `has-reward` 与 HUD **即时**（t=0 消失、+500/800.6）；领取按钮文案/禁用态受 `journal.refresh` 400ms 节流影响——打开面板后立即领取时，0–380ms 仍显示「领取 +500」且可点，**520ms** 才变「今日已领」（重复点击不会重复发奖，安全）。
- 不可买卡（disabled）点按：无任何反馈（无「还差 X」/抖动/提示）。
- 所有反馈均为 canvas/DOM 文字，无 `aria-live`、无音效/震动。

### 性能 / 控制台

- 10s 帧率：**60fps ×10 次采样**（frames 每秒 +60/+61），无掉帧。
- 首屏：FCP 32ms、游戏 ready 27–29ms（warm；cold 100/136ms）。
- Canvas 后备 780×1286（CSS 390×643），即 `dpr=min(2, devicePixelRatio)` → 在 DPR3 设备被放大 1.5×（像素画边缘轻微发糊）。
- 控制台：**0 error / 0 exception / 0 请求失败**；7 条 warning 全部来自本次探针的 `getImageData` 回读（非 App 代码）。资源 3/3 loaded。

## 2. 问题清单（按严重度）

1. **【P1】商店横滑不可发现**：9 张卡只有 3 张可见，390×844 下第 4 张露出 **0px**（374 容器 / 1126 内容），无滚动条/箭头/渐隐/计数提示 → 6 张升级卡可能永远不被发现。
2. **【P1】开局商店信息不可读**：全部卡不可买 → 整卡 `opacity:.55`；描述 2.70:1（像素 2.72）、价格/性价比 3.66:1、名称 4.31:1，且字号 10–11px。新玩家看价格/效果基本靠猜。
3. **【P1】触控热区不达标**：📔 按钮 39×**26**；日报 ✕ 13.7×**21**（均 <44×44），移动端易点不中。
4. **【P1】画布高度错位 42px**：三视口 canvas 均比容器高 42px（390:643 vs 601），底部 42px 被商店遮挡、场景底部被裁切；`dispatch resize` 后恢复 601。根因：`fit()` 只在 `resize` 调用，而商店卡片首帧 `refresh` 把商店撑高 42px。
5. **【P1】375×667 场景构图崩坏**：地面线 groundY=88.1 格，公告板画在 73.6–99.2 格 → 约 33px 压在木地板上（截图中像掉在地上）；若修正 42px 画布后（groundY 降到 74 格）公告板会整体落地。iPhone SE/8 尺寸常见。
6. **【P2】图鉴 9px + 低对比**：未解锁标签 9px/2.65:1、已解锁标签 4.37:1；55 格中 52 格是「???」，2 列 28 行需长滑，收集感偏弱。
7. **【P2】「戳屏幕摸鱼」引导** 10px/3.81:1 且常驻不消失（后期仍显示，压低场景质感）。
8. **【P2】日报面板双层纵向滚动**：375 下外层面板内滚 55px + 内图鉴网格 227/779 内滚，滚动目标易混淆。
9. **【P2】领取按钮反馈滞后 ≤400ms**：`journal.refresh` 400ms 节流；t=0–380ms 按钮仍「领取 +500」可点，520ms 才变「今日已领」。（红点/HUD 即时，无重复发奖风险）
10. **【P3】不可买卡点按零反馈**：disabled 直接吞掉事件，无「还差 12 摸鱼值」提示。
11. **【P3】反馈无无障碍语义**：飘字/金额/HUD 均为 canvas 或普通 div，无 `aria-live`，读屏用户无反馈。
12. **【P3】canvas 仅按 DPR2 渲染**，DPR3 手机被 1.5× 放大，像素画清晰度受损。
13. **【P3】长段位名依赖 `title` tooltip（移动端无 hover）**：r7 新增最长档「摸鱼宇宙尽头·终」在 360×740 下 `#hud-rank` clientW 62 / scrollW 64 → 截断 2px；390 下可放下。

## 3. 改进建议（4 条）

1. **商店可发现性 + 不可买态可读性**
   - `#shop-cards{scroll-snap-type:x mandatory;}`、`.shop-card{width:112px;scroll-snap-align:start}` → 390 下 3 卡 352px < 374px，第 4 卡稳定露出 ~14–22px；右上角加「9 项 · 左右滑」小字或右侧遮罩渐隐。
   - 不可买态不要整卡降透明：`.shop-card:not(.affordable){opacity:1;background:#34344b;border-color:#4a4a66}`、`.shop-card:not(.affordable) .shop-desc{color:#c9c4ad}`（≥6:1）。
   - 字号：描述 11→12px、增量/性价比 10→11px、价格 12→13px（卡高 144、内容 138/138 无溢出，够放）。
2. **热区**：`#btn-journal{position:relative}` + `#btn-journal::before{content:"";position:absolute;inset:-9px -3px}`（44/45px 命中区，不改 HUD 81px 高度）；`#journal-close{width:44px;height:44px;display:grid;place-items:center;margin:-11px -11px -11px 0;padding:0}`。
3. **画布/场景**：`fit()` 后挂 `new ResizeObserver(fit).observe(canvas.parentElement)`（或首次 `shop.refresh` 后 `requestAnimationFrame(fit)`）；`dpr=Math.min(3, devicePixelRatio||1)`；`scene.layout()` 用 groundY 反推道具：`boardY=Math.min(4.6*u, groundY-4.2*u)`，避免 375×667 公告板落地。
4. **可读性/反馈**：`.c-item .c-label{font-size:11px;color:#a9b6dd}`、`.c-item.off{opacity:.8}`、`.c-text{font-size:11px}`；canvas 引导改 `Math.max(12,2.4*s)`、`rgba(255,255,255,.75)`，并在 `totalEarned>500` 后隐藏；日报领取回调 `journal.refresh(state, true)` 消除 400ms 滞后；不可买卡加「还差 N 摸鱼值」或轻微 shake。

## 总评

**可交付：是**。核心循环（点击→飘字→买卡→日报→图鉴）在三种移动视口下无横向溢出、无 JS 错误、稳定 60fps、首屏 <40ms（warm），安全区适配正确。上线前建议先修 P1：商店横滑可发现性、不可买卡对比度、📔/✕ 热区、42px 画布错位（含 375×667 场景构图）。

## 证据索引

- `playtest/r6-ux-evidence.json`：三视口布局/字号/对比度/命中率/交互/性能/控制台全量数值
- `playtest/r6-ux-extra.json`：领取按钮时延时间线、canvas resize 前后、不可买卡点按
- `playtest/r6-ux-rank-r7.json`：r7 最长段位 HUD 复测（360 截断 2px，截图 `playtest/r6-screens/360x740-hud-stress-r7.png`）
- `playtest/r6-screens/`：`390x844-main/journal/journal-claimable/shop-affordable/tap-before/tap-after/hud-stress`、`375x667-main/journal`、`360x740-main/journal/hud-stress`、`360x740-hud-stress-r7`
- 探针脚本：`playtest/probe-r6-ux-cdp.mjs`、`playtest/probe-r6-ux-extra.mjs`（可复跑）
