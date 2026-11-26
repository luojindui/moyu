# Task state: moyu-game

- **Task**: 摸鱼主题放置/点击游戏，移动端浏览器优先（竖屏 + 触控），纯前端单机（localStorage 存档）
- **Class**: Normal Feature（spec 按需，review 必走）
- **Mode**: auto（进度门按证据放行，仅决策门停下）
- **Started**: 2026-11-26 (Asia/Shanghai)

## Resolved profile (G1)

- stack: Vite + 原生 Canvas（零框架游戏层）
- data: localStorage 单机存档，无后端
- art: 像素风开源素材（考察中，见会话内调研记录）
- SPEC rung: 2（spec-fallback templates；openspec CLI 缺失，PATH node=v16 < 20，本机另有 nvm v22.23.2）
- REVIEW rung: embedded subagent protocol（ocr 缺失，git 2.39.5 < 2.41）
- TDD rung: references/tdd.md（未检出 Superpowers）
- CLARIFY rung: references/clarify.md（未检出 Matt Pocock skills）
- mainline: unknown（无 remote；首次 commit 后按 git 默认分支）
- node 注意：构建/测试用 `~/.nvm/versions/node/v22.23.2/bin`（PATH 默认 v16）

## Gates

- [x] G1 clarify write-back + 批量问题已答（2026-11-26）
- [ ] G2 plan posted
- [ ] G3 verify evidence
- [ ] G4 review closed
- [ ] G5 archive confirm
- [ ] G6 cleanup verified
