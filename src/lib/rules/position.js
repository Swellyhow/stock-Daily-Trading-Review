export function analyzePosition({
  marketRegime,
  environment,
  emotionCycle,
  primaryTheme,
  leaders,
  modeProfile
}) {
  let totalPosition = "轻仓";
  if (environment.score >= 75 && primaryTheme && leaders.leader && modeProfile.primaryMode !== "防守空仓") {
    totalPosition = "7成仓";
  } else if (environment.score >= 60 && primaryTheme && modeProfile.primaryMode !== "防守空仓") {
    totalPosition = "半仓";
  } else if (environment.score <= 25 || emotionCycle.label === "冰点" || modeProfile.primaryMode === "防守空仓") {
    totalPosition = "空仓";
  }

  const structure =
    totalPosition === "7成仓"
      ? { leaderCore: 0.4, secondaryCore: 0.2, trial: 0.1 }
      : totalPosition === "半仓"
        ? { leaderCore: 0.25, secondaryCore: 0.15, trial: 0.1 }
        : totalPosition === "轻仓"
          ? { leaderCore: 0.1, secondaryCore: 0.1, trial: 0.05 }
          : { leaderCore: 0, secondaryCore: 0, trial: 0 };

  return {
    totalPosition,
    structure,
    retreatSignals: [
      "龙头竞价严重低于预期",
      "高位股批量负反馈",
      "主线不回流",
      "核心股炸板无法回封",
      `市场风格切到 ${marketRegime.stylePreference} 之外的防守状态`
    ],
    addSignals: [
      "龙头超预期",
      "板块联动加强",
      "前排晋级顺畅",
      "赚钱效应扩散",
      "指数与情绪共振增强"
    ]
  };
}
