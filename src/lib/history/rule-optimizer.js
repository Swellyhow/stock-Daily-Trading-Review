function weightedAverage(items, valueKey, weightKey = "tradeCount") {
  const totalWeight = items.reduce((sum, item) => sum + Number(item[weightKey] ?? 0), 0);
  if (totalWeight === 0) {
    return 0;
  }
  const weightedSum = items.reduce(
    (sum, item) => sum + Number(item[valueKey] ?? 0) * Number(item[weightKey] ?? 0),
    0
  );
  return Number((weightedSum / totalWeight).toFixed(2));
}

function groupByDate(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry.date || entry.date === "undated") {
      continue;
    }
    if (!map.has(entry.date)) {
      map.set(entry.date, []);
    }
    map.get(entry.date).push(entry);
  }
  return map;
}

function buildClosedSampleContexts(index) {
  const grouped = groupByDate(index.entries ?? []);
  const contexts = new Map();

  for (const [date, entries] of grouped.entries()) {
    const premarket = entries.find((entry) => entry.type === "premarket") ?? null;
    const postmarket = entries.find((entry) => entry.type === "postmarket") ?? null;
    const outcome = entries.find((entry) => entry.type === "outcome") ?? null;
    const anchor = postmarket ?? premarket;

    if (!anchor || !outcome) {
      continue;
    }

    contexts.set(date, {
      date,
      environment: anchor.environment ?? "未知环境",
      emotionCycle: anchor.emotionCycle ?? "未知周期",
      primaryTheme: anchor.primaryTheme ?? "未知题材",
      positionPlan: anchor.positionPlan ?? "未知仓位",
      actionBias: anchor.actionBias ?? "未知动作",
      guardrailMode: anchor.guardrailMode ?? "unknown",
      dataConfidence: anchor.dataConfidence ?? null,
      regimeKey: [anchor.environment, anchor.emotionCycle, anchor.primaryTheme].filter(Boolean).join(" | ") || "未知阶段"
    });
  }

  return contexts;
}

function positionBucket(positionPct) {
  if (positionPct >= 30) {
    return "重仓";
  }
  if (positionPct >= 15) {
    return "中仓";
  }
  if (positionPct > 0) {
    return "轻仓";
  }
  return "未记录";
}

function buildTradeRecords(index) {
  const grouped = groupByDate(index.entries ?? []);
  const sampleContexts = buildClosedSampleContexts(index);
  const records = [];

  for (const [date, entries] of grouped.entries()) {
    const outcome = entries.find((entry) => entry.type === "outcome") ?? null;
    const context = sampleContexts.get(date);
    if (!outcome || !context) {
      continue;
    }

    const tradeJournal = Array.isArray(outcome.tradeJournal) ? outcome.tradeJournal : [];
    if (tradeJournal.length > 0) {
      for (const trade of tradeJournal) {
        records.push({
          date,
          symbol: trade.symbol ?? "UNKNOWN",
          theme: trade.theme ?? context.primaryTheme,
          setup: trade.setup ?? "未知买点",
          pnlPct: Number(trade.pnlPct ?? 0),
          matchedPlan: Boolean(trade.matchedPlan),
          positionPct: Number(trade.positionPct ?? 0),
          positionBucket: positionBucket(Number(trade.positionPct ?? 0)),
          holdingDays: Number(trade.holdingDays ?? 0),
          entryStyle: trade.entryStyle ?? "Unknown",
          entryConfidence: trade.entryConfidence ?? null,
          plannedSetup: trade.plannedSetup ?? trade.setup ?? "未知买点",
          plannedTheme: trade.plannedTheme ?? trade.theme ?? context.primaryTheme,
          tags: Array.isArray(trade.tags) ? trade.tags : [],
          tradeCount: 1,
          winRate: Number(trade.pnlPct ?? 0) > 0 ? 1 : 0,
          matchedPlanRate: Boolean(trade.matchedPlan) ? 1 : 0,
          ...context
        });
      }
      continue;
    }

    for (const item of outcome.setupBreakdown ?? []) {
      records.push({
        date,
        symbol: null,
        theme: context.primaryTheme,
        setup: item.setup ?? "未知买点",
        pnlPct: Number(item.avgPnlPct ?? 0),
        matchedPlan: Number(item.matchedPlanRate ?? 0) >= 0.5,
        positionPct: 0,
        positionBucket: "未记录",
        holdingDays: 0,
        entryStyle: "Unknown",
        entryConfidence: null,
        plannedSetup: item.setup ?? "未知买点",
        plannedTheme: context.primaryTheme,
        tags: [],
        tradeCount: Number(item.count ?? 0),
        winRate: Number(item.winRate ?? 0),
        matchedPlanRate: Number(item.matchedPlanRate ?? 0),
        ...context
      });
    }
  }

  return records.filter((item) => item.tradeCount > 0);
}

function aggregateRecords(records, key) {
  const groups = new Map();
  for (const record of records) {
    const name = record[key];
    if (!name) {
      continue;
    }
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(record);
  }

  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      dayCount: new Set(items.map((item) => item.date)).size,
      tradeCount: items.reduce((sum, item) => sum + item.tradeCount, 0),
      avgPnlPct: weightedAverage(items, "pnlPct"),
      avgWinRate: weightedAverage(items, "winRate"),
      avgMatchedPlanRate: weightedAverage(items, "matchedPlanRate")
    }))
    .sort((a, b) => {
      if (b.avgPnlPct !== a.avgPnlPct) {
        return b.avgPnlPct - a.avgPnlPct;
      }
      return b.tradeCount - a.tradeCount;
    });
}

function pickConditionNames(items, predicate, limit = 2) {
  return items
    .filter(predicate)
    .slice(0, limit)
    .map((item) => item.name);
}

function classifySetup(profile) {
  if (profile.tradeCount < 3) {
    return "观察";
  }

  if (profile.avgPnlPct <= 0 || profile.avgWinRate < 0.4) {
    return "禁用";
  }

  if (
    profile.avgPnlPct < 0.8 ||
    profile.avgWinRate < 0.55 ||
    profile.avgMatchedPlanRate < 0.7 ||
    profile.weakEnvironments.length > 0
  ) {
    return "收紧";
  }

  return "保留";
}

function buildRationale(profile) {
  const reasons = [];

  if (profile.tradeCount < 3) {
    reasons.push("历史样本偏少，暂时不建议据此放大仓位。");
  }
  if (profile.avgPnlPct <= 0) {
    reasons.push("历史平均收益为负，说明这个买点当前没有体现正向边际。");
  }
  if (profile.avgWinRate < 0.4) {
    reasons.push("胜率偏低，容易在情绪切换期拖累整体节奏。");
  }
  if (profile.avgMatchedPlanRate < 0.7) {
    reasons.push("计划匹配率偏低，说明该买点容易和盘前计划脱节。");
  }
  if (profile.strongEnvironments.length > 0) {
    reasons.push(`更适合在 ${profile.strongEnvironments.join("、")} 中使用。`);
  }
  if (profile.weakEnvironments.length > 0) {
    reasons.push(`在 ${profile.weakEnvironments.join("、")} 中表现较弱，需收紧触发条件。`);
  }

  return reasons.length > 0 ? reasons : ["当前表现稳定，可继续保留在核心规则池。"];
}

function buildSetupProfiles(records) {
  const setupGroups = new Map();
  for (const record of records) {
    if (!setupGroups.has(record.setup)) {
      setupGroups.set(record.setup, []);
    }
    setupGroups.get(record.setup).push(record);
  }

  return [...setupGroups.entries()]
    .map(([setup, items]) => {
      const environmentPerformance = aggregateRecords(items, "environment");
      const themePerformance = aggregateRecords(items, "theme");
      const positionPerformance = aggregateRecords(items, "positionBucket");
      const entryStylePerformance = aggregateRecords(items, "entryStyle");
      const profile = {
        setup,
        dayCount: new Set(items.map((item) => item.date)).size,
        tradeCount: items.reduce((sum, item) => sum + item.tradeCount, 0),
        avgPnlPct: weightedAverage(items, "pnlPct"),
        avgWinRate: weightedAverage(items, "winRate"),
        avgMatchedPlanRate: weightedAverage(items, "matchedPlanRate"),
        environmentPerformance,
        themePerformance,
        positionPerformance,
        entryStylePerformance,
        strongEnvironments: pickConditionNames(environmentPerformance, (item) => item.tradeCount >= 1 && item.avgPnlPct > 0.8),
        weakEnvironments: pickConditionNames(environmentPerformance, (item) => item.tradeCount >= 1 && item.avgPnlPct <= 0),
        strongThemes: pickConditionNames(themePerformance, (item) => item.tradeCount >= 1 && item.avgPnlPct > 0.8),
        weakThemes: pickConditionNames(themePerformance, (item) => item.tradeCount >= 1 && item.avgPnlPct <= 0)
      };

      profile.recommendedAction = classifySetup(profile);
      profile.rationale = buildRationale(profile);
      return profile;
    })
    .sort((a, b) => {
      const rank = { 保留: 0, 收紧: 1, 禁用: 2, 观察: 3 };
      if (rank[a.recommendedAction] !== rank[b.recommendedAction]) {
        return rank[a.recommendedAction] - rank[b.recommendedAction];
      }
      if (b.avgPnlPct !== a.avgPnlPct) {
        return b.avgPnlPct - a.avgPnlPct;
      }
      return b.tradeCount - a.tradeCount;
    });
}

function buildEdgeList(records, keyFields) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFields.map((field) => record[field] ?? "").join("::");
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const labels = key.split("::");
      return {
        label: labels.join(" | "),
        setup: labels[0],
        context: labels.slice(1).join(" | "),
        dayCount: new Set(items.map((item) => item.date)).size,
        tradeCount: items.reduce((sum, item) => sum + item.tradeCount, 0),
        avgPnlPct: weightedAverage(items, "pnlPct"),
        avgWinRate: weightedAverage(items, "winRate"),
        avgMatchedPlanRate: weightedAverage(items, "matchedPlanRate")
      };
    })
    .sort((a, b) => {
      if (b.avgPnlPct !== a.avgPnlPct) {
        return b.avgPnlPct - a.avgPnlPct;
      }
      return b.tradeCount - a.tradeCount;
    });
}

function buildEnvironmentCoverage(records) {
  const groups = aggregateRecords(records, "environment");
  return {
    coveredEnvironments: groups.filter((item) => item.tradeCount > 0).map((item) => item.name),
    stableEnvironments: groups.filter((item) => item.tradeCount >= 5).map((item) => item.name),
    detail: groups
  };
}

function buildSampleMilestones(totalTrades) {
  return {
    observationReady: totalTrades >= 20,
    tuningReady: totalTrades >= 50,
    disableReady: totalTrades >= 100
  };
}

function buildGlobalRecommendations(setupProfiles, readiness) {
  const recommendations = [];
  const preserve = setupProfiles.filter((item) => item.recommendedAction === "保留");
  const tighten = setupProfiles.filter((item) => item.recommendedAction === "收紧");
  const disable = setupProfiles.filter((item) => item.recommendedAction === "禁用");
  const observe = setupProfiles.filter((item) => item.recommendedAction === "观察");

  if (!readiness.enoughTradeSamples) {
    recommendations.push("闭环交易样本仍偏少，当前规则优化更适合作为观察清单，不适合一次性大改交易体系。");
  }
  if (preserve.length > 0) {
    recommendations.push(`建议保留的核心买点: ${preserve.map((item) => item.setup).join("、")}。`);
  }
  if (tighten.length > 0) {
    recommendations.push(`建议收紧的买点: ${tighten.map((item) => item.setup).join("、")}。优先增加环境和主线确认条件。`);
  }
  if (disable.length > 0) {
    recommendations.push(`建议默认禁用的买点: ${disable.map((item) => item.setup).join("、")}。在重新验证前不建议继续放量使用。`);
  }
  if (observe.length > 0) {
    recommendations.push(`以下买点样本仍不足，先继续跟踪: ${observe.map((item) => item.setup).join("、")}。`);
  }
  if (recommendations.length === 0) {
    recommendations.push("当前没有足够的闭环样本来支持更细的规则调整，先继续积累带 outcome 的交易日。");
  }

  return recommendations;
}

export function buildRuleOptimizer(index) {
  const records = buildTradeRecords(index);
  const setupProfiles = buildSetupProfiles(records);
  const setupEnvironmentEdges = buildEdgeList(records, ["setup", "environment"]);
  const setupThemeEdges = buildEdgeList(records, ["setup", "theme"]);
  const setupPositionEdges = buildEdgeList(records, ["setup", "positionBucket"]);
  const setupEntryStyleEdges = buildEdgeList(records, ["setup", "entryStyle"]);
  const ruleActions = {
    preserve: setupProfiles.filter((item) => item.recommendedAction === "保留"),
    tighten: setupProfiles.filter((item) => item.recommendedAction === "收紧"),
    disable: setupProfiles.filter((item) => item.recommendedAction === "禁用"),
    observe: setupProfiles.filter((item) => item.recommendedAction === "观察")
  };

  const totalTrades = records.reduce((sum, item) => sum + item.tradeCount, 0);
  const environmentCoverage = buildEnvironmentCoverage(records);
  const sampleMilestones = buildSampleMilestones(totalTrades);
  const readiness = {
    closedTradeGroups: records.length,
    totalTrades,
    enoughTradeSamples: sampleMilestones.observationReady,
    enoughSetupComparison: setupProfiles.filter((item) => item.tradeCount >= 3).length >= 2,
    sampleMilestones,
    environmentCoverage
  };

  return {
    generatedAt: new Date().toISOString(),
    readiness,
    setupProfiles,
    positiveEdges: setupEnvironmentEdges.filter((item) => item.avgPnlPct > 0).slice(0, 5),
    negativeEdges: setupEnvironmentEdges.filter((item) => item.avgPnlPct <= 0).slice(0, 5),
    setupEnvironmentEdges: setupEnvironmentEdges.slice(0, 12),
    setupThemeEdges: setupThemeEdges.slice(0, 12),
    setupPositionEdges: setupPositionEdges.slice(0, 12),
    setupEntryStyleEdges: setupEntryStyleEdges.slice(0, 12),
    ruleActions,
    recommendations: buildGlobalRecommendations(setupProfiles, readiness)
  };
}

export function formatRuleOptimizer(optimizer) {
  return [
    `Closed Trade Groups: ${optimizer.readiness.closedTradeGroups}`,
    `Total Trades: ${optimizer.readiness.totalTrades}`,
    `Enough Trade Samples: ${optimizer.readiness.enoughTradeSamples ? "Yes" : "No"}`,
    `Milestones: ??${optimizer.readiness.sampleMilestones.observationReady ? "Yes" : "No"} / ??${optimizer.readiness.sampleMilestones.tuningReady ? "Yes" : "No"} / ??${optimizer.readiness.sampleMilestones.disableReady ? "Yes" : "No"}`,
    `Stable Environments: ${optimizer.readiness.environmentCoverage.stableEnvironments.join(", ") || "None"}`,
    `Enough Setup Comparison: ${optimizer.readiness.enoughSetupComparison ? "Yes" : "No"}`,
    `Rule Actions: 保留 ${optimizer.ruleActions.preserve.length} / 收紧 ${optimizer.ruleActions.tighten.length} / 禁用 ${optimizer.ruleActions.disable.length} / 观察 ${optimizer.ruleActions.observe.length}`,
    "",
    "Top Setup Actions:",
    ...(optimizer.setupProfiles.length > 0
      ? optimizer.setupProfiles.slice(0, 6).map((item) => `- ${item.setup}: ${item.recommendedAction}, avg ${item.avgPnlPct}%, win ${Math.round(item.avgWinRate * 100)}%, matched ${Math.round(item.avgMatchedPlanRate * 100)}%`)
      : ["- None"]),
    "",
    "Positive Edges:",
    ...(optimizer.positiveEdges.length > 0
      ? optimizer.positiveEdges.map((item) => `- ${item.label}: avg ${item.avgPnlPct}%, win ${Math.round(item.avgWinRate * 100)}%`)
      : ["- None"]),
    "",
    "Negative Edges:",
    ...(optimizer.negativeEdges.length > 0
      ? optimizer.negativeEdges.map((item) => `- ${item.label}: avg ${item.avgPnlPct}%, win ${Math.round(item.avgWinRate * 100)}%`)
      : ["- None"]),
    "",
    "Recommendations:",
    ...optimizer.recommendations.map((item) => `- ${item}`)
  ].join("\n");
}
