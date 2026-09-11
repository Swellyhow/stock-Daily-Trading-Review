function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function modeScore(name, score, reasons, enabled = true) {
  return {
    name,
    score: Math.round(clamp(score, 0, 100)),
    enabled,
    reasons
  };
}

export function analyzeTradingMode({
  market = {},
  marketRegime,
  environment,
  emotionCycle,
  primaryTheme,
  leaders
}) {
  const leaderBoardHeight = Number(leaders?.leader?.boardHeight ?? 0);
  const capacityCoreCount = Number(leaders?.capacityCores?.length ?? 0);
  const midArmyCount = Number(leaders?.midArmy?.length ?? 0);
  const themeLinkage = Number(primaryTheme?.linkageStrength ?? 0);
  const themePremium = Number(primaryTheme?.nextDayPremiumScore ?? 0);
  const themeComeback = Number(primaryTheme?.comebackStrength ?? 0);
  const themeCatalyst = Number(primaryTheme?.newsCatalystStrength ?? 0);
  const strongPremiumRatio = Number(market.strongPremiumRatio ?? 0);
  const deepNegativeRatio = Number(market.deepNegativeRatio ?? 0);
  const yesterdayFeedback = Number(market.yesterdayStrongFeedback ?? 0);
  const relayProfile = Number(market.profitProfiles?.relay?.score ?? 0);
  const lowAbsorbProfile = Number(market.profitProfiles?.lowAbsorb?.score ?? 0);
  const trendProfile = Number(market.profitProfiles?.trend?.score ?? 0);
  const firstBoardProfile = Number(market.profitProfiles?.firstBoard?.score ?? 0);

  const relayReasons = [
    `连板高度 ${leaderBoardHeight} 板`,
    `接力赚钱效应 ${Math.round(relayProfile * 100)}%`,
    `主线联动 ${Math.round(themeLinkage * 100)}%`
  ];
  let relayScore = 15;
  relayScore += environment.score * 0.34;
  relayScore += leaderBoardHeight * 5.5;
  relayScore += strongPremiumRatio * 12;
  relayScore += themeLinkage * 12;
  relayScore += relayProfile * 22;
  relayScore += marketRegime.stylePreference === "连板接力" ? 10 : 0;
  relayScore -= deepNegativeRatio * 24;
  relayScore -= ["冰点", "退潮"].includes(emotionCycle.label) ? 18 : 0;

  const lowAbsorbReasons = [
    `回流能力 ${Math.round(themeComeback * 100)}%`,
    `低吸赚钱效应 ${Math.round(lowAbsorbProfile * 100)}%`,
    `当前阶段 ${emotionCycle.label}`
  ];
  let lowAbsorbScore = 18;
  lowAbsorbScore += themeComeback * 24;
  lowAbsorbScore += themePremium * 10;
  lowAbsorbScore += yesterdayFeedback * 12;
  lowAbsorbScore += lowAbsorbProfile * 26;
  lowAbsorbScore += ["启动", "分歧", "冰点"].includes(emotionCycle.label) ? 12 : 0;
  lowAbsorbScore += marketRegime.stylePreference === "低吸修复" ? 10 : 0;
  lowAbsorbScore -= deepNegativeRatio * 16;

  const trendReasons = [
    `容量核心 ${capacityCoreCount} 个，中军 ${midArmyCount} 个`,
    `趋势赚钱效应 ${Math.round(trendProfile * 100)}%`,
    `指数风格 ${marketRegime.indexState}`
  ];
  let trendScore = 12;
  trendScore += capacityCoreCount * 16;
  trendScore += midArmyCount * 10;
  trendScore += (primaryTheme?.continuityDays ?? 0) * 6;
  trendScore += themeLinkage * 10;
  trendScore += trendProfile * 24;
  trendScore += marketRegime.stylePreference === "容量趋势" ? 16 : 0;
  trendScore += marketRegime.resonanceState !== "背离" ? 8 : -6;
  trendScore -= deepNegativeRatio * 10;

  const firstBoardReasons = [
    `新闻催化 ${Math.round(themeCatalyst * 100)}%`,
    `首板赚钱效应 ${Math.round(firstBoardProfile * 100)}%`,
    `市场风格 ${marketRegime.stylePreference}`
  ];
  let firstBoardScore = 8;
  firstBoardScore += themeCatalyst * 22;
  firstBoardScore += firstBoardProfile * 24;
  firstBoardScore += marketRegime.stylePreference === "首板套利" ? 14 : 0;
  firstBoardScore += emotionCycle.label === "启动" ? 12 : 0;
  firstBoardScore += leaderBoardHeight <= 2 ? 10 : -4;
  firstBoardScore -= deepNegativeRatio * 14;

  const defenseReasons = [
    `环境 ${environment.label}`,
    `深负反馈占比 ${Math.round(deepNegativeRatio * 100)}%`,
    `共振状态 ${marketRegime.resonanceState}`
  ];
  let defenseScore = 10;
  defenseScore += (100 - environment.score) * 0.55;
  defenseScore += deepNegativeRatio * 36;
  defenseScore += ["冰点", "退潮"].includes(emotionCycle.label) ? 18 : 0;
  defenseScore += marketRegime.indexState === "指数与情绪共振走弱" ? 14 : 0;

  const ranked = [
    modeScore("连板接力", relayScore, relayReasons, relayScore >= 45),
    modeScore("主线低吸回流", lowAbsorbScore, lowAbsorbReasons, lowAbsorbScore >= 45),
    modeScore("容量趋势抱团", trendScore, trendReasons, trendScore >= 45),
    modeScore("首板消息套利", firstBoardScore, firstBoardReasons, firstBoardScore >= 45),
    modeScore("防守空仓", defenseScore, defenseReasons, true)
  ].sort((a, b) => b.score - a.score);

  const primaryMode = ranked[0]?.name ?? "防守空仓";
  const activeModes = ranked.filter((item) => item.enabled && item.name !== "防守空仓").slice(0, 3);
  const disabledModes = ranked.filter((item) => !item.enabled || (item.name !== primaryMode && item.score < 45)).map((item) => item.name);

  return {
    primaryMode,
    activeModes,
    disabledModes: [...new Set(disabledModes)],
    ranked,
    summary:
      primaryMode === "防守空仓"
        ? "当前更适合把保护回撤放在第一位，先少做或不做。"
        : `当前更适合围绕 ${primaryMode} 这类打法展开。`
  };
}
