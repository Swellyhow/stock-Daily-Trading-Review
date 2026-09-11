function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function positiveRatio(items = [], selector) {
  if (items.length === 0) {
    return 0;
  }
  return items.filter(selector).length / items.length;
}

function expectedAuctionBaseline(decision) {
  if (!decision) {
    return 0.5;
  }
  const env = decision.overview?.environment;
  const cycle = decision.overview?.emotionCycle;
  if (env === "进攻环境" && ["发酵", "高潮"].includes(cycle)) {
    return 0.68;
  }
  if (cycle === "启动") {
    return 0.55;
  }
  if (["退潮", "冰点"].includes(cycle)) {
    return 0.38;
  }
  return 0.5;
}

function findLeaderState(limitUpPool = [], decision) {
  const names = [
    decision?.leaders?.leader?.name,
    decision?.leaders?.themeLeader?.name,
    ...(decision?.leaders?.capacityCores ?? []).map((item) => item.name)
  ].filter(Boolean);

  return limitUpPool.find((item) => names.includes(item.name)) ?? null;
}

function summarizeMicrostructure(records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      sealStrength: 0,
      recloseQuality: 0,
      supportStrength: 0,
      openMovePct: 0,
      recoveryRatio: 0,
      closeVsAveragePct: 0,
      first15RisePct: 0,
      middayPullbackPct: 0,
      lateRecoveryPct: 0,
      breakoutAcceptance: 0,
      pullbackControl: 0,
      intradayWeaknessRisk: 0
    };
  }

  const avg = (selector) => records.reduce((sum, item) => sum + Number(selector(item) ?? 0), 0) / records.length;
  return {
    sealStrength: Number(avg((item) => item.sealStrength).toFixed(2)),
    recloseQuality: Number(avg((item) => item.recloseQuality).toFixed(2)),
    supportStrength: Number(avg((item) => item.supportStrength).toFixed(2)),
    openMovePct: Number(avg((item) => item.trendSummary?.openMovePct).toFixed(2)),
    recoveryRatio: Number(avg((item) => item.trendSummary?.recoveryRatio).toFixed(2)),
    closeVsAveragePct: Number(avg((item) => item.trendSummary?.closeVsAveragePct).toFixed(2)),
    first15RisePct: Number(avg((item) => item.trendSummary?.first15RisePct).toFixed(2)),
    middayPullbackPct: Number(avg((item) => item.trendSummary?.middayPullbackPct).toFixed(2)),
    lateRecoveryPct: Number(avg((item) => item.trendSummary?.lateRecoveryPct).toFixed(2)),
    breakoutAcceptance: Number(avg((item) => item.trendSummary?.breakoutAcceptance).toFixed(2)),
    pullbackControl: Number(avg((item) => item.trendSummary?.pullbackControl).toFixed(2)),
    intradayWeaknessRisk: Number(avg((item) => item.trendSummary?.intradayWeaknessRisk).toFixed(2))
  };
}

function buildRecordState(record) {
  if (!record) {
    return null;
  }

  const trend = record.trendSummary ?? {};
  let state = "震荡观察";
  if ((record.supportStrength ?? 0) <= 0.35 || (trend.closeVsAveragePct ?? 0) <= -0.6) {
    state = "失守转弱";
  } else if ((record.recloseQuality ?? 0) >= 0.65 && (record.sealStrength ?? 0) >= 0.5) {
    state = "回封确认";
  } else if ((trend.recoveryRatio ?? 0) >= 0.65 && (trend.closeVsAveragePct ?? 0) >= 0) {
    state = "分时修复";
  } else if ((trend.first15RisePct ?? 0) >= 1) {
    state = "开盘确认";
  }

  return {
    name: record.name,
    state,
    supportStrength: record.supportStrength,
    sealStrength: record.sealStrength,
    recloseQuality: record.recloseQuality,
    trendSummary: trend
  };
}

function buildMinuteStateMachine(records = [], decision, signals) {
  const leaderName = decision?.leaders?.leader?.name;
  const leaderRecord = records.find((item) => item.name === leaderName) ?? records[0] ?? null;
  const capacityNames = (decision?.leaders?.capacityCores ?? []).map((item) => item.name);
  const capacityStates = records
    .filter((item) => capacityNames.includes(item.name))
    .map(buildRecordState)
    .filter(Boolean);
  const leaderState = buildRecordState(leaderRecord);

  let currentPhase = "观察等待";
  if (leaderState?.state === "失守转弱" || (signals.marketPressure ?? 0) >= 0.68) {
    currentPhase = "风险退出阶段";
  } else if (leaderState?.state === "回封确认" && (signals.themeContinuationStrength ?? 0) >= 0.55) {
    currentPhase = "一致性确认阶段";
  } else if (leaderState?.state === "分时修复" && (signals.repairConfirmation ?? 0) >= 0.55) {
    currentPhase = "分歧修复阶段";
  } else if (leaderState?.state === "开盘确认" && (signals.auctionExpectationGap ?? 0) >= 0) {
    currentPhase = "竞价确认阶段";
  }

  const entryTriggers = [];
  if ((signals.auctionExpectationGap ?? 0) >= 0 && (signals.supportStrength ?? 0) >= 0.55 && (signals.pullbackControl ?? 0) >= 0.5) {
    entryTriggers.push("竞价不低于预期且承接稳住均价线");
  }
  if ((signals.recloseQuality ?? 0) >= 0.6 && (signals.sealStrength ?? 0) >= 0.5) {
    entryTriggers.push("炸板后回封质量达标且封单不虚");
  }
  if ((signals.recoveryStrength ?? 0) >= 0.6 && (signals.themeContinuationStrength ?? 0) >= 0.5 && (signals.breakoutAcceptance ?? 0) >= 0.5) {
    entryTriggers.push("主线回流修复成立，前排重新带动");
  }

  const exitTriggers = [];
  if (leaderState?.state === "失守转弱") {
    exitTriggers.push("龙头分时失守，跌破均价且承接不足");
  }
  if ((signals.marketPressure ?? 0) >= 0.68) {
    exitTriggers.push("市场压力显著抬升，优先收缩风险暴露");
  }
  if ((signals.failedContinuationRisk ?? 0) >= 0.6) {
    exitTriggers.push("昨日强股延续失败，接力链条断裂");
  }
  if ((signals.intradayWeaknessRisk ?? 0) >= 0.6) {
    exitTriggers.push("分时走弱风险抬升，冲高回落概率增加");
  }

  return {
    currentPhase,
    leaderState,
    capacityStates,
    entryTriggers,
    exitTriggers,
    actionHint:
      currentPhase === "一致性确认阶段" ? "只围绕主线最强核心做确认单" :
      currentPhase === "分歧修复阶段" ? "仅允许低吸回流或修复确认" :
      currentPhase === "竞价确认阶段" ? "先看竞价兑现，再等盘中承接确认" :
      currentPhase === "风险退出阶段" ? "优先减仓与退出，停止主动开仓" :
      "等待盘中结构进一步明朗"
  };
}

function evaluateModeFit(decision, signals) {
  const primaryMode = decision?.modeProfile?.primaryMode ?? "防守空仓";
  if (primaryMode === "连板接力") {
    return clamp(signals.auctionStrength * 0.2 + signals.leaderStrength * 0.2 + signals.themeContinuationStrength * 0.15 + signals.recloseQuality * 0.15 + signals.sealStrength * 0.15 + signals.supportStrength * 0.15, 0, 1);
  }
  if (primaryMode === "主线低吸回流") {
    return clamp(signals.flowBackStrength * 0.28 + signals.repairConfirmation * 0.28 + signals.supportStrength * 0.18 + signals.recoveryStrength * 0.16 + (1 - signals.failedContinuationRisk) * 0.1, 0, 1);
  }
  if (primaryMode === "容量趋势抱团") {
    return clamp(signals.themeContinuationStrength * 0.2 + signals.leaderStrength * 0.1 + signals.flowBackStrength * 0.15 + signals.supportStrength * 0.25 + (1 - signals.highPositionRisk) * 0.15 + (1 - signals.marketPressure) * 0.15, 0, 1);
  }
  if (primaryMode === "首板消息套利") {
    return clamp((signals.auctionExpectationGap > 0 ? 0.2 : 0.05) + signals.auctionStrength * 0.2 + signals.themeContinuationStrength * 0.15 + signals.sealStrength * 0.25 + (1 - signals.marketPressure) * 0.15 + signals.recloseQuality * 0.1, 0, 1);
  }
  return clamp((1 - signals.marketPressure) * 0.4 + (1 - signals.highPositionRisk) * 0.3 + (1 - signals.failedContinuationRisk) * 0.3, 0, 1);
}

export function deriveIntradaySignalsFromMarketState(state = {}, decision = null) {
  const limitUpPool = state.limitUpPool ?? [];
  const previousLimitUpPool = state.previousLimitUpPool ?? [];
  const limitDownPool = state.limitDownPool ?? [];
  const mxNews = state.mxContext?.newsItems ?? [];
  const rawMicrostructure = state.intradayMicrostructure ?? [];
  const microstructure = summarizeMicrostructure(rawMicrostructure);
  const primaryTheme = decision?.themes?.primaryTheme?.name ?? null;
  const themePool = primaryTheme ? limitUpPool.filter((item) => (item.industry || "") === primaryTheme) : [];
  const topBoard = limitUpPool.reduce((max, item) => Math.max(max, item.boardCount ?? 0), 0);
  const highBoardStocks = limitUpPool.filter((item) => (item.boardCount ?? 0) >= Math.max(topBoard - 1, 2));
  const leaderState = findLeaderState(limitUpPool, decision);
  const earlySealRatio = positiveRatio(limitUpPool, (item) => {
    const firstTime = parseLimitTime(item.firstLimitTime);
    return firstTime !== null && firstTime <= 9 * 60 + 35;
  });
  const themeEarlySealRatio = positiveRatio(themePool, (item) => {
    const firstTime = parseLimitTime(item.firstLimitTime);
    return firstTime !== null && firstTime <= 9 * 60 + 40;
  });
  const previousPositiveRatio = positiveRatio(previousLimitUpPool, (item) => (item.changePct ?? 0) > 0);
  const previousStrongRatio = positiveRatio(previousLimitUpPool, (item) => (item.changePct ?? 0) >= 3);
  const previousDeepNegativeRatio = positiveRatio(previousLimitUpPool, (item) => (item.changePct ?? 0) <= -5);
  const auctionStrength = clamp(
    earlySealRatio * 0.28 +
    themeEarlySealRatio * 0.2 +
    positiveRatio(limitUpPool.slice(0, 10), (item) => (item.changePct ?? 0) >= 8) * 0.16 +
    ((leaderState?.changePct ?? 0) >= 8 ? 0.12 : 0) +
    Math.max(microstructure.openMovePct, 0) / 5 * 0.12 +
    microstructure.sealStrength * 0.12,
    0,
    1
  );
  const leaderStrength = clamp(
    ((leaderState?.boardCount ?? 0) / 6) * 0.26 +
    ((leaderState?.changePct ?? 0) / 10) * 0.2 +
    ((leaderState?.brokenCount ?? 0) === 0 ? 0.14 : 0) +
    (Number(leaderState?.sealAmount ?? 0) > 0 ? 0.1 : 0) +
    microstructure.supportStrength * 0.15 +
    microstructure.recloseQuality * 0.15,
    0,
    1
  );
  const flowBackStrength = clamp(
    previousPositiveRatio * 0.28 +
    previousStrongRatio * 0.16 +
    (decision?.themes?.primaryTheme?.comebackStrength ?? 0) * 0.22 +
    (mxNews.length > 0 ? 0.1 : 0) +
    microstructure.recoveryRatio * 0.24,
    0,
    1
  );
  const recloseQuality = clamp(
    positiveRatio(limitUpPool, (item) => (item.brokenCount ?? 0) === 0) * 0.4 +
    positiveRatio(limitUpPool, (item) => Number(item.sealAmount ?? 0) > 0) * 0.2 +
    microstructure.recloseQuality * 0.4,
    0,
    1
  );
  const sealStrength = clamp(
    positiveRatio(limitUpPool, (item) => Number(item.sealAmount ?? 0) > Number(item.amount ?? 0) * 0.08) * 0.45 +
    microstructure.sealStrength * 0.55,
    0,
    1
  );
  const supportStrength = clamp(
    microstructure.supportStrength * 0.4 +
    Math.max(microstructure.closeVsAveragePct, 0) / 2 * 0.14 +
    positiveRatio(limitUpPool, (item) => (item.brokenCount ?? 0) <= 1) * 0.12 +
    Math.max(microstructure.lateRecoveryPct, 0) / 3 * 0.12 +
    microstructure.pullbackControl * 0.22,
    0,
    1
  );
  const recoveryStrength = clamp(
    microstructure.recoveryRatio * 0.38 +
    (microstructure.closeVsAveragePct > 0 ? 0.14 : 0) +
    (microstructure.openMovePct > 0 ? 0.1 : 0) +
    Math.max(microstructure.lateRecoveryPct, 0) / 4 * 0.14 +
    microstructure.breakoutAcceptance * 0.24,
    0,
    1
  );
  const themeContinuationStrength = clamp(
    (themePool.length / Math.max(limitUpPool.length, 1)) * 1.3 +
    themeEarlySealRatio * 0.18 +
    (decision?.themes?.primaryTheme?.linkageStrength ?? 0) * 0.2 +
    (decision?.themes?.primaryTheme?.ladderProfile?.structureScore ?? 0) * 0.18 +
    sealStrength * 0.14,
    0,
    1
  );
  const auctionExpectationGap = Number((auctionStrength - expectedAuctionBaseline(decision)).toFixed(2));
  const repairConfirmation = clamp(
    (previousDeepNegativeRatio <= 0.2 ? 0.18 : 0) +
    previousPositiveRatio * 0.25 +
    (limitDownPool.length <= 10 ? 0.16 : Math.max(0, 0.16 - limitDownPool.length / 120)) +
    themeContinuationStrength * 0.18 +
    recoveryStrength * 0.23,
    0,
    1
  );
  const failedContinuationRisk = clamp(
    previousDeepNegativeRatio * 0.24 +
    positiveRatio(highBoardStocks, (item) => (item.brokenCount ?? 0) > 0) * 0.18 +
    positiveRatio(themePool, (item) => (item.brokenCount ?? 0) > 0) * 0.14 +
    Math.min(limitDownPool.length / 25, 1) * 0.1 +
    (1 - recloseQuality) * 0.1 +
    Math.max(0, -microstructure.closeVsAveragePct) / 2 * 0.08 +
    microstructure.intradayWeaknessRisk * 0.16,
    0,
    1
  );
  const highPositionRisk = clamp(
    positiveRatio(highBoardStocks, (item) => (item.brokenCount ?? 0) > 0) * 0.35 +
    previousDeepNegativeRatio * 0.25 +
    Math.min(limitDownPool.length / 20, 1) * 0.15 +
    (1 - supportStrength) * 0.15 +
    (1 - sealStrength) * 0.1,
    0,
    1
  );
  const marketPressure = clamp(
    Math.min(limitDownPool.length / 25, 1) * 0.3 +
    positiveRatio(limitUpPool, (item) => (item.brokenCount ?? 0) > 0) * 0.2 +
    (decision?.guardrails?.blocked ? 0.12 : 0) +
    Math.max(0, -auctionExpectationGap) * 0.14 +
    (1 - supportStrength) * 0.08 +
    (1 - sealStrength) * 0.06 +
    microstructure.intradayWeaknessRisk * 0.1,
    0,
    1
  );

  const breakoutAcceptance = clamp(microstructure.breakoutAcceptance, 0, 1);
  const pullbackControl = clamp(microstructure.pullbackControl, 0, 1);
  const intradayWeaknessRisk = clamp(microstructure.intradayWeaknessRisk, 0, 1);

  const baseSignals = {
    auctionStrength,
    auctionExpectationGap,
    leaderStrength,
    flowBackStrength,
    recloseQuality,
    sealStrength,
    supportStrength,
    recoveryStrength,
    breakoutAcceptance,
    pullbackControl,
    intradayWeaknessRisk,
    themeContinuationStrength,
    repairConfirmation,
    failedContinuationRisk,
    highPositionRisk,
    marketPressure
  };
  const modeFit = evaluateModeFit(decision, baseSignals);
  const minuteStateMachine = buildMinuteStateMachine(rawMicrostructure, decision, { ...baseSignals, modeFit });

  return {
    auctionStrength: Number(auctionStrength.toFixed(2)),
    auctionExpectationGap,
    leaderStrength: Number(leaderStrength.toFixed(2)),
    flowBackStrength: Number(flowBackStrength.toFixed(2)),
    recloseQuality: Number(recloseQuality.toFixed(2)),
    sealStrength: Number(sealStrength.toFixed(2)),
    supportStrength: Number(supportStrength.toFixed(2)),
    recoveryStrength: Number(recoveryStrength.toFixed(2)),
    breakoutAcceptance: Number(breakoutAcceptance.toFixed(2)),
    pullbackControl: Number(pullbackControl.toFixed(2)),
    intradayWeaknessRisk: Number(intradayWeaknessRisk.toFixed(2)),
    themeContinuationStrength: Number(themeContinuationStrength.toFixed(2)),
    repairConfirmation: Number(repairConfirmation.toFixed(2)),
    failedContinuationRisk: Number(failedContinuationRisk.toFixed(2)),
    highPositionRisk: Number(highPositionRisk.toFixed(2)),
    marketPressure: Number(marketPressure.toFixed(2)),
    modeFit: Number(modeFit.toFixed(2)),
    minuteStateMachine,
    diagnostics: {
      topBoard,
      leaderName: leaderState?.name ?? decision?.leaders?.leader?.name ?? "未识别",
      earlySealRatio: Number(earlySealRatio.toFixed(2)),
      themeEarlySealRatio: Number(themeEarlySealRatio.toFixed(2)),
      highBoardCount: highBoardStocks.length,
      themeCount: themePool.length,
      mxNewsCount: mxNews.length,
      previousStrongPositiveRatio: Number(previousPositiveRatio.toFixed(2)),
      previousStrongPremiumRatio: Number(previousStrongRatio.toFixed(2)),
      microstructure
    }
  };
}

export function analyzeIntradaySignals(signals = {}, decision = null) {
  const auctionStrength = Number(signals.auctionStrength ?? 0.5);
  const auctionExpectationGap = Number(signals.auctionExpectationGap ?? 0);
  const leaderStrength = Number(signals.leaderStrength ?? 0.5);
  const flowBackStrength = Number(signals.flowBackStrength ?? 0.5);
  const recloseQuality = Number(signals.recloseQuality ?? 0.5);
  const sealStrength = Number(signals.sealStrength ?? 0.5);
  const supportStrength = Number(signals.supportStrength ?? 0.5);
  const recoveryStrength = Number(signals.recoveryStrength ?? 0.5);
  const breakoutAcceptance = Number(signals.breakoutAcceptance ?? 0.5);
  const pullbackControl = Number(signals.pullbackControl ?? 0.5);
  const intradayWeaknessRisk = Number(signals.intradayWeaknessRisk ?? 0.5);
  const themeContinuationStrength = Number(signals.themeContinuationStrength ?? 0.5);
  const repairConfirmation = Number(signals.repairConfirmation ?? 0.5);
  const failedContinuationRisk = Number(signals.failedContinuationRisk ?? 0.5);
  const highPositionRisk = Number(signals.highPositionRisk ?? 0.5);
  const marketPressure = Number(signals.marketPressure ?? 0.5);
  const modeFit = Number(signals.modeFit ?? 0.5);
  const minuteStateMachine = signals.minuteStateMachine ?? null;

  let score = 50;
  score += (auctionStrength - 0.5) * 16;
  score += auctionExpectationGap * 14;
  score += (leaderStrength - 0.5) * 14;
  score += (flowBackStrength - 0.5) * 10;
  score += (recloseQuality - 0.5) * 8;
  score += (sealStrength - 0.5) * 10;
  score += (supportStrength - 0.5) * 12;
  score += (recoveryStrength - 0.5) * 8;
  score += (breakoutAcceptance - 0.5) * 8;
  score += (pullbackControl - 0.5) * 8;
  score += (themeContinuationStrength - 0.5) * 10;
  score += (repairConfirmation - 0.5) * 8;
  score += (modeFit - 0.5) * 12;
  score += minuteStateMachine?.currentPhase === "一致性确认阶段" ? 8 : 0;
  score += minuteStateMachine?.currentPhase === "分歧修复阶段" ? 4 : 0;
  score -= minuteStateMachine?.currentPhase === "风险退出阶段" ? 10 : 0;
  score -= intradayWeaknessRisk * 14;
  score -= failedContinuationRisk * 18;
  score -= highPositionRisk * 18;
  score -= marketPressure * 18;

  if (decision?.overview?.environment === "进攻环境") {
    score += 6;
  }
  if (["退潮", "冰点"].includes(decision?.overview?.emotionCycle)) {
    score -= 10;
  }
  if (decision?.guardrails?.blocked || decision?.riskControl?.status === "stop-trading") {
    score -= 20;
  }

  score = Math.round(clamp(score, 0, 100));

  let action = "防守观察";
  if (decision?.guardrails?.blocked || decision?.riskControl?.status === "stop-trading") {
    action = "停止出手，等待数据和结构修复";
  } else if (score >= 72) {
    action = "允许围绕主线核心主动进攻";
  } else if (score >= 58) {
    action = "只做主线分歧转一致与回流确认";
  } else if (score >= 42) {
    action = "谨慎观察，只保留低风险确认点";
  }

  const warnings = [];
  if (auctionExpectationGap <= -0.12) {
    warnings.push("竞价明显低于预期，优先把它视作风险而不是机会");
  }
  if (failedContinuationRisk >= 0.65) {
    warnings.push("失败延续风险偏高，昨天强的今天接不住");
  }
  if (highPositionRisk >= 0.7) {
    warnings.push("高位风险扩散明显，避免中位接力");
  }
  if (leaderStrength <= 0.35) {
    warnings.push("龙头走弱，主线承接需重新确认");
  }
  if (recloseQuality <= 0.35) {
    warnings.push("回封质量差，炸板后承接不足");
  }
  if (sealStrength <= 0.35) {
    warnings.push("封单强度偏弱，板上稳定性不足");
  }
  if (supportStrength <= 0.35) {
    warnings.push("分时承接偏弱，均价线下方停留过久");
  }
  if (breakoutAcceptance <= 0.35) {
    warnings.push("冲高后的接受度不足，容易出现回落兑现");
  }
  if (pullbackControl <= 0.35) {
    warnings.push("回撤控制偏弱，分时容易由强转弱");
  }
  if (intradayWeaknessRisk >= 0.65) {
    warnings.push("盘口走弱风险偏高，需优先处理持仓而不是找新机会");
  }
  if (themeContinuationStrength <= 0.35) {
    warnings.push("主线联动不足，更像局部异动而非群体行情");
  }
  if (modeFit <= 0.35) {
    warnings.push(`盘中结构与当前模式 ${decision?.modeProfile?.primaryMode ?? "未知"} 并不匹配`);
  }
  if (minuteStateMachine?.currentPhase === "风险退出阶段") {
    warnings.push("分钟状态机已进入风险退出阶段，应优先收缩仓位");
  }
  if (marketPressure >= 0.7) {
    warnings.push("市场压力偏大，优先防守");
  }
  if (decision?.guardrails?.blocked) {
    warnings.push(...(decision.guardrails.reasons ?? []));
  }
  if (decision?.riskControl?.status === "stop-trading") {
    warnings.push(...(decision.riskControl.reasons ?? []));
  }

  const preferredSetups = [];
  if (!decision?.guardrails?.blocked && decision?.riskControl?.status !== "stop-trading" && auctionExpectationGap >= 0 && leaderStrength >= 0.6 && sealStrength >= 0.5) {
    preferredSetups.push("龙头分歧转一致");
  }
  if (!decision?.guardrails?.blocked && decision?.riskControl?.status !== "stop-trading" && flowBackStrength >= 0.58 && themeContinuationStrength >= 0.5 && supportStrength >= 0.5) {
    preferredSetups.push("主线回流低吸");
  }
  if (!decision?.guardrails?.blocked && decision?.riskControl?.status !== "stop-trading" && recloseQuality >= 0.6 && themeContinuationStrength >= 0.55 && sealStrength >= 0.52) {
    preferredSetups.push("前排换手板确认");
  }
  if (!decision?.guardrails?.blocked && decision?.riskControl?.status !== "stop-trading" && repairConfirmation >= 0.58 && ["冰点", "启动"].includes(decision?.overview?.emotionCycle)) {
    preferredSetups.push("冰点修复首个试错点");
  }

  return {
    score,
    action,
    preferredSetups,
    warnings,
    minuteStateMachine,
    reasoning: [
      `竞价强度${auctionStrength.toFixed(2)}`,
      `竞价预期差${auctionExpectationGap.toFixed(2)}`,
      `龙头强度${leaderStrength.toFixed(2)}`,
      `回流强度${flowBackStrength.toFixed(2)}`,
      `封单强度${sealStrength.toFixed(2)}`,
      `承接强度${supportStrength.toFixed(2)}`,
      `回封质量${recloseQuality.toFixed(2)}`,
      `修复力度${recoveryStrength.toFixed(2)}`,
      `主线延续${themeContinuationStrength.toFixed(2)}`,
      `修复确认${repairConfirmation.toFixed(2)}`,
      `模式匹配${modeFit.toFixed(2)}`,
      `分钟阶段${minuteStateMachine?.currentPhase ?? "未知"}`,
      `失败延续风险${failedContinuationRisk.toFixed(2)}`,
      `高位风险${highPositionRisk.toFixed(2)}`,
      `市场压力${marketPressure.toFixed(2)}`
    ]
  };
}

export function analyzeIntradayMarketState(state, decision = null) {
  const signals = deriveIntradaySignalsFromMarketState(state, decision);
  return {
    signals,
    analysis: analyzeIntradaySignals(signals, decision)
  };
}

export function formatIntradayAnalysis(result) {
  const analysis = result.analysis ?? result;
  const signals = result.signals ?? null;
  const minuteStateMachine = analysis.minuteStateMachine ?? signals?.minuteStateMachine ?? null;

  return [
    `Intraday Score: ${analysis.score}`,
    `Action: ${analysis.action}`,
    `Preferred Setups: ${analysis.preferredSetups.join(", ") || "None"}`,
    `Warnings: ${analysis.warnings.join(" | ") || "None"}`,
    `Reasoning: ${analysis.reasoning.join(" | ")}`,
    ...(minuteStateMachine ? [
      `Minute Phase: ${minuteStateMachine.currentPhase}`,
      `Minute Hint: ${minuteStateMachine.actionHint}`,
      `Entry Triggers: ${minuteStateMachine.entryTriggers.join(" | ") || "None"}`,
      `Exit Triggers: ${minuteStateMachine.exitTriggers.join(" | ") || "None"}`
    ] : []),
    ...(signals ? [
      "",
      `Derived Signals: 竞价${signals.auctionStrength}, 预期差${signals.auctionExpectationGap}, 龙头${signals.leaderStrength}, 回流${signals.flowBackStrength}, 封单${signals.sealStrength}, 承接${signals.supportStrength}, 回封${signals.recloseQuality}, 修复${signals.recoveryStrength}, 延续${signals.themeContinuationStrength}, 模式匹配${signals.modeFit}`,
      `Diagnostics: 龙头${signals.diagnostics.leaderName} | 高标${signals.diagnostics.topBoard}板 | 主线家数${signals.diagnostics.themeCount} | 早封占比${signals.diagnostics.earlySealRatio}`
    ] : [])
  ].join("\n");
}


