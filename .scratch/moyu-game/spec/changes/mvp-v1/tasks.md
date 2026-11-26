# Tasks: mvp-v1

<!-- 唯一任务清单。自上而下执行；每任务：先红后绿、单动作、独立可验证。 -->

## 1. 脚手架 ✅

- [x] 1.1 vite+ts+vitest 脚手架（commit 7e5b450 前段）
- [x] 1.2 精灵/9-Slice 资产 + CREDITS.md

## 2. 引擎层 ✅（23 测试全绿）

- [x] 2.1 formatMoyu（2.1-red/green 证据）
- [x] 2.2 upgrades 价格曲线 ×1.15^n
- [x] 2.3 doClick/buyUpgrade（含买不起拒绝）
- [x] 2.4 advance 被动收益
- [x] 2.5 offlineEarn 8h 封顶
- [x] 2.6 serialize/restore + SaveAdapter（损坏/版本/缺失兜底）

## 3. 渲染层 ✅（构建通过；视觉验收留给用户+后续批次）

- [x] 3.1 sprites.ts 表加载/切帧/frameActivity 诊断
- [x] 3.2 scene.ts 工位场景（墙/窗/地板/桌/电脑/职员/饮水机）
- [x] 3.3 fx.ts 飘字+粒子池（有界）

## 4. UI 层 ✅

- [x] 4.1 hud.ts 节流刷新
- [x] 4.2 shop.ts 升级卡片可购态
- [x] 4.3 welcome.ts 离线面板

## 5. 装配与移动端 ✅

- [x] 5.1 main.ts rAF/pointer/自动存档/离线结算/__MOYU__ 调试钩子
- [x] 5.2 竖屏布局/viewport/touch-action

## 6. 试玩闭环（批次1）

- [x] 6.1 G3 部分：build + 23 测试绿；模拟驱动 4 画像报告
- [ ] 6.2 第 1 轮 agent 试玩（player-optimizer / player-casual / player-auditor）→ 报告回收

## 7. 批次2（用户已批准：先跑起来再加）

- [x] 7.1 第 1 轮报告回收与分诊：casual（6/10，5 发现 5 需求）、auditor（5/10，8 缺陷全实锤）已处理；optimizer 待回收
- [x] 7.1a 缺陷修复：CSS 装配、精灵坐标双重缩放、资产降级+boot 兜底、visibility/pageshow 回归结算（resume.ts TDD）、存档净化、__MOYU__ 补强
- [x] 7.1b 文案梗化：flavor.ts 三级彩蛋 + 点击蹦梗 + HUD 未解锁标注
- [x] 7.2 随机事件引擎（老板巡逻 + 同事丢梗，TDD 14 测试）+ 场景/主循环接线 + 模拟驱动事件经济
- [x] 7.2a 事件经济再平衡：安然奖 5×idleRate（约挂机 4%）、每巡逻最多扣一次
- [x] 7.3 数值曲线调优（optimizer 报告全采纳：底薪 0.2/s 修死局、效果里程碑 ×2/20 级、九档表、离线 70% 防首夜跳档、段位称号 + HUD、商店边际增量/里程碑 UI）
- [x] 7.4 G3 全量验证：53 引擎测试 + 构建 + 模拟四画像（idle 党 0→544/s 死局解除）
- [ ] 7.5 G4 独立 review（批次 diff）→ 修复 → 复审
- [ ] 7.6 第 2 轮 agent 试玩（三玩家复测）→ 达标交付
