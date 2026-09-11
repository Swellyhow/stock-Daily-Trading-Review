# stockdb 数据对接说明

## 数据边界

- 市场管理工作台的概念板块、成分股、板块 K 线、板块分时、个股 K 线、个股分时和交易日均只从本机 `stockdb` 读取，默认服务地址为 `http://127.0.0.1:7899`。
- 概念和成分关系读取 stockdb 自带的 `概念板块.json`；个股行情读取公共表 `日k`、`分钟k`。
- stockdb 的概念目录提供 `.TI` 代码和成分关系，但当前安装的公共 `日k`/`分钟k` 表中未发现 `.TI` 原生行情记录（已对整日代码键空间和多个候选命名空间做只读验证）。个股日 K、1 分钟分时直接读取原始表；5/15/30/60 分钟及周/月 K 才做周期转换。不要把 Python `get_price("300843.TI")` 当作板块行情：在当前 SDK 中它会忽略 `.TI` 后缀并返回同号股票 `300843`，对概念代码存在碰撞风险。板块 K 线和分时因此通过官方 SDK `zb.get("zhishu", symbols, ...)` 按成分股计算，并在接口标记 `dataQuality: constituent-index`、`source: stockdb zhishu 成分股合成指数`、`methodology: method=1 等权`，不冒充 `.TI` 原生行情。
- 连板天梯的涨停池继续使用项目现有的东方财富详细数据源，并保留同花顺涨停池作为成员补充。
- 连板天梯的概念筛选使用同一份 stockdb 概念成分关系；涨停池数据源边界保持不变。

### 分钟线保留范围

项目读取 `分钟k` 时默认只查询最近 365 天，边界由 `.env` 的
`STOCKDB_MINUTE_RETENTION_DAYS` 控制。这样即使调用方没有传日期，也不会把
多年分钟线加载到内存；日 K、周 K、月 K 不受此限制。当前随附的
`stockdb.exe` 将公共 `分钟k` 表以只读方式提供，不能通过 SDK 物理删除公共
`.ldb` 文件。`scripts/trim-stockdb-minutes.py` 可逐股票审计旧数据，默认预览，
并会在执行模式下先验证删除是否真正生效，避免误报。

## 私有存储

项目通过 stockdb Python SDK 将自定义数据写入 `stockdb/mydb`，不直接操作 stockdb 的公共 `data` 目录：

| 表名 | 用途 |
| --- | --- |
| `hot_money.limit_up_pool` | 东方财富详细涨停池，按交易日和代码保存 |
| `hot_money.limit_up_membership` | 同花顺涨停成员，避免覆盖详细字段 |
| `hot_money.auction_data` | 竞价汇总 |
| `hot_money.auction_snapshots` | 竞价期间最新快照 |

表的键结构为 `表名:交易日:代码`。详细涨停池优先于成员表，同一股票不会因为刷新成员数据而丢失涨幅、换手、封单金额等字段。

## 更新 stockdb

运行 `free-stockdb-windows-v0.3.2\stockdb\数据更新.exe` 时，更新器同步的是公共 `data/` 目录；项目自定义数据写入 `mydb/`，因此不会被公共行情更新覆盖。不要删除或替换 `mydb/`，也不要把自定义表写入 `data/`。

## 配置

默认配置即可使用本机实例。如目录位置不同，在 `.env` 中设置：

```text
STOCKDB_URL=http://127.0.0.1:7899
STOCKDB_PYTHON=python
STOCKDB_PYTHONPATH=D:\\path\\to\\stockdb\\pybao
```

首次迁移可执行：

```text
node scripts/clear-market-data.js --confirm
```

该命令只清空项目 SQLite 中的行情、涨停池、竞价、板块、指数和缓存记录，保留 `ui_preferences`，不会删除 stockdb 公共数据或 `mydb` 私有数据。
