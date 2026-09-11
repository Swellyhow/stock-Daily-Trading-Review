import express from "express";
import marketDatabase from "../src/lib/collector/market-database.js";
import { ifindConfigStatus } from "../src/lib/collector/ifind-auto.js";
import { AUCTION_STOCK_SOURCES, fetchAuctionStocksBySource } from "../src/lib/collector/auction-source-adapters.js";
import { describeStockDbSectorSeries, fetchStockDbConceptBoards, fetchStockDbConceptMembers, fetchStockDbKline, fetchStockDbSectorKline, fetchStockDbSectorIntraday, fetchStockDbTradingDates } from "../src/lib/collector/stockdb-client.js";
import { fetchThsLimitUpPool } from "../src/lib/collector/ths-auto.js";
import { normalizeIntradayItems } from "../src/lib/collector/ths-auto.js";

const router = express.Router();
const memory = new Map();
const SOURCE = "stockdb";
const IFIND_SOURCE = "stockdb";

function dateKey(value = "") { const raw = String(value).replace(/-/g, ""); return /^\d{8}$/.test(raw) ? raw : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, ""); }
export async function resolveStockDbDate(value = "", fetchDates = fetchStockDbTradingDates) {
  const requested = String(value ?? "").replace(/-/g, "");
  if (/^\d{8}$/.test(requested) && !(requested === dateKey() && !liveSession())) return requested;
  const dates = await fetchDates("000001", 1);
  const latest = String(Array.isArray(dates) ? dates[0] || "" : "").replace(/-/g, "");
  if (!/^\d{8}$/.test(latest)) throw new Error("stockdb 没有可用交易日");
  return latest;
}
function force(req) { return String(req.query.force || "") === "1"; }
function validKey(key) { return /^[a-z][a-z0-9-]{0,63}$/i.test(key); }
function getCache(key) {
  if (memory.has(key)) {
    const cached = memory.get(key);
    if (cacheAgeMs(cached) < 30000) return { ...cached, cached: true, source: "本地内存缓存" };
    memory.delete(key);
  }
  const row = marketDatabase.getMarketManagementCache(key);
  if (!row) return null;
  const value = { payload: row.payload, updatedAt: row.updatedAt, originalSource: row.source, cached: true, source: "本地持久化缓存" };
  if (cacheAgeMs(value) >= 30000) return null;
  if (memory.size >= 200) memory.delete(memory.keys().next().value);
  memory.set(key, value); return value;
}
function saveCache(key, type, date, code, payload, source = SOURCE) {
  marketDatabase.setMarketManagementCache(key, type, date, code, payload, source);
  const value = { payload, updatedAt: new Date().toISOString(), originalSource: source, cached: true, source: "本地持久化缓存" };
  memory.set(key, value); return value;
}
function filterStocks(items, filter, market) {
  return (items || []).filter((stock) => {
    const type = String(stock.marketType || "");
    const marketOk = market === "all" || (market === "main" ? /主板/.test(type) : type === market);
    const pct = Number(stock.auctionChangePct);
    const filterOk = filter === "all" || (filter === "yesterday-board" && Number(stock.yesterdayBoardCount || 0) > 0) || (filter === "gt3" && pct > 3) || (filter === "gt5" && pct > 5) || (filter === "gt7" && pct > 7) || (filter === "auction-limit" && stock.limitUp === true);
    return marketOk && filterOk;
  });
}
function sortRows(items) { return (items || []).map((item, index) => ({ ...item, rowNumber: index + 1 })); }
function sourceCoverage(items) {
  const rows = Array.isArray(items) ? items : [];
  return {
    total: rows.length,
    realtime: rows.filter((row) => row.dataQuality === "observed").length,
    auction: rows.filter((row) => row.auctionPrice != null || row.auctionChangePct != null || row.auctionVolume != null || row.auctionAmount != null).length
  };
}
function liveSession() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (["Sat", "Sun"].includes(values.weekday)) return false;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return minutes >= 555 && minutes <= 900;
}
function hasItems(payload) { return Array.isArray(payload?.items) && payload.items.length > 0; }
function normalizeIntradayPayload(payload) {
  if (!payload || !Array.isArray(payload.items)) return { payload, changed: false };
  const items = normalizeIntradayItems(payload.items);
  const changed = items.some((item, index) => {
    const previous = payload.items[index] || {};
    return item.volumeMode !== previous.volumeMode || Number(item.volume) !== Number(previous.volume) || Number(item.amount) !== Number(previous.amount);
  });
  return { payload: changed ? { ...payload, items } : payload, changed };
}
function cacheAgeMs(cached) {
  let value = String(cached?.updatedAt || "").replace(" ", "T");
  if (value && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) value += "+08:00";
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Date.now() - time) : Number.POSITIVE_INFINITY;
}

router.get("/api/auction-management/status", (_req, res) => res.json({ ok: true, sectorSource: SOURCE, stockSources: AUCTION_STOCK_SOURCES, ifind: ifindConfigStatus(), mxConfigured: Boolean(process.env.MX_APIKEY) }));

router.get("/api/auction-management/preferences", (_req, res) => res.json({ ok: true, preferences: marketDatabase.getUiPreferences() }));
router.put("/api/auction-management/preferences", (req, res) => {
  const preferences = req.body?.preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences) || Object.keys(preferences).some((key) => !validKey(key))) return res.status(400).json({ ok: false, error: "偏好设置格式无效" });
  try { res.json({ ok: true, preferences: marketDatabase.setUiPreferences(preferences) }); } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

router.get("/api/auction-management/sectors", async (req, res) => {
  const limit = Math.min(5000, Math.max(20, Number(req.query.limit) || 5000));
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, items: [], total: 0, source: SOURCE, dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const key = `auction-stockdb:v2:sectors:${date}:${limit}`;
  if (!force(req)) { const cached = getCache(key); if (hasItems(cached?.payload) && (!liveSession() || cacheAgeMs(cached) < 600000)) return res.json({ ok: true, ...cached.payload, source: cached.source, dataSource: cached.originalSource, cached: true, updatedAt: cached.updatedAt }); }
  try {
    const loaded = await fetchStockDbConceptBoards({ limit, date, force: force(req) });
    if (date && loaded.date && loaded.date !== date) throw new Error(`stockdb 返回交易日 ${loaded.date}，与请求日期 ${date} 不一致`);
    let limitCodes = null;
    try {
      const pool = await fetchThsLimitUpPool({ date: loaded.date, limit: 1000, ttlMs: 15000 });
      limitCodes = new Set((pool.items || []).map((row) => String(row.code || "").replace(/\.(SH|SZ|BJ)$/i, "")));
    } catch { /* keep board list available when the official pool is temporarily unavailable */ }
    const items = (loaded.items || []).map((item) => {
      let limitUpCount = item.limitUpCount;
      try {
        const symbols = fetchStockDbConceptMembers(item.code).symbols;
        if (limitCodes) limitUpCount = symbols.filter((code) => limitCodes.has(String(code))).length;
      } catch { /* invalid/legacy board codes retain the stockdb count */ }
      return { ...item, limitUpCount, source: "stockdb+同花顺涨停池" };
    });
    const payload = { items, total: items.length, date: loaded.date || dateKey(), warnings: ["概念板块与成分股来自 stockdb；实时竞价字段选中板块后由妙想补充"] };
    if (items.length) saveCache(key, "auction-sectors", payload.date, "", payload, SOURCE);
    res.json({ ok: true, ...payload, source: SOURCE, dataSource: "stockdb+同花顺涨停池", cached: false });
  }
  catch (error) { const cached = getCache(key); if (hasItems(cached?.payload)) return res.json({ ok: true, ...cached.payload, source: cached.source, dataSource: cached.originalSource, cached: true, dataQuality: "stale-local", warning: error.message }); res.status(503).json({ ok: false, items: [], total: 0, source: SOURCE, dataQuality: "unavailable", error: error.message }); }
});

router.get("/api/auction-management/stocks", async (req, res) => {
  const sector = String(req.query.sector || "").trim(); const sectorName = String(req.query.sectorName || "").trim(); const filter = String(req.query.filter || "all"); const market = String(req.query.market || "all"); const source = ["cmes", "mx", "sina", "tencent"].includes(String(req.query.source)) ? String(req.query.source) : "mx"; const limit = Math.min(2000, Math.max(20, Number(req.query.limit) || 1000));
  if (!sector) return res.status(400).json({ ok: false, items: [], error: "缺少板块代码" });
  // v7 重新计算连板和交易时段字段，避免旧缓存覆盖修复后的结果。
  // Direct requests without a date are the live workbench flow. Keep the
  // requested day explicit so response metadata and source selection do not
  // drift into an unlabelled latest-local snapshot.
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, items: [], total: 0, source: SOURCE, dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const key = `auction-stocks:v9:${date}:${source}:${sector}:${limit}`;
  if (!force(req)) { const cached = getCache(key); if (hasItems(cached?.payload) && cacheAgeMs(cached) < 10000) return res.json({ ok: true, date, sector, source, items: filterStocks(cached.payload.items, filter, market), total: cached.payload.items.length, coverage: sourceCoverage(cached.payload.items), dataSource: cached.originalSource, cached: true, updatedAt: cached.updatedAt }); }
  try {
    const requestedDate = req.query.date ? dateKey(req.query.date) : "";
    const realtime = liveSession() && (!requestedDate || requestedDate === dateKey());
    const items = await fetchAuctionStocksBySource(sector, sectorName, source, limit, { date, realtime });
    const dataSource = realtime ? `stockdb+${AUCTION_STOCK_SOURCES[source].source}+同花顺涨停池` : "stockdb 当日日K及已存竞价";
    const payload = { date, items, total: items.length, coverage: sourceCoverage(items) };
    if (items.length) saveCache(key, "auction-stocks", date, sector, payload, dataSource);
    res.json({ ok: true, ...payload, sector, source, items: filterStocks(items, filter, market), dataSource, cached: false });
  } catch (error) {
    res.status(503).json({ ok: false, date, sector, source, items: [], total: 0, dataQuality: "unavailable", error: error.message });
  }
});

async function kline(req, res, type) {
  const code = String(req.query.code || "").trim(); const period = ["daily", "weekly", "monthly"].includes(String(req.query.period)) ? String(req.query.period) : "daily"; const limit = Math.min(2000, Math.max(20, Number(req.query.limit) || 1000));
  if (!code) return res.status(400).json({ ok: false, items: [], error: "缺少代码" });
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, code, items: [], period, dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const key = `auction-stockdb:v4:${type}-kline:${code}:${date}:${period}:${limit}`;
  if (!force(req)) { const cached = getCache(key); if (cached?.payload?.items?.length) return res.json({ ok: true, ...cached.payload, source: cached.payload.source || cached.originalSource || cached.source, dataSource: cached.originalSource, cached: true, updatedAt: cached.updatedAt }); }
  try {
    const items = type === "sector"
      ? await fetchStockDbSectorKline(code, { limit, end: date, frequency: period, force: force(req) })
      : await fetchStockDbKline(code, { frequency: period, end: date, limit, force: force(req) });
    const isSector = type === "sector";
    const provenance = isSector ? describeStockDbSectorSeries(items) : null;
    const payload = {
      items,
      total: items.length,
      period,
      code,
      date: date || items.at(-1)?.date || "",
      source: provenance?.source || "stockdb",
      dataQuality: provenance?.dataQuality || (items.length ? "observed" : "unavailable"),
      methodology: provenance?.methodology,
      warning: provenance?.warning
    };
    if (items.length) saveCache(key, `${type}-kline`, date, code, payload, payload.source);
    res.json({ ok: true, ...payload, dataSource: "stockdb", cached: false });
  }
  catch (error) { const cached = getCache(key); if (cached?.payload?.items) return res.json({ ok: true, ...cached.payload, source: cached.payload.source || cached.originalSource || cached.source, dataSource: cached.originalSource, cached: true, dataQuality: "stale-local", warning: error.message }); res.status(503).json({ ok: false, items: [], source: SOURCE, dataQuality: "unavailable", error: error.message }); }
}
router.get("/api/auction-management/sector-kline", (req, res) => kline(req, res, "sector"));
router.get("/api/auction-management/stock-kline", (req, res) => kline(req, res, "stock"));

router.get("/api/auction-management/intraday", async (req, res) => {
  const code = String(req.query.code || "").trim(); if (!code) return res.status(400).json({ ok: false, items: [], error: "缺少代码" });
  let date;
  try { date = await resolveStockDbDate(req.query.date); }
  catch (error) { return res.status(503).json({ ok: false, code, items: [], dataQuality: "unavailable", error: `stockdb 交易日读取失败：${error.message}` }); }
  const kind = String(req.query.kind || "stock") === "sector" ? "sector" : "stock";
  const key = `auction-stockdb:v5:intraday:${code}:${date}:${kind}`;
  if (!force(req)) {
    const cached = getCache(key);
    const cachedHasStockMetadata = kind === "sector"
      || (String(cached?.payload?.name || "").trim() && cached?.payload?.items?.some((item) => Number(item?.preClose) > 0));
    if (cached?.payload?.items?.length && cachedHasStockMetadata) {
      const normalized = normalizeIntradayPayload(cached.payload);
      if (normalized.changed) saveCache(key, "auction-intraday", date, code, normalized.payload, IFIND_SOURCE);
      return res.json({ ok: true, ...normalized.payload, source: normalized.payload.source || cached.originalSource || cached.source, dataSource: cached.originalSource, cached: true, updatedAt: cached.updatedAt });
    }
  }
  try {
    let items;
    let stockName = "";
    let sectorPayload = null;
    if (kind === "sector") {
      sectorPayload = await fetchStockDbSectorIntraday(code, date);
      items = sectorPayload?.items || [];
    } else {
      const [rows, dailyRows] = await Promise.all([
        fetchStockDbKline(code, { frequency: "1m", start: date, end: date, limit: 2000 }),
        fetchStockDbKline(code, { frequency: "1d", start: date, end: date, limit: 5 }).catch(() => [])
      ]);
      const daily = dailyRows.find((row) => String(row.date).slice(0, 8) === date) || dailyRows.at(-1) || {};
      items = rows.map((row) => {
        const stamp = String(row.date);
        const time = /^\d{14}$/.test(stamp) ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}` : stamp;
        return { time, price: row.close, volume: row.volume, amount: row.amount, preClose: row.prevClose > 0 ? row.prevClose : (daily.prevClose ?? null) };
      });
      stockName = daily.name || rows.find((row) => row.name)?.name || "";
    }
    const isSector = kind === "sector";
    const provenance = isSector ? describeStockDbSectorSeries(items, { intraday: true, dataQuality: sectorPayload?.dataQuality }) : null;
    const payload = {
      items,
      total: items.length,
      code,
      date,
      name: isSector ? undefined : stockName,
      preClose: isSector ? undefined : (items.find((item) => Number(item.preClose) > 0)?.preClose ?? null),
      source: provenance?.source || "stockdb",
      dataQuality: provenance?.dataQuality || (items.length ? "observed" : "unavailable"),
      methodology: provenance?.methodology,
      warning: provenance?.warning
    };
    saveCache(key, "auction-intraday", date, code, payload, payload.source);
    res.json({ ok: true, ...payload, dataSource: "stockdb", cached: false });
  }
  catch (error) { const cached = getCache(key); if (cached?.payload?.items) { const normalized = normalizeIntradayPayload(cached.payload).payload; return res.json({ ok: true, ...normalized, source: normalized.source || cached.originalSource || cached.source, dataSource: cached.originalSource, cached: true, dataQuality: "stale-local", warning: error.message }); } res.status(503).json({ ok: false, items: [], source: SOURCE, dataQuality: "unavailable", error: error.message }); }
});

export default router;
