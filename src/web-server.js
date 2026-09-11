import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { buildDashboardData } from "./lib/web/dashboard-data.js";
import { resolveAnalysisSession } from "./lib/web/analysis-session.js";
import { buildDecision } from "./lib/orchestrator.js";
import { fetchEastmoneyFastNews, fetchEastmoneyMarketState, fetchEastmoneyIntradayMicrostructure } from "./lib/collector/eastmoney-auto.js";
import { fetchMxDecisionContext, searchUnifiedNews } from "./lib/collector/mx-api.js";
import { buildSnapshotFromLiveMarketState } from "./lib/collector/live-to-snapshot.js";
import { analyzeNewsCatalysts } from "./lib/llm/news-catalyst-analyzer.js";
import { buildDecisionExplanation } from "./lib/llm/decision-explainer.js";
import { buildPremarketPlan, buildPostmarketReview } from "./lib/workflow/daily-workflow.js";
import { formatPremarketPlan, formatPostmarketReview } from "./lib/workflow/workflow-report.js";
import { archiveLiveDecision } from "./lib/history/live-archive.js";

const rootDir = process.cwd();
const webRoot = path.join(rootDir, "web");
const port = Number(process.env.PORT ?? 3030);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

async function bundleClient() {
  await build({
    entryPoints: [path.join(webRoot, "src", "main.jsx")],
    outfile: path.join(webRoot, "app.bundle.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    target: ["es2022"],
    sourcemap: false,
    logLevel: "silent"
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function runMode(mode, date) {
  return new Promise((resolve, reject) => {
    const args = ["src/index.js", "--mode", mode, "--format", "json"];
    if (date) args.push("--date", date);
    const child = spawn(process.execPath, args, { cwd: rootDir, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Command failed with code ${code}`));
      try {
        resolve({ stdout, parsed: JSON.parse(stdout.replace(/^\uFEFF/, "")) });
      } catch {
        resolve({ stdout, parsed: null });
      }
    });
  });
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

async function runCurrentAnalysis() {
  const session = resolveAnalysisSession(new Date());
  const { snapshot, decision, llmExplanation } = await buildLiveDecisionContext(session.targetTradeDate);
  const workflow = session.analysisType === "premarket" ? buildPremarketPlan(snapshot, decision) : buildPostmarketReview(snapshot, decision);
  const text = session.analysisType === "premarket" ? formatPremarketPlan(workflow) : formatPostmarketReview(workflow);
  archiveLiveDecision(session.targetTradeDate, snapshot, decision, workflow, llmExplanation, text, session);
  return { session, workflowType: session.analysisType, workflow, snapshot, decision, llmExplanation, dashboard: buildDashboardData({ rootDir }) };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/dashboard") return sendJson(res, 200, buildDashboardData({ rootDir }));
  if (req.method === "GET" && url.pathname === "/api/session") return sendJson(res, 200, resolveAnalysisSession(new Date()));
  if (req.method === "POST" && url.pathname === "/api/run/current-analysis") return sendJson(res, 200, { ok: true, ...(await runCurrentAnalysis()) });
  if (req.method === "POST" && url.pathname === "/api/news/search") {
    const body = await parseBody(req);
    const fastNews = await fetchEastmoneyFastNews().catch(() => []);
    const result = await searchUnifiedNews(body.query ?? "", {
      timeRange: body.timeRange ?? "all",
      contentType: body.contentType ?? "all",
      trackedKeywords: Array.isArray(body.trackedKeywords) ? body.trackedKeywords : []
    }, {
      fastNews
    });
    return sendJson(res, 200, { ok: true, ...result });
  }
  if (req.method === "GET" && url.pathname === "/api/news/fast") {
    const items = await fetchEastmoneyFastNews();
    return sendJson(res, 200, {
      ok: true,
      source: "东方财富快讯",
      collectedAt: new Date().toISOString(),
      items
    });
  }
  if (req.method === "POST" && url.pathname === "/api/run/auto-live") {
    const body = await parseBody(req);
    const result = await runMode("auto-live", body.date ?? null);
    return sendJson(res, 200, { ok: true, mode: "auto-live", date: body.date ?? null, result: result.parsed, dashboard: buildDashboardData({ rootDir }) });
  }
  if (req.method === "POST" && url.pathname === "/api/run/intraday-live") {
    const body = await parseBody(req);
    const result = await runMode("intraday-live", body.date ?? null);
    return sendJson(res, 200, { ok: true, mode: "intraday-live", date: body.date ?? null, result: result.parsed, dashboard: buildDashboardData({ rootDir }) });
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/raw/")) {
    const relativePath = decodeURIComponent(url.pathname.replace("/api/raw/", ""));
    const targetPath = path.resolve(rootDir, relativePath);
    if (!targetPath.startsWith(rootDir)) return sendJson(res, 403, { error: "Forbidden" });
    if (!fs.existsSync(targetPath)) return sendJson(res, 404, { error: "File not found" });
    return sendFile(res, targetPath);
  }
  return sendJson(res, 404, { error: "API endpoint not found" });
}

await bundleClient();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    const filePath = url.pathname === "/" || url.pathname === "/index.html"
      ? path.join(webRoot, "index.html")
      : path.resolve(webRoot, `.${url.pathname}`);
    if (!filePath.startsWith(webRoot)) return sendJson(res, 403, { error: "Forbidden" });
    return sendFile(res, filePath);
  } catch (error) {
    return sendJson(res, 500, { error: error.message ?? String(error) });
  }
});

server.listen(port, () => {
  console.log(`Web dashboard running at http://localhost:${port}`);
});
