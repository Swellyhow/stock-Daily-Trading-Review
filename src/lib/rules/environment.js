function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function analyzeEnvironment(market = {}, marketRegime = null) {
  const limitUpCount = market.limitUpCount ?? 0;
  const limitDownCount = market.limitDownCount ?? 0;
  const maxBoardHeight = market.maxBoardHeight ?? 0;
  const mainlineConcentration = market.mainlineConcentration ?? 0;
  const brokenBoardRate = market.brokenBoardRate ?? 0.5;
  const yesterdayStrongFeedback = market.yesterdayStrongFeedback ?? 0;
  const highPositionNegativeFeedback = market.highPositionNegativeFeedback ?? 0;
  const avgYesterdayPremiumPct = Number(market.avgYesterdayPremiumPct ?? 0);
  const strongPremiumRatio = Number(market.strongPremiumRatio ?? 0);
  const deepNegativeRatio = Number(market.deepNegativeRatio ?? 0);
  const resonanceScore = Number(marketRegime?.resonanceScore ?? 50);

  let score = 50;
  score += clamp((limitUpCount - 40) * 0.7, -20, 25);
  score -= clamp((limitDownCount - 5) * 1.2, 0, 35);
  score += clamp((maxBoardHeight - 2) * 4, 0, 15);
  score += clamp((mainlineConcentration - 0.3) * 35, -10, 20);
  score -= clamp((brokenBoardRate - 0.2) * 40, 0, 20);
  score += clamp(yesterdayStrongFeedback * 20, -20, 20);
  score -= clamp(highPositionNegativeFeedback * 20, 0, 20);
  score += clamp(avgYesterdayPremiumPct * 1.2, -10, 12);
  score += clamp((strongPremiumRatio - 0.3) * 20, -6, 10);
  score -= clamp(deepNegativeRatio * 18, 0, 12);
  score += clamp((resonanceScore - 50) * 0.25, -8, 10);
  score = Math.round(clamp(score, 0, 100));

  let label = "震荡轮动";
  if (score >= 75) {
    label = "进攻环境";
  } else if (score <= 25) {
    label = "冰点/恐慌";
  } else if (score <= 45) {
    label = "退潮环境";
  }

  return {
    score,
    label,
    canAttack: score >= 60,
    premiumProfile: {
      avgYesterdayPremiumPct: Number(avgYesterdayPremiumPct.toFixed(2)),
      strongPremiumRatio: Number(strongPremiumRatio.toFixed(2)),
      deepNegativeRatio: Number(deepNegativeRatio.toFixed(2))
    },
    reasoning: [
      `涨停${limitUpCount}家，跌停${limitDownCount}家`,
      `连板高度${maxBoardHeight}板，主线集中度${mainlineConcentration.toFixed(2)}`,
      `炸板率${brokenBoardRate.toFixed(2)}，昨日强股反馈${yesterdayStrongFeedback.toFixed(2)}`,
      `昨日平均溢价${avgYesterdayPremiumPct.toFixed(2)}%，强溢价占比${strongPremiumRatio.toFixed(2)}，深负反馈占比${deepNegativeRatio.toFixed(2)}`,
      marketRegime ? `指数共振分${resonanceScore}，风格偏${marketRegime.stylePreference}` : null
    ].filter(Boolean)
  };
}
