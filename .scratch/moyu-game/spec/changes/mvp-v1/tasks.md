# Tasks: mvp-v1

<!-- 唯一任务清单。自上而下执行；每任务：先红后绿、单动作、独立可验证。 -->

## 1. 脚手架（纯配置，跳过 TDD——codevelop §tdd 允许并在此声明）

- [ ] 1.1 `npm create vite` vanilla-ts + vitest 接线 + tsconfig strict
      - Verify: `npm test -- --run` 空套件退出码 0 且 `npm run build` 通过
      - Rollback: 删除生成文件
- [ ] 1.2 拷贝精灵/9-Slice 资产到 public/assets + CREDITS.md（无逻辑，跳过 TDD）
      - Verify: `ls public/assets/**` 与 CREDITS 内容含 OGA CC-BY 署名
      - Rollback: 删除文件

## 2. 引擎层（TDD）

- [ ] 2.1 format：写失败测试 `123450 → "12.35万"`、`1_5000_0000 → "1.50亿"` → 实现 formatMoyu
      - Verify: `npx vitest run src/engine/format.test.ts` 红→绿
      - Rollback: revert 该 commit
- [ ] 2.2 upgrades：失败测试 `cost(2) = base×1.15²` → 实现 UPGRADES + cost()
      - Verify: `npx vitest run src/engine/upgrades.test.ts`
      - Rollback: revert
- [ ] 2.3 actions：失败测试（点击加点击力；购买成功扣钱+涨价+效果；余额不足不变）→ 实现 doClick/buyUpgrade
      - Verify: `npx vitest run src/engine/actions.test.ts`
      - Rollback: revert
- [ ] 2.4 tick：失败测试 `advance(s,60) ⇒ moyu += idleRate×60` → 实现 advance
      - Verify: `npx vitest run src/engine/tick.test.ts`
      - Rollback: revert
- [ ] 2.5 offline：失败测试（1800s 全额；86400s 封顶 28800s）→ 实现 offlineEarn
      - Verify: `npx vitest run src/engine/offline.test.ts`
      - Rollback: revert
- [ ] 2.6 save：失败测试（roundtrip；损坏 JSON→initial；v 不符→initial）→ 实现 serialize/restore + SaveAdapter
      - Verify: `npx vitest run src/engine/save.test.ts`
      - Rollback: revert

## 3. 渲染层（视觉验证，构建+运行；fx 逻辑极薄不单测）

- [ ] 3.1 sprites.ts：表加载 + 网格切帧 + 整数倍绘制
      - Verify: `npm run build` + dev 打开无控制台错误
      - Rollback: revert
- [ ] 3.2 scene.ts：工位场景（地板/桌/电脑动画/职员打字/饮水机）
      - Verify: dev 截图目视
      - Rollback: revert
- [ ] 3.3 fx.ts：飘字池 + 粒子
      - Verify: 点击出现 +N 飘字（目视）
      - Rollback: revert

## 4. UI 层

- [ ] 4.1 hud.ts + style.css 9-Slice：HUD 三指标节流刷新
      - Verify: dev 目视，数值随点击/时间变化
      - Rollback: revert
- [ ] 4.2 shop.ts：升级卡片、可购态、点击购买反馈
      - Verify: 目视 + 手动买一次涨价
      - Rollback: revert
- [ ] 4.3 welcome.ts：离线收益面板
      - Verify: 改 localStorage 时间戳后刷新弹出正确数额
      - Rollback: revert

## 5. 装配与移动端

- [ ] 5.1 main.ts：rAF 循环、pointer 输入、10s 自动存档、pagehide 存档、启动时离线结算
      - Verify: 刷新恢复状态；控制台无错误
      - Rollback: revert
- [ ] 5.2 移动适配：viewport、touch-action、竖屏布局、禁双击缩放
      - Verify: 375×667 DevTools 视口无横向滚动、即点即响应
      - Rollback: revert

## 6. 门禁

- [ ] 6.1 G3：`npm run build && npx vitest run` 全绿 + 运行验证 + 证据落 evidence/
- [ ] 6.2 G4：subagent 独立 review → 修复 → 复审
