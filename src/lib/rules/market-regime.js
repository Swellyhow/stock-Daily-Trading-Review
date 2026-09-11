function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value, fallback = null) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return fallback;
  }
  return Number(value);
}

function inferIndexChangeFromBreadth(market = {}) {
  const limitUpCount = Number(market.limitUpCount ?? 0);
  const limitDownCount = Number(market.limitDownCount ?? 0);
  const boardCount = Number(market.boardCount ?? 0);
  return Number(clamp((limitUpCount - limitDownCount) / 24 + (boardCount - 4) * 0.12, -2.5, 2.5).toFixed(2));
}

function inferGrowthIndexChange(market = {}) {
  const maxBoardHeight = Number(market.maxBoardHeight ?? 0);
  const strongPremiumRatio = Number(market.strongPremiumRatio ?? 0);
  const deepNegativeRatio = Number(market.deepNegativeRatio ?? 0);
  return Number(clamp((maxBoardHeight - 3) * 0.35 + strongPremiumRatio * 1.8 - deepNegativeRatio * 1.2, -2.8, 2.8).toFixed(2));
}

function inferTurnoverDelta(market = {}) {
  const limitUpCount = Number(market.limitUpCount ?? 0);
  const limitDownCount = Number(market.limitDownCount ?? 0);
  const brokenBoardRate = Number(market.brokenBoardRate ?? 0);
  return Number(clamp((limitUpCount - 35) * 0.35 - Math.max(limitDownCount - 8, 0) * 0.25 - brokenBoardRate * 12, -18, 18).toFixed(2));
}

function inferTurnoverBn(market = {}) {
  const boardCount = Number(market.boardCount ?? 0);
  const maxBoardHeight = Number(market.maxBoardHeight ?? 0);
  const limitUpCount = Number(market.limitUpCount ?? 0);
  return Number(Math.max(650, 760 + limitUpCount * 4.5 + boardCount * 12 + Math.max(maxBoardHeight - 2, 0) * 18).toFixed(2));
}

function buildVolumeState(turnoverDeltaPct) {
  if (turnoverDeltaPct >= 8) {
    return "放量";
  }
  if (turnoverDeltaPct <= -8) {
    return "缩量";
  }
  return "平量";
}

function buildIndexState(broadIndexChangePct, growthIndexChangePct) {
  if (broadIndexChangePct >= 0.6 && growthIndexChangePct >= 0.8) {
    return "指数与情绪共振走强";
  }
  if (broadIndexChangePct <= -0.6 && growthIndexChangePct <= -0.8) {
    return "指数与情绪共振走弱";
  }
  if (broadIndexChangePct >= 0.4 && growthIndexChangePct < 0.2) {
    return "权重偏强，情绪偏弱";
  }
  if (broadIndexChangePct < 0.2 && growthIndexChangePct >= 0.5) {
    return "情绪股强于指数";
  }
  return "指数中性";
}

function buildResonanceState(broadIndexChangePct, growthIndexChangePct, volumeState) {
  const spread = Math.abs(broadIndexChangePct - growthIndexChangePct);
  if (spread <= 0.35 && broadIndexChangePct >= 0.4 && volumeState === "放量") {
    return "强共振";
  }
  if (spread <= 0.5 && broadIndexChangePct > -0.3 && growthIndexChangePct > -0.3) {
    return "弱共振";
  }
  return "背离";
}

function buildStyleState(styleSpreadPct, growthSpreadPct) {
  if (styleSpreadPct === null || styleSpreadPct === undefined) {
    return "风格中性";
  }
  if (styleSpreadPct >= 0.6 && (growthSpreadPct ?? 0) >= 0) {
    return "小票成长占优";
  }
  if (styleSpreadPct <= -0.6) {
    return "权重大票占优";
  }
  return "风格中性";
}

function buildStylePreference(market = {}, broadIndexChangePct, growthIndexChangePct, styleSpreadPct, growthSpreadPct) {
  const maxBoardHeight = Number(market.maxBoardHeight ?? 0);
  const boardCount = Number(market.boardCount ?? 0);
  const strongPremiumRatio = Number(market.strongPremiumRatio ?? 0);
  const deepNegativeRatio = Number(market.deepNegativeRatio ?? 0);
  const comebackStrengthHint = Number(market.yesterdayStrongFeedback ?? 0);
  const profitProfiles = market.profitProfiles ?? {};

  if ((profitProfiles.relay?.score ?? 0) >= 0.55 && maxBoardHeight >= 4 && boardCount >= 6 && strongPremiumRatio >= 0.35 && (styleSpreadPct ?? 0) >= 0.2 && growthIndexChangePct >= 0.2) {
    return "连板接力";
  }
  if ((profitProfiles.trend?.score ?? 0) >= 0.52 && growthIndexChangePct >= 0.25 && broadIndexChangePct >= -0.1 && (growthSpreadPct ?? 0) >= -0.2) {
    return "容量趋势";
  }
  if ((profitProfiles.lowAbsorb?.score ?? 0) >= 0.5 && deepNegativeRatio >= 0.12 && comebackStrengthHint >= 0.15) {
    return "低吸修复";
  }
  if ((profitProfiles.firstBoard?.score ?? 0) >= 0.45 && maxBoardHeight <= 2 && strongPremiumRatio < 0.25) {
    return "首板套利";
  }
  return "防守轮动";
}

export function analyzeMarketRegime(market = {}) {
  const rawBroadIndex = normalizeNumber(market.indexChangePct);
  const rawGrowthIndex = normalizeNumber(market.growthIndexChangePct);
  const rawTurnoverDelta = normalizeNumber(market.turnoverDeltaPct);
  const rawTurnoverBn = normalizeNumber(market.totalTurnoverBn);
  const rawLargeCap = normalizeNumber(market.largeCapIndexChangePct);
  const rawSmallCap = normalizeNumber(market.smallCapIndexChangePct);
  const rawStyleSpread = normalizeNumber(market.styleSpreadPct);
  const rawGrowthSpread = normalizeNumber(market.growthSpreadPct);

  const broadIndexChangePct = rawBroadIndex ?? inferIndexChangeFromBreadth(market);
  const growthIndexChangePct = rawGrowthIndex ?? inferGrowthIndexChange(market);
  const turnoverDeltaPct = rawTurnoverDelta ?? inferTurnoverDelta(market);
  const totalTurnoverBn = rawTurnoverBn ?? inferTurnoverBn(market);
  const largeCapIndexChangePct = rawLargeCap ?? broadIndexChangePct;
  const smallCapIndexChangePct = rawSmallCap ?? growthIndexChangePct;
  const styleSpreadPct = rawStyleSpread ?? Number((smallCapIndexChangePct - largeCapIndexChangePct).toFixed(2));
  const growthSpreadPct = rawGrowthSpread ?? Number((growthIndexChangePct - largeCapIndexChangePct).toFixed(2));
  const volumeState = buildVolumeState(turnoverDeltaPct);
  const indexState = buildIndexState(broadIndexChangePct, growthIndexChangePct);
  const resonanceState = buildResonanceState(broadIndexChangePct, growthIndexChangePct, volumeState);
  const styleState = buildStyleState(styleSpreadPct, growthSpreadPct);
  const stylePreference = buildStylePreference(market, broadIndexChangePct, growthIndexChangePct, styleSpreadPct, growthSpreadPct);

  let resonanceScore = 50;
  resonanceScore += clamp(broadIndexChangePct * 10, -20, 20);
  resonanceScore += clamp(growthIndexChangePct * 12, -22, 22);
  resonanceScore += clamp(turnoverDeltaPct * 0.8, -12, 12);
  resonanceScore += clamp(styleSpreadPct * 6, -8, 8);
  resonanceScore += resonanceState === "强共振" ? 10 : resonanceState === "弱共振" ? 4 : -8;
  resonanceScore = Math.round(clamp(resonanceScore, 0, 100));

  return {
    broadIndexChangePct,
    growthIndexChangePct,
    totalTurnoverBn,
    turnoverDeltaPct,
    largeCapIndexChangePct,
    smallCapIndexChangePct,
    styleSpreadPct,
    growthSpreadPct,
    volumeState,
    indexState,
    resonanceState,
    resonanceScore,
    styleState,
    stylePreference,
    dataSource: market.marketDataSource ?? "derived-from-market-structure",
    estimatedFields: {
      indexChangePct: rawBroadIndex === null,
      growthIndexChangePct: rawGrowthIndex === null,
      turnoverDeltaPct: rawTurnoverDelta === null,
      totalTurnoverBn: rawTurnoverBn === null,
      largeCapIndexChangePct: rawLargeCap === null,
      smallCapIndexChangePct: rawSmallCap === null,
      styleSpreadPct: rawStyleSpread === null,
      growthSpreadPct: rawGrowthSpread === null
    },
    reasoning: [
      `指数变化 ${broadIndexChangePct.toFixed(2)}%，成长风格 ${growthIndexChangePct.toFixed(2)}%`,
      `大票 ${largeCapIndexChangePct.toFixed(2)}%，小票 ${smallCapIndexChangePct.toFixed(2)}%，风格差 ${styleSpreadPct.toFixed(2)}%`,
      `量能状态 ${volumeState}，成交额 ${totalTurnoverBn} 亿，量能变化 ${turnoverDeltaPct.toFixed(2)}%`,
      `指数状态 ${indexState}，共振状态 ${resonanceState}，风格状态 ${styleState}`,
      `当前更匹配的市场风格是 ${stylePreference}`,
      `数据源 ${market.marketDataSource ?? "市场结构推导"}`
    ]
  };
}
