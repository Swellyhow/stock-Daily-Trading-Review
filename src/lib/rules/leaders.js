function stockScore(stock, primaryThemeName) {
  let score = 0;
  score += (stock.boardHeight ?? 0) * 8;
  score += Math.round((stock.recognition ?? 0) * 20);
  score += Math.round((stock.auctionStrength ?? 0) * 15);
  score += Math.round((stock.reboundStrength ?? 0) * 15);
  score += Math.round((stock.followThrough ?? 0) * 15);
  score += Math.round((stock.volumeQuality ?? 0) * 10);
  score += Math.round((stock.liquidityScore ?? 0) * 12);
  score += stock.isLeader ? 15 : 0;
  score += stock.theme === primaryThemeName ? 10 : 0;
  score -= stock.isMidPositionRisk ? 15 : 0;
  return score;
}

function roleRank(role) {
  return {
    总龙头: 0,
    题材龙头: 1,
    容量核心: 2,
    中军: 3,
    前排核心: 4,
    中位跟随: 5,
    低位补涨: 6,
    后排跟风: 7,
    杂毛: 8
  }[role] ?? 9;
}

function classifyRole(stock, topScore, primaryThemeName, topThemeStocks) {
  const sameTheme = stock.theme === primaryThemeName;
  const boardHeight = stock.boardHeight ?? 0;
  const scoreGap = topScore - stock.score;
  const liquidityScore = stock.liquidityScore ?? 0;
  const volumeQuality = stock.volumeQuality ?? 0;
  const recognition = stock.recognition ?? 0;
  const sameThemeTopScore = topThemeStocks[0]?.score ?? topScore;
  const themeScoreGap = sameThemeTopScore - stock.score;

  if (stock.isLeader || boardHeight >= 5 || scoreGap <= 10) {
    return sameTheme ? "总龙头" : "总龙头";
  }
  if (sameTheme && boardHeight >= 3 && themeScoreGap <= 15) {
    return "题材龙头";
  }
  if (sameTheme && liquidityScore >= 0.65 && recognition >= 0.55 && volumeQuality >= 0.45) {
    return "容量核心";
  }
  if (sameTheme && liquidityScore >= 0.55 && recognition >= 0.45) {
    return "中军";
  }
  if (sameTheme && boardHeight >= 2 && themeScoreGap <= 25) {
    return "前排核心";
  }
  if (sameTheme && boardHeight >= 2) {
    return "中位跟随";
  }
  if (sameTheme && boardHeight <= 1 && recognition >= 0.35) {
    return "低位补涨";
  }
  if (!sameTheme && recognition >= 0.45 && liquidityScore >= 0.45) {
    return "后排跟风";
  }
  return "杂毛";
}

export function analyzeLeaders(stocks, primaryThemeName) {
  const ranked = stocks
    .map((stock) => ({
      ...stock,
      score: stockScore(stock, primaryThemeName)
    }))
    .sort((a, b) => b.score - a.score);

  const topScore = ranked[0]?.score ?? 0;
  const topThemeStocks = ranked.filter((stock) => stock.theme === primaryThemeName);
  const withRole = ranked
    .map((stock) => ({
      ...stock,
      role: classifyRole(stock, topScore, primaryThemeName, topThemeStocks)
    }))
    .sort((a, b) => {
      if (roleRank(a.role) !== roleRank(b.role)) {
        return roleRank(a.role) - roleRank(b.role);
      }
      return b.score - a.score;
    });

  const leader = withRole.find((stock) => stock.role === "总龙头") ?? withRole[0] ?? null;
  const themeLeader = withRole.find((stock) => stock.role === "题材龙头") ?? leader;
  const capacityCores = withRole.filter((stock) => stock.role === "容量核心").slice(0, 3);
  const midArmy = withRole.filter((stock) => stock.role === "中军").slice(0, 3);
  const corePool = withRole.filter((stock) => ["总龙头", "题材龙头", "容量核心", "前排核心"].includes(stock.role)).slice(0, 5);
  const turnoverCandidates = withRole
    .filter((stock) => ["前排核心", "容量核心"].includes(stock.role) && (stock.reboundStrength ?? 0) >= 0.4)
    .slice(0, 4);
  const lowPositionCandidates = withRole.filter((stock) => stock.role === "低位补涨").slice(0, 3);
  const junkStocks = withRole.filter((stock) => stock.role === "杂毛").slice(0, 5);
  const riskyNames = withRole
    .filter((stock) => ["中位跟随", "后排跟风", "杂毛"].includes(stock.role) || stock.isMidPositionRisk || (stock.followThrough ?? 0) <= 0.2)
    .map((stock) => stock.name);

  return {
    leader,
    themeLeader,
    capacityCores,
    midArmy,
    corePool,
    turnoverCandidates,
    lowPositionCandidates,
    junkStocks,
    riskyNames,
    ranked: withRole
  };
}
