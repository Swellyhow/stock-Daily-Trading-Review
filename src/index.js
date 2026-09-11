import fs from "node:fs";
import { buildDecision } from "./lib/orchestrator.js";
import { readJsonFile } from "./lib/io.js";
import { fetchEastmoneyMarketState, fetchEastmoneyIntradayMicrostructure } from "./lib/collector/eastmoney-auto.js";
import { fetchMxDecisionContext } from "./lib/collector/mx-api.js";
import { buildSnapshotFromLiveMarketState } from "./lib/collector/live-to-snapshot.js";
import { analyzeNewsCatalysts } from "./lib/llm/news-catalyst-analyzer.js";
import { normalizeRawInput } from "./lib/normalize/raw-to-snapshot.js";
import { normalizeOutcomeInput } from "./lib/normalize/outcome-input.js";
import { normalizeOutcomeBatchInput } from "./lib/normalize/outcome-batch.js";
import { normalizeDailyMarkdown } from "./lib/normalize/daily-markdown.js";
import { normalizePositionSellInput } from "./lib/normalize/position-sell-input.js";
import { formatDecisionReport } from "./lib/report/decision-report.js";
import { buildDecisionExplanation, formatDecisionExplanation } from "./lib/llm/decision-explainer.js";
import { buildPremarketPlan, buildPostmarketReview } from "./lib/workflow/daily-workflow.js";
import { runDailyPipeline, formatDailyPipelineResult } from "./lib/workflow/daily-pipeline.js";
import { analyzeIntradaySignals, analyzeIntradayMarketState, formatIntradayAnalysis } from "./lib/workflow/intraday-workflow.js";
import { buildOutcomeReview, formatOutcomeReview } from "./lib/workflow/outcome-workflow.js";
import { archiveOutcomeBatch, formatOutcomeBatchArchive } from "./lib/workflow/outcome-batch-workflow.js";
import { buildPositionSellPlan, formatPositionSellPlan } from "./lib/workflow/position-sell-workflow.js";
import { formatPremarketPlan, formatPostmarketReview } from "./lib/workflow/workflow-report.js";
import { archiveWorkflow, archiveOutcome, loadHistoryIndex } from "./lib/history/archive.js";
import { archiveLiveDecision } from "./lib/history/live-archive.js";
import { buildHistorySummary, formatHistorySummary } from "./lib/history/summary.js";

function parseArgs(argv) {
  const args = {
    input: "data/examples/sample_snapshot.json",
    mode: "analyze",
    format: "json",
    date: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--mode" && argv[i + 1]) {
      args.mode = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--format" && argv[i + 1]) {
      args.format = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--date" && argv[i + 1]) {
      args.date = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function buildLiveDecisionContext(date) {
  const state = await fetchEastmoneyMarketState(date ? date.replace(/-/g, "") : null);
  const mxContext = await fetchMxDecisionContext(state).catch((error) => ({
    themeSeeds: [],
    warnings: [`MX integration unavailable: ${error.message}`],
    newsItems: [],
    screenedStocks: [],
    marketHighlights: [],
    themeCatalysts: [],
    screeningStats: { count: 0, avgChangePct: 0, topCandidates: [] },
    marketPulse: []
  }));
  const newsAnalysis = await analyzeNewsCatalysts({ ...state, mxContext }).catch((error) => ({
    source: "rule-fallback",
    model: null,
    attemptedModels: [],
    warning: error.message,
    candidateThemes: [],
    newsCount: 0,
    themeCatalysts: [],
    catalystBuckets: {},
    rejectedNews: []
  }));

  let assembledState = { ...state, mxContext, newsAnalysis, intradayMicrostructure: [] };
  let snapshot = buildSnapshotFromLiveMarketState(assembledState);
  let decision = buildDecision(snapshot);

  const watchNames = buildWatchNames(decision);
  const intradayMicrostructure = await fetchEastmoneyIntradayMicrostructure([state.limitUpPool, state.previousLimitUpPool, mxContext.screenedStocks ?? []], watchNames).catch(() => []);
  if (intradayMicrostructure.length > 0) {
    assembledState = { ...assembledState, intradayMicrostructure };
    snapshot = buildSnapshotFromLiveMarketState(assembledState);
    decision = buildDecision(snapshot);
  }

  const llmExplanation = await buildDecisionExplanation(snapshot, decision);
  return { state: assembledState, snapshot, decision, llmExplanation };
}

function formatCatalystDetails(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- None";
  }

  return items
    .slice(0, 3)
    .map((item) => [
      `- ${item.theme} [${item.eventType}/${item.sentiment}/${Math.round((item.strength ?? 0) * 100)}%]`,
      `  原因: ${item.reason || "None"}`,
      `  细化: ${item.detailedReason || "None"}`,
      `  影响: ${item.decisionImpact || "None"}`,
      `  风险: ${item.riskNote || "None"}`,
      `  关联新闻: ${(item.headlineTitles ?? []).join(" | ") || "None"}`
    ].join("\n"))
    .join("\n");
}

function buildWatchNames(decision) {
  return [...new Set([
    decision?.leaders?.leader?.name,
    decision?.leaders?.themeLeader?.name,
    ...(decision?.leaders?.capacityCores ?? []).map((item) => item.name),
    ...(decision?.leaders?.midArmy ?? []).map((item) => item.name),
    ...(decision?.leaders?.turnoverCandidates ?? []).map((item) => item.name),
    ...(decision?.leaders?.lowPositionCandidates ?? []).map((item) => item.name),
    ...(decision?.leaders?.corePool ?? []).map((item) => item.name)
  ].filter(Boolean))].slice(0, 12);
}

function formatRejectedNews(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- None";
  }

  return items
    .slice(0, 5)
    .map((item) => `- ${item.title}: ${item.reason}`)
    .join("\n");
}

function formatAutoLiveReport(snapshot, decision, premarket, llmExplanation) {
  const conceptLines = (snapshot.liveContext?.conceptBoards ?? [])
    .slice(0, 5)
    .map((item) => `${item.name}(${item.changePct}%)`)
    .join(", ");
  const newsLines = (snapshot.liveContext?.fastNews ?? [])
    .slice(0, 5)
    .map((item) => `- ${item.title}`)
    .join("\n");
  const mxNewsLines = (snapshot.liveContext?.mxNews ?? [])
    .slice(0, 5)
    .map((item) => `- ${item.title}`)
    .join("\n");
  const mxScreenLines = (snapshot.liveContext?.mxScreenedStocks ?? [])
    .slice(0, 5)
    .map((item) => `${item.name}${Number.isFinite(item.changePct) ? `(${item.changePct}%)` : ""}`)
    .join(", ");
  const mxCatalystLines = (snapshot.liveContext?.mxThemeCatalysts ?? [])
    .slice(0, 3)
    .map((item) => `${item.theme}(${Math.round(item.catalystScore * 100)}%)`)
    .join(", ");
  const llmCatalysts = (snapshot.liveContext?.llmNewsAnalysis?.themeCatalysts ?? []).slice(0, 3);
  const llmCatalystLines = llmCatalysts
    .map((item) => `${item.theme}(${Math.round(item.strength * 100)}%,${item.sentiment},${item.eventType})`)
    .join(", ");
  const rejectedNewsLines = formatRejectedNews(snapshot.liveContext?.llmNewsAnalysis?.rejectedNews ?? []);
  const detailedCatalystLines = formatCatalystDetails(llmCatalysts);
  const catalystBucketLines = Object.entries(snapshot.liveContext?.llmNewsAnalysis?.catalystBuckets ?? {})
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([key, items]) => `${key}:${items.length}`)
    .join(", ");
  const mxMarketLines = (snapshot.liveContext?.mxMarketPulse ?? [])
    .slice(0, 3)
    .map((item) => item.summary)
    .join(", ");
  const warningLines = (snapshot.dataQuality?.warnings ?? [])
    .map((item) => `- ${item}`)
    .join("\n");

  return [
    formatDecisionReport(decision),
    "",
    `Top Concepts: ${conceptLines || "None"}`,
    "Fast News:",
    newsLines || "- None",
    "",
    `MX Theme Seeds: ${(snapshot.liveContext?.mxThemeSeeds ?? []).join(", ") || "None"}`,
    `MX Theme Catalysts: ${mxCatalystLines || "None"}`,
    `LLM News Catalysts: ${llmCatalystLines || "None"}`,
    `Catalyst Buckets: ${catalystBucketLines || "None"}`,
    "Catalyst Details:",
    detailedCatalystLines,
    "Rejected News:",
    rejectedNewsLines,
    `MX Screen Candidates: ${mxScreenLines || "None"}`,
    `MX Market Pulse: ${mxMarketLines || "None"}`,
    "MX News:",
    mxNewsLines || "- None",
    "",
    formatDecisionExplanation(llmExplanation),
    "",
    "Warnings:",
    warningLines || "- None",
    "",
    `Premarket Leader: ${premarket.watchlist.leader}`,
    `Premarket Core Pool: ${premarket.watchlist.corePool.join(", ") || "None"}`
  ].join("\n");
}

function printOutput(data, format, formatter) {
  if (format === "text") {
    console.log(formatter(data));
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "history-summary") {
    const summary = buildHistorySummary(loadHistoryIndex());
    printOutput(summary, args.format, formatHistorySummary);
    return;
  }

  if (args.mode === "auto-live") {
    const { snapshot, decision, llmExplanation } = await buildLiveDecisionContext(args.date);
    const premarket = buildPremarketPlan(snapshot, decision);
    const payload = { snapshot, decision, premarket, llmExplanation };
    const text = formatAutoLiveReport(snapshot, decision, premarket, llmExplanation);
    archiveLiveDecision(args.date ?? snapshot.date, snapshot, decision, premarket, llmExplanation, text);
    printOutput(payload, args.format, () => text);
    return;
  }

  if (args.mode === "intraday-live") {
    const { state, decision, llmExplanation } = await buildLiveDecisionContext(args.date);
    const result = analyzeIntradayMarketState(state, decision);
    printOutput({ ...result, llmExplanation }, args.format, (payload) => [formatIntradayAnalysis(payload), "", formatDecisionExplanation(llmExplanation)].join("\n"));
    return;
  }

  if (args.mode === "intraday") {
    const { json } = readJsonFile(args.input);
    const result = analyzeIntradaySignals(json);
    printOutput(result, args.format, formatIntradayAnalysis);
    return;
  }

  if (args.mode === "daily") {
    const { json } = readJsonFile(args.input);
    const result = runDailyPipeline(json);
    printOutput(result, args.format, formatDailyPipelineResult);
    return;
  }

  if (args.mode === "daily-markdown") {
    const markdown = fs.readFileSync(args.input, "utf8");
    const result = runDailyPipeline(normalizeDailyMarkdown(markdown));
    printOutput(result, args.format, formatDailyPipelineResult);
    return;
  }

  if (args.mode === "outcome" || args.mode === "archive-outcome") {
    const { json } = readJsonFile(args.input);
    const outcome = normalizeOutcomeInput(json);
    const review = buildOutcomeReview(outcome, loadHistoryIndex());
    const text = formatOutcomeReview(review);
    if (args.mode === "archive-outcome") {
      archiveOutcome(outcome, review, text);
    }
    printOutput(review, args.format, () => text);
    return;
  }

  if (args.mode === "archive-outcome-batch") {
    const { json } = readJsonFile(args.input);
    const outcomes = normalizeOutcomeBatchInput(json);
    const result = archiveOutcomeBatch(outcomes);
    printOutput(result, args.format, formatOutcomeBatchArchive);
    return;
  }

  if (args.mode === "position-sell") {
    const { json } = readJsonFile(args.input);
    const normalized = normalizePositionSellInput(json);
    const snapshot = normalizeRawInput({
      date: normalized.date,
      ...(normalized.marketNotes ?? {})
    });
    const decision = buildDecision(snapshot);
    const plan = buildPositionSellPlan(snapshot, decision, normalized.holdings);
    printOutput({ snapshot, decision, plan }, args.format, () => formatPositionSellPlan(plan));
    return;
  }

  const { json } = readJsonFile(args.input);
  const snapshot = args.mode === "analyze" ? json : normalizeRawInput(json);

  if (args.mode === "normalize") {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const decision = buildDecision(snapshot);

  if (args.mode === "premarket" || args.mode === "archive-premarket") {
    const payload = buildPremarketPlan(snapshot, decision);
    const text = formatPremarketPlan(payload);
    if (args.mode === "archive-premarket") {
      archiveWorkflow("premarket", snapshot, decision, payload, text);
    }
    printOutput(payload, args.format, () => text);
    return;
  }

  if (args.mode === "postmarket" || args.mode === "archive-postmarket") {
    const payload = buildPostmarketReview(snapshot, decision);
    const text = formatPostmarketReview(payload);
    if (args.mode === "archive-postmarket") {
      archiveWorkflow("postmarket", snapshot, decision, payload, text);
    }
    printOutput(payload, args.format, () => text);
    return;
  }

  if (args.format === "text") {
    console.log(formatDecisionReport(decision));
    return;
  }

  console.log(JSON.stringify(decision, null, 2));
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});

