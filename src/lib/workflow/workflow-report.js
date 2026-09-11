function formatCatalystLine(items = []) {
  return items.map((item) => `${item.theme}(${Math.round((item.strength ?? 0) * 100)}%,${item.eventType},${item.sentiment})`).join(", ") || "None";
}

function formatBucketNames(buckets = {}) {
  return Object.entries(buckets)
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([name, items]) => `${name}:${items.length}`)
    .join(", ") || "None";
}

function formatCatalystDetails(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- None";
  }

  return items
    .slice(0, 3)
    .map((item) => [
      `- ${item.theme} [${item.eventType}/${item.sentiment}/${Math.round((item.strength ?? 0) * 100)}%]`,
      `  原因: ${item.reason || "None"}`,
      `  细化: ${item.detailedReason || "None"}`,
      `  影响: ${item.decisionImpact || "None"}`,
      `  风险: ${item.riskNote || "None"}`,
      `  关联新闻: ${(item.headlineTitles ?? []).join(" | ") || "None"}`
    ].join("\n"))
    .join("\n");
}

function formatRejectedNews(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- None";
  }

  return items
    .slice(0, 5)
    .map((item) => `- ${item.title}: ${item.reason}`)
    .join("\n");
}

function formatSellPlan(sellPlan) {
  if (!sellPlan) {
    return "- None";
  }

  return [
    `Sell Style: ${sellPlan.primaryStyle}`,
    `State Machine: ${(sellPlan.stateMachine ?? []).map((item) => `${item.state}:${item.action}`).join(" | ") || "None"}`,
    `Take Profit: ${sellPlan.takeProfitRules.join(" | ")}`,
    `Stop Loss: ${sellPlan.stopLossRules.join(" | ")}`,
    `Emotion Warnings: ${sellPlan.emotionDeteriorationSignals.join(" | ")}`,
    `Structure Warnings: ${sellPlan.structureFailureSignals.join(" | ")}`,
    `Hold Conditions: ${sellPlan.holdConditions.join(" | ")}`
  ].join("\n");
}

export function formatPremarketPlan(plan) {
  return [
    `Date: ${plan.date ?? "N/A"}`,
    `Environment: ${plan.marketJudgement.environment}`,
    `Emotion Cycle: ${plan.marketJudgement.emotionCycle}`,
    `Attack Window: ${plan.marketJudgement.attackWindow}`,
    `Risk Preference: ${plan.marketJudgement.riskPreference}`,
    `Preferred Mode: ${plan.executionPlan.preferredMode}`,
    `Active Modes: ${plan.executionPlan.activeModes.map((item) => `${item.name}(${item.score})`).join(", ") || "None"}`,
    `Style Preference: ${plan.marketJudgement.regime.stylePreference}`,
    `Index State: ${plan.marketJudgement.regime.indexState}`,
    `Volume State: ${plan.marketJudgement.regime.volumeState}`,
    `Risk Control: ${plan.marketJudgement.riskControl.status}`,
    `Yesterday Avg Premium: ${plan.marketJudgement.keyMetrics.avgYesterdayPremiumPct}`,
    `Strong Premium Ratio: ${plan.marketJudgement.keyMetrics.strongPremiumRatio}`,
    "",
    `Primary Theme: ${plan.themes.primaryTheme}`,
    `Secondary Theme: ${plan.themes.secondaryTheme}`,
    `Primary Theme Type: ${plan.themes.primaryThemeType}`,
    `Narrative Label: ${plan.themes.narrativeLabel}`,
    `Avoid Themes: ${plan.themes.avoidThemes.join(", ") || "None"}`,
    `Top News Catalysts: ${formatCatalystLine(plan.newsCatalysts.topThemes)}`,
    `Catalyst Buckets: ${formatBucketNames(plan.newsCatalysts.buckets)}`,
    `Catalyst Warning: ${plan.newsCatalysts.warning || "None"}`,
    "Catalyst Details:",
    formatCatalystDetails(plan.newsCatalysts.topThemes),
    "Rejected News:",
    formatRejectedNews(plan.newsCatalysts.rejectedNews),
    "",
    `Leader: ${plan.watchlist.leader}`,
    `Theme Leader: ${plan.watchlist.themeLeader}`,
    `Capacity Cores: ${plan.watchlist.capacityCores.join(", ") || "None"}`,
    `Mid Army: ${plan.watchlist.midArmy.join(", ") || "None"}`,
    `Core Pool: ${plan.watchlist.corePool.join(", ") || "None"}`,
    `Turnover Candidates: ${plan.watchlist.turnoverCandidates.join(", ") || "None"}`,
    `Low Position Watch: ${plan.watchlist.lowPositionWatch.join(", ") || "None"}`,
    "",
    `Allowed Setups: ${plan.executionPlan.allowedSetups.join(", ") || "None"}`,
    `Forbidden Setups: ${plan.executionPlan.forbiddenSetups.join(", ") || "None"}`,
    `Position Plan: ${plan.positionPlan.totalPosition}`,
    `Retreat Signals: ${plan.positionPlan.retreatSignals.join(", ")}`,
    `Add Signals: ${plan.positionPlan.addSignals.join(", ")}`,
    `Risk Rules: ${(plan.marketJudgement.riskControl.rules ?? []).join(" | ") || "None"}`,
    "",
    formatSellPlan(plan.sellPlan)
  ].join("\n");
}

export function formatPostmarketReview(review) {
  return [
    `Date: ${review.date ?? "N/A"}`,
    `Environment Review: ${review.marketReview.environment}`,
    `Emotion Cycle Review: ${review.marketReview.emotionCycle}`,
    `Preferred Mode Review: ${review.marketReview.modeProfile.primaryMode}`,
    `Style Preference: ${review.marketReview.regime.stylePreference}`,
    `Risk Control: ${review.marketReview.riskControl.status}`,
    `Avg Premium Review: ${review.marketReview.keyMetrics.avgYesterdayPremiumPct}`,
    `Strong Premium Ratio: ${review.marketReview.keyMetrics.strongPremiumRatio}`,
    `Deep Negative Ratio: ${review.marketReview.keyMetrics.deepNegativeRatio}`,
    `Market Conclusion: ${review.marketReview.conclusion.join(" | ")}`,
    "",
    `Strongest Theme: ${review.themeReview.strongestTheme}`,
    `Backup Theme: ${review.themeReview.backupTheme}`,
    `Theme Summary: ${review.themeReview.summary}`,
    `News Catalysts: ${formatCatalystLine(review.themeReview.newsCatalysts.topThemes)}`,
    `Catalyst Buckets: ${formatBucketNames(review.themeReview.newsCatalysts.buckets)}`,
    `Catalyst Warning: ${review.themeReview.newsCatalysts.warning || "None"}`,
    "Catalyst Details:",
    formatCatalystDetails(review.themeReview.newsCatalysts.topThemes),
    "Rejected News:",
    formatRejectedNews(review.themeReview.newsCatalysts.rejectedNews),
    `Risky Names: ${review.themeReview.riskyNames.join(", ") || "None"}`,
    "",
    `Leader Review: ${review.stockReview.leader}`,
    `Theme Leader: ${review.stockReview.themeLeader}`,
    `Capacity Cores: ${review.stockReview.capacityCores.join(", ") || "None"}`,
    `Mid Army: ${review.stockReview.midArmy.join(", ") || "None"}`,
    `Core Pool Review: ${review.stockReview.corePool.join(", ") || "None"}`,
    `Tomorrow Focus: ${review.stockReview.tomorrowFocus.join(", ") || "None"}`,
    "",
    `Allowed Setups Worked: ${review.systemReview.allowedSetupsWorked.join(", ") || "None"}`,
    `Setups To Avoid: ${review.systemReview.setupsToAvoid.join(", ") || "None"}`,
    `Position Plan Review: ${review.systemReview.positionPlan}`,
    `Optimization Focus: ${review.systemReview.optimizationFocus.join(" | ")}`,
    "",
    formatSellPlan(review.systemReview.sellPlan)
  ].join("\n");
}
