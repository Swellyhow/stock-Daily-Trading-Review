import fs from "node:fs";
import path from "node:path";
import { buildDecision } from "../orchestrator.js";
import { normalizeRawInput } from "../normalize/raw-to-snapshot.js";
import { normalizeOutcomeInput } from "../normalize/outcome-input.js";
import { formatDecisionReport } from "../report/decision-report.js";
import { archiveOutcome, archiveWorkflow, loadHistoryIndex } from "../history/archive.js";
import { buildHistorySummary, formatHistorySummary } from "../history/summary.js";
import { buildStrategySamples, buildStrategyDashboard, formatStrategyDashboard } from "../history/ledger.js";
import { buildRuleOptimizer, formatRuleOptimizer } from "../history/rule-optimizer.js";
import { buildPremarketPlan, buildPostmarketReview } from "./daily-workflow.js";
import { buildOutcomeReview, formatOutcomeReview } from "./outcome-workflow.js";
import { formatPostmarketReview, formatPremarketPlan } from "./workflow-report.js";

const UTF8_BOM = "\uFEFF";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${text}\n`, "utf8");
}

function resolveDate(dailyRun) {
  return dailyRun.date ?? dailyRun.marketNotes?.date ?? dailyRun.outcome?.date ?? null;
}

export function runDailyPipeline(dailyRun) {
  const date = resolveDate(dailyRun);
  if (!date) {
    throw new Error("Daily run requires a valid date.");
  }
  const snapshot = normalizeRawInput({
    date,
    ...(dailyRun.marketNotes ?? {})
  });
  const decision = buildDecision(snapshot);
  const decisionText = formatDecisionReport(decision);
  const premarket = buildPremarketPlan(snapshot, decision);
  const premarketText = formatPremarketPlan(premarket);
  const postmarket = buildPostmarketReview(snapshot, decision);
  const postmarketText = formatPostmarketReview(postmarket);

  archiveWorkflow("premarket", snapshot, decision, premarket, premarketText);
  archiveWorkflow("postmarket", snapshot, decision, postmarket, postmarketText);

  let outcomeReview = null;
  let outcomeText = null;
  if (dailyRun.outcome) {
    const outcome = normalizeOutcomeInput({
      date,
      ...dailyRun.outcome
    });
    outcomeReview = buildOutcomeReview(outcome, loadHistoryIndex());
    outcomeText = formatOutcomeReview(outcomeReview);
    archiveOutcome(outcome, outcomeReview, outcomeText);
  }

  const historyIndex = loadHistoryIndex();
  const historySummary = buildHistorySummary(historyIndex);
  const historySummaryText = formatHistorySummary(historySummary);
  const strategySamples = buildStrategySamples(historyIndex);
  const strategyDashboard = buildStrategyDashboard(strategySamples);
  const strategyDashboardText = formatStrategyDashboard(strategyDashboard);
  const ruleOptimizer = buildRuleOptimizer(historyIndex);
  const ruleOptimizerText = formatRuleOptimizer(ruleOptimizer);

  const outputDir = path.resolve(process.cwd(), "outputs", "daily", date);
  ensureDir(outputDir);
  writeJson(path.join(outputDir, "snapshot.json"), snapshot);
  writeJson(path.join(outputDir, "decision.json"), decision);
  writeText(path.join(outputDir, "decision.txt"), decisionText);
  writeJson(path.join(outputDir, "premarket.json"), premarket);
  writeText(path.join(outputDir, "premarket.txt"), premarketText);
  writeJson(path.join(outputDir, "postmarket.json"), postmarket);
  writeText(path.join(outputDir, "postmarket.txt"), postmarketText);
  writeJson(path.join(outputDir, "history-summary.json"), historySummary);
  writeText(path.join(outputDir, "history-summary.txt"), historySummaryText);
  writeJson(path.join(outputDir, "strategy-samples.json"), strategySamples);
  writeJson(path.join(outputDir, "strategy-dashboard.json"), strategyDashboard);
  writeText(path.join(outputDir, "strategy-dashboard.txt"), strategyDashboardText);
  writeJson(path.join(outputDir, "rule-optimizer.json"), ruleOptimizer);
  writeText(path.join(outputDir, "rule-optimizer.txt"), ruleOptimizerText);
  writeJson(path.join(outputDir, "news-catalysts.json"), snapshot.liveContext?.llmNewsAnalysis ?? null);

  if (outcomeReview && outcomeText) {
    writeJson(path.join(outputDir, "outcome.json"), outcomeReview);
    writeText(path.join(outputDir, "outcome.txt"), outcomeText);
  }

  return {
    date,
    outputDir,
    generatedFiles: fs
      .readdirSync(outputDir)
      .sort()
      .map((fileName) => path.join("outputs", "daily", date, fileName)),
    historySummary,
    strategyDashboard,
    ruleOptimizer
  };
}

export function formatDailyPipelineResult(result) {
  return [
    `Date: ${result.date}`,
    `Output Dir: ${result.outputDir}`,
    "Generated Files:",
    ...result.generatedFiles.map((file) => `- ${file}`),
    "",
    `History Entries: ${result.historySummary.totalEntries}`,
    `Outcome Count: ${result.historySummary.performance.outcomeCount}`,
    `Avg Total PnL: ${result.historySummary.performance.avgTotalPnlPct}%`,
    `Closed Samples: ${result.strategyDashboard.readiness.closedSamples}`,
    `Enough For Optimization: ${result.strategyDashboard.readiness.enoughForOptimization ? "Yes" : "No"}`,
    `Rule Actions: 保留 ${result.ruleOptimizer.ruleActions.preserve.length} / 收紧 ${result.ruleOptimizer.ruleActions.tighten.length} / 禁用 ${result.ruleOptimizer.ruleActions.disable.length} / 观察 ${result.ruleOptimizer.ruleActions.observe.length}`
  ].join("\n");
}
