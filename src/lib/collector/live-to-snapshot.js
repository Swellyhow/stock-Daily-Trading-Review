function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupByIndustry(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.industry || "未知行业";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}

function dedupeNewsItems(items = []) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const title = item?.title ?? "";
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);
    merged.push(item);
  }
  return merged;
}

function eventTypeWeight(eventType) {
  return {
    policy: 1,
    announcement: 0.92,
    "industry-chain": 0.88,
    earnings: 0.82,
    flow: 0.5,
    general: 0.35,
    none: 0
  }[eventType] ?? 0.35;
}

function sentimentWeight(sentiment) {
  return {
    bullish: 1,
    neutral: 0.55,
    bearish: 0.2
  }[sentiment] ?? 0.55;
}

function durationWeight(duration) {
  return {
    medium: 1,
    short: 0.9,
    "one-off": 0.72
  }[duration] ?? 0.72;
}

function getMxCatalystBoost(themeName, mxContext) {
  const matched = (mxContext?.themeCatalysts ?? []).find((item) => item.theme === themeName);
  return matched?.catalystScore ?? 0;
}

function getLlmCatalyst(themeName, newsAnalysis) {
  return (newsAnalysis?.themeCatalysts ?? []).find((item) => item.theme === themeName) ?? null;
}

function getWeightedLlmBoost(catalyst) {
  if (!catalyst) {
    return 0;
  }
  return clamp(
    Number(catalyst.strength ?? 0) * eventTypeWeight(catalyst.eventType) * sentimentWeight(catalyst.sentiment) * durationWeight(catalyst.duration),
    0,
    1
  );
}

function buildNarrativeMetrics(llmCatalyst, mxCatalystBoost, continuityDays) {
  const llmBoost = getWeightedLlmBoost(llmCatalyst);
  const credibility = clamp(
    (llmCatalyst?.isCatalyst ? 0.45 : 0) +
      (Array.isArray(llmCatalyst?.headlineIds) ? Math.min(llmCatalyst.headlineIds.length / 3, 0.25) : 0) +
      mxCatalystBoost * 0.3,
    0,
    1
  );
  const narrativeStrength = clamp(llmBoost * 0.7 + mxCatalystBoost * 0.3, 0, 1);
  const sustainability = clamp(
    narrativeStrength * 0.45 +
      durationWeight(llmCatalyst?.duration) * 0.3 +
      Math.min((continuityDays ?? 0) / 3, 1) * 0.25,
    0,
    1
  );

  return {
    llmBoost,
    narrativeStrength: Number(narrativeStrength.toFixed(2)),
    narrativeSustainability: Number(sustainability.toFixed(2)),
    catalystCredibility: Number(credibility.toFixed(2))
  };
}

function buildPremiumMetrics(items = []) {
  if (items.length === 0) {
    return {
      avgPremiumPct: 0,
      positiveRatio: 0,
      strongPremiumRatio: 0,
      deepNegativeRatio: 0,
      premiumScore: 0
    };
  }

  const avgPremiumPct = average(items.map((item) => Number(item.changePct ?? 0)));
  const positiveRatio = items.filter((item) => Number(item.changePct ?? 0) > 0).length / items.length;
  const strongPremiumRatio = items.filter((item) => Number(item.changePct ?? 0) >= 3).length / items.length;
  const deepNegativeRatio = items.filter((item) => Number(item.changePct ?? 0) <= -5).length / items.length;
  const normalizedPremium = clamp((avgPremiumPct + 2) / 7, 0, 1);
  const premiumScore = clamp(positiveRatio * 0.45 + strongPremiumRatio * 0.35 + normalizedPremium * 0.2 - deepNegativeRatio * 0.15, 0, 1);

  return {
    avgPremiumPct: Number(avgPremiumPct.toFixed(2)),
    positiveRatio: Number(positiveRatio.toFixed(2)),
    strongPremiumRatio: Number(strongPremiumRatio.toFixed(2)),
    deepNegativeRatio: Number(deepNegativeRatio.toFixed(2)),
    premiumScore: Number(premiumScore.toFixed(2))
  };
}

function parseLimitTime(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const raw = String(value).padStart(6, "0").slice(0, 6);
  const hour = Number(raw.slice(0, 2));
  const minute = Number(raw.slice(2, 4));
  return hour * 60 + minute;
}

function sealRatio(item = {}) {
  const amount = Number(item.amount ?? 0);
  const sealAmount = Number(item.sealAmount ?? 0);
  if (amount <= 0 || sealAmount <= 0) {
    return 0;
  }
  return clamp(sealAmount / amount, 0, 1);
}

function selectAmountThreshold(items = []) {
  const amounts = items
    .map((item) => Number(item.amount ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (amounts.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.floor(amounts.length * 0.7) - 1);
  return amounts[index];
}

function buildProfitProfile(name, items = [], scoreBuilder = null) {
  const metrics = buildPremiumMetrics(items);
  const score = scoreBuilder ? clamp(scoreBuilder(metrics, items), 0, 1) : metrics.premiumScore;
  return {
    name,
    sampleCount: items.length,
    ...metrics,
    score: Number(score.toFixed(2))
  };
}

function buildProfitProfiles(previousLimitUpPool = []) {
  const amountThreshold = selectAmountThreshold(previousLimitUpPool);
  const relayItems = previousLimitUpPool.filter((item) => Number(item.boardCount ?? 0) >= 2);
  const firstBoardItems = previousLimitUpPool.filter((item) => Number(item.boardCount ?? 0) <= 1);
  const trendItems = previousLimitUpPool.filter((item) => Number(item.amount ?? 0) >= amountThreshold && amountThreshold > 0);
  const lowAbsorbItems = previousLimitUpPool.filter((item) => {
    const changePct = Number(item.changePct ?? 0);
    return changePct > -2 && changePct < 3;
  });

  const relay = buildProfitProfile("连板接力", relayItems, (metrics) => metrics.premiumScore * 0.7 + metrics.strongPremiumRatio * 0.3);
  const lowAbsorb = buildProfitProfile("低吸修复", lowAbsorbItems, (metrics, items) => {
    const neutralBandRatio = items.length === 0 ? 0 : items.filter((item) => Number(item.changePct ?? 0) >= -1 && Number(item.changePct ?? 0) <= 2).length / items.length;
    return metrics.positiveRatio * 0.35 + neutralBandRatio * 0.35 + metrics.premiumScore * 0.3;
  });
  const trend = buildProfitProfile("容量趋势", trendItems, (metrics) => metrics.positiveRatio * 0.35 + metrics.strongPremiumRatio * 0.2 + metrics.premiumScore * 0.45);
  const firstBoard = buildProfitProfile("首板套利", firstBoardItems, (metrics) => metrics.positiveRatio * 0.3 + metrics.strongPremiumRatio * 0.4 + metrics.premiumScore * 0.3);

  return {
    relay,
    lowAbsorb,
    trend,
    firstBoard,
    ranked: [relay, lowAbsorb, trend, firstBoard].sort((a, b) => b.score - a.score)
  };
}

function buildStructuredLadder(items = []) {
  const amountThreshold = selectAmountThreshold(items);
  const maxBoardHeight = Math.max(...[0, ...items.map((item) => Number(item.boardCount ?? 0))]);
  const leaderCandidates = items.filter((item) => Number(item.boardCount ?? 0) === maxBoardHeight && maxBoardHeight >= 3);
  const leaderCount = leaderCandidates.length;
  const frontCount = items.filter((item) => Number(item.boardCount ?? 0) >= Math.max(maxBoardHeight - 1, 3)).length;
  const midCount = items.filter((item) => {
    const boardHeight = Number(item.boardCount ?? 0);
    return boardHeight >= 2 && boardHeight < Math.max(maxBoardHeight - 1, 3);
  }).length;
  const lowCount = items.filter((item) => Number(item.boardCount ?? 0) <= 1).length;
  const capacityCount = items.filter((item) => Number(item.amount ?? 0) >= amountThreshold && amountThreshold > 0).length;
  const earlyLeaderCount = leaderCandidates.filter((item) => {
    const firstTime = parseLimitTime(item.firstLimitTime);
    return firstTime !== null && firstTime <= 9 * 60 + 40;
  }).length;
  const leaderSealStrength = leaderCandidates.length === 0 ? 0 : average(leaderCandidates.map((item) => sealRatio(item)));
  const frontSealStrength = frontCount === 0
    ? 0
    : average(items.filter((item) => Number(item.boardCount ?? 0) >= Math.max(maxBoardHeight - 1, 3)).map((item) => sealRatio(item)));
  const leaderDriveScore = clamp(
    (leaderCount > 0 ? 0.32 : 0) +
      (earlyLeaderCount > 0 ? 0.18 : 0) +
      Math.min(frontCount / 3, 1) * 0.18 +
      leaderSealStrength * 0.16 +
      frontSealStrength * 0.16,
    0,
    1
  );
  const lowSpreadScore = clamp(
    Math.min(lowCount / 4, 1) * 0.42 +
      Math.min(capacityCount / 3, 1) * 0.22 +
      (frontCount > 0 ? 0.18 : 0) +
      (midCount > 0 ? 0.18 : 0),
    0,
    1
  );
  const falseBreakoutRisk = clamp(
    (lowCount >= 3 && leaderCount === 0 ? 0.42 : 0) +
      (lowCount > frontCount + midCount + 1 ? 0.22 : 0) +
      (frontCount === 0 ? 0.18 : 0) +
      (capacityCount === 0 ? 0.1 : 0) +
      (leaderDriveScore <= 0.35 ? 0.12 : 0),
    0,
    1
  );
  const midRiskScore = clamp(
    (midCount >= Math.max(frontCount, 1) && maxBoardHeight <= 4 ? 0.34 : 0) +
      (midCount > frontCount + 1 ? 0.18 : 0) +
      (leaderDriveScore <= 0.4 ? 0.18 : 0) +
      (falseBreakoutRisk >= 0.45 ? 0.12 : 0) +
      (items.some((item) => Number(item.boardCount ?? 0) === 2 && Number(item.brokenCount ?? 0) > 0) ? 0.1 : 0),
    0,
    1
  );

  const structureScore = clamp(
    leaderDriveScore * 0.38 +
      lowSpreadScore * 0.22 +
      Math.min(capacityCount / 3, 1) * 0.16 +
      (midCount > 0 ? 0.14 : 0) +
      (frontCount > 0 ? 0.1 : 0) -
      falseBreakoutRisk * 0.18 -
      midRiskScore * 0.12,
    0,
    1
  );

  let completenessLabel = "不足";
  if (structureScore >= 0.72 && falseBreakoutRisk <= 0.4) {
    completenessLabel = "完整";
  } else if (structureScore >= 0.48) {
    completenessLabel = "一般";
  }

  const interpretation =
    falseBreakoutRisk >= 0.58 ? "低位扩散较多，但核心不带动，属于假扩散风险。" :
    midRiskScore >= 0.58 ? "中位承接层拥挤，情绪稍弱就容易先杀中位。" :
    leaderDriveScore >= 0.62 && lowSpreadScore >= 0.5 ? "龙头带动明确，前中低位协同扩散，梯队较健康。" :
    leaderDriveScore >= 0.48 ? "龙头有一定带动，但扩散质量一般，仍需盘中确认。" :
    "梯队结构偏弱，更像局部活跃，不像完整主升结构。";

  return {
    maxBoardHeight,
    leaderCount,
    frontCount,
    midCount,
    lowCount,
    capacityCount,
    leaderDriveScore: Number(leaderDriveScore.toFixed(2)),
    lowSpreadScore: Number(lowSpreadScore.toFixed(2)),
    falseBreakoutRisk: Number(falseBreakoutRisk.toFixed(2)),
    midRiskScore: Number(midRiskScore.toFixed(2)),
    structureScore: Number(structureScore.toFixed(2)),
    completenessLabel,
    interpretation
  };
}

function buildThemes(limitUpPool, previousLimitUpPool, conceptBoards, mxContext, newsAnalysis) {
  const currentGroups = groupByIndustry(limitUpPool);
  const previousGroups = groupByIndustry(previousLimitUpPool);
  const maxIndustryLimitUps = Math.max(...[1, ...[...currentGroups.values()].map((items) => items.length)]);

  const conceptThemeMap = new Map(
    (conceptBoards ?? []).map((item) => {
      const continuityDays = 1;
      const mxCatalystBoost = getMxCatalystBoost(item.name, mxContext);
      const llmCatalyst = getLlmCatalyst(item.name, newsAnalysis);
      const llmCatalystBoost = getWeightedLlmBoost(llmCatalyst);
      const narrative = buildNarrativeMetrics(llmCatalyst, mxCatalystBoost, continuityDays);
      const baseProfitEffect = clamp((item.changePct ?? 0) / 10, 0, 1);
      return [item.name, {
        name: item.name,
        continuityDays,
        limitUpCount: 0,
        maxBoardHeight: 1,
        hasLeader: Boolean(item.leaderName),
        hasMidCap: item.changePct >= 2,
        profitEffect: baseProfitEffect,
        nextDayPremiumScore: baseProfitEffect,
        comebackStrength: clamp(baseProfitEffect * 0.5 + llmCatalystBoost * 0.5, 0, 1),
        linkageStrength: clamp((item.changePct ?? 0) / 6, 0, 1),
        newsCatalystStrength: clamp(Math.max(mxCatalystBoost, llmCatalystBoost), 0, 1),
        narrativeStrength: narrative.narrativeStrength,
        narrativeSustainability: narrative.narrativeSustainability,
        catalystCredibility: narrative.catalystCredibility,
        catalystSentiment: llmCatalyst?.sentiment ?? null,
        catalystEventType: llmCatalyst?.eventType ?? null,
        catalystReason: llmCatalyst?.reason ?? "",
        catalystDetailedReason: llmCatalyst?.detailedReason ?? "",
        catalystDecisionImpact: llmCatalyst?.decisionImpact ?? "",
        catalystRiskNote: llmCatalyst?.riskNote ?? "",
        source: "concept-board",
        mxCatalystBoost,
        llmCatalystBoost,
        rawLlmCatalystStrength: llmCatalyst?.strength ?? 0,
        premiumProfile: buildPremiumMetrics([]),
        ladderProfile: {
          leaderCount: 0,
          frontCount: 0,
          midCount: 0,
          lowCount: 0,
          capacityCount: 0,
          structureScore: 0,
          completenessLabel: "不足"
        }
      }];
    })
  );

  for (const [industry, items] of currentGroups.entries()) {
    const continuityDays = previousGroups.has(industry) ? 2 : 1;
    const boardHeights = items.map((item) => item.boardCount ?? 0);
    const currentChangeScore = clamp(average(items.map((item) => (item.changePct ?? 0) / 10)), 0, 1);
    const linkageStrength = clamp(items.length / maxIndustryLimitUps * 0.55 + items.length / Math.max(limitUpPool.length, 1) * 1.2, 0, 1);
    const previousMetrics = buildPremiumMetrics(previousGroups.get(industry) ?? []);
    const mxCatalystBoost = getMxCatalystBoost(industry, mxContext);
    const llmCatalyst = getLlmCatalyst(industry, newsAnalysis);
    const llmCatalystBoost = getWeightedLlmBoost(llmCatalyst);
    const narrative = buildNarrativeMetrics(llmCatalyst, mxCatalystBoost, continuityDays);
    const ladderProfile = buildStructuredLadder(items);
    const profitEffect = clamp(
      currentChangeScore * 0.2 +
        previousMetrics.positiveRatio * 0.2 +
        previousMetrics.strongPremiumRatio * 0.2 +
        previousMetrics.premiumScore * 0.15 +
        ladderProfile.structureScore * 0.15 +
        narrative.narrativeStrength * 0.1 -
        previousMetrics.deepNegativeRatio * 0.15,
      0,
      1
    );
    const nextDayPremiumScore = clamp(
      previousMetrics.positiveRatio * 0.45 + previousMetrics.strongPremiumRatio * 0.35 + previousMetrics.premiumScore * 0.2,
      0,
      1
    );
    const comebackStrength = clamp(
      (previousGroups.has(industry) ? 0.18 : 0) +
        linkageStrength * 0.24 +
        nextDayPremiumScore * 0.2 +
        llmCatalystBoost * 0.16 +
        (ladderProfile.midCount > 0 ? 0.12 : 0),
      0,
      1
    );

    const candidate = {
      name: industry,
      continuityDays,
      limitUpCount: items.length,
      maxBoardHeight: Math.max(...boardHeights, 0),
      hasLeader: ladderProfile.leaderCount > 0 || Math.max(...boardHeights, 0) >= 2,
      hasMidCap: ladderProfile.midCount > 0 || items.length >= 2,
      profitEffect,
      nextDayPremiumScore,
      comebackStrength,
      linkageStrength,
      newsCatalystStrength: clamp(Math.max(mxCatalystBoost, llmCatalystBoost), 0, 1),
      narrativeStrength: narrative.narrativeStrength,
      narrativeSustainability: narrative.narrativeSustainability,
      catalystCredibility: narrative.catalystCredibility,
      catalystSentiment: llmCatalyst?.sentiment ?? null,
      catalystEventType: llmCatalyst?.eventType ?? null,
      catalystReason: llmCatalyst?.reason ?? "",
      catalystDetailedReason: llmCatalyst?.detailedReason ?? "",
      catalystDecisionImpact: llmCatalyst?.decisionImpact ?? "",
      catalystRiskNote: llmCatalyst?.riskNote ?? "",
      source: "limit-up-industry",
      mxCatalystBoost,
      llmCatalystBoost,
      rawLlmCatalystStrength: llmCatalyst?.strength ?? 0,
      premiumProfile: previousMetrics,
      ladderProfile
    };

    const existing = conceptThemeMap.get(industry);
    if (!existing || candidate.limitUpCount > existing.limitUpCount) {
      conceptThemeMap.set(industry, candidate);
    }
  }

  return [...conceptThemeMap.values()].sort((a, b) => {
    if (b.limitUpCount !== a.limitUpCount) {
      return b.limitUpCount - a.limitUpCount;
    }
    return b.linkageStrength - a.linkageStrength;
  });
}

function buildStocks(limitUpPool, previousLimitUpPool, themes, screenedStocks = [], conceptBoards = []) {
  const topThemeNames = new Set((themes ?? []).slice(0, 5).map((item) => item.name));
  const screenedMap = new Map((screenedStocks ?? []).filter((item) => item?.name).map((item) => [item.name, item]));
  const previousMap = new Map((previousLimitUpPool ?? []).filter((item) => item?.name).map((item) => [item.name, item]));
  const leaderNameSet = new Set((conceptBoards ?? []).map((item) => item?.leaderName).filter(Boolean));
  const candidateMap = new Map();

  for (const item of limitUpPool ?? []) {
    if (item?.name) {
      candidateMap.set(item.name, {
        ...item,
        source: "limit-up-pool"
      });
    }
  }

  for (const item of screenedStocks ?? []) {
    if (!item?.name) {
      continue;
    }
    const existing = candidateMap.get(item.name) ?? {};
    candidateMap.set(item.name, {
      ...existing,
      code: existing.code ?? item.code ?? "",
      name: item.name,
      industry: existing.industry ?? item.theme ?? item.market ?? "未知行业",
      changePct: existing.changePct ?? item.changePct ?? 0,
      amount: existing.amount ?? item.amount ?? 0,
      turnoverPct: existing.turnoverPct ?? item.turnoverPct ?? 0,
      boardCount: existing.boardCount ?? 0,
      sealAmount: existing.sealAmount ?? 0,
      brokenCount: existing.brokenCount ?? 0,
      source: existing.source ? `${existing.source}+mx-screen` : "mx-screen"
    });
  }

  for (const item of previousLimitUpPool ?? []) {
    if (!item?.name || candidateMap.has(item.name)) {
      continue;
    }
    candidateMap.set(item.name, {
      ...item,
      source: "previous-limit-up"
    });
  }

  const candidateStocks = [...candidateMap.values()];
  const maxAmount = Math.max(...[1, ...candidateStocks.map((item) => Number(item.amount ?? 0))]);
  const maxTurnover = Math.max(...[1, ...candidateStocks.map((item) => Number(item.turnoverPct ?? 0))]);

  return candidateStocks
    .sort((a, b) => {
      if ((b.boardCount ?? 0) !== (a.boardCount ?? 0)) {
        return (b.boardCount ?? 0) - (a.boardCount ?? 0);
      }
      if ((b.amount ?? 0) !== (a.amount ?? 0)) {
        return (b.amount ?? 0) - (a.amount ?? 0);
      }
      return (b.sealAmount ?? 0) - (a.sealAmount ?? 0);
    })
    .map((item, index) => {
      const screened = screenedMap.get(item.name);
      const previousStrong = previousMap.get(item.name);
      const boardHeight = Number(item.boardCount ?? 0);
      const changePct = Number(item.changePct ?? 0);
      const screenBoost = screened ? 0.08 : 0;
      const conceptLeaderBoost = leaderNameSet.has(item.name) ? 0.08 : 0;
      const liquidityScore = clamp((Number(item.amount ?? 0) / maxAmount) * 0.7 + (Number(item.turnoverPct ?? 0) / maxTurnover) * 0.3, 0, 1);
      return {
        name: item.name,
        code: item.code,
        theme: item.industry || screened?.theme || "未知行业",
        boardHeight,
        amount: Number(item.amount ?? 0),
        turnoverPct: Number(item.turnoverPct ?? 0),
        changePct,
        liquidityScore,
        recognition: clamp(0.2 + boardHeight * 0.12 + (index === 0 ? 0.15 : 0) + screenBoost + conceptLeaderBoost + (previousStrong ? 0.06 : 0), 0, 1),
        auctionStrength: clamp(changePct / 10, 0, 1),
        reboundStrength: clamp(1 - Math.min(item.brokenCount ?? 0, 3) * 0.2, 0, 1),
        followThrough: clamp((changePct + 10) / 20 + screenBoost + (previousStrong ? 0.05 : 0), 0, 1),
        volumeQuality: clamp((item.turnoverPct ?? 0) / 25 + liquidityScore * 0.2 + screenBoost, 0, 1),
        isLeader: index === 0 || boardHeight >= 3 || leaderNameSet.has(item.name),
        isMidPositionRisk: boardHeight === 2 && (item.brokenCount ?? 0) >= 1,
        isThemeAligned: topThemeNames.has(item.industry || screened?.theme || ""),
        isCapacityCoreCandidate: liquidityScore >= 0.6 || (screened && Number(screened.amount ?? 0) > 0),
        mxScreened: Boolean(screened),
        source: item.source ?? "unknown"
      };
    });
}

function buildDataQuality(state, themes, stocks) {
  const warnings = [];
  let confidence = 0.85;

  if (state.dataQuality?.warning) {
    warnings.push(state.dataQuality.warning);
    confidence -= state.dataQuality.limitPoolsTrusted === false ? 0.35 : 0.1;
  }
  if (state.dataSources?.limitUpPool || state.dataSources?.limitDownPool) {
    warnings.push(`涨跌停池来源：${state.dataSources.limitUpPool}；${state.dataSources.limitDownPool}`);
  }

  if ((state.limitUpPool ?? []).length === 0) {
    warnings.push("涨停池为空，主线判断可信度很低");
    confidence -= 0.45;
  }
  if ((state.previousLimitUpPool ?? []).length === 0) {
    warnings.push("昨日涨停池为空，昨日强股反馈采用弱近似");
    confidence -= 0.15;
  }
  if ((state.conceptBoards ?? []).length === 0) {
    warnings.push("概念板块热度缺失，主线识别退化为行业聚合");
    confidence -= 0.15;
  }
  if ((state.clsNews ?? []).length === 0) {
    warnings.push("财联社新闻缺失，题材催化强度无法可靠估计");
    confidence -= 0.1;
  }
  if (!state.marketIndices) {
    warnings.push("真实指数与成交额数据缺失，市场风格判断会保守处理");
    confidence -= 0.08;
  }
  if (themes.length === 0) {
    warnings.push("未形成有效题材候选，建议只把结果作为观察参考");
    confidence -= 0.2;
  }
  if (stocks.length < 3) {
    warnings.push("核心股候选过少，前中后排识别可能失真");
    confidence -= 0.1;
  }
  if ((state.clsNews ?? []).length > 0) {
    confidence += 0.05;
  }
  if ((state.mxContext?.screeningStats?.count ?? 0) > 0) {
    confidence += 0.04;
  }
  if ((state.newsAnalysis?.themeCatalysts ?? []).length > 0) {
    confidence += 0.05;
  }
  if ((state.newsAnalysis?.rejectedNews ?? []).length > 0) {
    confidence += 0.01;
  }
  if ((state.newsAnalysis?.relevantNewsCount ?? 0) > 0 && (state.newsAnalysis?.themeCatalysts ?? []).length === 0) {
    warnings.push("新闻语义层未识别出有效催化，题材催化按空值处理");
    confidence -= 0.05;
  }
  if ((state.mxContext?.warnings ?? []).length > 0) {
    warnings.push(...state.mxContext.warnings);
    confidence -= Math.min(state.mxContext.warnings.length * 0.03, 0.12);
  }
  if (state.newsAnalysis?.warning) {
    warnings.push(`新闻LLM分析降级: ${state.newsAnalysis.warning}`);
    confidence -= 0.03;
  }

  const requestedTradeDate = state.requestedTradeDate
    ? `${state.requestedTradeDate.slice(0, 4)}-${state.requestedTradeDate.slice(4, 6)}-${state.requestedTradeDate.slice(6, 8)}`
    : null;
  const resolvedTradeDate = state.resolvedTradeDate
    ? `${state.resolvedTradeDate.slice(0, 4)}-${state.resolvedTradeDate.slice(4, 6)}-${state.resolvedTradeDate.slice(6, 8)}`
    : null;
  const isFallbackTradeDate = Boolean(requestedTradeDate && resolvedTradeDate && requestedTradeDate !== resolvedTradeDate);
  if (isFallbackTradeDate) {
    warnings.push(`当前分析使用的是回退交易日数据：请求 ${requestedTradeDate}，实际采用 ${resolvedTradeDate}`);
    confidence -= 0.18;
  }

  const estimatedFieldCount = Object.values(state.marketIndices?.estimatedFields ?? {}).filter(Boolean).length;
  if (estimatedFieldCount > 0) {
    warnings.push(`市场风格字段中有 ${estimatedFieldCount} 项为估算值，请降低对风格判断的置信度`);
    confidence -= Math.min(estimatedFieldCount * 0.02, 0.12);
  }

  return {
    confidence: clamp(Number(confidence.toFixed(2)), 0, 1),
    warnings: [...new Set(warnings)],
    requestedTradeDate,
    resolvedTradeDate,
    isFallbackTradeDate,
    estimatedFields: state.marketIndices?.estimatedFields ?? {}
  };
}

export function buildSnapshotFromLiveMarketState(state) {
  const { date, limitUpPool, limitDownPool, previousLimitUpPool, conceptBoards } = state;

  // 使用财联社新闻替代其他新闻源
  const mergedNews = state.clsNews || [];

  const themes = buildThemes(limitUpPool, previousLimitUpPool, conceptBoards, state.mxContext, state.newsAnalysis);
  const stocks = buildStocks(limitUpPool, previousLimitUpPool, themes, state.mxContext?.screenedStocks ?? [], conceptBoards);
  const premiumMetrics = buildPremiumMetrics(previousLimitUpPool);
  const profitProfiles = buildProfitProfiles(previousLimitUpPool);
  const yesterdayStrongFeedback = clamp(
    premiumMetrics.positiveRatio * 0.5 + premiumMetrics.strongPremiumRatio * 0.3 + premiumMetrics.premiumScore * 0.2,
    0,
    1
  );
  const highPositionNegativeFeedback = clamp(
    (1 - premiumMetrics.positiveRatio) * 0.6 + premiumMetrics.deepNegativeRatio * 0.4,
    0,
    1
  );

  const market = {
    limitUpCount: limitUpPool.length,
    limitDownCount: limitDownPool.length,
    maxBoardHeight: limitUpPool.reduce((max, item) => Math.max(max, item.boardCount ?? 0), 0),
    boardCount: limitUpPool.filter((item) => (item.boardCount ?? 0) >= 2).length,
    mainlineConcentration: limitUpPool.length === 0 ? 0 : (themes[0]?.limitUpCount ?? 0) / limitUpPool.length,
    brokenBoardRate: limitUpPool.length === 0 ? 0 : limitUpPool.filter((item) => (item.brokenCount ?? 0) > 0).length / limitUpPool.length,
    yesterdayStrongFeedback: Number(yesterdayStrongFeedback.toFixed(2)),
    highPositionNegativeFeedback: Number(highPositionNegativeFeedback.toFixed(2)),
    avgYesterdayPremiumPct: premiumMetrics.avgPremiumPct,
    strongPremiumRatio: premiumMetrics.strongPremiumRatio,
    deepNegativeRatio: premiumMetrics.deepNegativeRatio,
    profitProfiles,
    indexChangePct: state.marketIndices?.indexChangePct ?? null,
    growthIndexChangePct: state.marketIndices?.growthIndexChangePct ?? null,
    totalTurnoverBn: state.marketIndices?.totalTurnoverBn ?? null,
    turnoverDeltaPct: state.marketIndices?.turnoverDeltaPct ?? null,
    marketDataSource: state.marketIndices?.source ?? null,
    requestedTradeDate: state.requestedTradeDate ?? null,
    resolvedTradeDate: state.resolvedTradeDate ?? null,
    isFallbackTradeDate: Boolean(state.isFallbackTradeDate)
  };

  const dataQuality = buildDataQuality(state, themes, stocks);

  return {
    date,
    market,
    themes,
    stocks,
    riskContext: state.riskContext ?? {},
    dataQuality,
    liveContext: {
      conceptBoards: conceptBoards ?? [],
      clsNews: mergedNews,
      mxScreenedStocks: state.mxContext?.screenedStocks ?? [],
      mxMarketHighlights: state.mxContext?.marketHighlights ?? [],
      mxThemeSeeds: state.mxContext?.themeSeeds ?? [],
      mxThemeCatalysts: state.mxContext?.themeCatalysts ?? [],
      mxScreeningStats: state.mxContext?.screeningStats ?? null,
      mxMarketPulse: state.mxContext?.marketPulse ?? [],
      llmNewsAnalysis: state.newsAnalysis ?? null,
      intradayMicrostructure: state.intradayMicrostructure ?? [],
      marketIndices: state.marketIndices ?? null,
      sourceMeta: {
        requestedTradeDate: state.requestedTradeDate ?? null,
        resolvedTradeDate: state.resolvedTradeDate ?? null,
        isFallbackTradeDate: Boolean(state.isFallbackTradeDate),
        dataSources: state.dataSources ?? {},
        dataQuality: state.dataQuality ?? {}
      }
    },
    assumptions: [
      "Live snapshot uses explicitly labeled provider data; unverified limit pools are disabled by default.",
      "Themes use the same THS concept-board taxonomy as the management page.",
      "News catalyst strength is sourced from CLS (财联社) news database and structured LLM semantic analysis.",
      "Theme narrative strength is determined by LLM catalyst strength, event type, duration and credibility.",
      "Yesterday strong-stock feedback and next-day premium are inferred from previous limit-up pool current returns.",
      "Profit effect is split into relay, low-absorb, trend and first-board profiles from previous strong-stock feedback.",
      "Ladder completeness is evaluated by leader/front/mid/low/capacity structure rather than only board count.",
      "If resolvedTradeDate differs from requestedTradeDate, the snapshot is using fallback trading-day data and should be treated as stale.",
      "Fields marked in dataQuality.estimatedFields are inferred rather than directly sourced.",
      "News source changed from Eastmoney fast news to CLS (财联社) local database for better quality and reliability."
    ]
  };
}
