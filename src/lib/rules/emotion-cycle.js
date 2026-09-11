export function analyzeEmotionCycle(market = {}, environment, marketRegime = null) {
  const limitUpCount = market.limitUpCount ?? 0;
  const maxBoardHeight = market.maxBoardHeight ?? 0;
  const yesterdayStrongFeedback = market.yesterdayStrongFeedback ?? 0;
  const mainlineConcentration = market.mainlineConcentration ?? 0;
  const highPositionNegativeFeedback = market.highPositionNegativeFeedback ?? 0;
  const avgYesterdayPremiumPct = Number(market.avgYesterdayPremiumPct ?? 0);
  const strongPremiumRatio = Number(market.strongPremiumRatio ?? 0);
  const resonanceScore = Number(marketRegime?.resonanceScore ?? 50);

  let label = "分歧";
  if (environment.score <= 25) {
    label = "冰点";
  } else if (environment.score <= 45 || highPositionNegativeFeedback >= 0.6 || avgYesterdayPremiumPct < -1) {
    label = "退潮";
  } else if (
    limitUpCount >= 60 &&
    maxBoardHeight >= 4 &&
    yesterdayStrongFeedback >= 0.5 &&
    mainlineConcentration >= 0.55 &&
    strongPremiumRatio >= 0.45 &&
    resonanceScore >= 58
  ) {
    label = "高潮";
  } else if (
    limitUpCount >= 40 &&
    maxBoardHeight >= 3 &&
    yesterdayStrongFeedback >= 0.2 &&
    avgYesterdayPremiumPct >= 1 &&
    resonanceScore >= 50
  ) {
    label = "发酵";
  } else if (
    limitUpCount >= 20 &&
    yesterdayStrongFeedback >= 0 &&
    highPositionNegativeFeedback <= 0.4 &&
    avgYesterdayPremiumPct >= 0
  ) {
    label = "启动";
  }

  return {
    label,
    reasoning: [
      `环境分${environment.score}`,
      `昨日强股反馈${yesterdayStrongFeedback.toFixed(2)}`,
      `昨日平均溢价${avgYesterdayPremiumPct.toFixed(2)}%`,
      `强溢价占比${strongPremiumRatio.toFixed(2)}`,
      `高位负反馈${highPositionNegativeFeedback.toFixed(2)}`,
      marketRegime ? `指数共振分${resonanceScore}` : null
    ].filter(Boolean)
  };
}
