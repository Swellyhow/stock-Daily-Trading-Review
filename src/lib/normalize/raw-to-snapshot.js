function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toRatio(value, fallback = 0) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return fallback;
  }
  return clamp(Number(value), 0, 1);
}

function deriveMainlineConcentration(themes = []) {
  if (themes.length === 0) {
    return 0;
  }

  const totalLimitUp = themes.reduce((sum, theme) => sum + (theme.limitUpCount ?? 0), 0);
  if (totalLimitUp <= 0) {
    return 0;
  }

  const topThemeLimitUp = Math.max(...themes.map((theme) => theme.limitUpCount ?? 0));
  return Number((topThemeLimitUp / totalLimitUp).toFixed(2));
}

function deriveBoardCount(stocks = []) {
  return stocks.filter((stock) => (stock.boardHeight ?? 0) >= 2).length;
}

function deriveMaxBoardHeight(stocks = []) {
  if (stocks.length === 0) {
    return 0;
  }
  return Math.max(...stocks.map((stock) => stock.boardHeight ?? 0));
}

function normalizeTheme(theme = {}) {
  return {
    name: theme.name ?? "Unnamed theme",
    continuityDays: Number(theme.continuityDays ?? 0),
    limitUpCount: Number(theme.limitUpCount ?? 0),
    maxBoardHeight: Number(theme.maxBoardHeight ?? 0),
    hasLeader: Boolean(theme.hasLeader),
    hasMidCap: Boolean(theme.hasMidCap),
    profitEffect: toRatio(theme.profitEffect),
    nextDayPremiumScore: toRatio(theme.nextDayPremiumScore),
    comebackStrength: toRatio(theme.comebackStrength),
    linkageStrength: toRatio(theme.linkageStrength),
    newsCatalystStrength: toRatio(theme.newsCatalystStrength),
    narrativeStrength: toRatio(theme.narrativeStrength),
    narrativeSustainability: toRatio(theme.narrativeSustainability),
    catalystCredibility: toRatio(theme.catalystCredibility),
    premiumProfile: theme.premiumProfile ?? null,
    ladderProfile: theme.ladderProfile ?? null
  };
}

function normalizeStock(stock = {}) {
  return {
    name: stock.name ?? "Unnamed stock",
    code: stock.code ?? null,
    theme: stock.theme ?? "Unclassified",
    boardHeight: Number(stock.boardHeight ?? 0),
    amount: Number(stock.amount ?? 0),
    turnoverPct: Number(stock.turnoverPct ?? 0),
    liquidityScore: toRatio(stock.liquidityScore),
    recognition: toRatio(stock.recognition),
    auctionStrength: toRatio(stock.auctionStrength),
    reboundStrength: toRatio(stock.reboundStrength),
    followThrough: toRatio(stock.followThrough),
    volumeQuality: toRatio(stock.volumeQuality),
    isLeader: Boolean(stock.isLeader),
    isMidPositionRisk: Boolean(stock.isMidPositionRisk),
    isCapacityCoreCandidate: Boolean(stock.isCapacityCoreCandidate)
  };
}

export function normalizeRawInput(raw = {}) {
  const themes = (raw.themes ?? []).map(normalizeTheme);
  const stocks = (raw.stocks ?? []).map(normalizeStock);

  const market = {
    limitUpCount: Number(raw.market?.limitUpCount ?? 0),
    limitDownCount: Number(raw.market?.limitDownCount ?? 0),
    maxBoardHeight: Number(raw.market?.maxBoardHeight ?? deriveMaxBoardHeight(stocks)),
    boardCount: Number(raw.market?.boardCount ?? deriveBoardCount(stocks)),
    mainlineConcentration: toRatio(
      raw.market?.mainlineConcentration,
      deriveMainlineConcentration(themes)
    ),
    brokenBoardRate: toRatio(raw.market?.brokenBoardRate),
    yesterdayStrongFeedback: toRatio(raw.market?.yesterdayStrongFeedback),
    highPositionNegativeFeedback: toRatio(raw.market?.highPositionNegativeFeedback),
    avgYesterdayPremiumPct: Number(raw.market?.avgYesterdayPremiumPct ?? 0),
    strongPremiumRatio: toRatio(raw.market?.strongPremiumRatio),
    deepNegativeRatio: toRatio(raw.market?.deepNegativeRatio),
    profitProfiles: raw.market?.profitProfiles ?? null,
    indexChangePct: raw.market?.indexChangePct !== undefined ? Number(raw.market.indexChangePct) : null,
    growthIndexChangePct: raw.market?.growthIndexChangePct !== undefined ? Number(raw.market.growthIndexChangePct) : null,
    totalTurnoverBn: raw.market?.totalTurnoverBn !== undefined ? Number(raw.market.totalTurnoverBn) : null,
    turnoverDeltaPct: raw.market?.turnoverDeltaPct !== undefined ? Number(raw.market.turnoverDeltaPct) : null,
    largeCapIndexChangePct: raw.market?.largeCapIndexChangePct !== undefined ? Number(raw.market.largeCapIndexChangePct) : null,
    smallCapIndexChangePct: raw.market?.smallCapIndexChangePct !== undefined ? Number(raw.market.smallCapIndexChangePct) : null,
    styleSpreadPct: raw.market?.styleSpreadPct !== undefined ? Number(raw.market.styleSpreadPct) : null,
    growthSpreadPct: raw.market?.growthSpreadPct !== undefined ? Number(raw.market.growthSpreadPct) : null,
    marketDataSource: raw.market?.marketDataSource ?? null
  };

  return {
    date: raw.date ?? null,
    market,
    themes,
    stocks,
    riskContext: raw.riskContext ?? {},
    assumptions: [
      raw.market?.maxBoardHeight === undefined ? "maxBoardHeight derived from stocks" : null,
      raw.market?.boardCount === undefined ? "boardCount derived from stocks" : null,
      raw.market?.mainlineConcentration === undefined
        ? "mainlineConcentration derived from theme limit-up distribution"
        : null
    ].filter(Boolean)
  };
}

