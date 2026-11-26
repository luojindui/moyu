# Design: mvp-v1

## Context & Goals
全新空仓库。目标：可玩的摸鱼放置 MVP——点击/被动/升级/离线/存档 + 像素场景 + 手机竖屏。
proposal: [proposal.md](proposal.md)；需求场景：[specs/specs.md](specs/specs.md)

## Authority Alignment (G2)
本仓库无 docs/adr、docs/architecture（profile 探测为空）——**no conflicting authority exists in this repo**。
外部权威依据：OGA [Office worker sprites](https://opengameart.org/content/office-worker-sprites)（CC-BY 4.0）、Kenney [素材镜像](https://github.com/ETdoFresh/kenney.nl)（CC0）。

## Approach
- **Vite + TypeScript，零运行时框架**：引擎纯函数化（state 进、new state 出），Canvas 只做场景/特效，DOM 做 HUD/商店（文字清晰、触控可及、可用 border-image 复用 Kenney 9-Slice）。拒绝 Phaser：MVP 循环不需要场景图/物理，包体和心智成本不划算。
- **精灵整数倍放大**（16×16 → ×N，`imageSmoothingEnabled=false`），保证像素干净。
- **rAF 主循环 + dt 累计**驱动引擎 tick；DOM 每 ~150ms 节流刷新数字。
- 存档带 `v` 字段做 schema 版本；localStorage 注入适配（测试接缝）。

## Module & Seam Design (four elements)
* **落点**：`src/engine/*`（纯逻辑：state/upgrades/actions/tick/offline/save/format）、`src/render/*`（sprites/scene/fx）、`src/ui/*`（hud/shop/welcome）、`src/main.ts`（装配）。测试落 `src/engine/*.test.ts`（colocated，新仓库即本约定）。
* **不塞既有模块的理由**：全为新模块；唯一约束是**方向**——engine 不 import render/ui（保证可测）；render/ui 可 import engine；main 是唯一允许 import 双方的装配点。任何新行为先问属于哪层，而不是塞进 main。
* **依赖方向**：`main → ui → render → engine`（无环，engine 最稳定、零依赖）。
* **测试接缝**：①`advance(state, dt)` / `offlineEarn(state, elapsed, now)` 以 dt 为参数注入时间；②`SaveAdapter` 接口注入 localStorage（测试用内存 Map）；③升级表 `UPGRADES` 为纯数据。测试只经公共函数驱动，不 mock 内部。

## File Map
| File | Responsibility |
|---|---|
| `index.html` | 入口、竖屏 viewport、三段式骨架 |
| `src/engine/state.ts` | GameState 类型 + initialState() |
| `src/engine/upgrades.ts` | UPGRADES 数据表（id/名/基础价/效果/曲线） |
| `src/engine/actions.ts` | doClick / buyUpgrade 纯函数 |
| `src/engine/tick.ts` | advance(state, dt) 被动收益 |
| `src/engine/offline.ts` | offlineEarn 结算（8h 上限）+ 返回结构 |
| `src/engine/save.ts` | serialize/restore + SaveAdapter |
| `src/engine/format.ts` | formatMoyu 万/亿缩写 |
| `src/render/sprites.ts` | 精灵表加载 + 帧绘制（按网格切帧） |
| `src/render/scene.ts` | 工位场景：工位/电脑/职员打字动画/饮水机 |
| `src/render/fx.ts` | 飘字池 + 点击粒子 |
| `src/ui/hud.ts` | HUD 数值绑定与节流刷新 |
| `src/ui/shop.ts` | 升级商店 DOM（9-Slice 样式） |
| `src/ui/welcome.ts` | 离线收益欢迎面板 |
| `src/main.ts` | 装配：循环/输入/存档调度 |
| `src/style.css` | 竖屏布局 + border-image 像素 UI |
| `public/assets/**` | 精灵与 UI PNG + CREDITS.md |

## Implementation Order
1. 脚手架（vite/ts/vitest 配置——纯配置，无 TDD）
2. engine 自底向上：format → upgrades → actions → tick → offline → save（每步先红后绿）
3. 资产落位（拷贝 + CREDITS——无逻辑，无 TDD）
4. render（sprites → scene → fx——视觉层，验证=构建+运行截图；fx 飘字逻辑保持极薄）
5. ui（hud → shop → welcome）
6. main 装配 + 移动端 CSS
7. G3 全量验证 → G4 subagent review

## Tests to Add / Modify
colocated `src/engine/*.test.ts`（vitest）：
- `format.test.ts`: 123450→"12.35万"；1_5000_0000→"1.50亿"
- `upgrades.test.ts`: 价格曲线 cost(n)=base×1.15^n
- `actions.test.ts`: doClick 加点击力；买得起扣钱涨价生效；买不起拒绝且状态不变
- `tick.test.ts`: advance 60s → +idleRate×60
- `offline.test.ts`: 30min 全额；24h 封顶 8h
- `save.test.ts`: roundtrip 相等；损坏 JSON → initialState；版本不符 → initial

## Compatibility / Migration
存档 schema `v:1`；未来迁移在 restore 处按 v 分支。无既有用户数据。

## Risks & Rollback
- 每任务 git commit，回滚 = revert 对应 commit；引擎纯函数无副作用，风险集中在装配层
- 移动端 60fps：精灵数量固定（<10），无风险；低端机 CSS 动画替代方案留待性能数据

## Verification Strategy
- 每任务：`npm test`（红→绿证据落 `evidence/`）
- G3：`npm run build && npm test` 全绿 + dev server 打开验证场景渲染（截图）
- G4：subagent 独立 review diff

## Subagent Opportunities
- G4 独立评审（embedded review rung）
- 实现期间：无并行必要（模块强依赖顺序，单人上下文更稳）
