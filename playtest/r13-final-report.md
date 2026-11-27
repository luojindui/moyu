# R13 赌徒党 · 最终复验（HEAD 0bc67b5）

- 版本：dev HEAD `0bc67b5`（34 文件/206 例全绿）；测试时间 2026-11-27 18:31–18:36
- 环境：http://127.0.0.1:5173/，390×844 CDP
- 证据：`probe-r13-final-boss.mjs`、`probe-r13-final-firstpatrol.mjs`、JSON `r13-final-boss.json`、`r13-final-firstpatrol.json`、
  截图 `r13-final-result-visible.png`、`r13-final-card-modal.png`、`r13-final-first-patrol.png`、`r13-final-timeout.png`、
  引擎探针 `probe-r13-gambler.test.ts`（14/14 通过）

## 评分（最终）

随机乐趣: 5/10　风险回报: 4/10　可预测性(越低越好): 7/10　整体可玩性: 6/10

## 五个复验点

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| ① | 答对后反馈 | ✅ 面板内绿色结果「王总：屏幕挺干净啊。 +90」在 90ms 可见（333×20px，面板未关），260ms 后收起、顶部 toast 同文案兜底；全程无「没来得及选」 | r13-final-result-visible.png、r13-final-boss.json |
| ① | 答错后反馈 | ✅ base 50、宽限期外实测 delta=-50，面板内红字「王总：切得真快。 -50」+ 顶部 toast「-50」，无超时文案 | r13-final-boss.json（neg 验证） |
| ② | 键盘 Enter 作答 | ✅ 焦点在按钮上按 Enter，正确答题 delta=+90、面板关闭；答错路径 delta=-50 同样生效（click/pointerdown/keydown 统一 `pick()`，只结算一次） | r13-final-boss.json |
| ③ | 首巡必为 choice | ✅ 全新会话自然首巡 19.3s 弹出回合制老板（横幅「有人过来了——脚步声又快又重…」，无性格名）；引擎 1000 次模拟首巡 choice=1000/1000，patrolCount=3 时恢复 35/30/20/15 | r13-final-firstpatrol.json |
| ④ | 连点时不弹卡 | ✅ 连续快点点 2.4s（16 次）期间弹窗 0 次；停手后 **867ms** 弹出（800ms 停手规则），且 chosen=null 无误选 | r13-final-card-modal.png、r13-final-boss.json |
| ⑤ | 盲猜负期望 | ✅ 正确 ×1.8 / 错误 ×1.0，盲猜期望 **-0.0667×base** <0；base=50 时 +90 / -50 / 超时 0；新手前 3 次选错仍免罚 | probe-r13-gambler.test.ts |

补充：跳过即关 ✓、HUD「生效中：团建吃饭（剩 24h）」✓、forceBoss('choice') 固定多疑 ✓、5s 窗口 ✓、画布点击显示「先选应对」不罚 ✓。

## 剩余问题（无 P0/P1）

### P2（唯一较关键）
1. **作答后的下一次超时会静默**：`choicePickedThisRound` 只在该分支内复位；答完题后面板由 `showResult` 收起，分支永不执行 → 标记残留为 true，导致"之后再超时"那一次的「没来得及选…这次不算」被吞掉（实测：答错 -50 后下一次超时 5.6s，toast 仍停在「王总：切得真快。 -50」且 shown=false）。0 罚款无经济损失，仅少一次提示。建议在新一轮 `show()` 时重置标记。
2. 设计取舍提示：现在"每次会话首次巡逻 = choice"（刷新/回访也算新会话），老玩家每次打开都会再看一次教学题；可考虑只对前 N 次会话生效。
3. 旧 P2 未变：稀有/剧情出现率偏低（全普通天 ~37%、特定稀有 ~10%）、顶部横幅仍会被"新章节/段位晋升" toast 叠盖。

## 可交付：是

3 个 P1 全部修复并复验通过，无 P0/P1 剩余；P2-1 建议顺手修（一行复位），不影响本批交付。
