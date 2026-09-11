export function analyzeSellPlan({
  market = {},
  marketRegime,
  environment,
  emotionCycle,
  primaryTheme,
  leaders,
  execution,
  position,
  modeProfile
}) {
  const avgPremiumPct = Number(market.avgYesterdayPremiumPct ?? 0);
  const strongPremiumRatio = Number(market.strongPremiumRatio ?? 0);
  const deepNegativeRatio = Number(market.deepNegativeRatio ?? 0);
  const leaderName = leaders?.leader?.name ?? "未识别";
  const capacityCoreName = leaders?.capacityCores?.[0]?.name ?? leaders?.midArmy?.[0]?.name ?? "未识别";
  const cautiousMode = ["冰点", "退潮"].includes(emotionCycle?.label) || (environment?.score ?? 0) <= 45;

  let primaryStyle = "冲高分批兑现，保留最强核心观察仓";
  if (position?.totalPosition === "空仓") {
    primaryStyle = "空仓等待，不做交易型持仓";
  } else if (cautiousMode) {
    primaryStyle = "以兑现和防守为主，不做情绪化格局";
  } else if ((environment?.score ?? 0) >= 75 && strongPremiumRatio >= 0.45) {
    primaryStyle = "强势环境可让利润奔跑，但只能留主线最强核心";
  }

  const stateMachine = [
    {
      state: "进攻持有",
      action: "继续持有或只做小幅减仓",
      triggers: [
        "主线继续回流",
        `${leaderName} 继续维持带动性`,
        `容量核心 ${capacityCoreName} 放量不走坏`
      ]
    },
    {
      state: "兑现阶段",
      action: "分批止盈",
      triggers: [
        "预期差兑现后冲高乏力",
        "后排明显扩散但前排开始分歧",
        "持仓已进入高浮盈区间"
      ]
    },
    {
      state: "防守观察仓",
      action: "减仓到观察仓",
      triggers: [
        "情绪转弱但主线尚未完全死亡",
        "龙头仍活但中位和后排掉队",
        "市场风格切向防守轮动"
      ]
    },
    {
      state: "退出",
      action: "清仓",
      triggers: [
        "竞价明显低于预期",
        "回封失败且承接消失",
        "情绪退潮信号批量出现"
      ]
    }
  ];

  const takeProfitRules = [
    "分歧转一致次日高开冲高且板块同步给反馈，优先分批兑现先手。",
    "主线核心出现一致性加速，而后排开始扩散时，不追高，已有仓位优先落袋。",
    "容量核心放量冲高但板块跟随变弱时，先兑现一部分，再看龙头是否继续带动。"
  ];

  const stopLossRules = [
    "买入逻辑被证伪时先认错，不等待情绪修复替你解套。",
    "龙头或核心股竞价明显低于预期、回封失败、承接消失，按计划减仓或清仓。",
    "非主线、非核心、非计划内交易一旦不及预期，默认快速退出。"
  ];

  const emotionDeteriorationSignals = [
    "昨日强股平均溢价明显走弱或强溢价占比下降。",
    "高位股批量负反馈，跌停和核按钮开始扩散。",
    "主线内部只剩龙头孤撑，中位和后排同步掉队。"
  ];

  const structureFailureSignals = [
    `${leaderName} 分时转弱、炸板后无法回封，说明情绪锚点失效。`,
    `${capacityCoreName} 量价背离、承接明显衰竭，说明容量资金开始撤退。`,
    "板块回流失败，第一次反抽不能带动前排和容量核心共振。"
  ];

  const holdConditions = [
    "龙头分歧后仍有承接，且板块前排继续晋级。",
    "容量核心放量上涨，中军或趋势核心同步加强。",
    `昨日强股平均溢价维持正值，强溢价占比仍在 ${Math.round(strongPremiumRatio * 100)}% 以上附近。`
  ];

  const notes = [
    `当前昨日强股平均溢价约 ${avgPremiumPct.toFixed(2)}%，强溢价占比 ${Math.round(strongPremiumRatio * 100)}%，深度负反馈占比 ${Math.round(deepNegativeRatio * 100)}%。`,
    `环境 ${environment?.label ?? "未知"} / 情绪 ${emotionCycle?.label ?? "未知"} / 风格 ${marketRegime?.stylePreference ?? "未知"} 下，卖点优先级高于追求利润最大化。`,
    `当前主模式是 ${modeProfile?.primaryMode ?? "未知模式"}，执行动作仍受 ${execution?.actionBias ?? "未知动作"} 与 ${position?.totalPosition ?? "未知仓位"} 约束。`
  ];

  return {
    primaryStyle,
    stateMachine,
    takeProfitRules,
    stopLossRules,
    emotionDeteriorationSignals,
    structureFailureSignals,
    holdConditions,
    notes
  };
}
