# 规则引擎参数说明

本文档用于说明当前短线情绪决策系统中，规则引擎是如何从结构化数据中产出：

- 市场环境
- 情绪周期
- 主线题材
- 龙头与核心股
- 执行动作
- 仓位计划

同时说明当前 `新闻催化强度` 与 `赚钱效应` 的计算方式，以及为什么新闻层更适合引入大模型语义分析。

## 1. 决策总流程

当前规则链路如下：

1. 原始数据整理成 `snapshot`
2. 根据 `snapshot.market` 计算市场环境
3. 根据环境 + 盘口广度计算情绪周期
4. 根据 `snapshot.themes` 识别主线题材
5. 根据 `snapshot.stocks` 识别龙头与核心股
6. 根据环境 / 情绪 / 主线 / 龙头给出动作倾向和允许买点
7. 根据环境 / 情绪 / 主线 / 龙头给出仓位计划
8. 再经过硬闸门做二次收缩

对应入口：

- [orchestrator.js](/g:/A股游资/src/lib/orchestrator.js)

## 2. 市场环境参数

对应：

- [environment.js](/g:/A股游资/src/lib/rules/environment.js)

环境分初始值为 `50`，再按以下规则加减，最终限制在 `0 ~ 100`。

| 维度 | 输入字段 | 计算规则 | 作用 |
|---|---|---|---|
| 涨停数 | `limitUpCount` | `(limitUpCount - 40) * 0.7`，限制在 `-20 ~ +25` | 涨停越多越强 |
| 跌停数 | `limitDownCount` | `(limitDownCount - 5) * 1.2`，限制在 `0 ~ 35` 后扣分 | 跌停越多越弱 |
| 连板高度 | `maxBoardHeight` | `(maxBoardHeight - 2) * 4`，限制在 `0 ~ 15` | 高标越高越强 |
| 主线集中度 | `mainlineConcentration` | `(mainlineConcentration - 0.3) * 35`，限制在 `-10 ~ +20` | 主线越集中越强 |
| 炸板率 | `brokenBoardRate` | `(brokenBoardRate - 0.2) * 40`，限制在 `0 ~ 20` 后扣分 | 炸板越多越弱 |
| 昨日强股反馈 | `yesterdayStrongFeedback` | `* 20`，限制在 `-20 ~ +20` | 昨强反馈越好越强 |
| 高位负反馈 | `highPositionNegativeFeedback` | `* 20`，限制在 `0 ~ 20` 后扣分 | 高位补跌越强越弱 |

### 环境标签阈值

| 分数区间 | 标签 |
|---|---|
| `>= 75` | `进攻环境` |
| `46 ~ 74` | `震荡轮动` |
| `26 ~ 45` | `退潮环境` |
| `<= 25` | `冰点/恐慌` |

## 3. 情绪周期参数

对应：

- [emotion-cycle.js](/g:/A股游资/src/lib/rules/emotion-cycle.js)

| 阶段 | 条件 |
|---|---|
| `冰点` | `environment.score <= 25` |
| `退潮` | `environment.score <= 45` 或 `highPositionNegativeFeedback >= 0.6` |
| `高潮` | `limitUpCount >= 60` 且 `maxBoardHeight >= 4` 且 `yesterdayStrongFeedback >= 0.5` 且 `mainlineConcentration >= 0.55` |
| `发酵` | `limitUpCount >= 40` 且 `maxBoardHeight >= 3` 且 `yesterdayStrongFeedback >= 0.2` |
| `启动` | `limitUpCount >= 20` 且 `yesterdayStrongFeedback >= 0` 且 `highPositionNegativeFeedback <= 0.4` |
| `分歧` | 其他情况 |

## 4. 主线题材参数

对应：

- [themes.js](/g:/A股游资/src/lib/rules/themes.js)

### 4.1 题材分数

| 维度 | 计算规则 |
|---|---|
| 持续天数 | `continuityDays * 10` |
| 涨停家数 | `limitUpCount * 2` |
| 最高板 | `maxBoardHeight * 4` |
| 有龙头 | `+15` |
| 有中位承接 | `+8` |
| 赚钱效应 | `profitEffect * 20` 取整 |
| 联动强度 | `linkageStrength * 20` 取整 |
| 新闻催化强度 | `newsCatalystStrength * 15` 取整 |

### 4.2 主线 checklist

| 检查项 | 条件 |
|---|---|
| 连续性 | `continuityDays >= 2` |
| 排名前二 | 当前题材排序索引 `<= 1` |
| 有龙头 | `hasLeader = true` |
| 梯队完整 | `ladderCompleteness != 不足` |
| 赚钱效应达标 | `profitEffect >= 0.5` |

满足 `4 / 5` 及以上，当前实现才把它认作 `主线候选`。

### 4.3 梯队完整性

| 条件 | 结果 |
|---|---|
| `maxBoardHeight >= 4` 且 `limitUpCount >= 5` | `完整` |
| `maxBoardHeight >= 2` 且 `limitUpCount >= 3` | `一般` |
| 其他 | `不足` |

## 5. 龙头与核心股参数

对应：

- [leaders.js](/g:/A股游资/src/lib/rules/leaders.js)

### 5.1 个股分数

| 维度 | 计算规则 |
|---|---|
| 连板高度 | `boardHeight * 8` |
| 辨识度 | `recognition * 20` 取整 |
| 竞价强度 | `auctionStrength * 15` 取整 |
| 回封/反包强度 | `reboundStrength * 15` 取整 |
| 持续性 | `followThrough * 15` 取整 |
| 量能质量 | `volumeQuality * 10` 取整 |
| 自带龙头属性 | `+15` |
| 属于主线 | `+10` |
| 中位风险 | `-15` |

### 5.2 角色划分

| 角色 | 条件 |
|---|---|
| `龙头` | `isLeader = true`，或同主线且 `boardHeight >= 4` 且与最高分差 `<= 15` |
| `前排核心` | 同主线且 `boardHeight >= 2` 且分差 `<= 25` |
| `中位跟随` | 同主线且 `boardHeight >= 2` |
| `低位补涨` | 同主线且 `boardHeight <= 1` |
| `后排跟风` | 其他 |

## 6. 执行动作参数

对应：

- [execution.js](/g:/A股游资/src/lib/rules/execution.js)

### 6.1 动作倾向

| 动作 | 条件 |
|---|---|
| `主动进攻` | `environment.score >= 75` 且有主线且有龙头 |
| `精选出手` | `environment.score >= 50` 且有主线 |
| `防守观察` | 其他 |

### 6.2 允许买点

| 买点 | 条件 |
|---|---|
| `龙头分歧转一致` | 有龙头，且情绪不是 `退潮 / 冰点` |
| `前排换手板确认` | 主线存在，且 `linkageStrength >= 0.6` |
| `核心股弱转强` | `yesterdayStrongFeedback >= 0.2` 且 `environment.score >= 50` |
| `冰点修复首个试错点` | 情绪为 `启动` 或 `发酵` |

### 6.3 默认禁止项

- `追后排跟风`
- `情绪退潮中的中位接力`

### 6.4 额外禁止项

- `environment.score < 50` 时：
  - `追一致加速板`
  - `临时起意打板`
- 没有明确主线时：
  - `非主线套利单`

## 7. 仓位参数

对应：

- [position.js](/g:/A股游资/src/lib/rules/position.js)

### 7.1 总仓位

| 总仓位 | 条件 |
|---|---|
| `7成仓` | `environment.score >= 75` 且有主线且有龙头 |
| `半仓` | `environment.score >= 60` 且有主线 |
| `空仓` | `environment.score <= 25` 或情绪为 `冰点` |
| `轻仓` | 其他 |

### 7.2 仓位结构

| 总仓位 | 分配 |
|---|---|
| `7成仓` | `leaderCore 0.4 / secondaryCore 0.2 / trial 0.1` |
| `半仓` | `leaderCore 0.25 / secondaryCore 0.15 / trial 0.1` |
| `轻仓` | `leaderCore 0.1 / secondaryCore 0.1 / trial 0.05` |
| `空仓` | 全部为 `0` |

## 8. 新闻催化强度怎么判断

当前实现不在规则引擎本体里，而是在快照构建阶段完成。

对应：

- [live-to-snapshot.js](/g:/A股游资/src/lib/collector/live-to-snapshot.js)

### 8.1 当前实现方式

当前 `newsCatalystStrength` 是一个 `0 ~ 1` 的归一化值，主要由 3 部分取最大值：

1. 东方财富快讯 / 妙想新闻标题命中数
2. 题材连续性兜底分
3. 妙想新闻增强分

### 8.2 标题命中得分

实现函数：

- [live-to-snapshot.js](/g:/A股游资/src/lib/collector/live-to-snapshot.js#L38)

规则：

- 统计新闻标题里包含题材名的条数 `hits`
- 用 `hits / 3`
- 最终限制在 `0 ~ 1`

即：

| 命中条数 | 分数 |
|---|---|
| `0` | `0` |
| `1` | `0.33` |
| `2` | `0.67` |
| `>= 3` | `1` |

### 8.3 行业题材的连续性兜底

如果一个行业昨天也在涨停池里，会给一个连续性基础分：

- 昨天也出现：`0.6`
- 没出现：`0.2`

这一步主要是为了避免完全靠新闻标题做题材判断。

### 8.4 妙想增强

如果妙想返回了 `themeCatalysts`，会取对应题材的 `catalystScore` 作为增强值。

最终逻辑：

- 概念板块题材：`max(标题命中分, 妙想增强分)`
- 涨停池行业题材：`max(标题命中分, 连续性兜底分, 妙想增强分)`

## 9. 赚钱效应怎么判断

对应：

- [live-to-snapshot.js](/g:/A股游资/src/lib/collector/live-to-snapshot.js#L51)

当前 `profitEffect` 也是一个 `0 ~ 1` 的归一化值。

### 9.1 概念板块题材

规则：

- `profitEffect = conceptBoard.changePct / 10`
- 再限制在 `0 ~ 1`

例子：

| 板块涨幅 | 赚钱效应 |
|---|---|
| `2%` | `0.2` |
| `5%` | `0.5` |
| `10% 及以上` | `1` |

### 9.2 涨停池行业题材

规则：

- 取该行业下所有涨停股的 `changePct / 10`
- 求平均
- 限制在 `0 ~ 1`

所以它反映的不是“题材讲得好不好”，而是：

`这个题材里的强势股，当下有没有给出可见的赚钱示范`

## 10. 为什么新闻更适合接入大模型

我同意，新闻层更适合引入大模型做语义分析，原因很明确：

### 10.1 当前实现的局限

现在的新闻催化强度主要是：

- 看标题里是否出现题材名
- 看新闻条数多不多
- 看妙想是否也返回相关题材

这套方式的问题是：

- 只能做关键词命中，不能理解语义
- 不能区分“重大催化”还是“普通提及”
- 不能判断利好、利空、中性
- 不能判断消息是否真正利好当前主线
- 不能处理“题材别名 / 上下游映射 / 政策链条”

### 10.2 更合理的大模型新闻层

更推荐把新闻层升级成：

`新闻抓取 -> 新闻去重 -> 大模型语义归因 -> 题材映射 -> 催化强度评分 -> 回写 snapshot`

建议让大模型输出结构化字段，例如：

| 字段 | 含义 |
|---|---|
| `theme` | 归属题材 |
| `eventType` | 政策 / 公告 / 产业 / 订单 / 业绩 / 传闻 |
| `sentiment` | 利好 / 中性 / 利空 |
| `strength` | 催化强度 `0 ~ 1` |
| `duration` | 一次性 / 短期 / 中期 |
| `scope` | 个股 / 板块 / 全市场 |
| `reason` | 为什么归到这个题材 |

### 10.3 推荐落地方式

不建议让大模型直接替代规则引擎，而是让它只增强新闻层：

1. 规则引擎继续负责环境、周期、主线、仓位
2. 大模型只负责新闻语义理解和题材催化归因
3. 最终只把大模型输出的结构化催化分数写回 `newsCatalystStrength`
4. 硬闸门仍然优先级最高

这样做的好处是：

- 保留规则引擎的稳定性
- 增强新闻理解能力
- 方便回测和调参
- 不会让 LLM 直接接管交易判断

## 11. 当前建议

当前最适合的升级方向是：

1. 保留现有规则引擎作为主决策骨架
2. 把 `新闻催化强度` 从关键词匹配升级成 `LLM 语义评分`
3. 让大模型输出结构化结果，而不是直接输出一句主观判断
4. 将结构化新闻结果回灌到 `snapshot.themes[*].newsCatalystStrength`

这样系统会更符合你的交易框架，也更容易长期维护。
