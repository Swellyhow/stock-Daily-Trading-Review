---
name: market-environment-analyzer
description: Analyze overall A-share short-term market environment from limit-up/down counts, board height, concentration, broken-board rate, and strong-stock feedback. Use when deciding whether the day is attack, rotation, retreat, or panic.
---

# Market Environment Analyzer

Use this skill when the task is to classify the overall market first.

## Workflow

1. Read [A股短线情绪交易基础判断标准](/g:/A股游资/游资知识库/A股短线情绪交易基础判断标准-428ca50305.md).
2. Focus on six fields: `limitUpCount`, `limitDownCount`, `maxBoardHeight`, `boardCount`, `mainlineConcentration`, `yesterdayStrongFeedback`.
3. Classify the day into `进攻环境` / `震荡轮动` / `退潮环境` / `冰点/恐慌`.
4. Output both label and reasons. Do not output a label without the supporting thresholds.

## Rules

- Favor `进攻环境` when涨停多、跌停少、连板高度高、主线集中、昨日强股仍有溢价。
- Favor `退潮环境` when高位股负反馈扩散、炸板率升高、晋级率下降。
- Favor `冰点/恐慌` when跌停扩散且情绪核心集体补跌。

