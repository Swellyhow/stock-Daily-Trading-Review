import fs from "node:fs";
import path from "node:path";
import { buildRuleOptimizer, formatRuleOptimizer } from "./rule-optimizer.js";

const UTF8_BOM = "\uFEFF";

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function groupByDate(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry.date || entry.date === "undated") {
      continue;
    }
    if (!map.has(entry.date)) {
      map.set(entry.date, []);
    }
    map.get(entry.date).push(entry);
  }
  return map;
}

function aggregatePerformance(samples, key) {
  const map = new Map();
  for (const sample of samples) {
    if (!sample.hasOutcome || !sample[key]) {
      continue;
    }
    if (!map.has(sample[key])) {
      map.set(sample[key], { name: sample[key], pnl: [], winRate: [], matchedPlanRate: [], count: 0 });
    }
    const agg = map.get(sample[key]);
    agg.count += 1;
    agg.pnl.push(Number(sample.totalPnlPct ?? 0));
    agg.winRate.push(Number(sample.winRate ?? 0));
    agg.matchedPlanRate.push(Number(sample.matchedPlanRate ?? 0));
  }
  return [...map.values()]
    .map((item) => ({
      name: item.name,
      sampleCount: item.count,
      avgPnlPct: average(item.pnl),
      avgWinRate: average(item.winRate),
      avgMatchedPlanRate: average(item.matchedPlanRate)
    }))
    .sort((a, b) => b.avgPnlPct - a.avgPnlPct);
}

export function buildStrategySamples(index) {
  const grouped = groupByDate(index.entries ?? []);
  const samples = [];

  for (const [date, entries] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const premarket = entries.find((entry) => entry.type === "premarket") ?? null;
    const postmarket = entries.find((entry) => entry.type === "postmarket") ?? null;
    const outcome = entries.find((entry) => entry.type === "outcome") ?? null;
    const anchor = postmarket ?? premarket ?? outcome;
    if (!anchor) {
      continue;
    }

    const confidenceValues = [premarket?.dataConfidence, postmarket?.dataConfidence].filter((value) => value !== undefined && value !== null);
    const sample = {
      date,
      hasPremarket: Boolean(premarket),
      hasPostmarket: Boolean(postmarket),
      hasOutcome: Boolean(outcome),
      environment: anchor.environment ?? null,
      emotionCycle: anchor.emotionCycle ?? null,
      primaryTheme: anchor.primaryTheme ?? null,
      actionBias: anchor.actionBias ?? null,
      positionPlan: anchor.positionPlan ?? null,
      dataConfidence: confidenceValues.length > 0 ? average(confidenceValues) : null,
      guardrailMode: postmarket?.guardrailMode ?? premarket?.guardrailMode ?? null,
      hardStop: Boolean(postmarket?.guardrailBlocked ?? premarket?.guardrailBlocked),
      totalPnlPct: outcome?.totalPnlPct ?? null,
      realizedPnlPct: outcome?.realizedPnlPct ?? null,
      winRate: outcome?.winRate ?? null,
      disciplineScore: outcome?.disciplineScore ?? null,
      matchedPlanRate: outcome?.matchedPlanRate ?? null,
      bestSetup: outcome?.setupBreakdown?.[0]?.setup ?? null,
      worstSetup: outcome?.setupBreakdown?.length > 0 ? outcome.setupBreakdown[outcome.setupBreakdown.length - 1].setup : null
    };

    sample.regimeKey = [sample.environment, sample.emotionCycle, sample.primaryTheme].filter(Boolean).join(" | ") || null;
    sample.sampleStatus = sample.hasOutcome ? "closed" : "open";
    samples.push(sample);
  }

  return samples;
}

export function buildStrategyDashboard(samples) {
  const closedSamples = samples.filter((sample) => sample.hasOutcome);
  const hardStopCount = samples.filter((sample) => sample.hardStop).length;
  const environmentPerformance = aggregatePerformance(closedSamples, "environment");
  const themePerformance = aggregatePerformance(closedSamples, "primaryTheme");
  const regimePerformance = aggregatePerformance(closedSamples, "regimeKey");

  const readiness = {
    totalSamples: samples.length,
    closedSamples: closedSamples.length,
    openSamples: samples.length - closedSamples.length,
    enoughForOptimization: closedSamples.length >= 20,
    enoughForCrossRegimeComparison: closedSamples.length >= 40
  };

  const warnings = [];
  if (closedSamples.length < 20) {
    warnings.push("闭环样本少于20天，当前统计更适合作为观察，不适合大幅改规则。");
  }
  if (hardStopCount > samples.length / 3 && samples.length > 0) {
    warnings.push("硬闸门触发偏多，说明数据质量或市场条件经常不足，需检查采集稳定性和出手条件。");
  }

  return {
    readiness,
    hardStopCount,
    environmentPerformance,
    themePerformance,
    regimePerformance,
    warnings
  };
}

export function formatStrategyDashboard(dashboard) {
  const bestEnvironment = dashboard.environmentPerformance[0] ?? null;
  const bestTheme = dashboard.themePerformance[0] ?? null;
  const bestRegime = dashboard.regimePerformance[0] ?? null;

  return [
    `Total Samples: ${dashboard.readiness.totalSamples}`,
    `Closed Samples: ${dashboard.readiness.closedSamples}`,
    `Open Samples: ${dashboard.readiness.openSamples}`,
    `Enough For Optimization: ${dashboard.readiness.enoughForOptimization ? "Yes" : "No"}`,
    `Enough For Cross Regime Comparison: ${dashboard.readiness.enoughForCrossRegimeComparison ? "Yes" : "No"}`,
    `Hard Stop Count: ${dashboard.hardStopCount}`,
    `Best Environment: ${bestEnvironment ? `${bestEnvironment.name}(${bestEnvironment.avgPnlPct}%)` : "None"}`,
    `Best Theme: ${bestTheme ? `${bestTheme.name}(${bestTheme.avgPnlPct}%)` : "None"}`,
    `Best Regime: ${bestRegime ? `${bestRegime.name}(${bestRegime.avgPnlPct}%)` : "None"}`,
    "",
    "Warnings:",
    ...(dashboard.warnings.length > 0 ? dashboard.warnings.map((item) => `- ${item}`) : ["- None"])
  ].join("\n");
}

export function writeHistoryArtifacts(index) {
  const historyDir = path.resolve(process.cwd(), "outputs", "history");
  fs.mkdirSync(historyDir, { recursive: true });
  const samples = buildStrategySamples(index);
  const dashboard = buildStrategyDashboard(samples);
  const ruleOptimizer = buildRuleOptimizer(index);
  writeJson(path.join(historyDir, "samples.json"), samples);
  writeJson(path.join(historyDir, "dashboard.json"), dashboard);
  writeJson(path.join(historyDir, "rule-optimizer.json"), ruleOptimizer);
  fs.writeFileSync(path.join(historyDir, "dashboard.txt"), `${UTF8_BOM}${formatStrategyDashboard(dashboard)}\n`, "utf8");
  fs.writeFileSync(path.join(historyDir, "rule-optimizer.txt"), `${UTF8_BOM}${formatRuleOptimizer(ruleOptimizer)}\n`, "utf8");
  return { samples, dashboard, ruleOptimizer };
}
