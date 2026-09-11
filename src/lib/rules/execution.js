export function analyzeExecution({
  market = {},
  marketRegime,
  environment,
  emotionCycle,
  primaryTheme,
  leaders,
  modeProfile
}) {
  const actionBias =
    environment.score >= 75 && primaryTheme && leaders.leader && modeProfile.primaryMode !== "防守空仓"
      ? "主动进攻"
      : environment.score >= 50 && primaryTheme && modeProfile.primaryMode !== "防守空仓"
        ? "精选出手"
        : "防守观察";

  const allowedSetups = [];
  const forbiddenSetups = ["追后排跟风", "情绪退潮中的中位接力"];

  if (leaders.leader && emotionCycle.label !== "退潮" && emotionCycle.label !== "冰点" && modeProfile.primaryMode === "连板接力") {
    allowedSetups.push("龙头分歧转一致");
  }
  if (primaryTheme && (primaryTheme.linkageStrength ?? 0) >= 0.6 && ["连板接力", "容量趋势抱团"].includes(modeProfile.primaryMode)) {
    allowedSetups.push("前排换手板确认");
  }
  if ((market.yesterdayStrongFeedback ?? 0) >= 0.2 && environment.score >= 50 && ["容量趋势抱团", "主线低吸回流"].includes(modeProfile.primaryMode)) {
    allowedSetups.push("核心股弱转强");
  }
  if (primaryTheme && (primaryTheme.comebackStrength ?? 0) >= 0.5 && (primaryTheme.nextDayPremiumScore ?? 0) >= 0.45 && ["主线低吸回流", "容量趋势抱团"].includes(modeProfile.primaryMode)) {
    allowedSetups.push("主线回流低吸");
  }
  if ((emotionCycle.label === "启动" || emotionCycle.label === "冰点") && ["首板消息套利", "主线低吸回流"].includes(modeProfile.primaryMode)) {
    allowedSetups.push("冰点修复首个试错点");
  }
  if (modeProfile.primaryMode === "首板消息套利" && (primaryTheme?.newsCatalystStrength ?? 0) >= 0.65) {
    allowedSetups.push("消息首板确认");
  }

  if (environment.score < 50) {
    forbiddenSetups.push("追一致加速板", "临时起意打板");
  }
  if (!primaryTheme) {
    forbiddenSetups.push("非主线套利单");
  }
  if ((market.deepNegativeRatio ?? 0) >= 0.3) {
    forbiddenSetups.push("高位股博弈穿越", "中位情绪接力");
  }
  if (marketRegime.stylePreference === "防守轮动" || modeProfile.primaryMode === "防守空仓") {
    forbiddenSetups.push("无预案主动追涨", "情绪化重仓试错");
  }

  return {
    actionBias,
    allowedSetups: [...new Set(allowedSetups)],
    forbiddenSetups: [...new Set(forbiddenSetups)],
    notes: [
      `主线：${primaryTheme?.name ?? "未识别"}`,
      `龙头：${leaders.leader?.name ?? "未识别"}`,
      `题材龙头：${leaders.themeLeader?.name ?? "未识别"}`,
      `容量核心：${leaders.capacityCores?.map((item) => item.name).join("、") || "未识别"}`,
      `情绪阶段：${emotionCycle.label}`,
      `市场风格：${marketRegime.stylePreference}`,
      `当前模式：${modeProfile.primaryMode}`
    ]
  };
}
