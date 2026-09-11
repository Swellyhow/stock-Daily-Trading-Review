import { normalizeOutcomeInput } from "../normalize/outcome-input.js";
import { buildOutcomeReview } from "./outcome-workflow.js";
import { archiveOutcome, loadHistoryIndex } from "../history/archive.js";

export function archiveOutcomeBatch(rawOutcomes = []) {
  const results = [];

  for (const raw of rawOutcomes) {
    const normalized = normalizeOutcomeInput(raw);
    const historyIndex = loadHistoryIndex();
    const review = buildOutcomeReview(normalized, historyIndex);
    const text = [
      `Date: ${review.date ?? "N/A"}`,
      `Total PnL: ${review.performance.totalPnlPct}%`,
      `Trade Count: ${review.performance.tradeCount}`,
      `Matched Plan Rate: ${Math.round(review.executionStats.matchedPlanRate * 100)}%`
    ].join("\n");
    archiveOutcome(normalized, review, text);
    results.push({
      date: review.date,
      tradeCount: review.performance.tradeCount,
      totalPnlPct: review.performance.totalPnlPct,
      matchedPlanRate: review.executionStats.matchedPlanRate
    });
  }

  return {
    importedCount: results.length,
    results
  };
}

export function formatOutcomeBatchArchive(result) {
  return [
    `Imported Outcomes: ${result.importedCount}`,
    ...(result.results.length > 0
      ? result.results.map((item) => `- ${item.date}: trades ${item.tradeCount}, pnl ${item.totalPnlPct}%, matched ${Math.round(item.matchedPlanRate * 100)}%`)
      : ["- None"])
  ].join("\n");
}
