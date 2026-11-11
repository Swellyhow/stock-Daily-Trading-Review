# 开发记录（Development Log）

本文件按时间回溯真实开发痕迹：每条记录都标注可验证证据（提交、归档产物、文档、测试）。只写有据可查的内容，不补写"感觉做过"的条目。

## 时间线总览

| 时间 | 阶段 | 证据 |
| --- | --- | --- |
| 2026-03-27 ~ 2026-03-31 | 规则内核 + 逐笔台账跑通 | `outputs/history/2026-03-27|28|31/*`、`outputs/history/index.json` |
| 2026-04-05 ~ 2026-04-13 | 联网自动模式（auto-live）连续实盘验证 | 该期间的 `outputs/daily/*/auto-live.{json,txt}`、`news-catalysts.json`（已在 0.2.0 中移出版本控制） |
| 2026-03 ~ 2026-04 | Web 工作台与 stockdb 集成 | `web/*`、`docs/STOCKDB_INTEGRATION.md`、`docs/数据获取能力评估报告.md` |
| 2026-09-11 | 首次公开快照（`3346173`） | `git show --stat 3346173` |
| 2026-09-21 | 连板数口径修复（`1ef9439`） | `test/ths-limit-up-board-count.test.js` |
| 2026-11-11 | 开源治理收尾（0.2.0） | LICENSE / CHANGELOG / ROADMAP / docs/TESTING.md / docs/SECURITY_AUDIT.md |

## 详细记录

### 2026-03-27 · 逐笔 outcome 台账初版

- 动作：把"今天做了什么、是否按计划、盈亏多少"落成结构化台账，供后续规则统计。
- 产物：`outputs/history/2026-03-27/outcome.json`（3 笔，合计 +1.6%，计划匹配率 100%）。
- 观察：早期台账只有 `pnlPct` 与 `matchedPlan` 两个维度的有效信息，`positionPct`、`holdingDays`、`entryStyle` 全为占位值 —— 数据结构先于数据质量，这是后来给模板加字段的原因。

### 2026-03-28 · 台账字段扩容

- 动作：加入 `winRate`、`disciplineScore`、`setupBreakdown`、`tradeJournal`。
- 产物：`outputs/history/2026-03-28/outcome.json`。
- 决策：`setup` 维度采用自由文本（"龙头分歧转一致""前排换手板确认"），而不是枚举 —— 因为短线打法的命名演化很快，枚举会逼着人改代码。

### 2026-03-31 · 完整日流水线 + 看板

- 动作：跑通 `premarket → decision → postmarket → outcome → rule-optimizer` 全链路；同日产出策略看板数据。
- 产物：`outputs/daily/2026-03-31/{snapshot,decision,premarket,postmarket,outcome,rule-optimizer,strategy-dashboard}.{json,txt}`、`outputs/history/dashboard.json`。
- 结果：环境判为"进攻环境 / 情绪启动 / 主线机器人 / 偏好连板接力"，但最终 `Action Bias = 停止出手`、`Position Plan = 空仓` —— 因为没有通过允许买点校验。这条记录成了后来"闸门优先于信号"设计原则的实证案例。
- 问题：`Data Confidence` 在该样本为 `N/A`，说明 confidence 计算依赖的字段在某些输入下缺失；后续在 `governance/decision-guardrails.js` 中补了缺省降级。

### 2026-04-05 ~ 2026-04-13 · 联网自动模式连续验证

- 动作：`run-analysis.ps1 -Mode auto-live` 每日运行，采集东财涨停池/指数/板块 + 财联社快讯 + 妙想上下文，产出决策与新闻催化结果。
- 产物：每日 `auto-live.json`（约 2.2–2.6 MB）、`auto-live.txt`（约 25–28 KB）、`news-catalysts.json`（约 165–188 KB）。
- 发现的问题（已在 0.2.0 治理中处理）：
  1. 单日 JSON 体积过大（2 MB+），把行情原始数据整包塞进了归档 → 归档不适合直接入库；
  2. 抓取过程出现 `MaxListenersExceededWarning`（并发请求复用 socket 时监听器累加），属于待修项，已记入 [ROADMAP](ROADMAP.md) 0.3.x；
  3. 新闻源偶发返回 0 条（`[财联社] 获取到 0 条新闻`），系统按设计降级而非报错。
- 结论：连续 7 个交易日跑通，未出现主链路中断，验证了"采集失败只降级"的设计。

### 2026-04 · Web 工作台与 stockdb 集成

- 动作：把决策与行情数据接到浏览器端：竞价工作台、市场管理、涨停梯队、历史数据、K 线图表、新闻列表、Key 管理。
- 关键决策：
  - 行情数据接入本机 `stockdb`（`http://127.0.0.1:7899`），涨停池与竞价自定义数据写入 `mydb` 私有空间，边界见 `docs/STOCKDB_INTEGRATION.md`；
  - 历史接口统一做**交易日回退**：非交易日返回最近交易日数据并标 `isFallback: true`，避免前端到处写容错；
  - 竞价页的实时五档/分时依赖 `stockdb` 本地桥接 + CMES Token，Token 只在本地 `key-management.html` 配置，不落仓库。
- 产物：`web/*.html`、`web/*-routes.js`、`docs/竞价工作台数据源与缓存策略.md`、`docs/分时图说明.md`。

### 2026-09-11 · 首次公开快照

- 动作：整理目录、脱敏示例数据、补 `.env.example`、首次公开。
- 提交：`3346173 Initial public snapshot`（163 个 skills 文件、72 个 outputs 文件、58 个 src 文件一并入库）。
- 事后复盘：这次提交把 `outputs/` 与运行日志一并带进了公开仓库，是 0.2.0 敏感数据治理的直接起因。

### 2026-09-21 · 连板数口径修复

- 问题：同花顺复盘页与东财涨停池对"连续涨停板数"的定义不一致，导致多日未交易/首次涨停的个股连板高度被错误累加，直接污染"连板高度"这个环境判断的核心输入。
- 修复：`ths-auto.js`、`auction-source-adapters.js`、`market-sync.js`、`market-management-routes.js` 统一解析官方涨停池的连板字段；`mergePostmarketLimitUpItem` 不再用本地累加值覆盖官方值。
- 验证：新增 `test/ths-limit-up-board-count.test.js`（2 个用例：连板数合并、复盘原因与连板元数据构造）。
- 提交：`1ef9439 Fix consecutive limit-up board counts`（6 个文件，+179/−50）。

### 2026-11-11 · 开源治理收尾（0.2.0）

- 补齐许可：`LICENSE`（MIT）+ `THIRD_PARTY_NOTICES.md`（Apache-2.0 技能包、妙想脚本、知识库笔记、行情数据来源）。
- 补齐证据链：`CHANGELOG.md`、`ROADMAP.md`、`docs/TESTING.md`（实测 47 用例 / 44 通过）、`docs/SECURITY_AUDIT.md`。
- 清理敏感/冗余内容：移除 28 MB 行情快照、4 个运行日志、`.claude/settings.local.json`；`.gitignore` 增加 `inputs/`、`*.out`、`*.err`、`src/data/`。
- 增强 README：英文摘要、架构图（Mermaid + PNG）、界面截图、安装步骤、适用场景、功能边界。
- 实测环境：Node 24.18 / npm 11.x / Windows 11；`npm install --ignore-scripts` + `prebuild-install` 安装 `better-sqlite3`，`node --test` 跑通 44/47。
