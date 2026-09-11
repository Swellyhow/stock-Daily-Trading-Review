---
name: decision-orchestrator
description: Orchestrate the full A-share short-term sentiment decision chain across market environment, emotion cycle, theme strength, leader selection, execution planning, position sizing, and review. Use when a complete end-to-end trading decision is needed.
---

# Decision Orchestrator

Use this skill when the task requires a full daily decision output.

## Workflow

1. Trigger `market-environment-analyzer`.
2. Trigger `theme-strength-analyzer`.
3. Trigger `leader-stock-selector`.
4. Trigger `trade-execution-planner`.
5. Trigger `position-risk-manager`.
6. If it is post-close, trigger `review-optimizer`.

## Output Contract

Return:
- market environment label
- emotion cycle label
- primary theme and backup theme
- leader and core pool
- allowed setups and forbidden setups
- total position and risk signals
