function positionRank(position) {
  return {
    空仓: 0,
    轻仓: 1,
    半仓: 2,
    '7成仓': 3
  }[position] ?? 0;
}

function minPosition(a, b) {
  return positionRank(a) <= positionRank(b) ? a : b;
}

function buildGuardrails(snapshot, decision) {
  const confidence = snapshot?.dataQuality?.confidence ?? null;
  const warnings = snapshot?.dataQuality?.warnings ?? [];
  const reasons = [];
  let mode = 'normal';
  let blocked = false;
  let maxPosition = decision.position.totalPosition;
  let forcedActionBias = decision.execution.actionBias;

  if (confidence !== null && confidence < 0.45) {
    mode = 'hard-stop';
    blocked = true;
    maxPosition = '空仓';
    forcedActionBias = '停止出手';
    reasons.push('数据可信度过低，禁止给出主动交易建议');
  } else if (confidence !== null && confidence < 0.6) {
    mode = 'cautious';
    maxPosition = minPosition(decision.position.totalPosition, '轻仓');
    if (['主动进攻', '精选出手'].includes(forcedActionBias)) {
      forcedActionBias = '防守观察';
    }
    reasons.push('数据完整度不足，仅允许保守结论');
  }

  if (!decision.themes.primaryTheme) {
    mode = mode === 'hard-stop' ? mode : 'cautious';
    maxPosition = minPosition(maxPosition, '轻仓');
    if (forcedActionBias === '主动进攻') {
      forcedActionBias = '防守观察';
    }
    reasons.push('未识别出明确主线，禁止激进进攻');
  }

  if ((snapshot?.market?.limitUpCount ?? 0) < 15 && (snapshot?.market?.limitDownCount ?? 0) > 10) {
    mode = mode === 'hard-stop' ? mode : 'cautious';
    maxPosition = minPosition(maxPosition, '轻仓');
    forcedActionBias = forcedActionBias === '停止出手' ? forcedActionBias : '防守观察';
    reasons.push('市场负反馈偏强，降低仓位和出手频率');
  }

  if (warnings.some((item) => /主线判断可信度很低|未形成有效题材候选/.test(item))) {
    mode = 'hard-stop';
    blocked = true;
    maxPosition = '空仓';
    forcedActionBias = '停止出手';
    reasons.push('关键基础数据缺失，禁止生成交易性结论');
  }

  return {
    mode,
    blocked,
    confidence,
    reasons: [...new Set(reasons)],
    maxPosition,
    forcedActionBias
  };
}

export function applyDecisionGuardrails(snapshot, decision) {
  const guardrails = buildGuardrails(snapshot, decision);
  const next = structuredClone(decision);

  next.guardrails = guardrails;
  next.execution.actionBias = guardrails.forcedActionBias;
  next.position.totalPosition = guardrails.maxPosition;

  if (guardrails.mode === 'hard-stop') {
    next.execution.allowedSetups = [];
    next.execution.forbiddenSetups = [...new Set([
      ...next.execution.forbiddenSetups,
      '数据不完整时强行出手',
      '无主线环境主动进攻'
    ])];
    next.position.structure = { leaderCore: 0, secondaryCore: 0, trial: 0 };
  } else if (guardrails.mode === 'cautious') {
    next.execution.allowedSetups = next.execution.allowedSetups.filter((item) => [
      '龙头分歧转一致',
      '前排换手板确认',
      '主线回流低吸'
    ].includes(item) || item === '龙头分歧转一致' || item === '前排换手板确认');

    if (next.position.totalPosition === '轻仓') {
      next.position.structure = { leaderCore: 0.1, secondaryCore: 0.1, trial: 0.05 };
    }
  }

  next.overview.actionBias = next.execution.actionBias;
  next.overview.positionPlan = next.position.totalPosition;
  return next;
}
