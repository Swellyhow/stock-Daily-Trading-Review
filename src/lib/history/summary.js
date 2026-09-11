import { buildStrategySamples, buildStrategyDashboard } from "./ledger.js";
import { buildRuleOptimizer } from "./rule-optimizer.js";

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries) {
    const value = entry[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function topItems(counts, limit = 3) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function validDatedEntries(entries) {
  return entries.filter((entry) => entry.date && entry.date !== "undated");
}

function buildSetupPerformance(outcomeEntries) {
  const map = new Map();
  for (const entry of outcomeEntries) {
    for (const item of entry.setupBreakdown ?? []) {
      if (!map.has(item.setup)) {
        map.set(item.setup, { setup: item.setup, totalCount: 0, pnlValues: [], winRateValues: [], matchedPlanValues: [] });
      }
      const agg = map.get(item.setup);
      agg.totalCount += item.count ?? 0;
      agg.pnlValues.push(Number(item.avgPnlPct ?? 0));
      agg.winRateValues.push(Number(item.winRate ?? 0));
      agg.matchedPlanValues.push(Number(item.matchedPlanRate ?? 0));
    }
  }

  return [...map.values()]
    .map((item) => ({
      setup: item.setup,
      totalCount: item.totalCount,
      avgPnlPct: average(item.pnlValues),
      avgWinRate: average(item.winRateValues),
      avgMatchedPlanRate: average(item.matchedPlanValues)
    }))
    .sort((a, b) => b.avgPnlPct - a.avgPnlPct);
}

function buildRecommendations(entries, counts, performance, setupPerformance, dashboard, ruleOptimizer) {
  const recommendations = [];
  const total = entries.length;

  if (total === 0) {
    return ["No valid dated history yet. Archive at least one dated premarket and one dated postmarket run."];
  }

  if ((counts.environment["退潮环境"] ?? 0) + (counts.environment["冰点/恐慌"] ?? 0) > total / 3) {
    recommendations.push("A large share of days are weak. Tighten exposure and demand stronger confirmation before attacking.");
  }

  if ((counts.actionBias["主动进攻"] ?? 0) > total / 2 && (counts.environment["进攻环境"] ?? 0) < total / 2) {
    recommendations.push("The system is attacking frequently relative to strong-environment days. Review attack thresholds.");
  }

  if ((counts.positionPlan["7成仓"] ?? 0) > (counts.environment["进攻环境"] ?? 0)) {
    recommendations.push("High position usage appears broader than attack environments. Consider stricter position gating.");
  }

  if (performance.outcomeCount > 0) {
    if (performance.avgWinRate < 0.5) {
      recommendations.push("Average win rate is below 50%. Tighten setup quality and execution discipline.");
    }
    if (performance.avgTotalPnlPct <= 0) {
      recommendations.push("Average daily return is non-positive. Revisit which setups deserve capital.");
    }
    if (performance.avgDisciplineScore < 70) {
      recommendations.push("Discipline score is low. Off-plan trades may be hurting performance.");
    }
    if (performance.avgMatchedPlanRate < 0.7) {
      recommendations.push("Plan adherence is weak. Reduce off-plan trades and enforce premarket setup discipline.");
    }
    if (performance.worstDrawdownPct < -3) {
      recommendations.push("Historical drawdown is deep. Add stricter stop and exposure controls.");
    }
  }

  if (setupPerformance.length > 0 && setupPerformance[0].avgPnlPct <= 0) {
    recommendations.push("No setup is showing positive edge yet. Reassess setup definitions before scaling exposure.");
  }

  recommendations.push(...dashboard.warnings);
  recommendations.push(...(ruleOptimizer?.recommendations ?? []));

  if (recommendations.length === 0) {
    recommendations.push("Current history looks internally consistent. Next step is to expand the sample size across more market regimes.");
  }

  return [...new Set(recommendations)];
}

export function buildHistorySummary(index) {
  const allEntries = index.entries ?? [];
  const datedEntries = validDatedEntries(allEntries);
  const strategyEntries = datedEntries.filter((entry) => entry.type !== "outcome");
  const outcomeEntries = datedEntries.filter((entry) => entry.type === "outcome");
  const counts = {
    type: countBy(datedEntries, "type"),
    environment: countBy(strategyEntries, "environment"),
    emotionCycle: countBy(strategyEntries, "emotionCycle"),
    primaryTheme: countBy(strategyEntries, "primaryTheme"),
    actionBias: countBy(strategyEntries, "actionBias"),
    positionPlan: countBy(strategyEntries, "positionPlan"),
    guardrailMode: countBy(strategyEntries, "guardrailMode")
  };

  const setupPerformance = buildSetupPerformance(outcomeEntries);
  const samples = buildStrategySamples(index);
  const dashboard = buildStrategyDashboard(samples);
  const ruleOptimizer = buildRuleOptimizer(index);
  const performance = {
    outcomeCount: outcomeEntries.length,
    avgTotalPnlPct: average(outcomeEntries.map((entry) => Number(entry.totalPnlPct ?? 0))),
    avgRealizedPnlPct: average(outcomeEntries.map((entry) => Number(entry.realizedPnlPct ?? 0))),
    avgWinRate: average(outcomeEntries.map((entry) => Number(entry.winRate ?? 0))),
    avgDisciplineScore: average(outcomeEntries.map((entry) => Number(entry.disciplineScore ?? 0))),
    avgMatchedPlanRate: average(outcomeEntries.map((entry) => Number(entry.matchedPlanRate ?? 0))),
    worstDrawdownPct: outcomeEntries.length > 0
      ? Math.min(...outcomeEntries.map((entry) => Number(entry.maxDrawdownPct ?? 0)))
      : 0
  };

  const sortedDates = [...new Set(datedEntries.map((entry) => entry.date))].sort();

  return {
    totalEntries: datedEntries.length,
    latestDate: sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null,
    counts,
    performance,
    setupPerformance,
    topThemes: topItems(counts.primaryTheme),
    topEnvironments: topItems(counts.environment),
    samples,
    dashboard,
    ruleOptimizer,
    recommendations: buildRecommendations(strategyEntries, counts, performance, setupPerformance, dashboard, ruleOptimizer)
  };
}

export function formatHistorySummary(summary) {
  const bestSetup = summary.setupPerformance[0] ?? null;
  const worstSetup = summary.setupPerformance.length > 0 ? summary.setupPerformance[summary.setupPerformance.length - 1] : null;
  const bestEnvironment = summary.dashboard.environmentPerformance[0] ?? null;
  const bestTheme = summary.dashboard.themePerformance[0] ?? null;

  return [
    `Total Entries: ${summary.totalEntries}`,
    `Latest Date: ${summary.latestDate ?? "N/A"}`,
    `Top Themes: ${summary.topThemes.map((item) => `${item.name}(${item.count})`).join(", ") || "None"}`,
    `Top Environments: ${summary.topEnvironments.map((item) => `${item.name}(${item.count})`).join(", ") || "None"}`,
    `Outcome Count: ${summary.performance.outcomeCount}`,
    `Avg Total PnL: ${summary.performance.avgTotalPnlPct}%`,
    `Avg Realized PnL: ${summary.performance.avgRealizedPnlPct}%`,
    `Avg Win Rate: ${Math.round(summary.performance.avgWinRate * 100)}%`,
    `Avg Discipline Score: ${summary.performance.avgDisciplineScore}`,
    `Avg Matched Plan Rate: ${Math.round(summary.performance.avgMatchedPlanRate * 100)}%`,
    `Worst Drawdown: ${summary.performance.worstDrawdownPct}%`,
    `Best Setup: ${bestSetup ? `${bestSetup.setup}(${bestSetup.avgPnlPct}%)` : "None"}`,
    `Worst Setup: ${worstSetup ? `${worstSetup.setup}(${worstSetup.avgPnlPct}%)` : "None"}`,
    `Closed Samples: ${summary.dashboard.readiness.closedSamples}`,
    `Enough For Optimization: ${summary.dashboard.readiness.enoughForOptimization ? "Yes" : "No"}`,
    `Hard Stop Count: ${summary.dashboard.hardStopCount}`,
    `Best Environment: ${bestEnvironment ? `${bestEnvironment.name}(${bestEnvironment.avgPnlPct}%)` : "None"}`,
    `Best Theme: ${bestTheme ? `${bestTheme.name}(${bestTheme.avgPnlPct}%)` : "None"}`,
    `Rule Actions: 保留 ${summary.ruleOptimizer.ruleActions.preserve.length} / 收紧 ${summary.ruleOptimizer.ruleActions.tighten.length} / 禁用 ${summary.ruleOptimizer.ruleActions.disable.length} / 观察 ${summary.ruleOptimizer.ruleActions.observe.length}`,
    "",
    "Recommendations:",
    ...summary.recommendations.map((item) => `- ${item}`)
  ].join("\n");
}
