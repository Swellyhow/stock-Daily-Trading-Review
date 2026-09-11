import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const VIEW_ITEMS = [
  ["overview", "总览"],
  ["process", "详细推导"],
  ["themes", "题材梯队"],
  ["execution", "股票池与执行"],
  ["review", "盘后复盘"],
  ["catalysts", "催化原因"],
  ["newssearch", "资讯搜索"],
  ["fastnews", "东方财富快讯"],
  ["newsfeed", "新闻列表"],
  ["history", "历史优化"],
  ["raw", "原始对象"]
];

const NEWS_SEARCH_FEATURES = [
  "实时新闻：聚合妙想资讯检索结果，快速查看最新金融新闻、公告和研报。",
  "关键词搜索：支持按股票名称、代码、板块、概念或自然语言问句搜索。",
  "时间筛选：支持最近一天、最近一周、最近一月等时间范围。",
  "事件追踪：把常用题材或个股加入追踪词，一键重复搜索。"
];

const NEWS_SEARCH_SCENARIOS = [
  "查找特定股票的最新消息和公告。",
  "了解某个行业或概念的近期动态。",
  "跟踪市场热点、政策催化和舆论趋势。",
  "快速验证盘前题材判断是否有新增资讯支撑。"
];

const NEWS_SEARCH_EXAMPLES = [
  "格力电器最新研报",
  "贵州茅台机构观点",
  "机器人板块近期新闻",
  "并购重组最新政策解读",
  "今日大盘异动原因分析"
];

const FAST_NEWS_FEATURES = [
  "独立查看东方财富快讯，不和妙想搜索结果混在一起。",
  "支持关键词过滤，快速筛出宏观、政策或题材脉冲。",
  "支持手动刷新，适合盘中盯消息。",
  "保留发布时间，便于对照盘面异动时点。"
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function fmtPct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(digits)}%`;
}

function fmtRatio(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN");
}

function safeText(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function badgeClass(value) {
  const text = String(value ?? "");
  if (/(进攻|主动|保留|bullish|success|在线|盘前|ready|已采纳)/i.test(text)) return "success";
  if (/(观察|谨慎|warn|一般|待确认|盘中|not yet|执行中)/i.test(text)) return "warn";
  if (/(空仓|冰点|恐慌|禁用|停止|danger|blocked|风险|盘后|异常|已过滤)/i.test(text)) return "danger";
  return "accent";
}

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
}

function metric(label, value, note) {
  return { label, value, note };
}

function pickNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function buildPoolReason(item, index, bucket) {
  const dataLine = [
    item.role ? `角色 ${item.role}` : null,
    item.theme ? `题材 ${item.theme}` : null,
    item.score !== null && item.score !== undefined ? `总分 ${item.score}` : null,
    item.boardHeight !== null && item.boardHeight !== undefined ? `板位 ${item.boardHeight}板` : null,
    item.recognition !== null && item.recognition !== undefined ? `辨识度 ${fmtRatio(item.recognition, 0)}` : null,
    item.auctionStrength !== null && item.auctionStrength !== undefined ? `竞价 ${fmtRatio(item.auctionStrength, 0)}` : null,
    item.reboundStrength !== null && item.reboundStrength !== undefined ? `回封 ${fmtRatio(item.reboundStrength, 0)}` : null,
    item.followThrough !== null && item.followThrough !== undefined ? `持续性 ${fmtRatio(item.followThrough, 0)}` : null
  ].filter(Boolean).join(" · ");

  const reason = item.reason ?? (
    bucket === "A池"
      ? "最优先观察，承担情绪锚定或题材锚定作用。"
      : bucket === "B池"
        ? "需要结合竞价和盘中确认后再考虑参与。"
        : bucket === "观察池"
          ? "更适合跟踪板块扩散和回流，不宜抢先主攻。"
          : "当前性价比不足或风险偏高，优先回避。"
  );

  const focus = item.focus ?? (
    bucket === "A池" ? "优先看竞价强弱、带动性和分歧后的承接。"
    : bucket === "B池" ? "先看是否与主线共振，再决定是否升级。"
    : bucket === "观察池" ? "只看是否形成有效扩散，不做情绪化追涨。"
    : "重点看风险扩散，不看入场。"
  );

  const trigger = item.trigger ?? (
    bucket === "回避池" ? "无触发条件，默认不做。"
    : "竞价不低于预期，盘中分歧后快速修复，并出现同题材联动。"
  );

  const abandon = item.abandon ?? (
    bucket === "回避池" ? "出现脉冲也不纳入计划。"
    : "高开低走、回封失败、无法带动同题材前排时放弃。"
  );

  const auctionValue = pickNumber(item.auctionStrength, NaN);
  const thresholdValue = Number.isFinite(auctionValue)
    ? (auctionValue >= 0.85 ? 0.85 : auctionValue >= 0.65 ? 0.65 : 0.5)
    : (bucket === "A池" ? 0.85 : bucket === "B池" ? 0.65 : 0.5);
  const auctionThreshold = Number.isFinite(auctionValue)
    ? `当前竞价 ${fmtRatio(auctionValue, 0)}，阈值 ${fmtRatio(thresholdValue, 0)}。${auctionValue >= thresholdValue ? "当前已达到可观察区间。" : "低于阈值时不升级处理。"}`
    : `参考阈值 ${fmtRatio(thresholdValue, 0)}，若达不到只作观察。`;

  return {
    ...item,
    id: `${bucket}-${item.name ?? index}`,
    reason,
    dataLine,
    focus,
    trigger,
    abandon,
    auctionThreshold
  };
}

function buildPoolLayers(day) {
  const leaders = day?.leaders ?? {};
  const leader = leaders.leader ? [{ ...leaders.leader, role: leaders.leader.role ?? "总龙头" }] : [];
  const themeLeader = leaders.themeLeader && leaders.themeLeader.name !== leaders.leader?.name
    ? [{ ...leaders.themeLeader, role: leaders.themeLeader.role ?? "题材龙头" }]
    : [];
  const capacity = asArray(leaders.capacityCores);
  const midArmy = asArray(leaders.midArmy);
  const turnover = asArray(leaders.turnoverCandidates);
  const low = asArray(leaders.lowPositionCandidates);
  const risky = asArray(leaders.riskyNames).map((name) => ({ name, role: "高风险" }));

  return {
    aPool: unique([...leader, ...themeLeader, ...capacity].map((item) => JSON.stringify(item))).map(JSON.parse).slice(0, 4).map((item, index) => buildPoolReason(item, index, "A池")),
    bPool: unique([...midArmy, ...turnover].map((item) => JSON.stringify(item))).map(JSON.parse).slice(0, 6).map((item, index) => buildPoolReason(item, index, "B池")),
    observePool: unique([...low].map((item) => JSON.stringify(item))).map(JSON.parse).slice(0, 6).map((item, index) => buildPoolReason(item, index, "观察池")),
    avoidPool: risky.slice(0, 6).map((item, index) => buildPoolReason(item, index, "回避池"))
  };
}

function buildLeaderStructure(day) {
  const leaders = day?.leaders ?? {};
  const leader = leaders.leader;
  return {
    leaderName: leader?.name ?? "未识别",
    driveList: unique([
      ...asArray(leaders.corePool).map((item) => item?.name),
      ...asArray(leaders.capacityCores).map((item) => item?.name),
      ...asArray(leaders.midArmy).map((item) => item?.name)
    ]).filter((name) => name && name !== leader?.name),
    layers: [
      { label: "龙头层", items: leader ? [leader.name] : [] },
      { label: "前排层", items: asArray(leaders.corePool).map((item) => item?.name) },
      { label: "中位层", items: asArray(leaders.turnoverCandidates).map((item) => item?.name) },
      { label: "低位扩散", items: asArray(leaders.lowPositionCandidates).map((item) => item?.name) },
      { label: "容量核心", items: asArray(leaders.capacityCores).map((item) => item?.name) },
      { label: "中军", items: asArray(leaders.midArmy).map((item) => item?.name) }
    ]
  };
}

function buildOverviewMetrics(day) {
  const market = day?.market ?? {};
  const overview = day?.overview ?? {};
  const dataQuality = day?.dataQuality ?? {};
  return [
    metric("市场环境", overview.environment ?? "-", `主线 ${overview.primaryTheme ?? "未识别"}`),
    metric("情绪周期", overview.emotionCycle ?? "-", `模式 ${overview.preferredMode ?? "未识别"}`),
    metric("动作 / 仓位", `${overview.actionBias ?? "-"} / ${overview.positionPlan ?? "-"}`, `风格 ${overview.stylePreference ?? "未识别"}`),
    metric("数据可信度", fmtRatio(dataQuality.confidence, 0), `交易日 ${market.tradeDate ?? day?.date ?? "-"}`)
  ];
}
function buildProcessSections(day) {
  const market = day?.market ?? {};
  const regime = day?.marketRegime ?? {};
  const environment = day?.environment ?? {};
  const cycle = day?.emotionCycle ?? {};
  const theme = day?.themes?.primaryTheme ?? {};
  const reasons = day?.analysisReasons ?? {};
  const execution = day?.execution ?? {};
  const position = day?.position ?? {};
  const sellPlan = day?.sellPlan ?? {};

  return [
    {
      title: "市场风格与量能",
      conclusion: `${regime.indexState ?? "-"} / ${regime.volumeState ?? "-"} / ${regime.stylePreference ?? "-"}`,
      metrics: [
        metric("指数状态", regime.indexState ?? "-"),
        metric("量能状态", regime.volumeState ?? "-"),
        metric("共振状态", regime.resonanceState ?? "-"),
        metric("风格偏好", regime.stylePreference ?? "-"),
        metric("总成交额", market.totalTurnoverBn ? `${fmtNum(market.totalTurnoverBn, 2)} 亿` : "-"),
        metric("量能变化", fmtPct(market.turnoverDeltaPct, 2))
      ],
      reasons: asArray(reasons.marketRegime)
    },
    {
      title: "市场环境",
      conclusion: environment.label ?? day?.overview?.environment ?? "-",
      metrics: [
        metric("环境分", fmtNum(environment.score, 1)),
        metric("涨停数", safeText(market.limitUpCount)),
        metric("跌停数", safeText(market.limitDownCount)),
        metric("炸板率", fmtRatio(market.brokenBoardRate, 0)),
        metric("连板高度", safeText(market.maxBoardHeight)),
        metric("昨日强股反馈", fmtRatio(market.yesterdayStrongFeedback, 0))
      ],
      reasons: asArray(reasons.environment)
    },
    {
      title: "情绪周期",
      conclusion: cycle.stage ?? day?.overview?.emotionCycle ?? "-",
      metrics: [
        metric("周期标签", cycle.stage ?? "-"),
        metric("强溢价占比", fmtRatio(market.strongPremiumRatio, 0)),
        metric("平均溢价", fmtPct(market.avgYesterdayPremiumPct, 2)),
        metric("高位负反馈", fmtRatio(market.highPositionNegativeFeedback, 0))
      ],
      reasons: asArray(reasons.emotionCycle)
    },
    {
      title: "主线题材",
      conclusion: theme.name ?? day?.overview?.primaryTheme ?? "-",
      metrics: [
        metric("题材分数", safeText(theme.mainlineScore ?? theme.score ?? "-")),
        metric("涨停家数", safeText(theme.limitUpCount)),
        metric("最高板", safeText(theme.maxBoardHeight)),
        metric("赚钱效应", fmtRatio(theme.profitEffect, 0)),
        metric("次日溢价", fmtRatio(theme.nextDayPremiumScore, 0)),
        metric("回流能力", fmtRatio(theme.comebackStrength, 0)),
        metric("新闻催化", fmtRatio(theme.newsCatalystStrength, 0)),
        metric("叙事强度", fmtRatio(theme.narrativeStrength, 0))
      ],
      reasons: asArray(reasons.primaryTheme)
    },
    {
      title: "龙头与带动性",
      conclusion: day?.leaders?.leader?.name ?? "未识别",
      metrics: [
        metric("龙头", day?.leaders?.leader?.name ?? "未识别"),
        metric("题材龙头", day?.leaders?.themeLeader?.name ?? "未识别"),
        metric("容量核心", asArray(day?.leaders?.capacityCores).map((item) => item?.name).slice(0, 3).join(" / ") || "-"),
        metric("中军", asArray(day?.leaders?.midArmy).map((item) => item?.name).slice(0, 3).join(" / ") || "-")
      ],
      reasons: asArray(reasons.leader)
    },
    {
      title: "执行与仓位",
      conclusion: `${execution.actionBias ?? day?.overview?.actionBias ?? "-"} / ${position.totalPosition ?? day?.overview?.positionPlan ?? "-"}`,
      metrics: [
        metric("动作倾向", execution.actionBias ?? "-"),
        metric("总仓位", position.totalPosition ?? "-"),
        metric("允许买点", asArray(execution.allowedSetups).join(" / ") || "-"),
        metric("禁止事项", asArray(execution.forbiddenActions).slice(0, 3).join(" / ") || "-")
      ],
      reasons: [...asArray(reasons.execution), ...asArray(reasons.position), ...asArray(reasons.sellPlan), ...asArray(sellPlan.reasons)]
    }
  ];
}

function buildThemeCards(day) {
  const ranked = asArray(day?.themes?.rankedThemes);
  if (ranked.length) {
    return ranked.slice(0, 8).map((theme, index) => ({
      id: `${theme.name ?? index}`,
      name: theme.name ?? `题材${index + 1}`,
      score: theme.mainlineScore ?? theme.score ?? 0,
      ladder: theme.structureSummary ?? theme.ladderInterpretation ?? "-",
      metrics: [
        metric("涨停家数", safeText(theme.limitUpCount)),
        metric("最高板", safeText(theme.maxBoardHeight)),
        metric("赚钱效应", fmtRatio(theme.profitEffect, 0)),
        metric("次日溢价", fmtRatio(theme.nextDayPremiumScore, 0)),
        metric("回流能力", fmtRatio(theme.comebackStrength, 0)),
        metric("新闻催化", fmtRatio(theme.newsCatalystStrength, 0))
      ],
      checklist: Object.entries(theme.checklist ?? {}).map(([key, value]) => ({ label: key, value: Boolean(value) })),
      reasons: [theme.narrativeLabel, theme.catalystReason, theme.catalystDecisionImpact, theme.catalystRiskNote, theme.ladderInterpretation].filter(Boolean)
    }));
  }

  const primary = day?.themes?.primaryTheme;
  return primary ? [{
    id: primary.name ?? "primary",
    name: primary.name ?? "未识别",
    score: primary.mainlineScore ?? primary.score ?? 0,
    ladder: primary.structureSummary ?? primary.ladderInterpretation ?? "-",
    metrics: [metric("涨停家数", safeText(primary.limitUpCount)), metric("最高板", safeText(primary.maxBoardHeight))],
    checklist: Object.entries(primary.checklist ?? {}).map(([key, value]) => ({ label: key, value: Boolean(value) })),
    reasons: [primary.narrativeLabel, primary.catalystReason, primary.ladderInterpretation].filter(Boolean)
  }] : [];
}

function buildExecutionStages(day) {
  const pool = buildPoolLayers(day);
  const leader = pool.aPool[0]?.name ?? day?.leaders?.leader?.name ?? "龙头";
  const theme = day?.overview?.primaryTheme ?? day?.themes?.primaryTheme?.name ?? "主线题材";
  return {
    auction: [
      `先看 ${leader} 的竞价强弱，不能明显低于预期。`,
      `再看 ${theme} 是否出现前排共振，而不是单兵脉冲。`,
      `若高位负反馈继续扩散，优先降低预期。`
    ],
    confirm: [
      `${leader} 分歧后快速修复，并带动前排同步转强。`,
      `${theme} 内至少出现前排 + 容量核心的联动。`,
      `允许买点只围绕 ${asArray(day?.execution?.allowedSetups).join("、") || "系统允许买点"}。`
    ],
    abort: [
      `${leader} 高开低走、回封失败或炸板后无承接。`,
      `${theme} 只剩后排异动，前排与容量核心不跟。`,
      `跌停扩散、炸板率抬升、风控闸门触发时立即放弃。`
    ]
  };
}

function buildReviewTemplate(day) {
  const workflow = day?.postmarket ?? day?.workflow ?? {};
  return {
    marketReview: unique([
      workflow.marketReview,
      `环境：${day?.overview?.environment ?? "-"}，周期：${day?.overview?.emotionCycle ?? "-"}`,
      `涨停 ${safeText(day?.market?.limitUpCount)} 家，跌停 ${safeText(day?.market?.limitDownCount)} 家，炸板率 ${fmtRatio(day?.market?.brokenBoardRate, 0)}`
    ]),
    themeReview: unique([
      workflow.themeReview,
      `主线：${day?.overview?.primaryTheme ?? "未识别"}`,
      day?.themes?.primaryTheme?.structureSummary,
      day?.themes?.primaryTheme?.catalystReason
    ]),
    coreStockReview: unique([
      `总龙头：${day?.leaders?.leader?.name ?? "未识别"}`,
      `题材龙头：${day?.leaders?.themeLeader?.name ?? "未识别"}`,
      `容量核心：${asArray(day?.leaders?.capacityCores).map((item) => item?.name).slice(0, 3).join(" / ") || "无"}`,
      `中军：${asArray(day?.leaders?.midArmy).map((item) => item?.name).slice(0, 3).join(" / ") || "无"}`
    ]),
    selfReview: unique([
      `盘前动作：${day?.overview?.actionBias ?? "-"}，仓位：${day?.overview?.positionPlan ?? "-"}`,
      `允许买点：${asArray(day?.execution?.allowedSetups).join(" / ") || "无"}`,
      `禁止事项：${asArray(day?.execution?.forbiddenActions).slice(0, 4).join(" / ") || "无"}`
    ]),
    watchList: unique([
      ...asArray(day?.leaders?.corePool).map((item) => item?.name),
      ...asArray(day?.leaders?.capacityCores).map((item) => item?.name),
      ...asArray(day?.leaders?.midArmy).map((item) => item?.name)
    ]).slice(0, 8)
  };
}
function buildPlanComparison(day) {
  const overview = day?.overview ?? {};
  const workflow = day?.postmarket ?? day?.premarket ?? {};
  const planned = workflow?.marketJudgement ?? {};
  const current = {
    environment: overview.environment ?? "-",
    cycle: overview.emotionCycle ?? "-",
    theme: overview.primaryTheme ?? "-",
    mode: overview.preferredMode ?? "-",
    action: overview.actionBias ?? "-",
    position: overview.positionPlan ?? "-"
  };
  const plan = {
    environment: planned.environment ?? current.environment,
    cycle: planned.emotionCycle ?? current.cycle,
    theme: planned.primaryTheme ?? current.theme,
    mode: planned.primaryMode ?? current.mode,
    action: planned.actionBias ?? current.action,
    position: planned.positionPlan ?? current.position
  };
  return { plan, current };
}

function buildDeviationAttribution(day) {
  const comparison = buildPlanComparison(day);
  const tags = [];
  if (comparison.plan.theme !== comparison.current.theme) tags.push("主线偏差");
  if (comparison.plan.mode !== comparison.current.mode) tags.push("模式偏差");
  if (comparison.plan.position !== comparison.current.position) tags.push("仓位偏差");
  if ((day?.riskControl?.status ?? "") !== "ok") tags.push("风控边界");
  if ((day?.overview?.environment ?? "") !== (comparison.plan.environment ?? "")) tags.push("市场环境偏差");
  if (!tags.length) tags.push("总体一致");
  return tags;
}

function buildCatalystCards(day) {
  return asArray(day?.liveContext?.llmNewsAnalysis?.themeCatalysts).map((item, index) => ({
    id: `${item.theme ?? index}`,
    title: item.theme ?? `题材${index + 1}`,
    eventType: item.eventType ?? "催化",
    sentiment: item.sentiment ?? "neutral",
    strength: item.strength,
    summary: item.reason ?? item.detailedReason ?? "暂无说明",
    impact: item.decisionImpact ?? "暂无策略影响说明",
    risk: item.riskNote ?? "暂无风险提示",
    headlines: asArray(item.headlineTitles),
    rejected: asArray(item.rejectedHeadlineTitles)
  }));
}

function buildNewsFeed(day) {
  return asArray(day?.liveContext?.newsFeed).map((item, index) => ({
    id: `${item.title ?? index}-${index}`,
    ...item,
    reason: item.adopted
      ? "这条新闻被模型认定为对相关题材构成直接催化。"
      : item.rejected
        ? "这条新闻被模型判定为弱相关、结果描述或证据不足，因此不进入交易优先级。"
        : "这条新闻当前仅作资讯参考。"
  }));
}

function buildNewsStats(newsFeed) {
  const list = asArray(newsFeed);
  return [
    metric("新闻总条数", list.length),
    metric("东方财富快讯", list.filter((item) => String(item.source).includes("东方财富")).length),
    metric("妙想新闻", list.filter((item) => String(item.source).includes("妙想")).length),
    metric("模型采纳", list.filter((item) => item.adopted).length),
    metric("模型过滤", list.filter((item) => item.rejected).length)
  ];
}

function buildNewsSearchMetrics(result) {
  if (!result) {
    return [];
  }

  const topSources = asArray(result.stats?.sourceFamilies ?? result.stats?.sources).slice(0, 3).map((item) => `${item.label} ${item.count}条`).join(" / ") || "暂无";
  const topTypes = asArray(result.stats?.types).slice(0, 3).map((item) => `${item.label} ${item.count}条`).join(" / ") || "暂无";
  return [
    metric("命中条数", safeText(result.stats?.total ?? 0)),
    metric("原始聚合", safeText(result.rawFetchedCount ?? result.stats?.rawFetchedCount ?? 0)),
    metric("查询问句", result.query ?? result.searchQuery ?? "-"),
    metric("主要来源", topSources),
    metric("资讯类型", topTypes)
  ];
}

function buildFastNewsMetrics(items, collectedAt) {
  const list = asArray(items);
  const latestItem = list[0] ?? null;
  const dayCount = new Set(list.map((item) => String(item.date ?? "").slice(0, 10)).filter(Boolean)).size;
  return [
    metric("快讯条数", safeText(list.length)),
    metric("最新时间", latestItem ? formatDateTime(latestItem.publishedAt ?? latestItem.date) : "-"),
    metric("覆盖日期", safeText(dayCount)),
    metric("最近刷新", collectedAt ? formatDateTime(collectedAt) : "-")
  ];
}

function Empty({ text = "暂无数据" }) {
  return <div className="empty">{text}</div>;
}

function Badge({ children, tone }) {
  return <span className={`badge ${tone ?? badgeClass(children)}`}>{children}</span>;
}

function Section({ title, note, actions, children }) {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h3>{title}</h3>
          {note ? <div className="muted">{note}</div> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function BulletList({ items, emptyText = "暂无数据" }) {
  const list = asArray(items).filter(Boolean);
  if (!list.length) return <Empty text={emptyText} />;
  return <ul className="bullet-list">{list.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>;
}

function MetricGrid({ items }) {
  const list = asArray(items).filter((item) => item && item.value !== undefined && item.value !== null && item.value !== "");
  if (!list.length) return <Empty text="暂无指标" />;
  return (
    <div className="metric-grid">
      {list.map((item) => (
        <div className="metric-tile" key={item.label}>
          <label>{item.label}</label>
          <strong>{item.value}</strong>
          {item.note ? <span className="muted">{item.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ label, value, note }) {
  return (
    <article className="summary-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {note ? <p className="muted">{note}</p> : null}
    </article>
  );
}

function ViewTabs({ current, onChange }) {
  return (
    <nav className="panel tabs-panel">
      <div className="tabs-row">
        {VIEW_ITEMS.map(([key, label]) => (
          <button key={key} className={`tab-btn ${current === key ? "active" : ""}`} onClick={() => onChange(key)}>{label}</button>
        ))}
      </div>
    </nav>
  );
}
function SessionBanner({ session, busy, autoRefreshEnabled, autoRefreshLabel, lastRefreshAt, onToggleAutoRefresh, onRunCurrent, onRunIntraday, onRefresh }) {
  if (!session) return null;
  return (
    <section className="panel session-banner">
      <div className="session-main">
        <div>
          <p className="eyebrow">Live Session</p>
          <h2>{session.analysisType === "premarket" ? "盘前分析会话" : "盘后复盘会话"}</h2>
          <div className="hero-badges" style={{ marginTop: 12 }}>
            <Badge>{session.analysisType === "premarket" ? "盘前" : "盘后"}</Badge>
            <Badge tone="accent">目标交易日 {session.targetTradeDate ?? "-"}</Badge>
            <Badge tone="warn">自动刷新 {autoRefreshEnabled ? "开启" : "关闭"}</Badge>
          </div>
          <div className="session-tip muted">
            最近刷新：{lastRefreshAt ? formatDateTime(lastRefreshAt) : "尚未刷新"} · 轮询频率：{autoRefreshLabel}
          </div>
        </div>
        <div className="toolbar-card">
          <button className="action-btn primary" disabled={busy} onClick={onRunCurrent}>{busy ? "正在运行" : "运行盘前/盘后分析"}</button>
          <button className="action-btn secondary" disabled={busy} onClick={onRunIntraday}>{busy ? "处理中" : "运行盘中分析"}</button>
          <button className="action-btn ghost" onClick={onRefresh}>刷新面板</button>
          <button className="action-btn ghost" onClick={onToggleAutoRefresh}>{autoRefreshEnabled ? "关闭自动轮询刷新" : "开启自动轮询刷新"}</button>
        </div>
      </div>
    </section>
  );
}

function QuickPoolColumn({ title, items }) {
  const list = asArray(items);
  return (
    <div className="info-card">
      <h4>{title}</h4>
      {!list.length ? <Empty text="暂无标的" /> : (
        <div className="stack compact-list">
          {list.map((item) => (
            <article key={item.id} className="pool-item-card">
              <div className="chips">
                <Badge tone="accent">{item.name ?? "未命名"}</Badge>
                <Badge>{item.role ?? title}</Badge>
              </div>
              <p>{item.reason}</p>
              <p className="muted">{item.dataLine}</p>
              <div className="info-subgrid">
                <div><strong>关注点：</strong>{item.focus}</div>
                <div><strong>竞价阈值：</strong>{item.auctionThreshold}</div>
                <div><strong>触发条件：</strong>{item.trigger}</div>
                <div><strong>放弃条件：</strong>{item.abandon}</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function LayerList({ title, items }) {
  return (
    <div className="info-card">
      <h4>{title}</h4>
      <BulletList items={items} emptyText="暂无对应层级" />
    </div>
  );
}

function LeaderStructurePanel({ structure, leaderReasons }) {
  return (
    <Section title="龙头与带动性" note="展示龙头带动票、梯队层级和后端结构化原因。">
      <div className="two-col">
        <div className="info-card">
          <h4>带动票名单</h4>
          <BulletList items={structure.driveList} emptyText="暂无带动票" />
        </div>
        <div className="info-card">
          <h4>龙头原因</h4>
          <BulletList items={leaderReasons} emptyText="暂无龙头原因" />
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        {structure.layers.map((layer) => <LayerList key={layer.label} title={layer.label} items={layer.items} />)}
      </div>
    </Section>
  );
}

function ThemeCard({ item }) {
  return (
    <article className="theme-card info-card">
      <div className="section-head">
        <div>
          <h4>{item.name}</h4>
          <div className="muted">结构：{item.ladder}</div>
        </div>
        <Badge tone="accent">{item.score} 分</Badge>
      </div>
      <MetricGrid items={item.metrics} />
      <div className="two-col" style={{ marginTop: 12 }}>
        <div className="info-card soft-card">
          <h4>主线判断表</h4>
          {!item.checklist.length ? <Empty text="暂无 checklist" /> : (
            <div className="check-grid">
              {item.checklist.map((entry) => <Badge key={entry.label} tone={entry.value ? "success" : "danger"}>{entry.label}</Badge>)}
            </div>
          )}
        </div>
        <div className="info-card soft-card">
          <h4>原因与风险</h4>
          <BulletList items={item.reasons} emptyText="暂无原因说明" />
        </div>
      </div>
    </article>
  );
}

function CatalystCard({ item }) {
  return (
    <article className="info-card">
      <div className="section-head">
        <div>
          <h4>{item.title}</h4>
          <div className="muted">{item.eventType} · {item.sentiment}</div>
        </div>
        <Badge tone={item.sentiment === "bullish" ? "success" : item.sentiment === "bearish" ? "danger" : "warn"}>{fmtRatio(item.strength, 0)}</Badge>
      </div>
      <BulletList items={[item.summary, `策略影响：${item.impact}`, `风险提示：${item.risk}`]} emptyText="暂无催化说明" />
      <div className="two-col" style={{ marginTop: 12 }}>
        <div className="info-card soft-card"><h4>采纳新闻</h4><BulletList items={item.headlines} emptyText="暂无采纳新闻" /></div>
        <div className="info-card soft-card"><h4>过滤新闻</h4><BulletList items={item.rejected} emptyText="暂无过滤新闻" /></div>
      </div>
    </article>
  );
}
function NewsListItem({ item }) {
  return (
    <article className="info-card news-card">
      <div className="section-head">
        <div>
          <h4>{item.title || "未命名新闻"}</h4>
          <div className="muted">{formatDateTime(item.publishedAt ?? item.collectedAt ?? item.date)} · {item.source ?? "未知来源"} · {item.informationType ?? "NEWS"}</div>
        </div>
        <div className="chips">
          {item.theme ? <Badge tone="accent">{item.theme}</Badge> : null}
          {item.eventType ? <Badge>{item.eventType}</Badge> : null}
          {item.adopted ? <Badge tone="success">已采纳</Badge> : null}
          {item.rejected ? <Badge tone="danger">已过滤</Badge> : null}
        </div>
      </div>
      <p>{item.reason}</p>
      {item.content ? <p className="muted">{item.content}</p> : <p className="muted">这条新闻当前只有标题，没有正文内容。</p>}
    </article>
  );
}

function SearchExampleGrid({ onPick }) {
  return (
    <div className="search-example-grid">
      {NEWS_SEARCH_EXAMPLES.map((item) => (
        <button key={item} className="example-chip" onClick={() => onPick(item)}>{item}</button>
      ))}
    </div>
  );
}

function SearchResultItem({ item, onTrack }) {
  const secuNames = asArray(item.secuList).map((entry) => entry?.secuName || entry?.secuCode).filter(Boolean).slice(0, 3);
  return (
    <article className="search-result-card">
      <div className="section-head">
        <div>
          <h4>{item.title || "未命名资讯"}</h4>
          <div className="muted">
            {formatDateTime(item.publishedAt ?? item.date)} · {item.source ?? "未知来源"} · {item.informationTypeLabel ?? item.informationType ?? "资讯"}
          </div>
        </div>
        <div className="chips">
          {item.sourceFamily ? <Badge>{item.sourceFamily}</Badge> : null}
          {item.queryVariant ? <Badge>{item.queryVariant}</Badge> : null}
          {item.entityName ? <Badge tone="accent">{item.entityName}</Badge> : null}
          {item.rating ? <Badge>{item.rating}</Badge> : null}
        </div>
      </div>
      <p>{item.content || item.trunk || "该条资讯暂未返回正文摘要。"}</p>
      {secuNames.length ? <div className="muted">关联证券：{secuNames.join(" / ")}</div> : null}
      <div className="news-item-actions">
        <button className="mini-action-btn" onClick={() => onTrack(item.entityName || item.title)}>加入追踪</button>
        {item.jumpUrl ? <a className="mini-action-btn ghost" href={item.jumpUrl} target="_blank" rel="noreferrer">查看原文</a> : null}
      </div>
    </article>
  );
}

function FastNewsItem({ item }) {
  return (
    <article className="search-result-card">
      <div className="section-head">
        <div>
          <h4>{item.title || "未命名快讯"}</h4>
          <div className="muted">
            {formatDateTime(item.publishedAt ?? item.collectedAt ?? item.date)} · {item.source ?? "东方财富快讯"}
          </div>
        </div>
        <div className="chips">
          <Badge tone="accent">快讯</Badge>
        </div>
      </div>
    </article>
  );
}

function HistoryGroupCard({ group }) {
  return (
    <article className="info-card">
      <div className="section-head">
        <h4>{group.date}</h4>
        <Badge tone="accent">{asArray(group.types).join(" / ") || "无类型"}</Badge>
      </div>
      <BulletList items={asArray(group.entries).map((entry) => `${entry.type} · ${entry.path ?? entry.file ?? "-"}`)} emptyText="暂无归档" />
    </article>
  );
}

function App() {
  const [dashboard, setDashboard] = useState(null);
  const [view, setView] = useState(window.location.hash.replace("#", "") || "overview");
  const [selectedDate, setSelectedDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [newsKeyword, setNewsKeyword] = useState("");
  const [newsSourceFilter, setNewsSourceFilter] = useState("all");
  const [newsStatusFilter, setNewsStatusFilter] = useState("all");
  const [newsDateFilter, setNewsDateFilter] = useState("all");
  const [newsThemeFilter, setNewsThemeFilter] = useState("all");
  const [newsSearchQuery, setNewsSearchQuery] = useState("");
  const [newsSearchTimeRange, setNewsSearchTimeRange] = useState("7d");
  const [newsSearchContentType, setNewsSearchContentType] = useState("all");
  const [trackedKeywords, setTrackedKeywords] = useState(["机器人", "并购重组", "低空经济"]);
  const [newsSearchResult, setNewsSearchResult] = useState(null);
  const [newsSearchBusy, setNewsSearchBusy] = useState(false);
  const [newsSearchError, setNewsSearchError] = useState("");
  const [newsSearchVisibleCount, setNewsSearchVisibleCount] = useState(20);
  const [fastNewsData, setFastNewsData] = useState({ items: [], collectedAt: null });
  const [fastNewsBusy, setFastNewsBusy] = useState(false);
  const [fastNewsError, setFastNewsError] = useState("");
  const [fastNewsKeyword, setFastNewsKeyword] = useState("");

  async function fetchDashboard() {
    const response = await fetch("/api/dashboard");
    if (!response.ok) throw new Error("加载仪表盘失败");
    const payload = await response.json();
    setDashboard(payload);
    setLastRefreshAt(new Date().toISOString());
    setSelectedDate((current) => current || payload.defaultSelectedDate || payload.latestDate || "");
  }

  useEffect(() => {
    fetchDashboard().catch(console.error);
  }, []);

  useEffect(() => {
    const onHashChange = () => setView(window.location.hash.replace("#", "") || "overview");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const session = dashboard?.session ?? null;
  const autoProfile = useMemo(() => {
    const hidden = document.visibilityState === "hidden";
    const baseMs = session?.analysisType === "premarket" ? 30000 : 180000;
    const intervalMs = hidden ? baseMs * 4 : baseMs;
    return {
      intervalMs,
      label: hidden ? `后台节流 ${Math.round(intervalMs / 1000)} 秒/次` : session?.analysisType === "premarket" ? `盘前 ${Math.round(intervalMs / 1000)} 秒/次` : `盘后 ${Math.round(intervalMs / 60000)} 分钟/次`
    };
  }, [session, dashboard]);

  useEffect(() => {
    if (!autoRefreshEnabled || !dashboard) return undefined;
    const timer = setInterval(() => {
      fetchDashboard().catch(console.error);
    }, autoProfile.intervalMs);
    return () => clearInterval(timer);
  }, [autoRefreshEnabled, autoProfile.intervalMs, dashboard]);

  const days = asArray(dashboard?.days);
  const day = days.find((item) => item.date === selectedDate) ?? days[0] ?? null;

  useEffect(() => {
    if (view === "newssearch" && !newsSearchQuery && day?.overview?.primaryTheme) {
      setNewsSearchQuery(`${day.overview.primaryTheme} 最新新闻`);
    }
  }, [view, newsSearchQuery, day]);

  useEffect(() => {
    if (view === "fastnews" && fastNewsData.items.length === 0 && !fastNewsBusy) {
      fetchFastNews().catch(console.error);
    }
  }, [view]);

  const poolLayers = useMemo(() => buildPoolLayers(day), [day]);
  const structure = useMemo(() => buildLeaderStructure(day), [day]);
  const processSections = useMemo(() => buildProcessSections(day), [day]);
  const themeCards = useMemo(() => buildThemeCards(day), [day]);
  const catalystCards = useMemo(() => buildCatalystCards(day), [day]);
  const newsFeed = useMemo(() => buildNewsFeed(day), [day]);
  const newsSources = useMemo(() => ["all", ...unique(newsFeed.map((item) => item.source || "未知来源"))], [newsFeed]);
  const newsThemes = useMemo(() => ["all", ...unique(newsFeed.map((item) => item.theme || "未归类题材"))], [newsFeed]);
  const newsDates = useMemo(() => ["all", ...unique(newsFeed.map((item) => {
    const source = item.publishedAt ?? item.collectedAt ?? item.date;
    if (!source) return "unknown";
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? String(source).slice(0, 10) : date.toISOString().slice(0, 10);
  }))], [newsFeed]);
  const filteredNewsFeed = useMemo(() => newsFeed.filter((item) => {
    const keyword = newsKeyword.trim().toLowerCase();
    const source = item.source || "未知来源";
    const theme = item.theme || "未归类题材";
    const dateSource = item.publishedAt ?? item.collectedAt ?? item.date;
    const dateKey = !dateSource ? "unknown" : (() => { const d = new Date(dateSource); return Number.isNaN(d.getTime()) ? String(dateSource).slice(0, 10) : d.toISOString().slice(0, 10); })();
    const status = item.adopted ? "adopted" : item.rejected ? "rejected" : "neutral";
    const haystack = [item.title, item.content, item.theme, item.source, item.reason].filter(Boolean).join(" ").toLowerCase();
    if (keyword && !haystack.includes(keyword)) return false;
    if (newsSourceFilter !== "all" && source !== newsSourceFilter) return false;
    if (newsThemeFilter !== "all" && theme !== newsThemeFilter) return false;
    if (newsStatusFilter !== "all" && status !== newsStatusFilter) return false;
    if (newsDateFilter !== "all" && dateKey !== newsDateFilter) return false;
    return true;
  }), [newsFeed, newsKeyword, newsSourceFilter, newsThemeFilter, newsStatusFilter, newsDateFilter]);
  const newsStats = useMemo(() => buildNewsStats(filteredNewsFeed), [filteredNewsFeed]);
  const executionStages = useMemo(() => buildExecutionStages(day), [day]);
  const reviewTemplate = useMemo(() => buildReviewTemplate(day), [day]);
  const planComparison = useMemo(() => buildPlanComparison(day), [day]);
  const deviationTags = useMemo(() => buildDeviationAttribution(day), [day]);
  const newsSearchMetrics = useMemo(() => buildNewsSearchMetrics(newsSearchResult), [newsSearchResult]);
  const visibleNewsSearchItems = useMemo(() => asArray(newsSearchResult?.items).slice(0, newsSearchVisibleCount), [newsSearchResult, newsSearchVisibleCount]);
  const filteredFastNews = useMemo(() => {
    const keyword = fastNewsKeyword.trim().toLowerCase();
    return asArray(fastNewsData.items).filter((item) => {
      if (!keyword) return true;
      return [item.title, item.date, item.source].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
  }, [fastNewsData.items, fastNewsKeyword]);
  const fastNewsMetrics = useMemo(() => buildFastNewsMetrics(filteredFastNews, fastNewsData.collectedAt), [filteredFastNews, fastNewsData.collectedAt]);

  async function runApi(path) {
    setBusy(true);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: selectedDate || undefined }) });
      if (!response.ok) throw new Error("执行失败");
      await response.json();
      await fetchDashboard();
    } finally {
      setBusy(false);
    }
  }

  async function runNewsSearch(nextQuery = newsSearchQuery, overrides = {}) {
    const query = String(nextQuery ?? "").trim();
    if (!query) {
      setNewsSearchError("请输入股票、题材或事件关键词。");
      return;
    }

    setNewsSearchBusy(true);
    setNewsSearchError("");
    try {
      const response = await fetch("/api/news/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          timeRange: overrides.timeRange ?? newsSearchTimeRange,
          contentType: overrides.contentType ?? newsSearchContentType,
          trackedKeywords
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "资讯搜索失败");
      }
      setNewsSearchQuery(query);
      setNewsSearchResult(payload);
      setNewsSearchVisibleCount(20);
      requestAnimationFrame(() => {
        document.getElementById("news-search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      setNewsSearchError(error.message || "资讯搜索失败");
    } finally {
      setNewsSearchBusy(false);
    }
  }

  async function fetchFastNews() {
    setFastNewsBusy(true);
    setFastNewsError("");
    try {
      const response = await fetch("/api/news/fast");
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "东方财富快讯加载失败");
      }
      setFastNewsData({
        items: asArray(payload.items),
        collectedAt: payload.collectedAt ?? new Date().toISOString()
      });
    } catch (error) {
      setFastNewsError(error.message || "东方财富快讯加载失败");
    } finally {
      setFastNewsBusy(false);
    }
  }

  function addTrackedKeyword(keyword) {
    const value = String(keyword ?? "").trim();
    if (!value) return;
    setTrackedKeywords((current) => current.includes(value) ? current : [value, ...current].slice(0, 8));
  }

  if (!dashboard || !day) {
    return <div className="main"><Section title="加载中" note="正在读取本地策略数据"><Empty text="正在加载数据，请稍候。" /></Section></div>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Strategy Desk</p>
          <h1>游资短线策略台</h1>
          <p className="muted">围绕知识库主链，把盘前、盘中、盘后和复盘统一到一个界面里。</p>
        </div>
        <Section title="控制台" note="网页已连接到本地策略服务" actions={<Badge tone="success">动态模式</Badge>}>
          <label className="muted">分析日期</label>
          <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} style={{ width: "100%", marginTop: 8, marginBottom: 12 }}>
            {days.map((item) => <option value={item.date} key={item.date}>{item.date}</option>)}
          </select>
          <button className="action-btn secondary" onClick={() => fetchDashboard()}>刷新数据</button>
          <button className="action-btn secondary" style={{ marginTop: 10 }} disabled={busy} onClick={() => runApi("/api/run/current-analysis")}>运行盘前分析</button>
          <button className="action-btn secondary" style={{ marginTop: 10 }} disabled={busy} onClick={() => runApi("/api/run/intraday-live")}>运行盘中分析</button>
        </Section>
        <Section title="每日归档" note={`${days.length} 个交易日`}>
          <div className="stack compact-list">
            {days.slice(0, 10).map((item) => (
              <button key={item.date} className={`archive-card ${item.date === day.date ? "active" : ""}`} onClick={() => setSelectedDate(item.date)}>
                <strong>{item.date}</strong>
                <span className="muted">{item.overview.environment} · {item.overview.primaryTheme}</span>
                <span className="muted">{item.overview.actionBias} / {item.overview.positionPlan}</span>
              </button>
            ))}
          </div>
        </Section>
      </aside>
      <main className="main">
        <SessionBanner
          session={session}
          busy={busy}
          autoRefreshEnabled={autoRefreshEnabled}
          autoRefreshLabel={autoProfile.label}
          lastRefreshAt={lastRefreshAt}
          onToggleAutoRefresh={() => setAutoRefreshEnabled((value) => !value)}
          onRunCurrent={() => runApi("/api/run/current-analysis")}
          onRunIntraday={() => runApi("/api/run/intraday-live")}
          onRefresh={() => fetchDashboard()}
        />
        <section className="panel hero">
          <div>
            <p className="eyebrow">盘前一屏速览</p>
            <h2>{day.overview.primaryTheme} · {day.overview.environment}</h2>
            <p className="muted">{day.overview.actionBias} / {day.overview.positionPlan} / {day.overview.preferredMode}</p>
          </div>
          <div className="hero-badges">
            <Badge>{day.overview.environment}</Badge>
            <Badge>{day.overview.emotionCycle}</Badge>
            <Badge tone="accent">{day.overview.primaryTheme}</Badge>
            <Badge>{day.overview.actionBias}</Badge>
            <Badge>{day.overview.positionPlan}</Badge>
          </div>
        </section>
        <div className="summary-grid">
          {buildOverviewMetrics(day).map((item) => <SummaryCard key={item.label} {...item} />)}
        </div>
        <ViewTabs current={view} onChange={(next) => { setView(next); window.location.hash = next; }} />

        {view === "overview" ? (
          <div className="content-grid">
            <div className="stack">
              <Section title="股票池分层" note="A池 / B池 / 观察池 / 回避池已经带上原因、数据、触发条件和放弃条件。">
                <div className="two-col">
                  <QuickPoolColumn title="A池" items={poolLayers.aPool} />
                  <QuickPoolColumn title="B池" items={poolLayers.bPool} />
                </div>
                <div className="two-col" style={{ marginTop: 12 }}>
                  <QuickPoolColumn title="观察池" items={poolLayers.observePool} />
                  <QuickPoolColumn title="回避池" items={poolLayers.avoidPool} />
                </div>
              </Section>
              <LeaderStructurePanel structure={structure} leaderReasons={asArray(day.analysisReasons?.leader)} />
            </div>
            <div className="stack">
              <Section title="今日一句话策略" note="把盘前最重要的收敛先写清楚。">
                <BulletList items={[
                  `主线：${day.overview.primaryTheme}。`,
                  `动作：${day.overview.actionBias}，仓位：${day.overview.positionPlan}。`,
                  `优先模式：${day.overview.preferredMode}。`,
                  `只做：${asArray(day.execution?.allowedSetups).join("、") || "系统允许买点"}。`
                ]} />
              </Section>
              <Section title="最重要的三件事" note="开盘前只看这三个关注点。">
                <BulletList items={executionStages.auction} />
              </Section>
            </div>
          </div>
        ) : null}

        {view === "process" ? (
          <div className="stack">
            {processSections.map((section) => (
              <Section key={section.title} title={section.title} note={`结论：${section.conclusion}`}>
                <MetricGrid items={section.metrics} />
                <div style={{ marginTop: 12 }}>
                  <BulletList items={section.reasons} emptyText="暂无结构化原因" />
                </div>
              </Section>
            ))}
          </div>
        ) : null}

        {view === "themes" ? (
          <Section title="题材与梯队" note="把主线判断表、题材结构、催化与风险放在一起看。">
            <div className="stack">{themeCards.map((item) => <ThemeCard key={item.id} item={item} />)}</div>
          </Section>
        ) : null}

        {view === "execution" ? (
          <div className="content-grid">
            <div className="stack">
              <Section title="股票池与角色" note="总龙头、题材龙头、容量核心、中军、前排、中位、低位扩散。">
                <div className="two-col">
                  <QuickPoolColumn title="A池" items={poolLayers.aPool} />
                  <QuickPoolColumn title="B池" items={poolLayers.bPool} />
                </div>
                <div className="two-col" style={{ marginTop: 12 }}>
                  <QuickPoolColumn title="观察池" items={poolLayers.observePool} />
                  <QuickPoolColumn title="回避池" items={poolLayers.avoidPool} />
                </div>
              </Section>
            </div>
            <div className="stack">
              <Section title="执行模板" note="竞价观察、盘中确认、放弃条件、允许买点、禁止事项。">
                <div className="stage-grid">
                  <div className="info-card stage-card"><h4>竞价观察要点</h4><BulletList items={executionStages.auction} /></div>
                  <div className="info-card stage-card"><h4>盘中确认</h4><BulletList items={executionStages.confirm} /></div>
                  <div className="info-card stage-card"><h4>放弃条件</h4><BulletList items={executionStages.abort} /></div>
                </div>
                <div className="two-col" style={{ marginTop: 12 }}>
                  <div className="info-card"><h4>允许买点</h4><BulletList items={day.execution?.allowedSetups} emptyText="暂无允许买点" /></div>
                  <div className="info-card"><h4>禁止事项</h4><BulletList items={day.execution?.forbiddenActions} emptyText="暂无禁止事项" /></div>
                </div>
              </Section>
            </div>
          </div>
        ) : null}

        {view === "review" ? (
          <div className="stack">
            <Section title="盘后复盘" note="市场复盘、主线复盘、核心股复盘、自我复盘、明日观察池。">
              <div className="two-col">
                <div className="info-card"><h4>市场复盘</h4><BulletList items={reviewTemplate.marketReview} /></div>
                <div className="info-card"><h4>主线复盘</h4><BulletList items={reviewTemplate.themeReview} /></div>
              </div>
              <div className="two-col" style={{ marginTop: 12 }}>
                <div className="info-card"><h4>核心股复盘</h4><BulletList items={reviewTemplate.coreStockReview} /></div>
                <div className="info-card"><h4>自我交易复盘</h4><BulletList items={reviewTemplate.selfReview} /></div>
              </div>
              <div className="info-card" style={{ marginTop: 12 }}><h4>明日观察池</h4><BulletList items={reviewTemplate.watchList} /></div>
            </Section>
            <Section title="盘前预案对照" note="对照盘前预案和当前结果，查看偏差来自哪里。">
              <div className="two-col">
                <div className="info-card"><h4>盘前预案</h4><BulletList items={Object.entries(planComparison.plan).map(([key, value]) => `${key}：${value}`)} /></div>
                <div className="info-card"><h4>当前结果</h4><BulletList items={Object.entries(planComparison.current).map(([key, value]) => `${key}：${value}`)} /></div>
              </div>
              <div className="info-card" style={{ marginTop: 12 }}><h4>偏差来源归因</h4><BulletList items={deviationTags} /></div>
            </Section>
          </div>
        ) : null}

        {view === "catalysts" ? (
          <Section title="催化原因" note="把每个题材的新闻催化、策略影响和风险分开看。">
            <div className="stack">{catalystCards.map((item) => <CatalystCard key={item.id} item={item} />)}</div>
          </Section>
        ) : null}

        {view === "newssearch" ? (
          <div className="stack">
            <section className="panel news-search-hero">
              <div className="news-search-banner">
                <p className="eyebrow">MX Search Workspace</p>
                <h2>妙想资讯搜索</h2>
                <p className="muted">面向个股、题材、政策和事件的金融资讯检索台。页面风格参考你给的文档图，但这里做成了可直接搜索的实用版。</p>
              </div>
              <div className="news-search-tabs">
                <span className="news-search-tab active">简介</span>
                <span className="news-search-tab">适用场景</span>
                <span className="news-search-tab">技能介绍</span>
              </div>
            </section>

            <div className="content-grid">
              <div className="stack">
                <Section title="资讯搜索台" note="支持关键词检索、时间筛选、资讯类型筛选和事件追踪。">
                  <div className="filter-grid">
                    <input
                      className="filter-input"
                      value={newsSearchQuery}
                      onChange={(event) => setNewsSearchQuery(event.target.value)}
                      placeholder="搜索个股新闻、板块题材、政策解读"
                    />
                    <select className="filter-input" value={newsSearchContentType} onChange={(event) => setNewsSearchContentType(event.target.value)}>
                      <option value="all">全部类型</option>
                      <option value="news">新闻</option>
                      <option value="report">研报</option>
                      <option value="announcement">公告</option>
                      <option value="policy">政策/解读</option>
                    </select>
                    <select className="filter-input" value={newsSearchTimeRange} onChange={(event) => setNewsSearchTimeRange(event.target.value)}>
                      <option value="all">全部时间</option>
                      <option value="1d">最近一天</option>
                      <option value="7d">最近一周</option>
                      <option value="30d">最近一月</option>
                    </select>
                    <button className="action-btn primary" disabled={newsSearchBusy} onClick={() => runNewsSearch()}>
                      {newsSearchBusy ? "搜索中" : "开始搜索"}
                    </button>
                  </div>
                  <div className="section-head" style={{ marginTop: 16 }}>
                    <div className="muted">事件追踪</div>
                    <button className="action-btn ghost small" onClick={() => addTrackedKeyword(newsSearchQuery)}>把当前问句加入追踪</button>
                  </div>
                  <div className="chips">
                    {trackedKeywords.map((item) => (
                      <button key={item} className="example-chip" onClick={() => { setNewsSearchQuery(item); runNewsSearch(item); }}>{item}</button>
                    ))}
                  </div>
                  {newsSearchError ? <div className="toast danger" style={{ marginTop: 12 }}>{newsSearchError}</div> : null}
                  {newsSearchResult ? (
                    <div className="toast success" style={{ marginTop: 12 }}>
                      原始聚合 {newsSearchResult.rawFetchedCount ?? 0} 条，当前筛选后保留 {newsSearchResult.items?.length ?? 0} 条，下面的“搜索结果”区域会直接展示。
                    </div>
                  ) : null}
                  <div style={{ marginTop: 18 }}>
                    <SearchExampleGrid onPick={(item) => { setNewsSearchQuery(item); runNewsSearch(item); }} />
                  </div>
                </Section>

                <div id="news-search-results">
                <Section title="搜索结果" note={newsSearchResult ? `当前问句：${newsSearchResult.query}` : "先输入关键词，再点击开始搜索。"}>
                  {newsSearchResult ? (
                    <div className="stack" style={{ marginBottom: 14 }}>
                      <div className="muted">本次并行检索：{asArray(newsSearchResult.queryVariants).map((item) => `${item.label}(${item.rawCount})`).join(" / ") || "暂无"}</div>
                      <div className="chips">
                        {asArray(newsSearchResult.stats?.sourceFamilies).map((item) => (
                          <Badge key={item.label} tone="accent">{item.label} {item.count}条</Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {newsSearchResult?.items?.length ? (
                    <div className="stack">
                      {visibleNewsSearchItems.map((item) => <SearchResultItem key={`${item.id}-${item.queryVariant ?? ""}`} item={item} onTrack={addTrackedKeyword} />)}
                      {newsSearchResult.items.length > visibleNewsSearchItems.length ? (
                        <button className="action-btn secondary" onClick={() => setNewsSearchVisibleCount((count) => count + 20)}>
                          加载更多结果（已显示 {visibleNewsSearchItems.length} / {newsSearchResult.items.length}）
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <Empty text={newsSearchBusy ? "正在拉取资讯，请稍候。" : "还没有搜索结果"} />
                  )}
                </Section>
                </div>
              </div>

              <div className="stack">
                <Section title="功能概述" note="与截图中的技能介绍对应，这里直接映射为可执行功能。">
                  <BulletList items={NEWS_SEARCH_FEATURES} />
                </Section>
                <Section title="适用场景" note="适合盘前找催化、盘中验证、盘后补充资讯链路。">
                  <BulletList items={NEWS_SEARCH_SCENARIOS} />
                </Section>
                <Section title="搜索统计" note="按当前搜索结果即时汇总。">
                  <MetricGrid items={newsSearchMetrics} />
                </Section>
              </div>
            </div>
          </div>
        ) : null}

        {view === "fastnews" ? (
          <div className="stack">
            <section className="panel news-search-hero">
              <div className="news-search-banner">
                <p className="eyebrow">Eastmoney Fast Feed</p>
                <h2>东方财富快讯</h2>
                <p className="muted">这里单独看东方财富快讯，适合盘中盯政策、宏观和题材脉冲，不和妙想搜索结果混排。</p>
              </div>
              <div className="news-search-tabs">
                <span className="news-search-tab active">快讯流</span>
                <span className="news-search-tab">盘中监控</span>
                <span className="news-search-tab">实时刷新</span>
              </div>
            </section>

            <div className="content-grid">
              <div className="stack">
                <Section title="快讯列表" note="从东方财富快讯页实时抓取，支持关键词过滤。">
                  <div className="filter-grid">
                    <input
                      className="filter-input"
                      value={fastNewsKeyword}
                      onChange={(event) => setFastNewsKeyword(event.target.value)}
                      placeholder="搜索快讯标题、日期"
                    />
                    <button className="action-btn primary" disabled={fastNewsBusy} onClick={() => fetchFastNews()}>
                      {fastNewsBusy ? "刷新中" : "刷新快讯"}
                    </button>
                  </div>
                  {fastNewsError ? <div className="toast danger" style={{ marginTop: 12 }}>{fastNewsError}</div> : null}
                  <div className="section-head" style={{ marginTop: 16 }}>
                    <div className="muted">当前展示 {filteredFastNews.length} / {fastNewsData.items.length} 条快讯</div>
                    <button className="action-btn ghost small" onClick={() => setFastNewsKeyword("")}>清空筛选</button>
                  </div>
                  {filteredFastNews.length ? (
                    <div className="stack">
                      {filteredFastNews.map((item, index) => <FastNewsItem key={`${item.title}-${index}`} item={item} />)}
                    </div>
                  ) : (
                    <Empty text={fastNewsBusy ? "正在抓取东方财富快讯，请稍候。" : "当前筛选条件下暂无快讯"} />
                  )}
                </Section>
              </div>

              <div className="stack">
                <Section title="快讯概览" note="方便先判断这波消息密度和最新时间。">
                  <MetricGrid items={fastNewsMetrics} />
                </Section>
                <Section title="功能概述" note="聚焦东方财富快讯这一条单独链路。">
                  <BulletList items={FAST_NEWS_FEATURES} />
                </Section>
              </div>
            </div>
          </div>
        ) : null}

        {view === "newsfeed" ? (
          <div className="content-grid">
            <div className="stack">
              <Section title="新闻列表" note="支持关键词、来源、状态、日期联动筛选。">
                <div className="filter-grid filter-grid-wide">
                  <input className="filter-input" value={newsKeyword} onChange={(event) => setNewsKeyword(event.target.value)} placeholder="搜索标题、正文、题材、来源" />
                  <select className="filter-input" value={newsSourceFilter} onChange={(event) => setNewsSourceFilter(event.target.value)}>
                    {newsSources.map((item) => <option key={item} value={item}>{item === "all" ? "全部来源" : item}</option>)}
                  </select>
                  <select className="filter-input" value={newsThemeFilter} onChange={(event) => setNewsThemeFilter(event.target.value)}>
                    {newsThemes.map((item) => <option key={item} value={item}>{item === "all" ? "全部题材" : item}</option>)}
                  </select>
                  <select className="filter-input" value={newsStatusFilter} onChange={(event) => setNewsStatusFilter(event.target.value)}>
                    <option value="all">全部状态</option>
                    <option value="adopted">仅看已采纳</option>
                    <option value="rejected">仅看已过滤</option>
                    <option value="neutral">仅看普通新闻</option>
                  </select>
                  <select className="filter-input" value={newsDateFilter} onChange={(event) => setNewsDateFilter(event.target.value)}>
                    {newsDates.map((item) => <option key={item} value={item}>{item === "all" ? "全部日期" : item}</option>)}
                  </select>
                </div>
                <div className="section-head" style={{ marginTop: 16 }}>
                  <div className="muted">当前展示 {filteredNewsFeed.length} / {newsFeed.length} 条新闻</div>
                  <button className="action-btn ghost small" onClick={() => { setNewsKeyword(""); setNewsSourceFilter("all"); setNewsThemeFilter("all"); setNewsStatusFilter("all"); setNewsDateFilter("all"); }}>重置筛选</button>
                </div>
                <div className="stack">{filteredNewsFeed.length ? filteredNewsFeed.map((item) => <NewsListItem key={item.id} item={item} />) : <Empty text="当前筛选条件下暂无新闻" />}</div>
              </Section>
            </div>
            <div className="stack">
              <Section title="新闻统计" note="按筛选结果实时更新。"><MetricGrid items={newsStats} /></Section>
            </div>
          </div>
        ) : null}

        {view === "history" ? (
          <div className="content-grid">
            <div className="stack">
              <Section title="历史优化与样本" note="规则优化器与归档时间线。">
                <MetricGrid items={[
                  metric("闭环样本", safeText(dashboard.history?.dashboard?.readiness?.closedSamples ?? dashboard.history?.dashboard?.closedSamples ?? "-")),
                  metric("观察阶段", dashboard.history?.dashboard?.readiness?.enoughForOptimization ? "可调优" : "样本偏少"),
                  metric("跨环境覆盖", safeText(dashboard.history?.dashboard?.readiness?.stableEnvironments ?? "-"))
                ]} />
                <div className="info-card" style={{ marginTop: 12 }}><h4>优化器建议</h4><BulletList items={dashboard.history?.dashboard?.warnings ?? []} emptyText="暂无额外警告" /></div>
              </Section>
            </div>
            <div className="stack">
              <Section title="历史时间线" note="最近归档日期与文件类型。">
                <div className="stack">{asArray(dashboard.history?.groups).slice(0, 12).map((group) => <HistoryGroupCard key={group.date} group={group} />)}</div>
              </Section>
            </div>
          </div>
        ) : null}

        {view === "raw" ? (
          <Section title="原始对象" note="便于核对后端返回的结构化数据。">
            <pre className="code-block">{JSON.stringify(day, null, 2)}</pre>
          </Section>
        ) : null}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);













