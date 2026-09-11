import fs from "node:fs";
import path from "node:path";

function loadEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }

  const envPath = path.resolve(process.cwd(), ".codex", "skills", ".env");
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [envKey, ...rest] = trimmed.split("=");
    if (envKey.trim() === key) {
      return rest.join("=").trim();
    }
  }

  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeMxDate(value) {
  if (!value) {
    return { date: "", publishedAt: null };
  }

  const text = String(value).trim();
  const match = text.match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    return { date: text, publishedAt: null };
  }

  const now = new Date();
  const year = Number(match[1] ?? now.getFullYear());
  const month = pad(match[2]);
  const day = pad(match[3]);
  const hour = pad(match[4] ?? 0);
  const minute = pad(match[5] ?? 0);
  const second = pad(match[6] ?? 0);
  return {
    date: `${year}-${month}-${day}`,
    publishedAt: `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`
  };
}

function formatInformationType(type) {
  const map = {
    REPORT: "研报",
    NEWS: "新闻",
    NOTICE: "公告",
    ANNOUNCEMENT: "公告",
    POLICY: "政策",
    INTERPRETATION: "解读",
    FAST_NEWS: "快讯"
  };
  return map[String(type ?? "").toUpperCase()] ?? String(type ?? "资讯");
}

function normalizeInformationType(type) {
  const raw = String(type ?? "").toUpperCase();
  if (raw === "NOTICE") return "ANNOUNCEMENT";
  return raw;
}

async function postMx(endpoint, payload) {
  const apiKey = loadEnvValue("MX_APIKEY");
  const baseUrl = loadEnvValue("MX_API_URL") ?? "https://mkapi2.dfcfs.com/finskillshub";
  if (!apiKey) {
    throw new Error("MX_APIKEY is not configured.");
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`MX request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function groupTopIndustries(limitUpPool = []) {
  const counts = new Map();
  for (const item of limitUpPool) {
    const key = item.industry || "未知行业";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .filter((name) => name && name !== "未知行业");
}

function extractMxNewsItems(result) {
  const items = result?.data?.data?.llmSearchResponse?.data ?? [];
  return items
    .filter((item) => item?.title)
    .map((item, index) => {
      const normalizedDate = normalizeMxDate(item.date ?? "");
      return {
        id: item.id ?? item.newsId ?? `${item.title}-${index}`,
        title: item.title,
        content: item.content ?? "",
        trunk: item.trunk ?? "",
        date: normalizedDate.date,
        publishedAt: normalizedDate.publishedAt,
        source: item.insName ?? "妙想资讯",
        informationType: item.informationType ?? "",
        informationTypeLabel: formatInformationType(item.informationType ?? ""),
        normalizedInformationType: normalizeInformationType(item.informationType ?? ""),
        entityName: item.entityFullName ?? "",
        rating: item.rating ?? "",
        jumpUrl: item.jumpUrl ?? "",
        secuList: Array.isArray(item.secuList) ? item.secuList : [],
        raw: item
      };
    });
}

function buildColumnNameMap(columns = []) {
  const map = new Map();
  for (const column of columns) {
    const key = column?.key ?? column?.field ?? column?.name;
    const title = column?.title ?? column?.displayName ?? column?.label ?? key;
    if (key) {
      map.set(String(key), String(title ?? key));
    }
  }
  return map;
}

function extractMxScreenRows(result) {
  const resultBlock = result?.data?.data?.allResults?.result ?? {};
  const dataList = resultBlock?.dataList ?? [];
  const columns = resultBlock?.columns ?? [];
  const columnMap = buildColumnNameMap(columns);

  return dataList.map((row) => ({
    code: row.SECURITY_CODE ?? row.SECCODE ?? row.SECUCODE ?? "",
    name: row.SECURITY_SHORT_NAME ?? row.SECURITY_NAME_ABBR ?? row.SECUNAME ?? "",
    latestPrice: Number(row.NEWEST_PRICE ?? row.LATEST_PRICE ?? 0),
    changePct: Number(row.CHG ?? row.CHANGE_RATE ?? row.ZDF ?? 0),
    turnoverPct: Number(row.HSL ?? row.TURNOVER_RATE ?? 0),
    amount: Number(row.CJL ?? row.TURNOVER ?? row.AMOUNT ?? 0),
    market: row.MARKET_SHORT_NAME ?? row.MARKET ?? "",
    theme: row.BOARD_NAME ?? row.INDUSTRY_NAME ?? row.CONCEPT_NAME ?? "",
    raw: row,
    columnMap: Object.fromEntries(columnMap)
  }));
}

function extractMxDataHighlights(result) {
  const dtoList = result?.data?.data?.searchDataResultDTO?.dataTableDTOList ?? [];
  return dtoList.map((item) => ({
    entityName: item.entityName ?? "",
    title: item.title ?? "",
    indicatorOrder: item.indicatorOrder ?? [],
    headName: item.table?.headName ?? [],
    nameMap: item.nameMap ?? {}
  }));
}

function buildThemeCatalysts(themeSeeds, newsItems) {
  return (themeSeeds ?? []).map((theme) => {
    const hits = (newsItems ?? []).filter((item) => {
      const merged = `${item.title ?? ""} ${item.content ?? ""}`;
      return merged.includes(theme);
    });

    return {
      theme,
      headlineCount: hits.length,
      catalystScore: clamp(hits.length / 4, 0, 1),
      topTitles: hits.map((item) => item.title)
    };
  }).sort((a, b) => b.catalystScore - a.catalystScore);
}

function buildScreeningStats(screenedStocks) {
  if (!screenedStocks || screenedStocks.length === 0) {
    return {
      count: 0,
      avgChangePct: 0,
      topCandidates: []
    };
  }

  return {
    count: screenedStocks.length,
    avgChangePct: Number((screenedStocks.reduce((sum, item) => sum + Number(item.changePct ?? 0), 0) / screenedStocks.length).toFixed(2)),
    topCandidates: screenedStocks.map((item) => ({ name: item.name, changePct: item.changePct }))
  };
}

function buildMarketPulse(marketHighlights) {
  return (marketHighlights ?? []).map((item) => ({
    name: item.entityName || item.title,
    summary: item.title || item.entityName
  }));
}

function buildNewsSearchQuery(query) {
  const base = String(query ?? "").trim();
  if (!base) {
    throw new Error("搜索关键词不能为空。");
  }
  return base;
}

function buildMxQueryVariants(query, options = {}) {
  const base = buildNewsSearchQuery(query);
  const contentType = String(options.contentType ?? "all");
  const trackedKeywords = Array.isArray(options.trackedKeywords)
    ? options.trackedKeywords.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const variants = [];
  const seen = new Set();

  function pushVariant(label, value) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    variants.push({ label, query: text });
  }

  pushVariant("原始问句", base);

  if (contentType === "all" || contentType === "news") {
    pushVariant("妙想新闻", `${base} 最新新闻`);
  }
  if (contentType === "all" || contentType === "announcement") {
    pushVariant("妙想公告", `${base} 最新公告`);
  }
  if (contentType === "all" || contentType === "report") {
    pushVariant("妙想研报", `${base} 最新研报`);
  }
  if (contentType === "all" || contentType === "policy") {
    pushVariant("政策解读", `${base} 最新政策 解读`);
  }
  if (trackedKeywords.length > 0) {
    pushVariant("追踪扩展", `${base} ${trackedKeywords.join(" ")}`);
  }

  return variants;
}

function matchTimeRange(publishedAt, timeRange) {
  if (!publishedAt || timeRange === "all") {
    return true;
  }

  const value = new Date(publishedAt).getTime();
  if (!Number.isFinite(value)) {
    return true;
  }

  const now = Date.now();
  const maxAgeMs = timeRange === "1d"
    ? 24 * 60 * 60 * 1000
    : timeRange === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : timeRange === "30d"
        ? 30 * 24 * 60 * 60 * 1000
        : null;

  return maxAgeMs === null ? true : now - value <= maxAgeMs;
}

function filterNewsItems(items, options = {}) {
  const contentType = String(options.contentType ?? "all");
  const timeRange = String(options.timeRange ?? "all");
  return (items ?? [])
    .filter((item) => {
      const normalizedType = String(item.normalizedInformationType ?? normalizeInformationType(item.informationType ?? ""));
      if (contentType === "news" && normalizedType !== "NEWS" && normalizedType !== "FAST_NEWS") return false;
      if (contentType === "report" && normalizedType !== "REPORT") return false;
      if (contentType === "announcement" && normalizedType !== "ANNOUNCEMENT") return false;
      if (contentType === "policy" && !["POLICY", "INTERPRETATION"].includes(normalizedType)) return false;
      return matchTimeRange(item.publishedAt, timeRange);
    })
    .sort((a, b) => String(b.publishedAt ?? b.date ?? "").localeCompare(String(a.publishedAt ?? a.date ?? "")));
}

function splitKeywords(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[\s,，、;；/|]+/).map((item) => item.trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  if (trimmed.length <= 2) return [trimmed];
  return [trimmed, ...trimmed.match(/.{2,4}/g) ?? []];
}

function matchKeywordInText(item, keywords = []) {
  if (!keywords.length) return true;
  const haystack = [
    item.title,
    item.content,
    item.trunk,
    item.entityName,
    item.source
  ].filter(Boolean).join(" ").toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function dedupeNewsItems(items = []) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const key = [
      item.jumpUrl || "",
      item.title || "",
      item.publishedAt || item.date || "",
      item.source || "",
      item.normalizedInformationType || normalizeInformationType(item.informationType ?? "")
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function runMxNewsQuery(variant) {
  const result = await postMx("/api/claw/news-search", { query: variant.query });
  const items = extractMxNewsItems(result).map((item) => ({
    ...item,
    sourceFamily: "妙想资讯",
    queryVariant: variant.label,
    queryText: variant.query
  }));
  return {
    label: variant.label,
    query: variant.query,
    rawCount: items.length,
    items
  };
}

function buildSourceHitSummary(items = []) {
  const sourceMap = new Map();
  for (const item of items) {
    const source = item.sourceFamily ?? item.source ?? "未知来源";
    sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
  }
  return [...sourceMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function buildNewsSearchStats(items) {
  const sourceCounts = new Map();
  const typeCounts = new Map();

  for (const item of items ?? []) {
    const source = item.source || "未知来源";
    const type = item.informationTypeLabel || formatInformationType(item.informationType);
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  return {
    total: items.length,
    sources: [...sourceCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    types: [...typeCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  };
}

export async function searchMxNews(query, options = {}) {
  const searchQuery = buildNewsSearchQuery(query);
  const result = await postMx("/api/claw/news-search", { query: searchQuery });
  const normalizedItems = extractMxNewsItems(result);
  const items = filterNewsItems(normalizedItems, options);

  return {
    query: String(query).trim(),
    searchQuery,
    filters: {
      timeRange: String(options.timeRange ?? "all"),
      contentType: String(options.contentType ?? "all"),
      trackedKeywords: Array.isArray(options.trackedKeywords) ? options.trackedKeywords.map((item) => String(item).trim()).filter(Boolean) : []
    },
    items,
    stats: buildNewsSearchStats(items)
  };
}

export async function searchUnifiedNews(query, options = {}, extraSources = {}) {
  const baseQuery = buildNewsSearchQuery(query);
  const variants = buildMxQueryVariants(baseQuery, options);
  const keywords = splitKeywords(baseQuery);

  const mxResults = await Promise.all(variants.map((variant) =>
    runMxNewsQuery(variant).catch((error) => ({
      label: variant.label,
      query: variant.query,
      rawCount: 0,
      error: error.message,
      items: []
    }))
  ));

  const mxItems = dedupeNewsItems(mxResults.flatMap((entry) => entry.items ?? []));
  const fastNewsItems = Array.isArray(extraSources.fastNews)
    ? extraSources.fastNews
      .filter((item) => matchKeywordInText(item, keywords))
      .map((item) => ({
        ...item,
        informationTypeLabel: formatInformationType(item.informationType ?? "FAST_NEWS"),
        normalizedInformationType: normalizeInformationType(item.informationType ?? "FAST_NEWS"),
        sourceFamily: "东方财富快讯",
        queryVariant: "东方财富快讯",
        queryText: baseQuery
      }))
    : [];

  const mergedRawItems = dedupeNewsItems([...mxItems, ...fastNewsItems]);
  const items = filterNewsItems(mergedRawItems, options);
  const sourceHitSummary = buildSourceHitSummary(items);

  return {
    query: baseQuery,
    searchQuery: baseQuery,
    searchQueries: variants.map((item) => item.query),
    queryVariants: mxResults.map((item) => ({
      label: item.label,
      query: item.query,
      rawCount: item.rawCount ?? 0,
      error: item.error ?? null
    })),
    filters: {
      timeRange: String(options.timeRange ?? "all"),
      contentType: String(options.contentType ?? "all"),
      trackedKeywords: Array.isArray(options.trackedKeywords) ? options.trackedKeywords.map((item) => String(item).trim()).filter(Boolean) : []
    },
    rawFetchedCount: mergedRawItems.length,
    items,
    stats: {
      ...buildNewsSearchStats(items),
      rawFetchedCount: mergedRawItems.length,
      sourceFamilies: sourceHitSummary
    }
  };
}

export async function fetchMxDecisionContext(state) {
  const themeSeeds = groupTopIndustries(state.limitUpPool);
  const themeQuery = themeSeeds.length > 0 ? themeSeeds.join("、") : "A股市场";
  const warnings = [];

  const tasks = [
    postMx("/api/claw/news-search", {
      query: `${themeQuery} 板块 最新新闻 政策 催化`
    }).catch((error) => {
      warnings.push(`MX news search unavailable: ${error.message}`);
      return null;
    }),
    postMx("/api/claw/stock-screen", {
      keyword: `${themeQuery} 今日涨幅大于0 成交额较大 A股`
    }).catch((error) => {
      warnings.push(`MX stock screen unavailable: ${error.message}`);
      return null;
    }),
    postMx("/api/claw/query", {
      toolQuery: "上证指数 创业板指 沪深300 最新价 涨跌幅"
    }).catch((error) => {
      warnings.push(`MX market query unavailable: ${error.message}`);
      return null;
    })
  ];

  const [newsResult, screenResult, marketResult] = await Promise.all(tasks);
  const newsItems = newsResult ? extractMxNewsItems(newsResult) : [];
  const screenedStocks = screenResult ? extractMxScreenRows(screenResult) : [];
  const marketHighlights = marketResult ? extractMxDataHighlights(marketResult) : [];
  const themeCatalysts = buildThemeCatalysts(themeSeeds, newsItems);
  const screeningStats = buildScreeningStats(screenedStocks);
  const marketPulse = buildMarketPulse(marketHighlights);

  return {
    themeSeeds,
    warnings,
    newsItems,
    screenedStocks,
    marketHighlights,
    themeCatalysts,
    screeningStats,
    marketPulse
  };
}
