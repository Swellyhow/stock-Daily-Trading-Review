import express from "express";
import { fetchAuctionData, fetchStockQuote } from "../src/lib/collector/eastmoney-auto.js";
import marketDatabase from "../src/lib/collector/market-database.js";
import { writeStockDbAuctionSnapshots } from "../src/lib/collector/stockdb-client.js";

const router = express.Router();
const AUCTION_CACHE_MS = 3000;
const QUOTE_CACHE_MS = 2000;
const auctionCache = new Map();
const quoteCache = new Map();
const persistedFingerprints = new Map();
const stockDbSnapshotWrites = new Map();
let samplerTimer = null;

function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const time = `${values.hour}:${values.minute}:${values.second}`;
  const secondOfDay = Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second);
  const isTradingDay = !["Sat", "Sun"].includes(values.weekday);

  return { date, time, secondOfDay, isTradingDay };
}

function auctionSession(clock) {
  const start = 9 * 3600 + 15 * 60;
  const end = 9 * 3600 + 25 * 60;
  const open = 9 * 3600 + 30 * 60;

  if (!clock.isTradingDay) {
    return { phase: "closed", label: "非交易日", isAuctionOpen: false, shouldRecord: false };
  }
  if (clock.secondOfDay < start) {
    return { phase: "waiting", label: "等待竞价", isAuctionOpen: false, shouldRecord: false };
  }
  if (clock.secondOfDay <= end) {
    return { phase: "live", label: "集合竞价中", isAuctionOpen: true, shouldRecord: true };
  }
  if (clock.secondOfDay < open) {
    return { phase: "locked", label: "竞价结束", isAuctionOpen: false, shouldRecord: false };
  }
  return { phase: "closed", label: "非竞价时段", isAuctionOpen: false, shouldRecord: false };
}

function normalizeLimit(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(300, Math.max(20, number)) : 100;
}

function normalizeHistoryLimit(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(2000, Math.max(1, number)) : 2000;
}

function normalizeCode(value) {
  const code = String(value ?? "").trim();
  return /^(?:\d{6}|\d+\.\d+)$/.test(code) ? code : "";
}

async function cachedAuctionData(sortBy, limit) {
  const cacheKey = `${sortBy}:${limit}`;
  const cached = auctionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const items = await fetchAuctionData({ sortBy, limit });
  auctionCache.set(cacheKey, { items, expiresAt: Date.now() + AUCTION_CACHE_MS });
  return items;
}

async function cachedQuote(code) {
  const cached = quoteCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  const quote = await fetchStockQuote(code);
  quoteCache.set(code, { quote, expiresAt: Date.now() + QUOTE_CACHE_MS });
  return quote;
}

function snapshotFromQuote(quote, collectedAt, date, source = "eastmoney") {
  if (!quote?.code) return null;
  const sampledAtMs = new Date(collectedAt).getTime();
  const price = Number(quote.auctionPrice ?? quote.latestPrice ?? 0);
  if (!Number.isFinite(sampledAtMs) || price <= 0) return null;
  return {
    date,
    sampleTime: shanghaiClock(new Date(sampledAtMs)).time,
    sampledAt: new Date(sampledAtMs).toISOString(),
    sampledAtMs,
    code: String(quote.code),
    name: quote.name ?? "",
    auctionPrice: price,
    auctionChangePct: Number(quote.auctionChangePct ?? quote.changePct ?? 0),
    auctionVolume: Number(quote.auctionVolume ?? quote.volume ?? 0),
    auctionAmount: Number(quote.auctionAmount ?? quote.amount ?? 0),
    prevClose: Number(quote.prevClose ?? 0),
    open: Number(quote.open ?? price),
    high: Number(quote.high ?? price),
    low: Number(quote.low ?? price),
    turnoverPct: Number(quote.turnoverPct ?? 0),
    volumeRatio: Number(quote.volumeRatio ?? 0),
    source
  };
}

function persistSnapshots(items, collectedAt, date, source = "eastmoney") {
  const now = Date.now();
  const snapshots = [];
  for (const item of items ?? []) {
    const snapshot = snapshotFromQuote(item, collectedAt, date, source);
    if (!snapshot) continue;
    const fingerprint = [snapshot.auctionPrice, snapshot.auctionChangePct, snapshot.auctionVolume,
      snapshot.auctionAmount, snapshot.prevClose, snapshot.open, snapshot.high, snapshot.low,
      snapshot.turnoverPct, snapshot.volumeRatio].join("|");
    const previous = persistedFingerprints.get(`${date}:${snapshot.code}`);
    // The upstream list is cached for three seconds. Avoid turning repeated browser polls
    // of the same cached payload into duplicate database rows.
    if (previous && previous.fingerprint === fingerprint && now - previous.at < AUCTION_CACHE_MS + 500) continue;
    persistedFingerprints.set(`${date}:${snapshot.code}`, { fingerprint, at: now });
    snapshots.push(snapshot);
  }
  if (!snapshots.length) return 0;
  const inserted = marketDatabase.batchInsertAuctionSnapshots(snapshots);
  // Keep the latest browser/session observations in stockdb's private area.
  // A short per-day throttle avoids spawning a Python bridge for every poll.
  const lastWrite = stockDbSnapshotWrites.get(date) || 0;
  if (now - lastWrite >= 5000) {
    stockDbSnapshotWrites.set(date, now);
    void writeStockDbAuctionSnapshots(snapshots, { date, source }).catch((error) => {
      console.error(`[竞价采样] stockdb 私有存储失败 ${date}:`, error.message);
    });
  }
  return inserted;
}

async function sampleAuctionInBackground() {
  const collectedAt = new Date();
  const clock = shanghaiClock(collectedAt);
  if (!auctionSession(clock).shouldRecord) return;
  try {
    const items = await fetchAuctionData({ sortBy: "change_pct", limit: 100 });
    persistSnapshots(items, collectedAt, clock.date, "eastmoney-background");
  } catch (error) {
    console.error("[竞价采样] 后台采样失败:", error.message);
  }
}

export function startAuctionSampler() {
  if (samplerTimer) return samplerTimer;
  samplerTimer = setInterval(sampleAuctionInBackground, 5000);
  samplerTimer.unref?.();
  return samplerTimer;
}

export function stopAuctionSampler() {
  if (!samplerTimer) return;
  clearInterval(samplerTimer);
  samplerTimer = null;
}

router.get("/api/auction/live", async (req, res) => {
  const collectedAt = new Date();
  const clock = shanghaiClock(collectedAt);
  const session = auctionSession(clock);
  const sortBy = req.query.sortBy === "volume" ? "volume" : "change_pct";
  const limit = normalizeLimit(req.query.limit);
  const code = normalizeCode(req.query.code);

  const warnings = [];
  const items = session.isAuctionOpen
    ? await cachedAuctionData(sortBy, limit).catch((error) => {
        warnings.push(`竞价榜获取失败：${error.message}`);
        return [];
      })
    : [];
  let quote = code
    ? items.find((item) => item.code === code) ?? null
    : items[0] ?? null;

  if (session.isAuctionOpen && code && !quote) {
    quote = await cachedQuote(code).catch((error) => {
      warnings.push(`单股报价获取失败：${error.message}`);
      return null;
    });
  }

  if (session.shouldRecord) {
    try {
      persistSnapshots(items, collectedAt, clock.date, "eastmoney-browser");
      if (quote && !items.some((item) => String(item.code) === String(quote.code))) {
        persistSnapshots([quote], collectedAt, clock.date, "eastmoney-browser-selected");
      }
    } catch (error) {
      warnings.push(`竞价数据持久化失败：${error.message}`);
    }
  }

  res.json({
    ok: true,
    source: "东方财富公开行情",
    collectedAt: collectedAt.toISOString(),
    marketDate: clock.date,
    marketTime: clock.time,
    session,
    sortBy,
    count: items.length,
    upstreamAvailable: items.length > 0 || Boolean(quote),
    warnings,
    quote,
    items
  });
});

router.get("/api/auction/history", (req, res) => {
  const date = String(req.query.date ?? "").trim();
  const code = normalizeCode(req.query.code);
  const limit = normalizeHistoryLimit(req.query.limit);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !code) {
    return res.status(400).json({ ok: false, error: "date 和 code 参数格式不正确" });
  }
  const snapshots = marketDatabase.getAuctionSnapshots(date, code, limit);
  const samples = snapshots.map((item) => ({
    timestamp: item.sampledAtMs,
    time: item.sampleTime,
    price: Number(item.auctionPrice ?? 0),
    changePct: Number(item.auctionChangePct ?? 0),
    volume: Number(item.auctionVolume ?? 0),
    amount: Number(item.auctionAmount ?? 0),
    prevClose: Number(item.prevClose ?? 0),
    high: Number(item.high ?? item.auctionPrice ?? 0),
    low: Number(item.low ?? item.auctionPrice ?? 0),
    turnoverPct: Number(item.turnoverPct ?? 0),
    volumeRatio: Number(item.volumeRatio ?? 0),
    source: item.source
  }));
  res.json({ ok: true, date, code, count: samples.length, samples, stats: marketDatabase.getAuctionSnapshotStats(date) });
});

// The rebuilt auction workbench uses the iFinD MCP route. Keep the legacy
// endpoints available for historical compatibility, but do not start the old
// Eastmoney background sampler and mix its snapshots into the iFinD dataset.

export default router;
