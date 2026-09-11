import fs from "node:fs";
import path from "node:path";
import { isTradingDay, resolveAnalysisSession } from "./analysis-session.js";
import { buildDecisionReasons } from "../explanations/decision-reasons.js";

export function buildDashboardData(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const includeNonTradingDays = options.includeNonTradingDays ?? false;
  const dailyRoot = path.join(rootDir, "outputs", "daily");
  const historyRoot = path.join(rootDir, "outputs", "history");
  const session = resolveAnalysisSession(options.now ?? new Date());

  function exists(file) {
    return fs.existsSync(file);
  }

  function readJson(file) {
    if (!exists(file)) {
      return null;
    }
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  }

  function readText(file) {
    if (!exists(file)) {
      return "";
    }
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function topN(items, limit = 8) {
    return safeArray(items).slice(0, limit);
  }

  function normalizeNewsItem(item, fallback = {}) {
    return {
      title: item?.title ?? "",
      content: item?.content ?? "",
      date: item?.date ?? fallback.date ?? null,
      publishedAt: item?.publishedAt ?? fallback.publishedAt ?? null,
      collectedAt: item?.collectedAt ?? fallback.collectedAt ?? null,
      dateType: item?.dateType ?? fallback.dateType ?? null,
      source: item?.source ?? fallback.source ?? "未知来源",
      informationType: item?.informationType ?? fallback.informationType ?? "NEWS",
      entityName: item?.entityName ?? fallback.entityName ?? "",
      theme: item?.theme ?? fallback.theme ?? null,
      eventType: item?.eventType ?? fallback.eventType ?? null,
      sentiment: item?.sentiment ?? fallback.sentiment ?? null,
      strength: item?.strength ?? fallback.strength ?? null,
      adopted: Boolean(item?.adopted ?? fallback.adopted),
      rejected: Boolean(item?.rejected ?? fallback.rejected)
    };
  }

  function buildNewsFeed(liveContext = {}, snapshot = {}) {
    const feed = [];
    const seen = new Set();
    const baseDate = snapshot?.date ?? null;

    for (const item of safeArray(liveContext.fastNews)) {
      const normalized = normalizeNewsItem(item, { date: baseDate, source: "东方财富快讯", informationType: "FAST_NEWS", publishedAt: item?.publishedAt ?? null, collectedAt: item?.collectedAt ?? null, dateType: item?.dateType ?? null });
      if (!normalized.title || seen.has(`fast:${normalized.title}`)) continue;
      seen.add(`fast:${normalized.title}`);
      feed.push(normalized);
    }

    for (const item of safeArray(liveContext.mxNews)) {
      const normalized = normalizeNewsItem(item, { date: baseDate, source: item?.source || "妙想新闻", informationType: item?.informationType || "MX_NEWS", publishedAt: item?.publishedAt ?? null, collectedAt: item?.collectedAt ?? null, dateType: item?.dateType ?? null });
      if (!normalized.title || seen.has(`mx:${normalized.title}`)) continue;
      seen.add(`mx:${normalized.title}`);
      feed.push(normalized);
    }

    for (const catalyst of safeArray(liveContext.llmNewsAnalysis?.themeCatalysts)) {
      for (const title of safeArray(catalyst.headlineTitles)) {
        const key = `llm-adopted:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        feed.push(normalizeNewsItem({
          title,
          date: baseDate,
          source: "LLM 采纳",
          informationType: catalyst.eventType ?? "CATALYST",
          theme: catalyst.theme,
          eventType: catalyst.eventType,
          sentiment: catalyst.sentiment,
          strength: catalyst.strength,
          adopted: true
        }));
      }
      for (const title of safeArray(catalyst.rejectedHeadlineTitles)) {
        const key = `llm-rejected:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        feed.push(normalizeNewsItem({
          title,
          date: baseDate,
          source: "LLM 过滤",
          informationType: catalyst.eventType ?? "REJECTED",
          theme: catalyst.theme,
          eventType: catalyst.eventType,
          sentiment: catalyst.sentiment,
          strength: catalyst.strength,
          rejected: true
        }));
      }
    }

    return feed.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }

  function listDailyDates() {
    if (!exists(dailyRoot)) {
      return [];
    }
    return fs.readdirSync(dailyRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .filter((date) => includeNonTradingDays || isTradingDay(date))
      .sort((a, b) => b.localeCompare(a));
  }

  function normalizeOverview(decision = {}) {
    const overview = decision.overview ?? {};
    const leaders = decision.leaders ?? {};
    const modeProfile = decision.modeProfile ?? {};
    return {
      environment: overview.environment ?? "未知环境",
      emotionCycle: overview.emotionCycle ?? "未知周期",
      primaryTheme: overview.primaryTheme ?? decision.themes?.primaryTheme?.name ?? "未识别",
      actionBias: overview.actionBias ?? decision.execution?.actionBias ?? "未识别",
      positionPlan: overview.positionPlan ?? decision.position?.totalPosition ?? "未识别",
      preferredMode: overview.preferredMode ?? modeProfile.primaryMode ?? "未识别",
      stylePreference: overview.stylePreference ?? decision.marketRegime?.stylePreference ?? "未识别",
      leader: leaders.leader?.name ?? "未识别",
      themeLeader: leaders.themeLeader?.name ?? "未识别"
    };
  }

  function normalizeLiveContext(snapshot = {}) {
    const liveContext = snapshot.liveContext ?? {};
    return {
      conceptBoards: safeArray(liveContext.conceptBoards),
      fastNews: safeArray(liveContext.fastNews),
      mxNews: safeArray(liveContext.mxNews),
      newsFeed: buildNewsFeed(liveContext, snapshot),
      mxThemeSeeds: safeArray(liveContext.mxThemeSeeds),
      mxThemeCatalysts: safeArray(liveContext.mxThemeCatalysts),
      mxScreenedStocks: safeArray(liveContext.mxScreenedStocks),
      mxMarketPulse: safeArray(liveContext.mxMarketPulse),
      llmNewsAnalysis: liveContext.llmNewsAnalysis ?? null,
      llmExplanation: liveContext.llmExplanation ?? null
    };
  }

  function normalizeDecisionBundle(date, dir) {
    const autoLive = readJson(path.join(dir, "auto-live.json"));
    if (autoLive) {
      const decision = autoLive.decision ?? {};
      const snapshot = autoLive.snapshot ?? {};
      const workflowType = autoLive.workflowType ?? (autoLive.postmarket ? "postmarket" : "premarket");
      return {
        date,
        kind: "auto-live",
        session: autoLive.session ?? null,
        workflowType,
        workflow: autoLive.workflow ?? (workflowType === "postmarket" ? autoLive.postmarket : autoLive.premarket ?? null),
        overview: normalizeOverview(decision),
        market: snapshot.market ?? {},
        marketRegime: decision.marketRegime ?? {},
        environment: decision.environment ?? {},
        emotionCycle: decision.emotionCycle ?? {},
        themes: decision.themes ?? {},
        leaders: decision.leaders ?? {},
        modeProfile: decision.modeProfile ?? {},
        execution: decision.execution ?? {},
        position: decision.position ?? {},
        sellPlan: decision.sellPlan ?? {},
        guardrails: decision.guardrails ?? {},
        riskControl: decision.riskControl ?? {},
        analysisReasons: decision.analysisReasons ?? buildDecisionReasons(snapshot, decision),
        dataQuality: snapshot.dataQuality ?? {},
        liveContext: normalizeLiveContext(snapshot),
        llmExplanation: autoLive.llmExplanation ?? null,
        premarket: workflowType === "premarket" ? (autoLive.workflow ?? autoLive.premarket ?? null) : null,
        postmarket: workflowType === "postmarket" ? (autoLive.workflow ?? autoLive.postmarket ?? null) : null,
        historySummary: null,
        ruleOptimizer: null,
        strategyDashboard: null,
        rawFiles: {
          autoLive: path.relative(rootDir, path.join(dir, "auto-live.json")),
          newsCatalysts: exists(path.join(dir, "news-catalysts.json")) ? path.relative(rootDir, path.join(dir, "news-catalysts.json")) : null
        }
      };
    }

    const decision = readJson(path.join(dir, "decision.json")) ?? {};
    const snapshot = readJson(path.join(dir, "snapshot.json")) ?? {};
    const premarket = readJson(path.join(dir, "premarket.json"));
    const postmarket = readJson(path.join(dir, "postmarket.json"));
    const historySummary = readJson(path.join(dir, "history-summary.json"));
    const ruleOptimizer = readJson(path.join(dir, "rule-optimizer.json"));
    const strategyDashboard = readJson(path.join(dir, "strategy-dashboard.json"));
    const newsCatalysts = readJson(path.join(dir, "news-catalysts.json"));

    return {
      date,
      kind: "daily-pipeline",
      session: null,
      workflowType: premarket ? "premarket" : (postmarket ? "postmarket" : null),
      workflow: premarket ?? postmarket ?? null,
      overview: normalizeOverview(decision),
      market: snapshot.market ?? {},
      marketRegime: decision.marketRegime ?? premarket?.marketJudgement?.regime ?? {},
      environment: decision.environment ?? {},
      emotionCycle: decision.emotionCycle ?? {},
      themes: decision.themes ?? {},
      leaders: decision.leaders ?? {},
      modeProfile: decision.modeProfile ?? premarket?.marketJudgement?.modeProfile ?? {},
      execution: decision.execution ?? premarket?.executionPlan ?? {},
      position: decision.position ?? premarket?.positionPlan ?? {},
      sellPlan: decision.sellPlan ?? premarket?.sellPlan ?? {},
      guardrails: decision.guardrails ?? {},
      riskControl: decision.riskControl ?? premarket?.marketJudgement?.riskControl ?? {},
      analysisReasons: decision.analysisReasons ?? buildDecisionReasons(snapshot, decision),
      dataQuality: snapshot.dataQuality ?? {},
      liveContext: {
        conceptBoards: [],
        fastNews: [],
        mxThemeSeeds: [],
        mxThemeCatalysts: [],
        mxScreenedStocks: [],
        mxMarketPulse: [],
        llmNewsAnalysis: newsCatalysts,
        llmExplanation: null
      },
      llmExplanation: null,
      premarket,
      postmarket,
      historySummary,
      ruleOptimizer,
      strategyDashboard,
      rawFiles: {
        decision: path.relative(rootDir, path.join(dir, "decision.json")),
        premarket: premarket ? path.relative(rootDir, path.join(dir, "premarket.json")) : null,
        postmarket: postmarket ? path.relative(rootDir, path.join(dir, "postmarket.json")) : null,
        historySummary: historySummary ? path.relative(rootDir, path.join(dir, "history-summary.json")) : null,
        ruleOptimizer: ruleOptimizer ? path.relative(rootDir, path.join(dir, "rule-optimizer.json")) : null
      }
    };
  }

  function buildHistoryGroups(index = { entries: [] }) {
    const groups = new Map();
    for (const entry of safeArray(index.entries)) {
      if (!includeNonTradingDays && !isTradingDay(entry.date)) {
        continue;
      }
      if (!groups.has(entry.date)) {
        groups.set(entry.date, []);
      }
      groups.get(entry.date).push(entry);
    }
    return [...groups.entries()]
      .map(([date, entries]) => ({
        date,
        entries,
        types: entries.map((item) => item.type),
        outcome: entries.find((item) => item.type === "outcome") ?? null,
        premarket: entries.find((item) => item.type === "premarket") ?? null,
        postmarket: entries.find((item) => item.type === "postmarket") ?? null
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  const dates = listDailyDates();
  const days = dates.map((date) => normalizeDecisionBundle(date, path.join(dailyRoot, date)));
  const historyIndex = readJson(path.join(historyRoot, "index.json")) ?? { entries: [] };
  const ruleOptimizer = readJson(path.join(historyRoot, "rule-optimizer.json")) ?? null;
  const dashboard = readJson(path.join(historyRoot, "dashboard.json")) ?? null;
  const historySummaryText = readText(path.join(historyRoot, "dashboard.txt"));
  const historyGroups = buildHistoryGroups(historyIndex);
  const skippedNonTradingDays = fs.existsSync(dailyRoot)
    ? fs.readdirSync(dailyRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
        .map((entry) => entry.name)
        .filter((date) => !isTradingDay(date))
        .sort((a, b) => b.localeCompare(a))
    : [];

  return {
    generatedAt: new Date().toISOString(),
    latestDate: days[0]?.date ?? null,
    defaultSelectedDate: days.find((item) => item.date === session?.targetTradeDate)?.date ?? days[0]?.date ?? null,
    session,
    calendar: {
      includeNonTradingDays,
      skippedNonTradingDays
    },
    days,
    history: {
      index: historyIndex,
      groups: historyGroups,
      ruleOptimizer,
      dashboard,
      dashboardText: historySummaryText
    }
  };
}









