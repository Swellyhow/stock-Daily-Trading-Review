# 测试与验证记录

本文件记录可复现的测试结果：命令、环境、通过/失败明细、失败原因与后续动作。原始输出见 [`test-run-2026-11-11.log`](test-run-2026-11-11.log)。

## 环境

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-11 |
| OS | Windows 11 (10.0.26200) |
| Node.js | v24.18.0 |
| npm | 11.x |
| 依赖安装 | `npm install --ignore-scripts` + `better-sqlite3` 预编译二进制 |
| 本地数据 | `src/data/market.db`（当日 `sync-today` 同步：383 概念板块 / 16 指数） |
| 本地 `stockdb` | **未提供**（因此 3 个 `.TI` 板块用例失败，属预期） |

## 1. 安装与语法自检

```bash
npm install --ignore-scripts --no-audit --no-fund
cd node_modules/better-sqlite3
npx prebuild-install -r node -t 24.18.0 -a x64    # 成功：better_sqlite3.node (ABI node-v137-win32-x64)
npm run check                                     # node --check src/index.js
```

结果：安装成功（139 packages），`better-sqlite3` 预编译二进制加载正常。

> 若不执行 `prebuild-install`，`npm install` 会走 `node-gyp` 本地编译，Windows 下需要 VS Build Tools + "使用 C++ 的桌面开发" 工作负载，否则报 `gyp ERR! find VS`。

## 2. 单元测试

```bash
node --test --test-reporter=spec "test/**/*.test.js"
```

```text
ℹ tests      47
ℹ pass       44
ℹ fail        3
ℹ duration_ms ~557
```

### 通过的覆盖面（44）

| 领域 | 代表用例 |
| --- | --- |
| 连板数口径（0.1.1 修复） | `THS N-day/M-board labels stay aggregate metadata, never current boardCount`、`postmarket merge uses Eastmoney lbc instead of THS rolling total`、`review merge rejects missing reasons and codes outside the official pool` |
| 交易日回退 | `auction route uses latest stockdb trading date when date is omitted`、`market route preserves an explicitly requested trading date`、`stockdb 无交易日时明确失败` |
| 分时/VWAP 口径 | `分时均价使用stockdb原始成交额/成交量…`、`零成交分钟沿用上一有效累计VWAP`、`板块明确average:null时…不伪造均价线` |
| 前端竞态与图表状态 | `latest request aborts superseded work…`、`identical in-flight requests share one fetch…`、`取消图表请求会使请求令牌失效并清空旧图` |
| 表格排序/序号 | `连板天梯排序后会按当前显示顺序重编号…`、`市场管理两张表启用空值末尾排序器…` |
| 个股列表增强 | `stock list enrichment uses THS membership and only siliconflow review details`、`stock list enrichment preserves quote rows when optional sources fail` |

### 失败的 3 个用例（均为本地 `stockdb` 数据依赖）

文件：`test/stockdb-sector-source.test.js`

| 用例 | 失败信息 |
| --- | --- |
| `daily snapshots preserve native .TI identity for board list statistics` | `Error: stockdb 概念板块.json 不存在，请设置 STOCKDB_ROOT` |
| `板块 K 线优先使用 stockdb 已提供的 .TI 原生行情` | 同上 |
| `市场管理板块接口把原生 .TI K线标记为 native` | `AssertionError: actual 'stockdb' ≠ expected 'stockdb .TI 原生板块行情'`（无原生产情时降级为普通 `stockdb` 来源标签） |

**性质判定**：这 3 个用例断言的是"优先使用 stockdb 的 `.TI` 原生行情"，需要本地 stockdb 数据集（`STOCKDB_ROOT` 指向包含 `概念板块.json` 的目录）。在无数据集的机器上属于**环境缺失**，不是规则或逻辑回归。

**复现方式**：

```bash
# 指定本地 stockdb 数据集后重跑
set STOCKDB_ROOT=<path-to-stockdb>     # Windows
STOCKDB_ROOT=<path-to-stockdb> node --test "test/stockdb-sector-source.test.js"
```

**后续动作**（已记入 [ROADMAP](../ROADMAP.md) 0.3.x）：改为 fixture 驱动 + `t.skip` 明确跳过，让 CI 在无数据集时全绿。

## 3. 数据同步冒烟测试

```bash
node sync-data.js status
node sync-data.js sync-today
```

```text
📊 同步今日市场数据...
[市场数据同步] 实际交易日: 2026-11-11
[市场数据同步] 概念板块: 383 个
[市场数据同步] 市场指数: 6 个
✅ 同步成功！
日期: 2026-11-11
涨停池: 0 只
跌停池: 0 只
板块: 383 个
指数: 16 个
```

说明：当日涨停池抓取返回 0 只（盘中时点/接口返回为空），系统按设计降级为空列表并继续写入板块与指数，未抛错中断。顺带观察到 `MaxListenersExceededWarning`（并发 socket 监听器累加），已记入 ROADMAP。

## 4. 决策链路冒烟测试

```bash
node src/index.js --mode analyze --format text
```

关键断言（人工核对）：

| 检查点 | 实测 |
| --- | --- |
| 环境识别 | `Environment: 进攻环境`，依据含"涨停58家，跌停7家 / 连板高度5板 / 主线集中度0.68" |
| 情绪周期 | `Emotion Cycle: 启动`，`Emotion Basis` 给出环境分 88 与高位负反馈 0.22 |
| 题材与龙头 | `Primary Theme: 机器人`，`Leader: 机器人龙头A` |
| 闸门优先 | 环境虽为进攻，但 `Allowed Setups: None` → `Action Bias: 停止出手`、`Position Plan: 空仓` |
| 禁止项输出 | `Forbidden Setups` 列出 6 条（追后排跟风、情绪退潮中的中位接力等） |
| 已知缺口 | `Data Confidence: N/A`（该示例输入缺 confidence 依赖字段） |

## 5. Web 服务冒烟测试

```bash
node web/search-server.js
```

| 请求 | 结果 |
| --- | --- |
| `GET /` | 200 |
| `GET /api/history/sync-status` | 200，返回 `lastSync.limit_up = 20261111`、`sector = 2026-09-01` 等实际同步状态 |
| `/auction-monitor.html`、`/market-management.html`、`/history-viewer.html` | 200，Chrome headless 渲染截图成功（见 README 截图，文件 114–136 KB，1680×1050） |

截图采集命令（无头模式，逐页单独 profile 避免锁冲突）：

```bash
chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run \
  --user-data-dir=%TEMP%\chromeprof1 --window-size=1680,1050 \
  --virtual-time-budget=10000 \
  --screenshot=docs/assets/market-management.png \
  http://127.0.0.1:3000/market-management.html
```

## 6. CI 实测（GitHub Actions）

工作流：`.github/workflows/ci.yml`（Node 20/22/24 × Ubuntu/Windows 共 6 个 job）。

首次运行 `run 43004422174`（commit `394bc6f`）结果：

| job | 结果 | 说明 |
| --- | --- | --- |
| node 20 / ubuntu | ✅ | |
| node 22 / ubuntu | ✅ | |
| node 24 / ubuntu | ✅ | |
| node 20 / windows | ✅ | |
| node 22 / windows | ✅ | |
| node 24 / windows | ❌ | `test/stockdb-date-resolution.test.js`：`SqliteError: database is locked`（41 用例 / 40 通过 / 1 失败） |

**问题定位**：`node --test` 以独立子进程并行跑测试文件，多个文件在 import 阶段各自实例化 `MarketDatabase` 并打开同一个 `src/data/market.db`；WAL 模式下跨进程写锁竞争在 Windows 上直接抛错（Linux 时序不同，未触发）。

**修复**：`market-database.js` 连接初始化增加 `busy_timeout = 5000`（等待锁而非立即失败），并在构造时 `mkdir -p src/data`。本地连续 3 轮 `node --test` 稳定为 44 pass / 3 fail（3 个为 stockdb 数据集缺失）。

**修复后复跑** `run 43004841929`（commit `5ea9afa`）：**6 个 job 全部通过**（Node 20/22/24 × Ubuntu/Windows），每个 job 41 用例全绿（排除了需要本地 stockdb 的 `stockdb-sector-source.test.js`），并通过 CLI 决策冒烟与 Web 服务启动冒烟。

**这条例子的价值**：它证明 CI 矩阵不是摆设——一个只在 Windows 并行时序下出现的锁竞争，被第一次跑就抓到了。

## 7. 未覆盖 / 待补测试

- `governance/decision-guardrails.js`、`trading-risk.js`、`execution-discipline.js`：无单元测试（最高优先级补测项）。
- `llm/news-catalyst-analyzer.js`：仅覆盖降级分支，未覆盖主/备模型切换。
- `history/rule-optimizer.js`：仅靠归档产物人工核对，无断言基线。
- 采集层（eastmoney/ths/cls）：无录制回放 fixture，当前依赖真实网络。

## 复现清单

```bash
npm install --ignore-scripts
(cd node_modules/better-sqlite3 && npx prebuild-install -r node -t 24.18.0 -a x64)
npm run check
node --test --test-reporter=spec "test/**/*.test.js"   # 期望 44 pass / 3 fail（无 stockdb 时）
node sync-data.js sync-today
node src/index.js --mode analyze --format text
node web/search-server.js                              # 另开终端：curl -I http://127.0.0.1:3000/
```
