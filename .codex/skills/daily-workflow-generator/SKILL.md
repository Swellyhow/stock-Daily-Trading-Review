---
name: daily-workflow-generator
description: Generate premarket action sheets and postmarket review sheets for A-share short-term sentiment trading from normalized raw inputs and system decisions. Use when the task is to produce a daily operating document.
---

# Daily Workflow Generator

Use this skill when the task is to turn analysis into a daily operating sheet.

## Workflow

1. Normalize raw inputs into market snapshot JSON.
2. Run the decision engine.
3. Generate either:
   - premarket plan
   - postmarket review
4. Keep the output compact and execution-oriented.

## Premarket Output

Include:
- market environment
- emotion cycle
- primary and secondary themes
- leader and core pool
- allowed setups and forbidden setups
- position plan and retreat signals

## Postmarket Output

Include:
- market review conclusion
- strongest theme and backup theme
- leader/core review
- tomorrow focus list
- system optimization focus
