# A股短线情绪自动分析决策系统

基于 [游资知识库](/g:/A股游资/游资知识库) 搭建的本地 Node.js 自动分析决策系统。

当前核心能力：

- 市场环境判断
- 情绪周期定位
- 主线题材识别
- 龙头、题材龙头、容量核心、中军识别
- 标准买点与禁止项判断
- 仓位与硬闸门控制
- 独立卖点引擎
- 盘前、盘中、盘后工作流
- 历史归档、样本台账、规则优化器
- 东方财富公开数据采集
- 妙想数据增强
- 新闻 LLM 语义催化分析
- 知识库检索 + LLM 解释层

## 推荐命令

### 一键启动整个 Web 项目

在资源管理器中双击项目外层的 `启动项目.cmd`，或双击项目目录中的 `start-project.cmd`。启动器会启动统一的 Web 服务并打开项目首页；竞价工作台、市场管理、数据查看和历史数据页面都由同一个服务提供。

当前启动器默认打开竞价工作台：`http://localhost:3000/auction-monitor.html`。策略看板服务同时运行在 `http://localhost:3030/index.html`；后续统一首页完成后，再将启动器默认入口切换到统一首页。

行情数据接入本机 stockdb，涨停池和竞价自定义数据写入 stockdb 的 `mydb` 私有空间。迁移、清空和更新边界见 [`docs/STOCKDB_INTEGRATION.md`](docs/STOCKDB_INTEGRATION.md)。

### 本地日报一键运行

```powershell
powershell -ExecutionPolicy Bypass -File .\run-analysis.ps1 -Mode daily-md -InputPath .\inputs\daily\latest.md
```

### 全自动联网采集并分析

```powershell
powershell -ExecutionPolicy Bypass -File .\run-analysis.ps1 -Mode auto-live
```

### 自动盘中结构分析

```powershell
powershell -ExecutionPolicy Bypass -File .\run-analysis.ps1 -Mode intraday-live
```

### 逐笔持仓卖点计划

```powershell
npm run position:sell
```

如需指定交易日：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-analysis.ps1 -Mode auto-live -TradeDate 2026-03-31
powershell -ExecutionPolicy Bypass -File .\run-analysis.ps1 -Mode intraday-live -TradeDate 2026-03-31
```

## 数据同步系统

### 快速开始

```bash
# 查看同步状态
node sync-data.js status

# 同步今日数据
node sync-data.js sync-today

# 同步最近30天数据
node sync-data.js sync-recent 30

# 同步个股K线
node sync-data.js sync-kline 000001 100

# 查看帮助
node sync-data.js help
```

### 数据存储

所有市场数据已实现本地数据库存储和增量更新：

- ✅ 个股K线历史数据（日/周/月）
- ✅ 涨停池/跌停池历史
- ✅ 概念板块历史
- ✅ 市场指数历史
- ✅ 竞价数据
- ✅ 财联社新闻

数据库文件：`src/data/market.db`

### Web API接口

启动服务器：`node web/search-server.js`

访问地址：http://localhost:3000

#### Web界面
- `/history-viewer.html` - 历史数据查看器（K线、涨停池、板块、指数等）
- `/data-viewer.html` - 实时数据查看器

#### 实时数据
- `/api/raw-data` - 当前市场数据

CMES VIP 实时数据（需在 `key-management.html` 配置 Token，并启动 stockdb 的本地桥接）：

- `/api/cmes/quotes?codes=601212,000001` - 实时五档
- `/api/cmes/minutes?code=601212` - 当日实时分钟
- `/api/cmes/ticks?code=601212&count=2000` - 实时分笔 Tick

#### 历史数据
- `/api/history/kline?code=000001&limit=100` - K线历史
- `/api/history/limit-up?date=2026-04-26` - 涨停池历史
- `/api/history/limit-down?date=2026-04-26` - 跌停池历史
- `/api/history/sector?date=2026-04-26` - 板块历史
- `/api/history/index?date=2026-04-26` - 指数历史
- `/api/history/auction?date=2026-04-26` - 竞价数据
- `/api/history/trading-dates?limit=100` - 交易日列表
- `/api/history/sync-status` - 同步状态

**交易日过滤功能：** 所有历史数据API支持自动交易日过滤。当查询非交易日时，自动返回最近交易日的数据，并在响应中标注 `isFallback: true`。

详细文档：[数据同步系统使用指南](docs/数据同步系统使用指南.md)

## 自动联网模式

### 基础层：东方财富公开数据

- 涨停池
- 跌停池
- 昨日涨停池
- 概念板块热度
- 快讯标题

### 增强层：妙想 skills

- `mx-search`：新闻、公告、研报、催化信息
- `mx-xuangu`：候选股筛选结果
- `mx-data`：指数与市场查询摘要

### 解释层：SiliconFlow + DeepSeek 容灾链

- 主模型：`deepseek-ai/DeepSeek-V3.2`
- 备用模型：`Pro/deepseek-ai/DeepSeek-V3.2`
- 接口：`https://api.siliconflow.cn/v1/chat/completions`
- 主模型失败时自动切换备用模型
- 两者都失败时降级为本地规则解释，不阻断主决策链

系统会自动推导：

- 涨停/跌停数量
- 连板高度
- 主线集中度
- 炸板率近似值
- 昨日强股反馈
- 次日溢价与赚钱效应
- 主线题材与核心股候选
- 数据可信度与 warnings
- 盘中结构信号
- LLM 解释版结论

## LLM 配置

根目录 `.env` 支持以下变量：

- `SILICONFLOW_API_KEY`
- `HOT_MONEY_SILICONFLOW_API_KEY`（本项目涨停复盘图片识别专用，优先级更高）
- `SILICONFLOW_BASE_URL`
- `SILICONFLOW_MODEL_PRIMARY`
- `SILICONFLOW_MODEL_BACKUP`
- `SILICONFLOW_REVIEW_MODEL`

模板见 [`.env.example`](/g:/A股游资/.env.example)。

## 决策闸门

系统会根据 `dataQuality.confidence` 和关键缺失项自动降级：

- `confidence < 0.45`：`hard-stop`，输出 `停止出手 / 空仓`
- `0.45 <= confidence < 0.60`：`cautious`，只允许保守结论
- 无明确主线或关键基础数据缺失：禁止主动进攻

LLM 解释层只能解释结论，不能绕过闸门。

## 统计与规则优化

每次归档后，系统会更新：

- [index.json](/g:/A股游资/outputs/history/index.json)
- [samples.json](/g:/A股游资/outputs/history/samples.json)
- [dashboard.json](/g:/A股游资/outputs/history/dashboard.json)
- [dashboard.txt](/g:/A股游资/outputs/history/dashboard.txt)
- [rule-optimizer.json](/g:/A股游资/outputs/history/rule-optimizer.json)
- [rule-optimizer.txt](/g:/A股游资/outputs/history/rule-optimizer.txt)

`rule-optimizer` 会按：

- `setup x environment`
- `setup x theme`
- `setup x position`
- `setup x entryStyle`

给出 `保留 / 收紧 / 禁用 / 观察` 四类规则建议。

## 逐笔 Outcome 模板

逐笔 outcome 支持字段：

- `symbol`
- `theme`
- `setup`
- `plannedSetup`
- `plannedTheme`
- `pnlPct`
- `matchedPlan`
- `positionPct`
- `holdingDays`
- `entryStyle`
- `exitReason`
- `entryConfidence`
- `tags`
- `notes`

模板见 [trade_outcome.template.json](/g:/A股游资/data/templates/trade_outcome.template.json)。

## 逐笔卖点计划模板

逐笔持仓卖点输入支持：

- `marketNotes`：当天市场快照输入
- `holdings`：你的实际持仓
- 每笔持仓字段包含 `theme / positionPct / pnlPct / holdingDays / entryStyle / plannedSetup / matchedPlan`

模板见 [position_sell_input.template.json](/g:/A股游资/data/templates/position_sell_input.template.json)，示例见 [position_sell_input.json](/g:/A股游资/data/examples/position_sell_input.json)。

## 说明

- 自动联网模式依赖外网、东方财富公开接口、妙想 API 和 SiliconFlow API 可访问。
- 妙想接口失败时，会降级回东方财富公开数据，不阻断主流程。
- SiliconFlow 两个模型都失败时，会降级为本地规则解释。
- 数据缺失时，系统会降低 `confidence` 并输出 `warnings`，而不是强行给激进结论。
- 非交易日会自动回退到最近有数据的交易日。
