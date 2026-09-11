function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function positionRank(position) {
  return {
    空仓: 0,
    轻仓: 1,
    半仓: 2,
    "7成仓": 3
  }[position] ?? 0;
}

function buildChecks(snapshot, decision) {
  const confidence = Number(snapshot?.dataQuality?.confidence ?? 0);
  const primaryTheme = decision?.themes?.primaryTheme ?? null;
  const leader = decision?.leaders?.leader ?? null;
  const mode = decision?.modeProfile?.primaryMode ?? "防守空仓";
  const allowedSetups = decision?.execution?.allowedSetups ?? [];
  const guardBlocked = Boolean(decision?.guardrails?.blocked);
  const riskStopped = decision?.riskControl?.status === "stop-trading";
  const ladderScore = Number(primaryTheme?.ladderProfile?.structureScore ?? 0);
  const leaderDriveScore = Number(primaryTheme?.ladderProfile?.leaderDriveScore ?? 0);
  const strongPremiumRatio = Number(snapshot?.market?.strongPremiumRatio ?? 0);

  return [
    {
      key: "theme",
      question: "这是不是当前明确主线？",
      passed: Boolean(primaryTheme),
      detail: primaryTheme ? `当前主线 ${primaryTheme.name}` : "当前没有明确主线"
    },
    {
      key: "leader",
      question: "这是不是主线核心股或总龙头？",
      passed: Boolean(leader),
      detail: leader ? `当前总龙头 ${leader.name}` : "当前没有识别出总龙头"
    },
    {
      key: "mode",
      question: "当前市场是否允许这种模式？",
      passed: mode !== "防守空仓",
      detail: `当前模式 ${mode}`
    },
    {
      key: "setup",
      question: "今天是否存在计划内允许买点？",
      passed: allowedSetups.length > 0,
      detail: allowedSetups.length > 0 ? `允许买点 ${allowedSetups.join("、")}` : "当前没有允许买点"
    },
    {
      key: "data",
      question: "数据和风险控制是否允许出手？",
      passed: confidence >= 0.6 && !guardBlocked && !riskStopped,
      detail: `可信度 ${Math.round(confidence * 100)}%，硬闸门 ${decision?.guardrails?.mode ?? "-"}，风控 ${decision?.riskControl?.status ?? "-"}`
    },
    {
      key: "structure",
      question: "主线梯队和带动性是否达标？",
      passed: ladderScore >= 0.48 && leaderDriveScore >= 0.45 && strongPremiumRatio >= 0.25,
      detail: `梯队 ${Math.round(ladderScore * 100)}%，带动性 ${Math.round(leaderDriveScore * 100)}%，强溢价占比 ${Math.round(strongPremiumRatio * 100)}%`
    }
  ];
}

export function applyExecutionDiscipline(snapshot, decision) {
  const checks = buildChecks(snapshot, decision);
  const failed = checks.filter((item) => !item.passed);
  const criticalFailed = failed.filter((item) => ["theme", "leader", "setup", "data"].includes(item.key));
  const next = structuredClone(decision);

  const reasons = failed.map((item) => `${item.question} 未通过：${item.detail}`);
  const status = criticalFailed.length > 0 ? "blocked" : failed.length > 0 ? "cautious" : "passed";

  next.discipline = {
    status,
    checks,
    reasons: unique(reasons),
    criticalFailed: criticalFailed.map((item) => item.key)
  };

  if (status === "blocked") {
    next.execution.actionBias = "停止出手";
    next.position.totalPosition = "空仓";
    next.position.structure = { leaderCore: 0, secondaryCore: 0, trial: 0 };
    next.execution.allowedSetups = [];
    next.execution.forbiddenSetups = unique([
      ...(next.execution.forbiddenSetups ?? []),
      "未通过盘中六问仍强行出手",
      "计划外临时追涨"
    ]);
    next.overview.actionBias = next.execution.actionBias;
    next.overview.positionPlan = next.position.totalPosition;
  } else if (status === "cautious") {
    next.execution.actionBias = next.execution.actionBias === "主动进攻" ? "精选出手" : next.execution.actionBias;
    next.position.totalPosition = positionRank(next.position.totalPosition) > positionRank("轻仓") ? "轻仓" : next.position.totalPosition;
    next.overview.actionBias = next.execution.actionBias;
    next.overview.positionPlan = next.position.totalPosition;
  }

  return next;
}
