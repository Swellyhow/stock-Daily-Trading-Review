function inferRole(holding, decision) {
  if (holding.role) {
    return holding.role;
  }

  const name = holding.name ?? holding.symbol;
  if (!name) {
    return "未识别";
  }

  if (decision.leaders.leader?.name === name) {
    return "总龙头";
  }
  if (decision.leaders.themeLeader?.name === name) {
    return "题材龙头";
  }
  if ((decision.leaders.capacityCores ?? []).some((item) => item.name === name)) {
    return "容量核心";
  }
  if ((decision.leaders.midArmy ?? []).some((item) => item.name === name)) {
    return "中军";
  }
  if ((decision.leaders.corePool ?? []).some((item) => item.name === name)) {
    return "前排核心";
  }
  if ((decision.leaders.lowPositionCandidates ?? []).some((item) => item.name === name)) {
    return "低位补涨";
  }
  if ((decision.leaders.riskyNames ?? []).includes(name)) {
    return "中位跟随/风险位";
  }
  return "未识别";
}

function isCoreRole(role) {
  return ["总龙头", "题材龙头", "容量核心", "中军", "前排核心"].includes(role);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferState(action) {
  if (["清仓"].includes(action)) {
    return "退出";
  }
  if (["减仓", "减仓观察", "减仓至观察仓", "分批止盈"].includes(action)) {
    return "防守观察仓";
  }
  return "进攻持有";
}

function buildHoldingAdvice(holding, decision) {
  const role = inferRole(holding, decision);
  const primaryTheme = decision.themes.primaryTheme?.name ?? null;
  const inPrimaryTheme = Boolean(primaryTheme) && holding.theme === primaryTheme;
  const weakEnvironment = ["冰点", "退潮"].includes(decision.overview.emotionCycle) || decision.position.totalPosition === "空仓";
  const riskyRole = ["中位跟随/风险位", "后排跟风", "杂毛", "未识别"].includes(role);
  const pnlPct = Number(holding.pnlPct ?? 0);
  const positionPct = Number(holding.positionPct ?? 0);
  const holdingDays = Number(holding.holdingDays ?? 0);
  const matchedPlan = holding.matchedPlan;
  const reasons = [];
  const profitTriggers = [];
  const riskTriggers = [];
  const holdConditions = [];
  let action = "继续持有";
  let urgency = 40;

  if (!inPrimaryTheme) {
    reasons.push("当前不属于系统识别出的主线，优先级天然下降。");
    urgency += 15;
  }
  if (riskyRole) {
    reasons.push("当前持仓地位不高或已处于风险位，承接和容错率都偏弱。");
    urgency += 15;
  }
  if (matchedPlan === false) {
    reasons.push("这笔持仓偏离盘前计划，纪律上应降低容忍度。");
    urgency += 10;
  }
  if (weakEnvironment) {
    reasons.push(`当前环境为 ${decision.overview.environment}/${decision.overview.emotionCycle}，系统仓位已降到 ${decision.position.totalPosition}。`);
    urgency += 18;
  }
  if (decision.riskControl?.status === "stop-trading") {
    reasons.push("风险控制层已进入停止交易，新仓与交易型持仓都应尽快收缩。");
    urgency += 18;
  }

  if (decision.position.totalPosition === "空仓" || decision.riskControl?.status === "stop-trading") {
    if (isCoreRole(role) && inPrimaryTheme && pnlPct > 2) {
      action = "减仓至观察仓";
      reasons.push("虽然是主线核心，但系统总仓位已降为空仓，只保留最小观察仓更合适。");
      urgency += 12;
    } else {
      action = "清仓";
      reasons.push("系统明确不允许继续保留交易型仓位，应优先退出。");
      urgency += 25;
    }
  } else if (pnlPct <= -3 || (pnlPct < 0 && weakEnvironment && riskyRole)) {
    action = "清仓";
    reasons.push("亏损已达到或接近无效区，且环境不支持继续给容错。");
    urgency += 25;
  } else if (pnlPct >= 6 && weakEnvironment) {
    action = "分批止盈";
    reasons.push("弱环境里已有较好浮盈，更适合兑现而不是继续博弈。");
    urgency += 18;
  } else if (pnlPct >= 3 && (!inPrimaryTheme || riskyRole || holdingDays >= 3)) {
    action = "减仓";
    reasons.push("已有浮盈，但不是最核心的进攻载体，适合先落袋一部分。");
    urgency += 12;
  } else if (isCoreRole(role) && inPrimaryTheme && !weakEnvironment) {
    action = "继续持有";
    reasons.push("属于主线核心仓，且当前环境未完全转坏，可按计划持有。");
  } else if (isCoreRole(role) && inPrimaryTheme) {
    action = "减仓观察";
    reasons.push("虽是核心，但环境偏弱，适合降低暴露后继续观察。");
    urgency += 10;
  } else {
    action = "减仓";
    reasons.push("这类持仓不具备继续格局的充分条件，应先降风险。");
    urgency += 10;
  }

  profitTriggers.push(...decision.sellPlan.takeProfitRules.slice(0, 2));
  riskTriggers.push(...decision.sellPlan.stopLossRules.slice(0, 2));
  riskTriggers.push(...decision.sellPlan.structureFailureSignals.slice(0, 2));
  holdConditions.push(...decision.sellPlan.holdConditions.slice(0, 2));

  if (pnlPct >= 0) {
    profitTriggers.push("若次日高开冲高但板块跟随转弱，优先兑现而不是幻想二次加速。");
  }
  if (pnlPct < 0) {
    riskTriggers.push("若亏损继续扩大且盘中没有修复信号，默认快速退出，不做情绪化等待。");
  }
  if (holdingDays >= 2) {
    riskTriggers.push("持有天数已拉长，若不能继续给溢价，就把它视作兑现周期而不是继续格局。");
  }
  if (isCoreRole(role) && inPrimaryTheme) {
    holdConditions.push("只有龙头、题材龙头、容量核心同步维持强势时，才值得继续拿。");
  }

  const state = inferState(action);
  const nextTriggers =
    state === "进攻持有"
      ? ["龙头继续超预期", "主线回流加强", "量价关系维持健康"]
      : state === "防守观察仓"
        ? ["龙头修复失败则清仓", "回流成立则保留观察仓"]
        : ["执行完成后不再反复试错"];

  return {
    symbol: holding.symbol,
    name: holding.name,
    theme: holding.theme,
    role,
    inPrimaryTheme,
    positionPct,
    pnlPct,
    holdingDays,
    plannedSetup: holding.plannedSetup,
    actualSetup: holding.actualSetup,
    action,
    state,
    nextTriggers,
    urgency: clamp(Math.round(urgency), 0, 100),
    reasons,
    profitTriggers: [...new Set(profitTriggers)],
    riskTriggers: [...new Set(riskTriggers)],
    holdConditions: [...new Set(holdConditions)]
  };
}

export function buildPositionSellPlan(snapshot, decision, holdings = []) {
  const holdingPlans = holdings.map((holding) => buildHoldingAdvice(holding, decision));
  const summary = {
    totalHoldings: holdingPlans.length,
    clearCount: holdingPlans.filter((item) => item.action === "清仓").length,
    reduceCount: holdingPlans.filter((item) => ["减仓", "减仓观察", "减仓至观察仓", "分批止盈"].includes(item.action)).length,
    holdCount: holdingPlans.filter((item) => item.action === "继续持有").length,
    primaryTheme: decision.themes.primaryTheme?.name ?? "No clear mainline",
    environment: decision.overview.environment,
    emotionCycle: decision.overview.emotionCycle,
    preferredMode: decision.modeProfile?.primaryMode ?? "未知",
    systemSellStyle: decision.sellPlan?.primaryStyle ?? "None"
  };

  return {
    date: snapshot.date ?? decision.meta.date ?? null,
    summary,
    holdingPlans
  };
}

export function formatPositionSellPlan(plan) {
  const lines = [
    `Date: ${plan.date ?? "N/A"}`,
    `Environment: ${plan.summary.environment}`,
    `Emotion Cycle: ${plan.summary.emotionCycle}`,
    `Primary Theme: ${plan.summary.primaryTheme}`,
    `Preferred Mode: ${plan.summary.preferredMode}`,
    `System Sell Style: ${plan.summary.systemSellStyle}`,
    `Holdings: ${plan.summary.totalHoldings}`,
    `Need Exit: ${plan.summary.clearCount}`,
    `Need Reduce: ${plan.summary.reduceCount}`,
    `Can Hold: ${plan.summary.holdCount}`,
    "",
    "Holding Plans:"
  ];

  if (plan.holdingPlans.length === 0) {
    lines.push("- None");
    return lines.join("\n");
  }

  for (const item of plan.holdingPlans) {
    lines.push(`- ${item.name} [${item.role}] ${item.action} | state ${item.state} | pnl ${item.pnlPct}% | pos ${item.positionPct}% | urgency ${item.urgency}`);
    lines.push(`  Reasons: ${item.reasons.join(" | ") || "None"}`);
    lines.push(`  Next Triggers: ${item.nextTriggers.join(" | ") || "None"}`);
    lines.push(`  Profit Triggers: ${item.profitTriggers.join(" | ") || "None"}`);
    lines.push(`  Risk Triggers: ${item.riskTriggers.join(" | ") || "None"}`);
    lines.push(`  Hold Conditions: ${item.holdConditions.join(" | ") || "None"}`);
  }

  return lines.join("\n");
}
