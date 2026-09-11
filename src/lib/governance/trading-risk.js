function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function minPositionByRank(current, limit) {
  const rank = {
    空仓: 0,
    轻仓: 1,
    半仓: 2,
    "7成仓": 3
  };
  return (rank[current] ?? 0) <= (rank[limit] ?? 0) ? current : limit;
}

export function applyTradingRiskControls(snapshot, decision) {
  const riskContext = snapshot?.riskContext ?? {};
  const dailyDrawdownPct = Number(riskContext.dailyDrawdownPct ?? 0);
  const consecutiveLossDays = Number(riskContext.consecutiveLossDays ?? 0);
  const openPositions = Number(riskContext.openPositions ?? 0);
  const planDeviationCount = Number(riskContext.planDeviationCount ?? 0);
  const availableCapitalPct = Number(riskContext.availableCapitalPct ?? 100);
  const reasons = [];
  let status = "normal";
  let forcedActionBias = decision.execution.actionBias;
  let forcedPosition = decision.position.totalPosition;
  let maxNewTrades = decision.modeProfile?.primaryMode === "防守空仓" ? 0 : 2;

  if (decision.guardrails?.blocked) {
    status = "stop-trading";
    forcedActionBias = "停止出手";
    forcedPosition = "空仓";
    maxNewTrades = 0;
    reasons.push("硬闸门已阻断交易，风险控制层直接进入停止交易。");
  }

  if (dailyDrawdownPct <= -2) {
    status = "stop-trading";
    forcedActionBias = "停止出手";
    forcedPosition = "空仓";
    maxNewTrades = 0;
    reasons.push("当日回撤超过 2%，强制停止新增交易。");
  } else if (dailyDrawdownPct <= -1) {
    status = status === "stop-trading" ? status : "risk-off";
    forcedActionBias = forcedActionBias === "停止出手" ? forcedActionBias : "防守观察";
    forcedPosition = minPositionByRank(forcedPosition, "轻仓");
    maxNewTrades = Math.min(maxNewTrades, 1);
    reasons.push("当日回撤已超过 1%，只允许观察或单笔低风险试错。");
  }

  if (consecutiveLossDays >= 3) {
    status = "stop-trading";
    forcedActionBias = "停止出手";
    forcedPosition = "空仓";
    maxNewTrades = 0;
    reasons.push("连续亏损天数达到 3 天，进入交易冷却。");
  }

  if (planDeviationCount >= 2) {
    status = status === "stop-trading" ? status : "risk-off";
    forcedActionBias = forcedActionBias === "停止出手" ? forcedActionBias : "防守观察";
    forcedPosition = minPositionByRank(forcedPosition, "轻仓");
    maxNewTrades = Math.min(maxNewTrades, 1);
    reasons.push("当日计划外交易偏多，强制收紧出手频率。");
  }

  if (openPositions >= 4) {
    maxNewTrades = 0;
    reasons.push("当前持仓数量已偏多，停止继续摊薄注意力。");
  }

  if (availableCapitalPct <= 15) {
    maxNewTrades = 0;
    reasons.push("可用资金不足，优先处理存量持仓。");
  }

  const next = structuredClone(decision);
  next.riskControl = {
    status,
    dailyDrawdownPct,
    consecutiveLossDays,
    openPositions,
    planDeviationCount,
    availableCapitalPct,
    maxNewTrades,
    reasons: unique(reasons),
    rules: [
      "单日回撤超过 2% 停止新增交易",
      "连续 3 天亏损进入冷却期",
      "单日出现 2 次计划外交易后收缩到轻仓观察",
      "持仓数过多或可用资金过低时，优先去杠杆而不是继续试错"
    ]
  };

  next.execution.actionBias = forcedActionBias;
  next.position.totalPosition = forcedPosition;
  next.overview.actionBias = forcedActionBias;
  next.overview.positionPlan = forcedPosition;

  if (status === "stop-trading") {
    next.execution.allowedSetups = [];
    next.position.structure = { leaderCore: 0, secondaryCore: 0, trial: 0 };
  }

  return next;
}
