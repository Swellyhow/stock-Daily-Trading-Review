---
name: data-snapshot-normalizer
description: Normalize raw market notes, manual spreadsheets, or scraped A-share market data into the structured market snapshot JSON required by the decision engine. Use when data must be prepared before automated analysis.
---

# Data Snapshot Normalizer

Use this skill when the task is to convert raw inputs into `market snapshot` JSON.

## Workflow

1. Read [market_snapshot.template.json](/g:/A股游资/data/templates/market_snapshot.template.json).
2. Map raw inputs into three layers:
   - `market`
   - `themes`
   - `stocks`
3. If a field cannot be observed directly, estimate conservatively and mark the assumption.
4. Avoid inventing a mainline or leader when the source data is noisy.

## Field Guidance

- `mainlineConcentration`: use a 0 to 1 score for how concentrated涨停和连板 are around one direction.
- `yesterdayStrongFeedback`: use a -1 to 1 style intuition compressed into 0 to 1 if your pipeline only supports positive scale.
- `highPositionNegativeFeedback`: increase it when高位股、昨日强股、中位接力 simultaneously weaken.

