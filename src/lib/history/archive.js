import fs from "node:fs";
import path from "node:path";
import { writeHistoryArtifacts } from "./ledger.js";

const UTF8_BOM = "\uFEFF";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, `${UTF8_BOM}${text}\n`, "utf8");
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(stripBom(fs.readFileSync(filePath, "utf8")));
}

function upsertIndexEntry(entry) {
  const indexPath = path.resolve(process.cwd(), "outputs", "history", "index.json");
  const index = readJsonIfExists(indexPath, { entries: [] });
  const filtered = index.entries.filter((item) => !(item.date === entry.date && item.type === entry.type));
  filtered.push(entry);
  filtered.sort((a, b) => `${a.date}-${a.type}`.localeCompare(`${b.date}-${b.type}`));
  const updatedIndex = { entries: filtered };
  writeJson(indexPath, updatedIndex);
  writeHistoryArtifacts(updatedIndex);
  return updatedIndex;
}

export function archiveWorkflow(type, snapshot, decision, payload, formattedText) {
  const date = snapshot.date ?? decision.meta.date ?? "undated";
  const baseDir = path.resolve(process.cwd(), "outputs", "history", date);
  ensureDir(baseDir);

  const jsonFile = path.join(baseDir, `${type}.json`);
  const textFile = path.join(baseDir, `${type}.txt`);
  writeJson(jsonFile, payload);
  writeText(textFile, formattedText);

  return upsertIndexEntry({
    date,
    type,
    generatedAt: decision.meta.generatedAt,
    environment: decision.overview.environment,
    emotionCycle: decision.overview.emotionCycle,
    primaryTheme: decision.overview.primaryTheme,
    actionBias: decision.execution.actionBias,
    positionPlan: decision.position.totalPosition,
    sellStyle: decision.sellPlan?.primaryStyle ?? null,
    leader: decision.leaders.leader?.name ?? null,
    themeLeader: decision.leaders.themeLeader?.name ?? null,
    capacityCores: decision.leaders.capacityCores?.map((item) => item.name) ?? [],
    midArmy: decision.leaders.midArmy?.map((item) => item.name) ?? [],
    dataConfidence: snapshot.dataQuality?.confidence ?? null,
    guardrailMode: decision.guardrails?.mode ?? null,
    guardrailBlocked: decision.guardrails?.blocked ?? false,
    llmNewsCatalysts: snapshot.liveContext?.llmNewsAnalysis?.themeCatalysts ?? [],
    llmNewsBuckets: snapshot.liveContext?.llmNewsAnalysis?.catalystBuckets ?? {},
    artifacts: {
      json: path.relative(process.cwd(), jsonFile),
      text: path.relative(process.cwd(), textFile)
    }
  });
}

export function archiveOutcome(outcome, review, formattedText) {
  const date = outcome.date ?? "undated";
  const baseDir = path.resolve(process.cwd(), "outputs", "history", date);
  ensureDir(baseDir);

  const jsonFile = path.join(baseDir, "outcome.json");
  const textFile = path.join(baseDir, "outcome.txt");
  writeJson(jsonFile, review);
  writeText(textFile, formattedText);

  return upsertIndexEntry({
    date,
    type: "outcome",
    generatedAt: new Date().toISOString(),
    totalPnlPct: review.performance.totalPnlPct,
    realizedPnlPct: review.performance.realizedPnlPct,
    maxDrawdownPct: review.performance.maxDrawdownPct,
    winRate: review.performance.winRate,
    tradeCount: review.performance.tradeCount,
    disciplineScore: review.performance.disciplineScore,
    matchedPlanRate: review.executionStats.matchedPlanRate,
    setupBreakdown: review.executionStats.setupBreakdown,
    tradeJournal: review.executionStats.tradeJournal,
    artifacts: {
      json: path.relative(process.cwd(), jsonFile),
      text: path.relative(process.cwd(), textFile)
    }
  });
}

export function loadHistoryIndex() {
  const indexPath = path.resolve(process.cwd(), "outputs", "history", "index.json");
  return readJsonIfExists(indexPath, { entries: [] });
}
