---
name: daily-runner
description: Run the full daily A-share workflow from one daily input file, generating decision, premarket, postmarket, outcome, and history summary artifacts in a single command. Use when a one-shot daily run is needed.
---

# Daily Runner

Use this skill when the task is to generate the entire daily output bundle at once.

## Workflow

1. Read `daily_run.json`.
2. Normalize market notes.
3. Run decision analysis.
4. Generate premarket and postmarket documents.
5. If outcome exists, generate outcome review.
6. Archive everything to history.
7. Emit bundled files into `outputs/daily/YYYY-MM-DD/`.
