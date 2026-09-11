function summarizeSetups(trades) {
  const map = new Map();
  for (const trade of trades) {
    const key = trade.setup ?? "Unknown";
    if (!map.has(key)) {
      map.set(key, { setup: key, count: 0, totalPnlPct: 0, wins: 0, matchedPlanCount: 0 });
    }
    const entry = map.get(key);
    entry.count += 1;
    entry.totalPnlPct += Number(trade.pnlPct ?? 0);
    entry.wins += Number(trade.pnlPct ?? 0) > 0 ? 1 : 0;
    entry.matchedPlanCount += trade.matchedPlan ? 1 : 0;
  }

  return [...map.values()].map((entry) => ({
    ...entry,
    avgPnlPct: Number((entry.totalPnlPct / Math.max(entry.count, 1)).toFixed(2)),
    winRate: Number((entry.wins / Math.max(entry.count, 1)).toFixed(2)),
    matchedPlanRate: Number((entry.matchedPlanCount / Math.max(entry.count, 1)).toFixed(2))
  }));
}

function normalizeTradeJournal(trades) {
  return trades.map((trade) => ({
    symbol: trade.symbol,
    theme: trade.theme,
    setup: trade.setup,
    pnlPct: Number(trade.pnlPct ?? 0),
    result: trade.result,
    matchedPlan: Boolean(trade.matchedPlan),
    positionPct: Number(trade.positionPct ?? 0),
    holdingDays: Number(trade.holdingDays ?? 0),
    entryStyle: trade.entryStyle ?? "Unknown",
    exitReason: trade.exitReason ?? "",
    entryConfidence: trade.entryConfidence ?? null,
    plannedSetup: trade.plannedSetup ?? trade.setup,
    plannedTheme: trade.plannedTheme ?? trade.theme,
    tags: Array.isArray(trade.tags) ? trade.tags : [],
    notes: trade.notes ?? ""
  }));
}

export function buildOutcomeReview(outcome, historyIndex) {
  const trades = outcome.trades ?? [];
  const matchedPlanCount = trades.filter((trade) => trade.matchedPlan).length;
  const positiveTrades = trades.filter((trade) => trade.pnlPct > 0).length;
  const negativeTrades = trades.filter((trade) => trade.pnlPct < 0).length;
  const bestTrade = trades.length > 0 ? [...trades].sort((a, b) => b.pnlPct - a.pnlPct)[0] : null;
  const worstTrade = trades.length > 0 ? [...trades].sort((a, b) => a.pnlPct - b.pnlPct)[0] : null;
  const setupBreakdown = summarizeSetups(trades);
  const tradeJournal = normalizeTradeJournal(trades);

  return {
    date: outcome.date,
    performance: outcome.summary,
    executionStats: {
      matchedPlanCount,
      matchedPlanRate: Number((matchedPlanCount / Math.max(trades.length, 1)).toFixed(2)),
      unmatchedPlanCount: trades.length - matchedPlanCount,
      positiveTrades,
      negativeTrades,
      bestTrade,
      worstTrade,
      setupBreakdown,
      tradeJournal
    },
    optimizationFocus: [
      outcome.summary.maxDrawdownPct < -2 ? "Drawdown was heavy. Tighten invalidation and position control." : null,
      outcome.summary.winRate < 0.5 ? "Win rate is below 50%. Recheck setup selection and mainline confirmation." : null,
      matchedPlanCount < trades.length ? "Some trades were outside plan. Review execution discipline." : null,
      historyIndex.entries?.length > 0 ? "Compare this outcome with prior archived environment and theme patterns." : null
    ].filter(Boolean)
  };
}

export function formatOutcomeReview(review) {
  const setupLines = review.executionStats.setupBreakdown.map(
    (item) => `- ${item.setup}: avg ${item.avgPnlPct}%, win ${Math.round(item.winRate * 100)}%, matched ${Math.round(item.matchedPlanRate * 100)}%`
  );
  const tradeLines = review.executionStats.tradeJournal.map(
    (item) => `- ${item.symbol}: ${item.setup}, pnl ${item.pnlPct}%, pos ${item.positionPct}%, matched ${item.matchedPlan ? "Yes" : "No"}`
  );

  return [
    `Date: ${review.date ?? "N/A"}`,
    `Total PnL: ${review.performance.totalPnlPct}%`,
    `Realized PnL: ${review.performance.realizedPnlPct}%`,
    `Max Drawdown: ${review.performance.maxDrawdownPct}%`,
    `Win Rate: ${Math.round(review.performance.winRate * 100)}%`,
    `Trade Count: ${review.performance.tradeCount}`,
    `Discipline Score: ${review.performance.disciplineScore}`,
    `Notes: ${review.performance.notes || "None"}`,
    "",
    `Matched Plan Trades: ${review.executionStats.matchedPlanCount}`,
    `Matched Plan Rate: ${Math.round(review.executionStats.matchedPlanRate * 100)}%`,
    `Unmatched Plan Trades: ${review.executionStats.unmatchedPlanCount}`,
    `Positive Trades: ${review.executionStats.positiveTrades}`,
    `Negative Trades: ${review.executionStats.negativeTrades}`,
    `Best Trade: ${review.executionStats.bestTrade ? `${review.executionStats.bestTrade.symbol}(${review.executionStats.bestTrade.pnlPct}%)` : "None"}`,
    `Worst Trade: ${review.executionStats.worstTrade ? `${review.executionStats.worstTrade.symbol}(${review.executionStats.worstTrade.pnlPct}%)` : "None"}`,
    "",
    "Setup Breakdown:",
    ...(setupLines.length > 0 ? setupLines : ["- None"]),
    "",
    "Trade Journal:",
    ...(tradeLines.length > 0 ? tradeLines : ["- None"]),
    "",
    "Optimization Focus:",
    ...review.optimizationFocus.map((item) => `- ${item}`)
  ].join("\n");
}
