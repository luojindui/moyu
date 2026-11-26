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

- [ ] 7.1 回收第 1 轮报告 → 按 VALID/INVALID/UNCERTAIN 分诊（codevelop §12）
- [ ] 7.2 实现批次2：老板巡逻 + 同事丢梗（随机事件，TDD）+ 第 1 轮有效缺陷修复
- [ ] 7.3 G3 全量验证 + subagent 独立 review（G4）
- [ ] 7.4 第 2 轮 agent 试玩 → 若仍有 major 问题继续第 3 轮，否则交付
