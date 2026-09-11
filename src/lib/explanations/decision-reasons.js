function num(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return parsed.toFixed(digits);
}

function pct(value, digits = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return `${(parsed * 100).toFixed(digits)}%`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function summarizeChecklist(checklist = {}) {
  const passed = [];
  const failed = [];
  for (const [key, value] of Object.entries(checklist)) {
    (value ? passed : failed).push(key);
  }
  return { passed, failed };
}

function buildEnvironmentReason(snapshot, decision) {
  const environment = decision.environment ?? {};
  const market = snapshot.market ?? {};
  return {
    conclusion: `${environment.label ?? '未知环境'} · ${environment.score ?? '-'} 分`,
    data: {
      score: environment.score ?? null,
      limitUpCount: market.limitUpCount ?? null,
      limitDownCount: market.limitDownCount ?? null,
      brokenBoardRate: market.brokenBoardRate ?? null,
      maxBoardHeight: market.maxBoardHeight ?? null,
      mainlineConcentration: market.mainlineConcentration ?? null,
      yesterdayStrongFeedback: market.yesterdayStrongFeedback ?? null,
      avgYesterdayPremiumPct: market.avgYesterdayPremiumPct ?? null,
      strongPremiumRatio: market.strongPremiumRatio ?? null,
      deepNegativeRatio: market.deepNegativeRatio ?? null,
      highPositionNegativeFeedback: market.highPositionNegativeFeedback ?? null
    },
    reasons: safeArray(environment.reasoning)
  };
}

function buildEmotionReason(snapshot, decision) {
  const emotionCycle = decision.emotionCycle ?? {};
  const market = snapshot.market ?? {};
  return {
    conclusion: emotionCycle.label ?? '未知周期',
    data: {
      limitUpCount: market.limitUpCount ?? null,
      maxBoardHeight: market.maxBoardHeight ?? null,
      yesterdayStrongFeedback: market.yesterdayStrongFeedback ?? null,
      strongPremiumRatio: market.strongPremiumRatio ?? null,
      deepNegativeRatio: market.deepNegativeRatio ?? null,
      mainlineConcentration: market.mainlineConcentration ?? null
    },
    reasons: safeArray(emotionCycle.reasoning)
  };
}

function buildThemeReason(snapshot, decision) {
  const theme = decision.themes?.primaryTheme ?? null;
  const ranked = safeArray(decision.themes?.ranked);
  if (!theme) {
    return {
      conclusion: '暂未识别明确主线',
      data: {},
      reasons: ['当前没有题材同时满足主线判断表阈值，因此系统不认定明确主线。']
    };
  }

  const peers = safeArray(snapshot.stocks)
    .filter((item) => item.theme === theme.name)
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 12);
  const checklist = summarizeChecklist(theme.checklist);
  const ladder = theme.ladderProfile ?? {};
  const topRank = ranked.findIndex((item) => item.name === theme.name) + 1;

  return {
    conclusion: `${theme.name} · ${theme.themeType ?? '未分类'}`,
    data: {
      score: theme.score ?? null,
      mainlineScore: theme.mainlineScore ?? null,
      rank: topRank || null,
      continuityDays: theme.continuityDays ?? null,
      limitUpCount: theme.limitUpCount ?? null,
      maxBoardHeight: theme.maxBoardHeight ?? null,
      linkageStrength: theme.linkageStrength ?? null,
      profitEffect: theme.profitEffect ?? null,
      nextDayPremiumScore: theme.nextDayPremiumScore ?? null,
      comebackStrength: theme.comebackStrength ?? null,
      newsCatalystStrength: theme.newsCatalystStrength ?? null,
      narrativeStrength: theme.narrativeStrength ?? null,
      narrativeSustainability: theme.narrativeSustainability ?? null,
      catalystCredibility: theme.catalystCredibility ?? null,
      ladderProfile: {
        leaderCount: ladder.leaderCount ?? 0,
        frontCount: ladder.frontCount ?? 0,
        midCount: ladder.midCount ?? 0,
        lowCount: ladder.lowCount ?? 0,
        capacityCount: ladder.capacityCount ?? 0,
        structureScore: ladder.structureScore ?? null,
        leaderDriveScore: ladder.leaderDriveScore ?? null,
        lowSpreadScore: ladder.lowSpreadScore ?? null,
        falseBreakoutRisk: ladder.falseBreakoutRisk ?? null,
        midRiskScore: ladder.midRiskScore ?? null
      },
      checklist: theme.checklist ?? {},
      supportingStocks: peers
    },
    reasons: [
      `${theme.name} 当前总分 ${theme.score ?? '-'}，主线判断表命中 ${theme.mainlineScore ?? '-'}/12，排名第 ${topRank || '-'}。`,
      `连续 ${theme.continuityDays ?? 0} 天活跃，涨停 ${theme.limitUpCount ?? 0} 家，最高 ${theme.maxBoardHeight ?? 0} 板。`,
      `赚钱效应 ${pct(theme.profitEffect)}，次日溢价 ${pct(theme.nextDayPremiumScore)}，回流能力 ${pct(theme.comebackStrength)}。`,
      `联动强度 ${pct(theme.linkageStrength)}，新闻催化 ${pct(theme.newsCatalystStrength)}，叙事强度 ${pct(theme.narrativeStrength)}，持续性 ${pct(theme.narrativeSustainability)}。`,
      `梯队结构是 ${theme.structureSummary ?? '暂无'}，健康度 ${pct(ladder.structureScore)}，龙头带动性 ${pct(ladder.leaderDriveScore)}。`,
      theme.ladderInterpretation ? `梯队解读：${theme.ladderInterpretation}` : null,
      theme.catalystReason ? `催化原因：${theme.catalystReason}` : null,
      theme.catalystDetailedReason ? `详细因果：${theme.catalystDetailedReason}` : null,
      theme.catalystDecisionImpact ? `策略影响：${theme.catalystDecisionImpact}` : null,
      theme.catalystRiskNote ? `风险提示：${theme.catalystRiskNote}` : null,
      checklist.passed.length ? `主线判断表满足：${checklist.passed.join('、')}` : null,
      checklist.failed.length ? `仍需继续验证：${checklist.failed.join('、')}` : null,
      peers.length ? `同题材可观察个股：${peers.join('、')}` : null
    ].filter(Boolean)
  };
}

function buildLeaderReason(snapshot, decision) {
  const leader = decision.leaders?.leader ?? null;
  const theme = decision.themes?.primaryTheme?.name ?? null;
  const ranked = safeArray(decision.leaders?.ranked);
  if (!leader) {
    return {
      conclusion: '暂未识别总龙头',
      data: {},
      reasons: ['当前候选股中没有足够强的辨识度锚点。']
    };
  }

  const peers = ranked.filter((item) => item.theme === leader.theme);
  const peerRank = peers.findIndex((item) => item.name === leader.name) + 1;
  const globalRank = ranked.findIndex((item) => item.name === leader.name) + 1;
  const ladderMembers = {
    leader: peers.filter((item) => item.role === '总龙头' || item.role === '题材龙头').map((item) => item.name),
    front: peers.filter((item) => item.role === '前排核心').map((item) => item.name),
    mid: peers.filter((item) => item.role === '中位跟随').map((item) => item.name),
    low: peers.filter((item) => item.role === '低位补涨').map((item) => item.name),
    capacity: peers.filter((item) => item.role === '容量核心').map((item) => item.name),
    midArmy: peers.filter((item) => item.role === '中军').map((item) => item.name)
  };
  const drivenStocks = peers
    .filter((item) => item.name !== leader.name && ['题材龙头', '容量核心', '中军', '前排核心', '中位跟随', '低位补涨'].includes(item.role))
    .map((item) => `${item.name}(${item.role})`)
    .slice(0, 12);
  const closest = ranked
    .filter((item) => item.name !== leader.name)
    .slice(0, 3)
    .map((item) => `${item.name} ${item.score}分/${item.role}`);

  return {
    conclusion: `${leader.name} · ${leader.role ?? '核心股'}`,
    data: {
      score: leader.score ?? null,
      globalRank: globalRank || null,
      peerRank: peerRank || null,
      boardHeight: leader.boardHeight ?? null,
      recognition: leader.recognition ?? null,
      auctionStrength: leader.auctionStrength ?? null,
      reboundStrength: leader.reboundStrength ?? null,
      followThrough: leader.followThrough ?? null,
      volumeQuality: leader.volumeQuality ?? null,
      liquidityScore: leader.liquidityScore ?? null,
      theme: leader.theme ?? null,
      role: leader.role ?? null,
      drivenStocks,
      ladderMembers
    },
    reasons: [
      `${leader.name} 当前总分 ${leader.score ?? '-'}，全市场排序第 ${globalRank || '-'}，在 ${leader.theme ?? '当前题材'} 内排序第 ${peerRank || '-'}。`,
      `板位 ${leader.boardHeight ?? 0} 板，辨识度 ${pct(leader.recognition)}，竞价强度 ${pct(leader.auctionStrength)}，回封/反包强度 ${pct(leader.reboundStrength)}。`,
      `持续性 ${pct(leader.followThrough)}，量能质量 ${pct(leader.volumeQuality)}，流动性 ${pct(leader.liquidityScore)}。`,
      theme && leader.theme === theme ? `${leader.name} 处在当前主线 ${theme} 内，因此既是情绪锚点，也是主线锚点。` : `${leader.name} 当前更多体现为全市场情绪锚，而不是单一题材内部锚点。`,
      drivenStocks.length ? `带动性体现在：${drivenStocks.join('、')} 都与它处于同题材梯队，说明不是孤立强。` : '当前带动性仍偏单兵，需要继续观察是否能带动前排和容量核心共振。',
      ladderMembers.front.length ? `前排核心：${ladderMembers.front.join('、')}` : null,
      ladderMembers.mid.length ? `中位承接：${ladderMembers.mid.join('、')}` : null,
      ladderMembers.low.length ? `低位扩散：${ladderMembers.low.join('、')}` : null,
      ladderMembers.capacity.length ? `容量核心：${ladderMembers.capacity.join('、')}` : null,
      ladderMembers.midArmy.length ? `中军：${ladderMembers.midArmy.join('、')}` : null,
      closest.length ? `同阶段主要竞争者：${closest.join('；')}` : null
    ].filter(Boolean)
  };
}

function buildModeReason(snapshot, decision) {
  const modeProfile = decision.modeProfile ?? {};
  const ranked = safeArray(modeProfile.ranked);
  const primary = ranked[0] ?? null;
  return {
    conclusion: modeProfile.primaryMode ?? '未知模式',
    data: {
      primaryMode: modeProfile.primaryMode ?? null,
      ranked: ranked.map((item) => ({
        name: item.name,
        score: item.score,
        enabled: item.enabled
      }))
    },
    reasons: [
      primary ? `${primary.name} 当前模式分最高，为 ${primary.score} 分。` : null,
      ...safeArray(primary?.reasons).map((item) => `${primary?.name}：${item}`),
      ranked[1] ? `第二候选模式是 ${ranked[1].name}（${ranked[1].score} 分）。` : null,
      safeArray(modeProfile.disabledModes).length ? `当前不优先的模式：${modeProfile.disabledModes.join('、')}` : null,
      modeProfile.summary ?? null
    ].filter(Boolean)
  };
}

function buildExecutionReason(snapshot, decision) {
  const execution = decision.execution ?? {};
  const guardrails = decision.guardrails ?? {};
  const riskControl = decision.riskControl ?? {};
  const primaryTheme = decision.themes?.primaryTheme?.name ?? '未识别';
  const leader = decision.leaders?.leader?.name ?? '未识别';

  return {
    conclusion: `${execution.actionBias ?? '未知动作'} / ${decision.position?.totalPosition ?? '未知仓位'}`,
    data: {
      actionBias: execution.actionBias ?? null,
      totalPosition: decision.position?.totalPosition ?? null,
      primaryTheme,
      leader,
      preferredMode: decision.modeProfile?.primaryMode ?? null,
      guardrailMode: guardrails.mode ?? null,
      riskStatus: riskControl.status ?? null,
      confidence: snapshot.dataQuality?.confidence ?? null,
      allowedSetups: safeArray(execution.allowedSetups),
      forbiddenSetups: safeArray(execution.forbiddenSetups)
    },
    reasons: [
      `当前主线是 ${primaryTheme}，总龙头是 ${leader}，模式判断是 ${decision.modeProfile?.primaryMode ?? '未识别'}。`,
      ...safeArray(execution.allowedSetups).map((item) => `允许买点：${item}`),
      ...safeArray(execution.forbiddenSetups).map((item) => `禁止动作：${item}`),
      ...safeArray(guardrails.reasons).map((item) => `硬闸门：${item}`),
      ...safeArray(riskControl.reasons).map((item) => `风控：${item}`),
      execution.notes?.length ? `执行补充：${safeArray(execution.notes).join('；')}` : null
    ].filter(Boolean)
  };
}

function buildPositionReason(snapshot, decision) {
  const position = decision.position ?? {};
  const structure = position.structure ?? {};
  return {
    conclusion: position.totalPosition ?? '未知仓位',
    data: {
      totalPosition: position.totalPosition ?? null,
      structure
    },
    reasons: [
      `当前总仓位是 ${position.totalPosition ?? '未知'}，龙头核心仓 ${pct(structure.leaderCore)}，次核心仓 ${pct(structure.secondaryCore)}，试错仓 ${pct(structure.trial)}。`,
      ...safeArray(position.addSignals).map((item) => `加仓信号：${item}`),
      ...safeArray(position.retreatSignals).map((item) => `撤退信号：${item}`)
    ].filter(Boolean)
  };
}

function buildSellReason(snapshot, decision) {
  const sellPlan = decision.sellPlan ?? {};
  return {
    conclusion: sellPlan.primaryStyle ?? '未知卖点风格',
    data: {
      primaryStyle: sellPlan.primaryStyle ?? null,
      stateMachine: safeArray(sellPlan.stateMachine)
    },
    reasons: [
      ...safeArray(sellPlan.notes),
      ...safeArray(sellPlan.takeProfitRules).map((item) => `止盈：${item}`),
      ...safeArray(sellPlan.stopLossRules).map((item) => `止损：${item}`),
      ...safeArray(sellPlan.structureFailureSignals).map((item) => `结构失败：${item}`),
      ...safeArray(sellPlan.holdConditions).map((item) => `继续持有条件：${item}`)
    ].filter(Boolean)
  };
}

export function buildDecisionReasons(snapshot, decision) {
  const sections = {
    environment: buildEnvironmentReason(snapshot, decision),
    emotionCycle: buildEmotionReason(snapshot, decision),
    primaryTheme: buildThemeReason(snapshot, decision),
    leader: buildLeaderReason(snapshot, decision),
    mode: buildModeReason(snapshot, decision),
    execution: buildExecutionReason(snapshot, decision),
    position: buildPositionReason(snapshot, decision),
    sellPlan: buildSellReason(snapshot, decision)
  };

  return {
    ...sections,
    processOrder: [
      sections.environment,
      sections.emotionCycle,
      sections.primaryTheme,
      sections.leader,
      sections.mode,
      sections.execution,
      sections.position,
      sections.sellPlan
    ]
  };
}
