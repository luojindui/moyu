# 归档：探索性试玩探针

这些文件是 6 轮 subagent 试玩（数值党/休闲党/审计/多玩法/养成/挑战）与其验收轮留下的**探索性探针**，不是产品回归套件。

归档原因：它们是"当时现状"的证据（含 `it.fails` 记录缺陷），而设计在 R2–R6 之间多次调参（里程碑错峰、事件变体、偷点罚则、奖励倍率、连段上限等），这些断言会随参数变化而失效；保留在默认套件里会让"全绿"失去意义。

权威回归套件（仍在 `playtest/` 与 `src/`）：
- `src/**/*.test.ts` —— 引擎与装配的单元测试（100 例）
- `playtest/simulate.test.ts` —— 4 类玩家画像 ×180 分钟批处理模拟（产出 report.json）
- `playtest/probe-r5-balance.test.ts` —— 偷点交叉点平衡
- `playtest/probe-r6-redlines.test.ts` —— 三条红线：事件占比 <10%、8cps 胜率 50–99%、3cps <40%

若需复核历史数据，可直接 `npx vitest run playtest/archive/<file>`（多数仍可运行，仅断言可能过期）。
