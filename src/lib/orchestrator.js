import { analyzeMarketRegime } from "./rules/market-regime.js";
import { analyzeEnvironment } from "./rules/environment.js";
import { analyzeEmotionCycle } from "./rules/emotion-cycle.js";
import { analyzeThemes } from "./rules/themes.js";
import { analyzeLeaders } from "./rules/leaders.js";
import { analyzeTradingMode } from "./rules/mode-engine.js";
import { analyzeExecution } from "./rules/execution.js";
import { analyzePosition } from "./rules/position.js";
import { analyzeSellPlan } from "./rules/sell.js";
import { applyDecisionGuardrails } from "./governance/decision-guardrails.js";
import { applyTradingRiskControls } from "./governance/trading-risk.js";
import { applyExecutionDiscipline } from "./governance/execution-discipline.js";
import { buildDecisionReasons } from "./explanations/decision-reasons.js";

export function buildDecision(snapshot) {
  const marketRegime = analyzeMarketRegime(snapshot.market);
  const environment = analyzeEnvironment(snapshot.market, marketRegime);
  const emotionCycle = analyzeEmotionCycle(snapshot.market, environment, marketRegime);
  const themes = analyzeThemes(snapshot.themes ?? []);
  const leaders = analyzeLeaders(snapshot.stocks ?? [], themes.primaryTheme?.name);
  const modeProfile = analyzeTradingMode({
    market: snapshot.market,
    marketRegime,
    environment,
    emotionCycle,
    primaryTheme: themes.primaryTheme,
    leaders
  });
  const execution = analyzeExecution({
    market: snapshot.market,
    marketRegime,
    environment,
    emotionCycle,
    primaryTheme: themes.primaryTheme,
    leaders,
    modeProfile
  });
  const position = analyzePosition({
    marketRegime,
    environment,
    emotionCycle,
    primaryTheme: themes.primaryTheme,
    leaders,
    execution,
    modeProfile
  });
  const sellPlan = analyzeSellPlan({
    market: snapshot.market,
    marketRegime,
    environment,
    emotionCycle,
    primaryTheme: themes.primaryTheme,
    leaders,
    execution,
    position,
    modeProfile
  });

  const decision = {
    meta: {
      date: snapshot.date ?? null,
      generatedAt: new Date().toISOString()
    },
    overview: {
      environment: environment.label,
      emotionCycle: emotionCycle.label,
      primaryTheme: themes.primaryTheme?.name ?? "No clear mainline",
      actionBias: execution.actionBias,
      positionPlan: position.totalPosition,
      preferredMode: modeProfile.primaryMode,
      stylePreference: marketRegime.stylePreference
    },
    marketRegime,
    environment,
    emotionCycle,
    themes,
    leaders,
    modeProfile,
    execution,
    position,
    sellPlan
  };

  const guardedDecision = applyDecisionGuardrails(snapshot, decision);
  const riskControlledDecision = applyTradingRiskControls(snapshot, guardedDecision);
  const finalDecision = applyExecutionDiscipline(snapshot, riskControlledDecision);
  finalDecision.analysisReasons = buildDecisionReasons(snapshot, finalDecision);
  return finalDecision;
}



