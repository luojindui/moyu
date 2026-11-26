# Proposal: mvp-v1（摸鱼工位 MVP）

## Why
用户要在 moyu 做一款「摸鱼」主题放置/点击游戏，手机浏览器竖屏优先。本次交付可玩的核心循环：点击摸鱼 → 被动收益 → 升级 → 离线结算，像素美术采用已调研的方案 A（OGA 职员 + Kenney 像素 UI）。

## What Changes
- 新建 Vite + TypeScript 项目（无框架，Canvas 渲染场景 + DOM HUD/商店）
- 纯逻辑引擎层（点击/升级/被动收益/离线/存档），vitest 全覆盖
- 像素风办公场景渲染（OGA 16×16 精灵，整数倍放大）
- localStorage 存档 + 离线收益结算（上限 8h）
- 移动端适配：竖屏布局、pointer 触控、无拖拽延迟

## Out of Scope
- 后端/排行榜/账号、原生打包、微信小游戏
- 音效（后续批次）、多场景/关卡、成就系统
- itch.io 场景包（本环境不可达，留待后续人工补充）

## Impact
- 全新仓库首个功能，无既有代码受影响
- 风险：移动端性能（rAF + 精灵整数缩放缓解）；localStorage 容量与版本迁移（save 带 schema 版本）
