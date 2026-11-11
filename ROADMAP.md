# Roadmap

目标：把"能跑通的个人复盘系统"推进到"可被别人复现、可被验证、可长期维护"的开源工具。优先级按 `P0 正确性 → P1 可复现 → P2 体验 → P3 扩展` 排列。

当前版本 **0.2.0**（见 [CHANGELOG.md](CHANGELOG.md)）。

## 0.3.x — 可复现性与测试基线（进行中，P0/P1）

- [ ] `stockdb` 依赖用例改造成 fixture 驱动：`test/stockdb-sector-source.test.js` 的 3 个用例在无本地数据集时跳过（`t.skip`）并给出 `STOCKDB_ROOT` 提示，CI 上全绿。
- [ ] 为 `eastmoney-auto` / `ths-auto` / `cls-collector` 增加录制回放（record & replay）：把一次真实抓取落成 `test/fixtures/*.json`，测试不依赖外网。
- [ ] 归档输出上限：`outputs/daily/*/auto-live.json` 单文件限制（如 ≤ 2 MB），提供 `--slim` 只保留决策所需字段。
- [ ] `.github/workflows/ci.yml` 增加 Windows / Ubuntu 双平台矩阵，覆盖 `better-sqlite3` 安装路径。

## 0.4.x — 规则层可解释与可调参（P2）

- [ ] 规则参数外置：把 `rules/*` 中的阈值集中到 `config/rules.json`（保留代码默认值作为回退），支持按市场（主板/创业板/北交所）切换参数集。
- [ ] `rule-optimizer` 输出置信区间：用 bootstrap 给 `setup × environment` 分组胜率加区间，避免小样本误导。
- [ ] 决策报告增加"证据表"：每条结论附带触发它的原始字段与阈值，便于事后追责。
- [ ] 为 `governance/decision-guardrails` 增加单元测试（当前仅覆盖到路由与模型层）。

## 0.5.x — 界面与数据体验（P2/P3）

- [ ] 统一首页：把竞价工作台、市场管理、历史数据、策略看板收拢到一个入口（当前默认入口仍是 `auction-monitor.html`）。
- [ ] 历史页支持多标的对比与区间统计（涨停次数、连板分布、板块内排名）。
- [ ] 新闻页增加"按题材聚合 + 催化强度排序"，与 LLM 催化结果联动。
- [ ] 前端资源打包拆包：`web/app.bundle.js` 约 1.2 MB，按路由拆分懒加载。

## 1.0 — 稳定性与非投资建议边界（P0）

- [ ] 完整数据 schema 版本化：`snapshot` / `decision` / `outcome` 加 `schemaVersion`，归档可向前兼容读取。
- [ ] 全链路契约测试：示例输入 → snapshot → decision → 报告文本做快照对比，规则改动必须显式更新基线。
- [ ] 文档补齐：数据字典（字段、单位、口径）、故障排查手册（接口失败/限流/时区/交易日）。
- [ ] 在 README 与所有输出文件头固化免责声明：输出为决策辅助，不构成投资建议。

## 明确不做

- 不接券商/期货下单接口，不做自动化实盘交易。
- 不做行情数据转售或对外提供数据接口。
- 不内置任何真实 API Key、账户凭证或个人交易流水。
