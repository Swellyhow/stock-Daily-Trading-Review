# Changelog

本项目的所有重要变更都记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned
- 为 `stockdb-sector-source` 相关用例提供本地 fixture，使测试在没有 `stockdb` 数据集时也能确定性通过。
- 归档目录增加 `--dry-run` 与输出大小上限，避免联网模式产出超大快照文件。

## [0.2.0] - 2026-11-11

### Added
- `LICENSE`：主体代码采用 MIT 许可。
- `THIRD_PARTY_NOTICES.md`：登记 Apache-2.0 的 `Awesome-finance-skills` 技能包、妙想 `mx-*` 技能脚本、游资知识库笔记与行情数据来源的授权状态。
- `CHANGELOG.md`、`ROADMAP.md`、`docs/DEVLOG.md`、`docs/TESTING.md`、`docs/SECURITY_AUDIT.md`：补齐版本、路线、开发、测试与敏感数据证据链。
- `docs/assets/architecture.png`、`auction-monitor.png`、`market-management.png`、`history-viewer.png`：系统架构图与界面截图。
- `.github/workflows/ci.yml`：Node 20/22/24 三版本矩阵，执行 `npm run check` 与 `node --test "test/**/*.test.js"`。
- `.github/ISSUE_TEMPLATE/bug_report.yml`、`feature_request.yml`、`.github/PULL_REQUEST_TEMPLATE.md`：Issue/PR 结构化模板。
- `README.md` 全面重写：英文摘要、架构图（Mermaid + PNG）、运行截图、安装步骤、适用场景、功能边界与已知限制、维护记录索引。

### Changed
- `package.json`：补充 `description` / `keywords` / `license` / `repository` / `engines` 字段，版本提升至 `0.2.0`。
- `.gitignore`：新增 `inputs/`、`*.out`、`*.err`、`src/data/`，与 README 中"归档与运行产物不入库"的说明保持一致。

### Fixed
- `src/lib/collector/market-database.js`：首次运行时自动创建 `src/data/` 目录（此前需要手工 `mkdir`，否则 CI/新机器上会报 `Cannot open database because the directory does not exist`）。
- `src/lib/collector/market-database.js`：连接增加 `busy_timeout = 5000`。CI 的 `node 24 / windows-latest` 首次运行暴露出：`node --test` 并行子进程同时打开同一个 `src/data/market.db` 时会抛 `SqliteError: database is locked`；改为等待锁而非立即失败。

### Removed
- 取消跟踪运行日志 `web-server.out`、`web-server.err`、`web_server.out`、`web_server.err`（含本机运行路径与接口调用痕迹）。
- 取消跟踪 `.claude/settings.local.json`（含本机进程 PID 与临时授权项）。
- 移除仓库内 2026-04-05 ~ 2026-04-13 的 `outputs/daily/*`、`outputs/history/*/live/*` 行情快照（约 28 MB，属第三方行情数据，不适合随代码分发）。
- 取消跟踪 `outputs/`、`inputs/` 下的运行产物；仓库仅保留 2026-03-27/28/31 与 `undated` 的脱敏演示产物。

## [0.1.1] - 2026-09-21

### Fixed
- 修正同花顺涨停复盘"连续涨停板数"统计口径：`src/lib/collector/ths-auto.js`、`auction-source-adapters.js`、`market-sync.js`、`web/market-management-routes.js` 统一按官方涨停池的连板字段解析，修复多日未复牌/首次涨停个股连板数被错误累加的问题。
- 新增回归用例 `test/ths-limit-up-board-count.test.js`（"连续涨停板数"合并与元数据构造）。

## [0.1.0] - 2026-09-11

### Added
- 首次公开快照：规则内核（环境/情绪/题材/龙头/模式/仓位/执行/卖点）、编排器、盘前盘中盘后工作流、逐笔台账与规则优化器。
- 多源采集：东方财富公开接口、同花顺涨停复盘、财联社快讯、妙想 skills、本地 `stockdb`。
- LLM 解释层：新闻催化语义分析 + 决策解释，主/备模型与规则降级链。
- Express Web：竞价工作台、市场管理、涨停梯队、历史数据、K 线图表、新闻列表、Key 管理。
- 设计文档与功能清单：`docs/` 下 12 篇（数据获取能力评估、涨停类型量化定义、规则引擎参数等）。
