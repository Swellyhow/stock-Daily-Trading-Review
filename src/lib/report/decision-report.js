export function formatDecisionReport(decision) {
  const lines = [
    `Date: ${decision.meta.date ?? "N/A"}`,
    `Environment: ${decision.overview.environment}`,
    `Emotion Cycle: ${decision.overview.emotionCycle}`,
    `Primary Theme: ${decision.overview.primaryTheme}`,
    `Preferred Mode: ${decision.overview.preferredMode ?? "N/A"}`,
    `Style Preference: ${decision.overview.stylePreference ?? "N/A"}`,
    `Action Bias: ${decision.overview.actionBias}`,
    `Position Plan: ${decision.overview.positionPlan}`,
    `Guardrail Mode: ${decision.guardrails?.mode ?? "normal"}`,
    `Risk Control: ${decision.riskControl?.status ?? "normal"}`,
    `Data Confidence: ${decision.guardrails?.confidence !== null && decision.guardrails?.confidence !== undefined ? `${Math.round(decision.guardrails.confidence * 100)}%` : "N/A"}`,
    "",
    `Environment Basis: ${decision.environment.reasoning.join(" | ")}`,
    `Emotion Basis: ${decision.emotionCycle.reasoning.join(" | ")}`,
    `Regime Basis: ${decision.marketRegime.reasoning.join(" | ")}`,
    `Mode Summary: ${decision.modeProfile.summary}`,
    `Theme Summary: ${decision.themes.summary}`,
    `Leader: ${decision.leaders.leader?.name ?? "Unidentified"}`,
    `Theme Leader: ${decision.leaders.themeLeader?.name ?? "Unidentified"}`,
    `Capacity Cores: ${decision.leaders.capacityCores?.map((item) => item.name).join(", ") || "None"}`,
    `Mid Army: ${decision.leaders.midArmy?.map((item) => item.name).join(", ") || "None"}`,
    `Core Pool: ${decision.leaders.corePool.map((item) => item.name).join(", ") || "None"}`,
    `Risky Names: ${decision.leaders.riskyNames.join(", ") || "None"}`,
    `Allowed Setups: ${decision.execution.allowedSetups.join(", ") || "None"}`,
    `Forbidden Setups: ${decision.execution.forbiddenSetups.join(", ") || "None"}`,
    `Sell Style: ${decision.sellPlan?.primaryStyle ?? "None"}`,
    `Guardrail Reasons: ${decision.guardrails?.reasons?.join(" | ") || "None"}`,
    `Risk Reasons: ${decision.riskControl?.reasons?.join(" | ") || "None"}`
  ];

  return lines.join("\n");
}
