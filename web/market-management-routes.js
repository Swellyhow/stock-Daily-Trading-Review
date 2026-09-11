import express from "express";
import { aggregatePriceBars } from "../src/lib/collector/market-series.js";
import {
  fetchThsConceptBoardList,
  fetchThsConceptBoardStocks,
  fetchThsKline,
  fetchThsIntraday,
  fetchThsSectorRealtime,
  fetchThsStockRealtime,
  fetchThsLimitUpPool,
  classifyLimitTypes,
  normalizeIntradayItems
} from "../src/lib/collector/ths-auto.js";
import { fetchStockKline, fetchConceptBoardList as fetchEastmoneyConceptBoardList, fetchConceptBoardStocks, fetchEastmoneyDetailedLimitUpPool, fetchAuctionData } from "../src/lib/collector/eastmoney-auto.js";
import marketDatabase from "../src/lib/collector/market-database.js";
import { fetchAndStoreThsDailyLimitUpReview } from "../src/lib/collector/ths-review.js";
import {
  fetchStockDbKline,
  fetchStockDbTradingDates,
  fetchStockDbConceptBoards,
  fetchStockDbConceptStocks,
  fetchStockDbStocks,
  fetchStockDbConceptMembers,
  fetchStockDbSectorKline,
  fetchStockDbSectorIntraday,
  describeStockDbSectorSeries,
  isStockDbConceptCode,
  readStockDbLimitUp,
  readStockDbLimitUpMembership,
  readStockDbLimitUpReasons,
  readStockDbLimitUpReviewStatus,
  readStockDbAuction,
  writeStockDbLimitUp,
  stockDbHealth
} from "../src/lib/collector/stockdb-client.js";

const router = express.Router();
const intradayMemoryCache = new Map();
const managementMemoryCache = new Map();
const managementInflight = new Map();
const sectorDateCache = new Map();
const klineResponseCache = new Map();

function getTimedResponse(cache, key) {
  const value = cache.get(key);
  if (!value || Date.now() >= value.expiresAt) { cache.delete(key); return null; }
  return value.payload;
}

function setTimedResponse(cache, key, payload) {
  if (!payload.items?.length) return;
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(key, { payload, expiresAt: Date.now() + 30000 });
}

function withManagementSingleFlight(cacheKey, task) {
  const existing = managementInflight.get(cacheKey);
  if (existing) return existing;
  const pending = Promise.resolve().then(task).finally(() => managementInflight.delete(cacheKey));
  managementInflight.set(cacheKey, pending);
  return pending;
}

function normalizeStockCode(value) {
  const code = String(value ?? "").trim().toUpperCase().replace(/^(?:SH|SZ|BJ)\.?/, "");
  return /^\d{6}$/.test(code) ? code : "";
}

function stockSnapshotQuality(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items) return { valid: false, reason: "items-not-array" };
  if (payload.snapshotVersion !== "stocks-v7" || payload.complete !== true) {
    return { valid: false, reason: "missing-completeness-proof" };
  }
  const seen = new Set();
  const duplicateCodes = [];
  const invalidCodes = [];
  for (const item of items) {
    const code = normalizeStockCode(item?.code);
    if (!code) { invalidCodes.push(String(item?.code ?? "")); continue; }
    if (seen.has(code)) duplicateCodes.push(code);
    seen.add(code);
  }
  const uniqueItemCount = seen.size;
  const declaredUnique = Number(payload.uniqueItemCount);
  const valid = invalidCodes.length === 0
    && duplicateCodes.length === 0
    && (!Number.isFinite(declaredUnique) || declaredUnique === uniqueItemCount)
    && (!Number.isFinite(Number(payload.itemCount)) || Number(payload.itemCount) === items.length);
  return { valid, reason: valid ? "ok" : "duplicate-or-invalid-items", itemCount: items.length, uniqueItemCount, duplicateCodes, invalidCodes };
}

function buildStockSnapshot(items, warnings = []) {
  const normalized = [];
  const seen = new Set();
  const duplicateCodes = [];
  const invalidCodes = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const code = normalizeStockCode(raw?.code);
    if (!code) { invalidCodes.push(String(raw?.code ?? "")); continue; }
    const item = { ...raw, code };
    if (seen.has(code)) { duplicateCodes.push(code); continue; }
    seen.add(code);
    normalized.push(item);
  }
  if (invalidCodes.length || duplicateCodes.length) {
    throw new Error(`拒绝写入异常股票快照：${invalidCodes.length ? `非法代码 ${[...new Set(invalidCodes)].join(",")}` : ""}${invalidCodes.length && duplicateCodes.length ? "；" : ""}${duplicateCodes.length ? `重复代码 ${[...new Set(duplicateCodes)].join(",")}` : ""}`);
  }
  return {
    items: normalized,
    warnings,
    itemCount: normalized.length,
    uniqueItemCount: normalized.length,
    duplicateCodes: [],
    snapshotVersion: "stocks-v7",
    fetchedAt: new Date().toISOString(),
    dataQuality: "observed",
    complete: true
  };
}

function normalizeIntradayPayload(payload) {
  if (!payload || !Array.isArray(payload.items)) return { payload, changed: false };
  const items = normalizeIntradayItems(payload.items);
  const changed = items.some((item, index) => {
    const previous = payload.items[index] || {};
    return item.volumeMode !== previous.volumeMode
      || Number(item.volume) !== Number(previous.volume)
      || Number(item.amount) !== Number(previous.amount);
  });
  return { payload: changed ? { ...payload, items } : payload, changed };
}

function cacheAgeMs(updatedAt) {
  if (!updatedAt) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(String(updatedAt).replace(" ", "T") + "+08:00");
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function forceRefresh(req) {
  return String(req.query.force ?? "") === "1";
}

function getManagementCache(cacheKey, allowMemory = true) {
  if (allowMemory && managementMemoryCache.has(cacheKey)) {
    const memory = managementMemoryCache.get(cacheKey);
    if (memory.dataType === "stocks" && !stockSnapshotQuality(memory.payload).valid) {
      managementMemoryCache.delete(cacheKey);
    } else {
      return { ...memory, cached: true, source: "本地内存缓存" };
    }
  }
  const durable = marketDatabase.getMarketManagementCache(cacheKey);
  if (!durable) return null;
  if (durable.dataType === "stocks" && !stockSnapshotQuality(durable.payload).valid) return null;
  const result = { payload: durable.payload, cached: true, source: "本地持久化缓存", updatedAt: durable.updatedAt, originalSource: durable.source };
  result.dataType = durable.dataType;
  managementMemoryCache.set(cacheKey, result);
  return result;
}

function isThsSnapshot(cache) {
  return Boolean(cache?.originalSource && /同花顺/.test(String(cache.originalSource)));
}

function saveManagementCache(cacheKey, dataType, date, code, payload, source) {
  if (dataType === "stocks") {
    const quality = stockSnapshotQuality(payload);
    if (!quality.valid) throw new Error(`拒绝写入不完整股票快照：${quality.reason}`);
  }
  marketDatabase.setMarketManagementCache(cacheKey, dataType, date, code, payload, source);
  const result = { payload, dataType, cached: true, source: "本地持久化缓存", updatedAt: new Date().toISOString(), originalSource: source };
  managementMemoryCache.set(cacheKey, result);
}

async function getLimitUpSnapshot(force = false, requestedDate = "") {
  const normalizedRequestedDate = String(requestedDate ?? "").replace(/-/g, "");
  const cacheDate = /^\d{8}$/.test(normalizedRequestedDate) ? normalizedRequestedDate : shanghaiDateKey();
  const cacheKey = `limit-up-pool:v2:${cacheDate}`;
  if (!force) {
    try {
      const privateItems = await readStockDbLimitUpMembership(cacheDate);
      if (privateItems.length) {
        const payload = { date: cacheDate, items: privateItems, total: privateItems.length };
        return { payload, date: cacheDate, cached: true, source: "stockdb 私有涨停池", originalSource: "stockdb" };
      }
    } catch {
      // The private SDK is optional at startup; use the established cache or
      // THS source while stockdb is being launched.
    }
  }
  if (!force) {
    const cached = getManagementCache(cacheKey);
    // Normal page loads are local-first: any persisted THS snapshot is usable.
    // Network refresh is reserved for a missing snapshot or an explicit force=1.
    if (cached?.payload?.items && isThsSnapshot(cached)) {
      return { ...cached, date: dateKey(cached.payload.date) };
    }
  }
  try {
    const payload = await fetchThsLimitUpPool({ date: cacheDate, limit: 1000, ttlMs: force ? 0 : 15000 });
    const date = dateKey(payload.date);
    if (date !== cacheDate) throw new Error(`同花顺返回交易日 ${date || "未知"}，与请求日期 ${cacheDate} 不一致`);
    saveManagementCache(cacheKey, "limit-up-pool", date, "", payload, "同花顺涨停池");
    saveManagementCache(`limit-up-pool:v1:${date}`, "limit-up-pool", date, "", payload, "同花顺涨停池");
    const rows = (payload.items || []).map((item) => ({
      date,
      code: item.code,
      name: item.name,
      latestPrice: null,
      changePct: null,
      amount: null,
      turnoverPct: null,
      boardCount: null,
      firstLimitTime: null,
      lastLimitTime: null,
      sealAmount: null,
      brokenCount: null,
      industry: ""
    }));
    await writeStockDbLimitUp(payload.items || [], { date, source: "ths", kind: "membership", replace: true }).catch((error) => {
      console.error(`[涨停池] stockdb 私有存储失败 ${date}:`, error.message);
    });
    return { payload, date, cached: false, source: "同花顺涨停池", originalSource: "同花顺涨停池" };
  } catch (error) {
    const cached = getManagementCache(cacheKey);
    if (cached?.payload?.items && isThsSnapshot(cached)) return { ...cached, date, warning: error.message };
    throw error;
  }
}

// Keep every stock-list endpoint aligned with the ladder: the official THS
// pool determines whether a stock actually closed at the limit and its pool
// tag, while the image-review table is the only source allowed to populate a
// detailed reason. Both sources are additive. A transient failure must never
// make the primary stockdb quote query fail or discard its rows.
export async function enrichStocksWithLimitUpMetadata(stocks, date, options = {}) {
  const rows = Array.isArray(stocks) ? stocks : [];
  if (!rows.length) return { items: rows, warnings: [] };

  const requestedDate = dateKey(date);
  const fetchPool = options.fetchPool || fetchThsLimitUpPool;
  const readReasons = options.readReasons || readStockDbLimitUpReasons;
  const ttlMs = options.ttlMs ?? (options.force ? 0 : 15000);
  const [poolResult, reviewResult] = await Promise.allSettled([
    fetchPool({ date: requestedDate, limit: 1000, ttlMs }),
    readReasons(requestedDate)
  ]);
  const warnings = [];
  let officialByCode = null;
  if (poolResult.status === "fulfilled") {
    const returnedDate = dateKey(poolResult.value?.date);
    if (returnedDate === requestedDate) {
      officialByCode = new Map((poolResult.value?.items || [])
        .map((entry) => [normalizeStockCode(entry?.code), entry])
        .filter(([code]) => Boolean(code)));
    } else {
      warnings.push(`同花顺涨停池交易日不一致：请求 ${requestedDate}，返回 ${returnedDate}`);
    }
  } else {
    warnings.push(`同花顺涨停池暂不可用：${poolResult.reason?.message || "未知错误"}`);
  }

  let reviewByCode = new Map();
  if (reviewResult.status === "fulfilled") {
    // Older paragraph-derived rows are deliberately excluded. They were not
    // extracted from the THS review image and cannot be shown as "详细原因".
    reviewByCode = new Map((reviewResult.value || [])
      .filter((item) => item?.extractedBy === "siliconflow" && String(item.reason || "").trim())
      .map((item) => [normalizeStockCode(item.code), String(item.reason).trim()])
      .filter(([code]) => Boolean(code)));
  } else {
    warnings.push(`涨停复盘明细暂不可用：${reviewResult.reason?.message || "未知错误"}`);
  }

  const items = rows.map((stock) => {
    const code = normalizeStockCode(stock?.code);
    // Never pass through a provider-specific or historical fallback as a
    // detailed limit-up reason. An empty trusted match is intentionally blank.
    const enriched = { ...stock, limitReasonDetail: reviewByCode.get(code) || "" };
    if (!officialByCode) return enriched;
    const official = officialByCode.get(code);
    if (!official) {
      return { ...enriched, limitUp: false, limitReason: "", limitStatusQuality: "同花顺涨停池" };
    }
    return {
      ...enriched,
      limitUp: true,
      limitReason: official.limitReason || official.changeTag || "",
      limitStatusQuality: "同花顺涨停池"
    };
  });
  return { items, warnings };
}

function dateKey(value = "") {
  const text = String(value ?? "").replace(/-/g, "");
  return /^\d{8}$/.test(text) ? text : shanghaiDateKey();
}

// A missing date must follow the local stockdb trading calendar rather than
// wall-clock Shanghai time. This matters after market close, on weekends and
// whenever the updater has not yet written the current day's snapshot.
export async function resolveStockDbDate(value = "", fetchDates = fetchStockDbTradingDates) {
  const requested = String(value ?? "").replace(/-/g, "");
  if (/^\d{8}$/.test(requested) && !(requested === shanghaiDateKey() && !liveMarketSession())) return requested;
  const dates = await fetchDates("000001", 1);
  const latest = String(Array.isArray(dates) ? dates[0] || "" : "").replace(/-/g, "");
  if (!/^\d{8}$/.test(latest)) throw new Error("stockdb 没有可用交易日");
  return latest;
}

function isFresh(updatedAt, ttlMs) {
  if (!updatedAt) return false;
  const timestamp = Date.parse(String(updatedAt).replace(" ", "T") + "+08:00");
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlMs;
}

function validKlineRow(row) {
  return [row?.open, row?.high, row?.low, row?.close].every((value) => Number(value) > 0);
}

function validKlineItems(items) {
  return Array.isArray(items) && items.length > 0 && items.every(validKlineRow);
}

function minimumKlineRows(period) {
  return period === "daily" ? 20 : period === "weekly" ? 8 : 3;
}

function completeKlineItems(items, period) {
  return validKlineItems(items) && items.length >= minimumKlineRows(period);
}

function shanghaiDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
}

function liveMarketSession() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (["Sat", "Sun"].includes(values.weekday)) return false;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return minutes >= 555 && minutes <= 900;
}

function mergeRealtimeKline(items, realtime, date = shanghaiDateKey()) {
  if (!realtime || date !== shanghaiDateKey()) return items;
  const values = [realtime.open, realtime.high, realtime.low, realtime.latestPrice].map(Number);
  if (!values.every((value) => value > 0)) return items;
  const [open, high, low, close] = values;
  const live = { date, open, high, low, close, volume: Number(realtime.volume ?? 0), amount: Number(realtime.amount ?? 0), changePct: Number(realtime.changePct ?? 0), turnoverPct: Number(realtime.turnoverPct ?? 0) };
  const merged = new Map((items || []).map((item) => [String(item.date).replace(/-/g, ""), item]));
  merged.set(date, live);
  return [...merged.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function validPreferenceValue(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return false;
  try {
    return JSON.stringify(value).length <= 64 * 1024;
  } catch {
    return false;
  }
}

function numberParam(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeMarket(value) {
  return ["main", "创业板", "科创板", "京A"].includes(String(value)) ? String(value) : "all";
}

function filterStocks(stocks, tab, market) {
  const normalizedTab = ["all", "up", "down"].includes(tab) ? tab : "all";
  return stocks.filter((stock) => {
    const marketMatch = market === "all"
      || (market === "main" && ["沪A主板", "深A主板"].includes(stock.marketType))
      || stock.marketType === market;
    const tabMatch = normalizedTab === "all"
      || (normalizedTab === "up" && stock.limitUp)
      || (normalizedTab === "down" && stock.limitDown);
    return marketMatch && tabMatch;
  });
}

function stockFilterStatistics(stocks, tab, market) {
  const tabs = Object.fromEntries(["all", "up", "down"].map((key) => [key, filterStocks(stocks, key, market).length]));
  const markets = Object.fromEntries(["all", "main", "创业板", "科创板", "京A"].map((key) => [key, filterStocks(stocks, tab, key).length]));
  return { tabs, markets };
}

async function stockDbKline(code, limit, period = "daily", endDate = "", force = false) {
  return fetchStockDbKline(code, { frequency: ({ weekly: "1w", monthly: "1M" })[period] || "1d", limit, end: endDate, force });
}

function sectorDbKline(code, limit, endDate = "") {
  const dates = marketDatabase.getTradingDates(Math.max(limit + 1, 20)).reverse();
  const rows = dates.filter((date) => !endDate || String(date).replace(/-/g, "") <= endDate).map((date) => marketDatabase.getSectorHistory(date, code)).filter(Boolean).slice(-limit);
  return rows.map((item, index) => {
    const close = Number(item.latest_price ?? 0);
    const previous = Number(rows[index - 1]?.latest_price ?? close);
    const high = Math.max(close, previous);
    const low = Math.min(close, previous);
    return { code, name: item.sector_name ?? "", date: item.date, open: previous, close, high, low, volume: 0, amount: 0, changePct: Number(item.change_pct ?? 0) };
  });
}

function normalizePeriod(value) {
  return ["daily", "weekly", "monthly"].includes(String(value)) ? String(value) : "daily";
}

function aggregateKline(items, period) {
  return aggregatePriceBars(items || [], ({ weekly: "1w", monthly: "1M" })[period] || "1d");
}

function deriveKlineFields(items) {
  const sorted = [...(items || [])].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  return sorted.map((item, index) => {
    const close = Number(item.close ?? 0);
    const high = Number(item.high ?? 0);
    const low = Number(item.low ?? 0);
    const previousClose = Number(sorted[index - 1]?.close ?? item.open ?? 0);
    const base = previousClose > 0 ? previousClose : Number(item.open ?? 0);
    return {
      ...item,
      changePct: base > 0 ? Number(((close - base) / base * 100).toFixed(2)) : Number(item.changePct ?? 0),
      amplitudePct: base > 0 ? Number(((high - low) / base * 100).toFixed(2)) : Number(item.amplitudePct ?? 0)
    };
  });
}

function normalizeSectorItems(items) {
  return (items || []).map((item) => {
    const numeric = (value) => {
      if (value == null || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const latestPrice = numeric(item.latestPrice);
    const prevClose = numeric(item.prevClose);
    const derivedChange = latestPrice > 0 && prevClose > 0
      ? Number(((latestPrice - prevClose) / prevClose * 100).toFixed(2))
      : numeric(item.changePct);
    return { ...item, latestPrice, prevClose, changePct: derivedChange };
  });
}

function stockDbIntradayPayload(rows, code, date, metadata = {}) {
  const fallbackName = String(metadata.name || "");
  const fallbackPreClose = Number(metadata.preClose);
  const preClose = Number.isFinite(fallbackPreClose) && fallbackPreClose > 0 ? fallbackPreClose : null;
  const items = (rows || []).map((item) => {
    const stamp = String(item.date ?? "");
    if (!/^\d{14}$/.test(stamp)) return null;
    return {
      time: `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`,
      price: Number(item.close ?? 0),
      volume: Number(item.volume ?? 0),
      amount: Number(item.amount ?? 0),
      preClose: Number(item.prevClose ?? 0) > 0 ? Number(item.prevClose) : preClose
    };
  }).filter((item) => item && Number.isFinite(item.price) && item.price > 0);
  return { date, name: rows.find((item) => item.name)?.name || fallbackName, preClose, items };
}

function dedupeStocks(items) {
  const unique = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const code = String(item?.code ?? "").trim();
    if (!code) continue;
    const previous = unique.get(code);
    unique.set(code, previous ? { ...previous, ...item } : item);
  }
  return [...unique.values()];
}

async function getStockKlineData(code, period, limit) {
  const normalizedPeriod = normalizePeriod(period);
  const requestedLimit = Math.min(1000, Math.max(20, Number(limit) || 500));
  // stockdb is the canonical local market-data source.  Its public database
  // contains daily and minute K records; weekly/monthly views are aggregated
  // from the same daily records to keep the source consistent.
  try {
    const stockdbRows = await stockDbKline(code, requestedLimit, normalizedPeriod);
    if (stockdbRows.length >= (normalizedPeriod === "daily" ? 1 : 3)) {
      return { items: stockdbRows, source: `stockdb${normalizedPeriod === "weekly" ? "周K" : normalizedPeriod === "monthly" ? "月K" : "日K"}` };
    }
  } catch {
    // Keep the existing remote fallback for installations where stockdb is
    // not running yet; the response source makes that fallback visible.
  }
  if (normalizedPeriod !== "daily") {
    const thsRows = await fetchThsKline(code, requestedLimit, normalizedPeriod).catch(() => []);
    if (thsRows.length) return { items: thsRows, source: `同花顺${normalizedPeriod === "weekly" ? "周K" : "月K"}` };
    const rows = await fetchStockKline(code, { period: normalizedPeriod, limit: requestedLimit, adjustType: 1 });
    if (rows.length) return { items: rows, source: `东方财富${normalizedPeriod === "weekly" ? "周K" : "月K"}（同花顺周期接口暂不可用）` };
    const dailyRows = await fetchThsKline(code, 1000, "daily").catch(() => []);
    return { items: aggregateKline(dailyRows, normalizedPeriod).slice(-requestedLimit), source: `同花顺日K聚合（${normalizedPeriod === "weekly" ? "周线" : "月线"}接口暂不可用）` };
  }
  const thsRows = await fetchThsKline(code, Math.min(requestedLimit, 300)).catch(() => []);
  const storedRows = marketDatabase.getStockKline(code, null, null, requestedLimit).reverse().map((item) => ({
    code: item.code,
    name: item.name,
    date: item.date,
    open: Number(item.open ?? 0),
    close: Number(item.close ?? 0),
    high: Number(item.high ?? 0),
    low: Number(item.low ?? 0),
    volume: Number(item.volume ?? 0),
    amount: Number(item.amount ?? 0),
    changePct: Number(item.change_pct ?? 0),
    turnoverPct: Number(item.turnover_pct ?? 0)
  }));
  if (thsRows.length || storedRows.length) {
    const merged = new Map([...storedRows, ...thsRows].map((item) => [String(item.date).replace(/-/g, ""), item]));
    return { items: [...merged.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-requestedLimit), source: storedRows.length ? "同花顺日K+本地历史" : "同花顺日K" };
  }
  // 仅在本地没有任何历史数据时访问备用源，避免实时刷新时反复触发外部补全请求。
  const historyRows = await fetchStockKline(code, { period: "daily", limit: requestedLimit, adjustType: 1 });
  return { items: historyRows.slice(-requestedLimit), source: "东方财富日K（本地无历史）" };
}

async function fetchConceptBoardStocksFallback(sectorCode, limit) {
  const thsBoards = await fetchThsConceptBoardList(5000, { enrich: false });
  const thsBoard = thsBoards.find((item) => String(item.code).toUpperCase() === String(sectorCode).toUpperCase());
  if (!thsBoard?.name) throw new Error("无法解析同花顺板块名称，无法匹配备用数据源");
  const boards = await fetchEastmoneyConceptBoardList(5000);
  const sourceName = String(thsBoard.name).trim();
  const normalizedName = (value) => String(value ?? "").toLowerCase().replace(/[\s\-_/（）()]/g, "").replace(/概念|板块/g, "");
  const sourceKey = normalizedName(sourceName);
  const board = boards.find((item) => String(item.name).trim() === sourceName)
    ?? boards.find((item) => normalizedName(item.name) === sourceKey)
    ?? boards.find((item) => {
      const candidate = normalizedName(item.name);
      return sourceKey.length >= 2 && candidate.length >= 2 && (sourceKey.includes(candidate) || candidate.includes(sourceKey));
    });
  if (!board?.code) throw new Error(`东方财富不存在同名概念板块：${thsBoard.name}`);
  const stocks = await fetchConceptBoardStocks(board.code, limit);
  if (!stocks.length) throw new Error(`东方财富概念板块没有返回成分股：${thsBoard.name}`);
  return { stocks, source: `东方财富概念成分股（同花顺分页受限回退：${thsBoard.name}）` };
}

router.get("/api/market-management/preferences", (_req, res) => {
  res.json({ ok: true, preferences: marketDatabase.getUiPreferences() });
});

router.get("/api/market-management/stockdb-status", async (_req, res) => {
  const status = await stockDbHealth();
  res.status(status.ok ? 200 : 503).json({ ok: status.ok, ...status });
});

router.get("/api/market-management/trading-dates", async (req, res) => {
  try {
    const dates = await fetchStockDbTradingDates("000001", 500);
    return res.json({ ok: true, dates, latest: dates[0] ?? "", source: "stockdb", dataSource: "stockdb", cached: false });
  } catch (error) {
    return res.status(503).json({ ok: false, dates: [], latest: "", source: "stockdb", dataSource: "stockdb", error: `stockdb 交易日读取失败：${error.message}` });
  }
});

router.put("/api/market-management/preferences", (req, res) => {
  const input = req.body?.preferences;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return res.status(400).json({ ok: false, error: "偏好设置格式无效" });
  }
  const entries = Object.entries(input);
  if (entries.some(([key, value]) => !/^[a-z][a-z0-9-]{0,63}$/i.test(key) || !validPreferenceValue(value))) {
    return res.status(400).json({ ok: false, error: "偏好设置内容无效" });
  }
  try {
    res.json({ ok: true, preferences: marketDatabase.setUiPreferences(input) });
  } catch (error) {
    res.status(500).json({ ok: false, error: `偏好设置保存失败：${error.message}` });
  }
});

router.get("/api/market-management/limit-up-pool", async (req, res) => {
  try {
    const snapshot = await getLimitUpSnapshot(forceRefresh(req), req.query.date);
    res.json({
      ok: true,
      date: snapshot.date,
      items: snapshot.payload.items || [],
      total: snapshot.payload.total ?? snapshot.payload.items?.length ?? 0,
      source: snapshot.cached ? snapshot.source : "同花顺涨停池",
      dataSource: snapshot.originalSource || "同花顺涨停池",
      cached: Boolean(snapshot.cached),
      updatedAt: snapshot.updatedAt || snapshot.payload.fetchedAt,
      warning: snapshot.warning
    });
  } catch (error) {
    res.status(502).json({ ok: false, items: [], total: 0, source: "同花顺涨停池", dataQuality: "unavailable", error: `同花顺涨停池暂不可用：${error.message}` });
  }
});

function ladderTime(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  // Eastmoney returns pre-market times such as 09:25:00 as the number 92500.
  if (/^\d{5}$/.test(digits)) digits = `0${digits}`;
  if (/^\d{6}$/.test(digits)) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
  if (/^\d{4}$/.test(digits)) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  return "";
}

function ladderMarketMatch(item, market) {
  if (market === "all") return true;
  if (market === "main") return ["沪A主板", "深A主板"].includes(item.marketType);
  return item.marketType === market;
}

async function enrichCurrentLadderRows(rows, date) {
  if (date !== shanghaiDateKey()) return rows;
  const enriched = [];
  for (let start = 0; start < rows.length; start += 6) {
    const batch = rows.slice(start, start + 6);
    const result = await Promise.all(batch.map(async (row) => {
      try {
        const [realtime, intraday] = await Promise.all([
          fetchThsStockRealtime(row.code),
          fetchThsIntraday(row.code, date).catch(() => ({ items: [] }))
        ]);
        const typeResult = classifyLimitTypes(row, realtime, intraday);
        return {
          ...row,
          latestPrice: realtime.latestPrice || row.latestPrice,
          changePct: Number.isFinite(Number(realtime.changePct)) ? realtime.changePct : row.changePct,
          turnoverPct: Number.isFinite(Number(realtime.turnoverPct)) ? realtime.turnoverPct : row.turnoverPct,
          circulatingMarketCap: realtime.circulatingMarketCap || row.circulatingMarketCap,
          totalMarketCap: realtime.totalMarketCap || row.totalMarketCap,
          marketType: realtime.marketType || row.marketType,
          limitTypes: typeResult.limitTypes,
          limitTypeStatus: typeResult.limitTypeStatus
        };
      } catch {
        return { ...row, limitTypes: [], limitTypeStatus: "unavailable" };
      }
    }));
    enriched.push(...result);
  }
  return enriched;
}

async function enrichHistoricalLadderRows(rows, date) {
  const enriched = [];
  for (let start = 0; start < rows.length; start += 8) {
    const batch = rows.slice(start, start + 8);
    const result = await Promise.all(batch.map(async (row) => {
      try {
        const [dailyRows, minuteRows] = await Promise.all([
          // stockdb's one-sided `end` query can return an empty result. An
          // exact-day range is reliable and the daily row already carries
          // prevClose for the classification rules.
          fetchStockDbKline(row.code, { frequency: "1d", start: date, end: date, limit: 10 }),
          fetchStockDbKline(row.code, { frequency: "1m", start: date, end: date, limit: 2000 })
        ]);
        const normalizedDate = String(date).replace(/-/g, "");
        const orderedDaily = [...dailyRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const index = orderedDaily.findIndex((item) => String(item.date).slice(0, 8) === normalizedDate);
        const daily = index >= 0 ? orderedDaily[index] : null;
        const previous = index > 0 ? orderedDaily[index - 1] : null;
        if (!daily) return { ...row, limitTypes: [], limitTypeStatus: "unavailable" };
        const intraday = {
          items: minuteRows.map((item) => {
            const stamp = String(item.date || "");
            return { time: /^\d{12,14}$/.test(stamp) ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}` : String(item.time || ""), price: Number(item.close), volume: Number(item.volume || 0), amount: Number(item.amount || 0) };
          }).filter((item) => /^\d{2}:\d{2}$/.test(item.time) && item.price > 0)
        };
        const realtime = {
          prevClose: Number(daily.prevClose || previous?.close),
          open: Number(daily.open),
          high: Number(daily.high),
          low: Number(daily.low),
          latestPrice: Number(daily.close),
          turnoverPct: Number(daily.turnoverPct ?? row.turnoverPct)
        };
        const typeResult = classifyLimitTypes(row, realtime, intraday);
        return { ...row, changePct: Number.isFinite(Number(daily.changePct)) ? daily.changePct : row.changePct, limitTypes: typeResult.limitTypes, limitTypeStatus: typeResult.limitTypeStatus, limitTypeSource: "stockdb日K+1分钟K+自定义规则" };
      } catch {
        return { ...row, limitTypes: [], limitTypeStatus: "unavailable" };
      }
    }));
    enriched.push(...result);
  }
  return enriched;
}

async function enrichLadderAuctionChanges(rows, date) {
  const codes = rows.map((row) => String(row.code));
  let persisted = [];
  try {
    const privateRows = await readStockDbAuction(date);
    persisted = privateRows.filter((row) => codes.includes(String(row.code)));
  } catch {
    persisted = [];
  }
  if (!persisted.length) persisted = marketDatabase.getAuctionChanges(date, codes);
  const byCode = new Map(persisted.map((row) => [String(row.code), row]));
  // During the current auction session, use the same public source as the
  // auction workbench to fill codes not yet present in the local snapshot.
  if (date === shanghaiDateKey() && byCode.size < codes.length) {
    const live = await fetchAuctionData({ sortBy: "change_pct", limit: 300 }).catch(() => []);
    for (const row of live) if (!byCode.has(String(row.code))) byCode.set(String(row.code), row);
  }
  return rows.map((row) => {
    const auction = byCode.get(String(row.code));
    return {
      ...row,
      auctionChangePct: auction && Number.isFinite(Number(auction.auctionChangePct)) ? Number(auction.auctionChangePct) : null,
      auctionDataStatus: auction ? "竞价工作台" : "暂无竞价快照"
    };
  });
}

router.get("/api/market-management/limit-up-review-status", async (req, res) => {
  const date = dateKey(req.query.date);
  try {
    const status = await readStockDbLimitUpReviewStatus(date);
    res.json({ ok: true, date, status: status || null, source: "stockdb" });
  } catch (error) {
    res.status(503).json({ ok: false, date, status: null, error: `涨停复盘状态读取失败：${error.message}` });
  }
});

router.post("/api/market-management/limit-up-review-sync", async (req, res) => {
  const date = dateKey(req.body?.date || req.query.date);
  const force = String(req.body?.force ?? req.query.force ?? "") === "1";
  try {
    const result = await fetchAndStoreThsDailyLimitUpReview(date, { force });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    res.status(502).json({ ok: false, date, error: `涨停复盘同步失败：${error.message}` });
  }
});

// Field-rich ladder data. The official THS pool remains the membership source
// elsewhere; this endpoint uses Eastmoney's detailed pool specifically for
// time, turnover, seal and market-cap fields that THS does not publish here.
router.get("/api/market-management/limit-up-ladder", async (req, res) => {
  const date = dateKey(req.query.date);
  const sector = String(req.query.sector ?? "").trim();
  const market = normalizeMarket(req.query.market);
  const includeTypes = String(req.query.types ?? "") === "1";
  if (sector && !isStockDbConceptCode(sector)) return res.status(400).json({ ok: false, error: "请提供有效的 stockdb 概念板块代码" });
  try {
    let items = [];
    let reviewByCode = new Map();
    try {
      // Only visual-model output is a valid detailed reason. Older rows may
      // contain the former paragraph fallback and must not be shown as detail.
      reviewByCode = new Map((await readStockDbLimitUpReasons(date))
        .filter((item) => item.extractedBy === "siliconflow" && String(item.reason || "").trim())
        .map((item) => [String(item.code), item]));
    } catch {
      // 复盘同步是独立任务；涨停池仍可在原因表暂不可用时展示。
    }
    let poolSource = "东方财富涨停池明细";
    if (!forceRefresh(req)) {
      try {
        const stored = await readStockDbLimitUp(date);
        const detailed = stored.filter((item) => item.storageKind === "detailed" || item.limitAmount != null || item.lastLimitTime != null);
        if (detailed.length) {
          items = detailed;
          poolSource = "stockdb 私有涨停池";
        }
      } catch {
        // A missing stockdb SDK should not prevent the established pool source.
      }
    }
    // THS is the authoritative membership source. Eastmoney/stockdb rows only
    // supplement fields such as seal amount and limit-up times; never let a
    // stale detail snapshot decide which stocks belong to the requested day.
    let officialByCode = null;
    try {
      const official = await fetchThsLimitUpPool({ date, limit: 1000, ttlMs: forceRefresh(req) ? 0 : 15000 });
      if (dateKey(official.date) !== date) {
        const mismatch = new Error(`同花顺返回交易日 ${dateKey(official.date) || "未知"}，与请求日期 ${date} 不一致`);
        mismatch.code = "THS_DATE_MISMATCH";
        throw mismatch;
      }
      officialByCode = new Map((official.items || []).map((entry) => [String(entry.code), entry]));
      let detailsByCode = new Map(items.map((item) => [String(item.code), item]));
      const marketOpen = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T09:00:00+08:00`);
      const storedTimes = items.map((item) => Date.parse(item.storedAt || "")).filter(Number.isFinite);
      const savedBeforeOpen = date === shanghaiDateKey() && storedTimes.length > 0 && Math.max(...storedTimes) < marketOpen;
      const missingDetails = [...officialByCode.keys()].some((code) => !detailsByCode.has(code));
      if (forceRefresh(req) || savedBeforeOpen || missingDetails) {
        const refreshed = await fetchEastmoneyDetailedLimitUpPool(date);
        detailsByCode = new Map(refreshed.map((item) => [String(item.code), item]));
        items = refreshed;
        poolSource = "东方财富涨停池明细";
        await writeStockDbLimitUp(refreshed, { date, source: "eastmoney", kind: "detailed", replace: true }).catch((error) => {
          console.error(`[涨停天梯] stockdb 私有存储替换失败 ${date}:`, error.message);
        });
      }
      items = [...officialByCode.entries()].map(([code, entry]) => ({
        ...(detailsByCode.get(code) || {}),
        code,
        name: detailsByCode.get(code)?.name || entry.name,
        boardCount: detailsByCode.get(code)?.boardCount ?? entry.highDaysValue ?? 0,
        firstLimitTime: detailsByCode.get(code)?.firstLimitTime ?? entry.firstLimitTime,
        lastLimitTime: detailsByCode.get(code)?.lastLimitTime ?? entry.lastLimitTime,
        // Keep the THS pool tag and the review article's detailed explanation
        // as separate fields so neither source overwrites the other.
        limitReason: entry.limitReason || "",
        limitReasonDetail: reviewByCode.get(code)?.reason || "",
        marketType: detailsByCode.get(code)?.marketType || entry.marketType || "A股"
      }));
    } catch (error) {
      if (error?.code === "THS_DATE_MISMATCH") throw error;
      // Keep an already-confirmed detail snapshot available during a temporary
      // THS outage, but never create a new dated snapshot without membership.
      if (!items.length) throw error;
      officialByCode = null;
    }
    if (sector) {
      const codes = new Set(fetchStockDbConceptMembers(sector).symbols);
      items = items.filter((item) => codes.has(String(item.code)));
    }
    const normalized = items.map((item) => ({
      ...item,
      marketType: item.marketType || "A股",
      firstLimitTime: ladderTime(item.firstLimitTime),
      lastLimitTime: ladderTime(item.lastLimitTime),
      limitAmount: Number(item.limitAmount ?? item.amount ?? 0),
      limitTypes: [],
      limitReason: item.limitReason || item.reason || item.changeTag || "",
      limitReasonDetail: reviewByCode.get(String(item.code))?.reason || item.limitReasonDetail || "",
      limitTypeStatus: date === shanghaiDateKey() ? "pending" : "historical-unavailable"
    })).filter((item) => ladderMarketMatch(item, market));
    let rows = date === shanghaiDateKey() ? await enrichCurrentLadderRows(normalized, date) : normalized;
    if (officialByCode) rows = rows.map((row) => ({
      ...row,
      limitUp: true,
      limitReason: officialByCode.get(String(row.code))?.limitReason || row.limitReason || "",
      limitReasonDetail: reviewByCode.get(String(row.code))?.reason || row.limitReasonDetail || ""
    }));
    rows = await enrichLadderAuctionChanges(rows, date);
    if (includeTypes && date !== shanghaiDateKey()) rows = await enrichHistoricalLadderRows(rows, date);
    res.json({ ok: true, date, sector: sector || null, market, items: rows, total: rows.length, source: `${poolSource} + 同花顺涨停池`, typeStatus: date === shanghaiDateKey() || includeTypes ? "自定义涨停类型计算" : "历史日期暂无分时分类" });
  } catch (error) {
    res.status(502).json({ ok: false, items: [], error: `连板天梯数据获取失败：${error.message}` });
  }
});

router.get("/api/market-management/sectors", async (req, res) => {
  const limit = numberParam(req.query.limit, 5000, 20, 5000);
  const requestedDate = req.query.date ? dateKey(req.query.date) : "";
  const cacheKey = `sectors:${requestedDate}:${limit}`;
  const cached = getTimedResponse(sectorDateCache, cacheKey);
  if (!forceRefresh(req) && cached) {
    return res.json({ ...cached, cached: true });
  }
  try {
    const result = await fetchStockDbConceptBoards({ limit, date: requestedDate, force: forceRefresh(req) });
    if (requestedDate && result.date && result.date !== requestedDate) {
      return res.status(409).json({ ok: false, items: [], total: 0, date: result.date, error: `stockdb 无法提供 ${requestedDate} 的概念板块快照` });
    }
    let items = normalizeSectorItems(result.items);
    try {
      const official = await fetchThsLimitUpPool({ date: result.date, limit: 1000, ttlMs: forceRefresh(req) ? 0 : 15000 });
      const codes = new Set((official.items || []).map((entry) => String(entry.code)));
      items = items.map((item) => {
        try { return { ...item, limitUpCount: fetchStockDbConceptMembers(item.code).symbols.filter((code) => codes.has(String(code))).length }; }
        catch { return item; }
      });
    } catch { /* retain stockdb board statistics if THS is unavailable */ }
    const payload = { ok: true, items, total: items.length, date: result.date, warnings: [], source: "stockdb 概念板块+同花顺涨停池", dataSource: "stockdb+同花顺涨停池", cached: false };
    setTimedResponse(sectorDateCache, cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    res.status(503).json({ ok: false, items: [], total: 0, source: "stockdb 概念板块", dataSource: "stockdb", dataQuality: "unavailable", error: `stockdb 概念板块读取失败：${error.message}` });
  }
});

router.get("/api/market-management/stocks", async (req, res) => {
  const sector = String(req.query.sector ?? "").trim();
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, sector, items: [], total: 0, source: "stockdb", dataSource: "stockdb", dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const tab = String(req.query.tab ?? "all");
  const market = normalizeMarket(req.query.market);
  const limit = numberParam(req.query.limit, 5000, 50, 5000);
  if (!isStockDbConceptCode(sector)) return res.status(400).json({ ok: false, error: "请提供有效的 stockdb 概念板块代码" });
  try {
    // Return the full member list from the daily snapshot immediately. Minute
    // summaries are loaded separately for visible rows so large concepts do
    // not block board-to-stock linkage on thousands of per-symbol requests.
    const loaded = await fetchStockDbConceptStocks(sector, { date, force: forceRefresh(req), withMinutes: false });
    let stocks = loaded.items.slice(0, limit).map((row) => {
      const { intradayItems, ...stock } = row;
      const typeResult = classifyLimitTypes(stock, {
        prevClose: stock.prevClose,
        open: stock.open,
        high: stock.high,
        low: stock.low,
        latestPrice: stock.latestPrice,
        turnoverPct: stock.turnoverPct
      }, { items: intradayItems });
      return { ...stock, ...typeResult };
    });
    const limitUpMetadata = await enrichStocksWithLimitUpMetadata(stocks, loaded.date, { force: forceRefresh(req) });
    stocks = limitUpMetadata.items;
    res.json({ ok: true, sector, sectorName: loaded.board.name, date: loaded.date, tab, market, items: filterStocks(stocks, tab, market), total: stocks.length, uniqueItemCount: stocks.length, statistics: stockFilterStatistics(stocks, tab, market), warnings: limitUpMetadata.warnings, source: "stockdb 概念成分股+日K+同花顺涨停池", dataSource: "stockdb+同花顺涨停池", dataQuality: "stockdb+同花顺涨停池", cached: false });
  } catch (error) {
    res.status(503).json({ ok: false, sector, tab, market, items: [], total: 0, warnings: [], source: "stockdb", dataSource: "stockdb", cached: false, dataQuality: "unavailable", error: `stockdb 成分股读取失败：${error.message}` });
  }
});

router.get("/api/market-management/stock-search", async (req, res) => {
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, date: "", items: [], error: `stockdb 交易日读取失败：${error.message}` }); }
  const query = String(req.query.q || "").trim();
  const codes = String(req.query.codes || "").split(",").map(normalizeStockCode).filter(Boolean).slice(0, 100);
  try {
    const result = await fetchStockDbStocks({ date, query, codes: codes.length ? codes : undefined, limit: numberParam(req.query.limit, 100, 1, 1000), withMinutes: false });
    const limitUpMetadata = await enrichStocksWithLimitUpMetadata(result.items, result.date || date, { force: forceRefresh(req) });
    return res.json({ ok: true, ...result, items: limitUpMetadata.items, total: limitUpMetadata.items.length, warnings: [...(result.warnings || []), ...limitUpMetadata.warnings], source: "stockdb 日K+同花顺涨停池", dataSource: "stockdb+同花顺涨停池" });
  } catch (error) {
    return res.status(503).json({ ok: false, date, items: [], error: error.message });
  }
});

router.get("/api/market-management/stock-details", async (req, res) => {
  const sector = String(req.query.sector ?? "").trim();
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, sector, items: [], total: 0, source: "stockdb", dataSource: "stockdb", dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const codes = [...new Set(String(req.query.codes ?? "").split(",").map(normalizeStockCode).filter(Boolean))].slice(0, 30);
  if (sector && !isStockDbConceptCode(sector)) return res.status(400).json({ ok: false, error: "请提供有效的 stockdb 概念板块代码" });
  if (!codes.length) return res.status(400).json({ ok: false, error: "请提供需要补充分钟字段的股票代码" });
  try {
    const loaded = sector
      ? await fetchStockDbConceptStocks(sector, { date, codes, withMinutes: true })
      : await fetchStockDbStocks({ date, codes, withMinutes: true });
    const items = loaded.items.map((row) => {
      const { intradayItems, ...stock } = row;
      const typeResult = classifyLimitTypes(stock, {
        prevClose: stock.prevClose,
        open: stock.open,
        high: stock.high,
        low: stock.low,
        latestPrice: stock.latestPrice,
        turnoverPct: stock.turnoverPct
      }, { items: intradayItems });
      return { ...stock, ...typeResult, minuteFieldsLoaded: true };
    });
    const limitUpMetadata = await enrichStocksWithLimitUpMetadata(items, loaded.date, { force: forceRefresh(req) });
    res.json({ ok: true, sector, date: loaded.date, items: limitUpMetadata.items, total: limitUpMetadata.items.length, warnings: limitUpMetadata.warnings, source: "stockdb 1分钟K+同花顺涨停池", dataSource: "stockdb+同花顺涨停池", cached: false });
  } catch (error) {
    res.status(503).json({ ok: false, sector, date, items: [], source: "stockdb", dataSource: "stockdb", error: `stockdb 个股分钟字段读取失败：${error.message}` });
  }
});

router.get("/api/market-management/sector-realtime", async (req, res) => {
  const code = String(req.query.code ?? "").trim();
  if (!isStockDbConceptCode(code)) return res.status(400).json({ ok: false, error: "请提供有效的 stockdb 概念板块代码" });
  try {
    const result = await fetchStockDbConceptBoards({ limit: 5000, force: forceRefresh(req) });
    const item = result.items.find((row) => row.code === code.toUpperCase());
    if (!item) return res.status(404).json({ ok: false, source: "stockdb", dataSource: "stockdb", error: "stockdb 中未找到该概念板块" });
    res.json({ ok: true, item, date: result.date, source: "stockdb 成分股日K聚合", dataSource: "stockdb", cached: false });
  } catch (error) {
    res.status(503).json({ ok: false, source: "stockdb", dataSource: "stockdb", error: `stockdb 板块行情读取失败：${error.message}` });
  }
});

router.get("/api/market-management/intraday", async (req, res) => {
  const code = String(req.query.code ?? "").trim();
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, code, items: [], dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const kind = isStockDbConceptCode(code) ? "sector" : "stock";
  if (!isStockDbConceptCode(code) && !/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "请提供有效的 stockdb 板块或股票代码" });
  try {
    let payload;
    if (kind === "sector") {
      payload = await fetchStockDbSectorIntraday(code, date);
    } else {
      const [minuteRows, dailyRows] = await Promise.all([
        fetchStockDbKline(code, { frequency: "1m", start: date, end: date, timeoutMs: 30000 }),
        fetchStockDbKline(code, { frequency: "1d", start: date, end: date, limit: 5, timeoutMs: 30000 }).catch(() => [])
      ]);
      const daily = dailyRows.find((row) => String(row.date).slice(0, 8) === date) || dailyRows.at(-1) || {};
      payload = stockDbIntradayPayload(minuteRows, code, date, { name: daily.name, preClose: daily.prevClose });
    }
    const sectorProvenance = kind === "sector"
      ? describeStockDbSectorSeries(payload.items, { intraday: true, dataQuality: payload.dataQuality })
      : null;
    return res.json({
      ok: true,
      code,
      date: payload.date || date,
      ...payload,
      source: sectorProvenance?.source || "stockdb 1分钟K",
      dataSource: "stockdb",
      cached: false,
      dataQuality: sectorProvenance?.dataQuality || (payload.items?.length ? "observed" : "unavailable"),
      methodology: sectorProvenance?.methodology,
      warning: sectorProvenance ? sectorProvenance.warning : (payload.items?.length ? (payload.methodology || undefined) : "stockdb 未返回所选标的和日期的分钟数据")
    });
  } catch (error) {
    return res.status(503).json({ ok: false, code, date, items: [], source: "stockdb", dataSource: "stockdb", error: `stockdb 分时数据读取失败：${error.message}` });
  }
});

router.get("/api/market-management/sector-kline", async (req, res) => {
  const code = String(req.query.code ?? "").trim();
  const period = normalizePeriod(req.query.period);
  const limit = numberParam(req.query.limit, 500, 20, 1000);
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, code, items: [], period, dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const force = forceRefresh(req);
  const cacheKey = `sector-kline:${code.toUpperCase()}:${date}:${period}:${limit}`;
  const cached = getTimedResponse(klineResponseCache, cacheKey);
  if (!force && cached) return res.json({ ...cached, cached: true });
  if (!isStockDbConceptCode(code)) return res.status(400).json({ ok: false, error: "请提供有效的 stockdb 概念板块代码" });
  try {
    const items = await fetchStockDbSectorKline(code, { limit, end: date, frequency: ({ weekly: "1w", monthly: "1M" })[period] || "1d", force });
    const provenance = describeStockDbSectorSeries(items);
    const payload = { ok: true, code, date: date || items.at(-1)?.date || "", items, period, dataSource: "stockdb", cached: false, ...provenance };
    setTimedResponse(klineResponseCache, cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    res.status(503).json({ ok: false, code, items: [], period, source: "stockdb", dataSource: "stockdb", error: `stockdb 板块K线读取失败：${error.message}` });
  }
});

router.get("/api/market-management/stock-kline", async (req, res) => {
  const code = String(req.query.code ?? "").trim();
  const period = normalizePeriod(req.query.period);
  const limit = numberParam(req.query.limit, 500, 20, 1000);
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, code, items: [], period, dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const force = forceRefresh(req);
  const cacheKey = `stock-kline:${code}:${date}:${period}:${limit}`;
  const cached = getTimedResponse(klineResponseCache, cacheKey);
  if (!force && cached) return res.json({ ...cached, cached: true });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "请提供有效的股票代码" });
  try {
    const items = (await stockDbKline(code, limit, period, date, force)).filter(validKlineRow).slice(-limit);
    const payload = { ok: true, code, date: date || items.at(-1)?.date || "", items, period, source: `stockdb${period === "weekly" ? "周K" : period === "monthly" ? "月K" : "日K"}`, dataSource: "stockdb", cached: false };
    setTimedResponse(klineResponseCache, cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    res.status(503).json({ ok: false, code, items: [], period, source: "stockdb", dataSource: "stockdb", error: `stockdb 个股K线读取失败：${error.message}` });
  }
});

export default router;
