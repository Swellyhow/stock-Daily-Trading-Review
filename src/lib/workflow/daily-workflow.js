function pickArray(values, fallback = []) {
  return Array.isArray(values) && values.length > 0 ? values : fallback;
}

function formatPercent(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function buildCatalystSummary(snapshot) {
  const analysis = snapshot.liveContext?.llmNewsAnalysis;
  if (!analysis) {
    return {
      topThemes: [],
      buckets: {},
      warning: null,
      rejectedNews: []
    };
  }

  return {
    topThemes: (analysis.themeCatalysts ?? []).slice(0, 5).map((item) => ({
      theme: item.theme,
      strength: item.strength,
      sentiment: item.sentiment,
      eventType: item.eventType,
      reason: item.reason,
      detailedReason: item.detailedReason,
      decisionImpact: item.decisionImpact,
      riskNote: item.riskNote,
      headlineTitles: item.headlineTitles ?? []
    })),
    buckets: analysis.catalystBuckets ?? {},
    warning: analysis.warning ?? null,
    rejectedNews: (analysis.rejectedNews ?? []).slice(0, 5)
  };
}

export function buildPremarketPlan(snapshot, decision) {
  const primaryTheme = decision.themes.primaryTheme?.name ?? "No clear mainline";
  const secondaryTheme = decision.themes.secondaryTheme?.name ?? "None";
  const leader = decision.leaders.leader?.name ?? "Unidentified";
  const themeLeader = decision.leaders.themeLeader?.name ?? leader;
  const corePool = decision.leaders.corePool.map((item) => item.name).slice(0, 5);
  const capacityCores = decision.leaders.capacityCores?.map((item) => item.name).slice(0, 3) ?? [];
  const midArmy = decision.leaders.midArmy?.map((item) => item.name).slice(0, 3) ?? [];
  const turnoverCandidates = decision.leaders.turnoverCandidates?.map((item) => item.name).slice(0, 4) ?? [];
  const watchLow = decision.leaders.lowPositionCandidates?.map((item) => item.name).slice(0, 2) ?? [];

  return {
    date: decision.meta.date,
    marketJudgement: {
      environment: decision.overview.environment,
      emotionCycle: decision.overview.emotionCycle,
      attackWindow: decision.execution.actionBias,
      riskPreference:
        decision.environment.score >= 75 ? "强" : decision.environment.score >= 50 ? "中" : "弱",
      keyMetrics: {
        limitUpCount: snapshot.market.limitUpCount,
        limitDownCount: snapshot.market.limitDownCount,
        maxBoardHeight: snapshot.market.maxBoardHeight,
        brokenBoardRate: formatPercent(snapshot.market.brokenBoardRate),
        mainlineConcentration: formatPercent(snapshot.market.mainlineConcentration),
        avgYesterdayPremiumPct: `${Number(snapshot.market.avgYesterdayPremiumPct ?? 0).toFixed(2)}%`,
        strongPremiumRatio: formatPercent(snapshot.market.strongPremiumRatio)
      },
      regime: decision.marketRegime,
      modeProfile: decision.modeProfile,
      riskControl: decision.riskControl
    },
    themes: {
      primaryTheme,
      secondaryTheme,
      primaryThemeLadder: decision.themes.primaryTheme?.ladderCompleteness ?? "未知",
      primaryThemeType: decision.themes.primaryTheme?.themeType ?? "未识别",
      narrativeLabel: decision.themes.primaryTheme?.narrativeLabel ?? "未识别",
      oneDayThemes: decision.themes.ranked
        .filter((theme) => !theme.isMainlineCandidate && theme.mainlineScore <= 2)
        .map((theme) => theme.name),
      avoidThemes: primaryTheme === "No clear mainline" ? ["All non-core themes"] : ["Back-row follow-ons"],
      warnings: decision.themes.warnings ?? []
    },
    newsCatalysts: buildCatalystSummary(snapshot),
    watchlist: {
      leader,
      themeLeader,
      capacityCores,
      midArmy,
      corePool,
      turnoverCandidates,
      lowPositionWatch: watchLow
    },
    executionPlan: {
      preferredMode: decision.modeProfile.primaryMode,
      activeModes: decision.modeProfile.activeModes,
      allowedSetups: pickArray(decision.execution.allowedSetups),
      forbiddenSetups: pickArray(decision.execution.forbiddenSetups),
      sixQuestions: [
        "Is it the mainline?",
        "Is it a core stock?",
        "Is the emotion stage allowing entry now?",
        "Does the setup belong to the premarket plan?",
        "Where is the invalidation point if wrong?",
        "Is it worth using today’s position budget?"
      ]
    },
    positionPlan: {
      totalPosition: decision.position.totalPosition,
      structure: decision.position.structure,
      retreatSignals: decision.position.retreatSignals,
      addSignals: decision.position.addSignals
    },
    sellPlan: decision.sellPlan
  };
}

export function buildPostmarketReview(snapshot, decision) {
  const primaryTheme = decision.themes.primaryTheme?.name ?? "No clear mainline";
  return {
    date: decision.meta.date,
    marketReview: {
      environment: decision.overview.environment,
      emotionCycle: decision.overview.emotionCycle,
      keyMetrics: {
        limitUpCount: snapshot.market.limitUpCount,
        limitDownCount: snapshot.market.limitDownCount,
        maxBoardHeight: snapshot.market.maxBoardHeight,
        brokenBoardRate: formatPercent(snapshot.market.brokenBoardRate),
        avgYesterdayPremiumPct: `${Number(snapshot.market.avgYesterdayPremiumPct ?? 0).toFixed(2)}%`,
        strongPremiumRatio: formatPercent(snapshot.market.strongPremiumRatio),
        deepNegativeRatio: formatPercent(snapshot.market.deepNegativeRatio)
      },
      regime: decision.marketRegime,
      modeProfile: decision.modeProfile,
      riskControl: decision.riskControl,
      conclusion: decision.environment.reasoning
    },
    themeReview: {
      strongestTheme: primaryTheme,
      backupTheme: decision.themes.secondaryTheme?.name ?? "None",
      summary: decision.themes.summary,
      warnings: decision.themes.warnings ?? [],
      riskyNames: decision.leaders.riskyNames,
      newsCatalysts: buildCatalystSummary(snapshot)
    },
    stockReview: {
      leader: decision.leaders.leader?.name ?? "Unidentified",
      themeLeader: decision.leaders.themeLeader?.name ?? "Unidentified",
      capacityCores: decision.leaders.capacityCores?.map((item) => item.name) ?? [],
      midArmy: decision.leaders.midArmy?.map((item) => item.name) ?? [],
      corePool: decision.leaders.corePool.map((item) => item.name),
      turnoverCandidates: decision.leaders.turnoverCandidates?.map((item) => item.name) ?? [],
      tomorrowFocus: decision.leaders.corePool.slice(0, 4).map((item) => item.name)
    },
    systemReview: {
      preferredMode: decision.modeProfile.primaryMode,
      allowedSetupsWorked: decision.execution.allowedSetups,
      setupsToAvoid: decision.execution.forbiddenSetups,
      positionPlan: decision.position.totalPosition,
      sellPlan: decision.sellPlan,
      optimizationFocus: [
        "Check whether the mode engine matched the day’s real赚钱效应",
        "Review whether leader, capacity core, and mid-army stayed aligned",
        "Compare planned setups with actual intraday opportunities"
      ]
    }
  };
}
