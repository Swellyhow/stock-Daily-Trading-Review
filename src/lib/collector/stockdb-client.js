import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregatePriceBars, finiteNumber, stockDbTimeQuery, validPriceBar } from "./market-series.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(moduleDir, "../../..");
const defaultStockDbUrl = "http://127.0.0.1:7899";
const privateBridgePath = path.join(moduleDir, "stockdb-private-bridge.py");
const stockDbSnapshotCache = new Map();
const stockDbSnapshotInflight = new Map();
const stockDbTradingDatesCache = new Map();
const stockDbReferenceCacheMs = 5 * 60 * 1000;
let conceptCatalogCache = null;
const klineCache = new Map();
const klineInflight = new Map();
const sectorSeriesCache = new Map();
const sectorSeriesInflight = new Map();
// zhishu is substantially more expensive than reading an individual stock
// candle. It calculates a derived constituent index, so cache its daily and
// minute inputs separately from presentation periods; weekly/monthly reuse
// the daily series after it is aggregated locally.
const sectorSourceSeriesCache = new Map();
const sectorSourceSeriesInflight = new Map();

function loadProjectEnv() {
  const envPath = path.join(projectDir, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.replace(/^\uFEFF/, "").match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadProjectEnv();

// The public updater replaces files under data/, while the SDK writes private
// tables under mydb/. Keep custom namespaces explicit and independent.
export const STOCKDB_PRIVATE_TABLES = Object.freeze({
  limitUp: "hot_money.limit_up_pool",
  limitUpMembership: "hot_money.limit_up_membership",
  limitUpReasons: "hot_money.limit_up_reasons",
  limitUpReviewRuns: "hot_money.limit_up_review_runs",
  auction: "hot_money.auction_data",
  auctionSnapshots: "hot_money.auction_snapshots"
});

function stockDbUrl() {
  return String(process.env.STOCKDB_URL || defaultStockDbUrl).replace(/\/$/, "");
}

function normalizeCode(code) {
  const value = String(code ?? "").trim().toUpperCase()
    .replace(/^(?:SH|SZ|BJ)\.?/, "")
    .replace(/^[01]\./, "");
  return /^\d{6}$/.test(value) ? value : "";
}

function normalizeQuoteCode(code) {
  const value = String(code ?? "").trim().toUpperCase();
  return /^\d{6}\.(?:TI|SL)$/.test(value) ? value : normalizeCode(value);
}

function normalizeDate(date) {
  const value = String(date ?? "").replace(/-/g, "");
  return /^\d{8}$/.test(value) ? value : "";
}

function parseStockDbJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`stockdb 返回了无效 JSON：${String(text).slice(0, 160)}`);
  }
}

async function stockDbCommand(command, expression, timeoutMs = 10000) {
  const url = new URL(`${stockDbUrl()}/`);
  url.searchParams.set("cmd", command);
  url.searchParams.set("t", expression);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`stockdb HTTP ${response.status}`);
    return parseStockDbJson(text);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`stockdb 请求超时（${timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function stockDbQuery(command, table, key1 = "all:", key2 = "all:", options = {}) {
  const url = new URL(`${stockDbUrl()}/`);
  url.searchParams.set("cmd", command);
  url.searchParams.set("t", table);
  url.searchParams.set("k1", key1);
  url.searchParams.set("k2", key2);
  if (Number.isInteger(options.num) && options.num !== 0) url.searchParams.set("num", String(options.num));
  const timeoutMs = Number(options.timeoutMs) || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`stockdb HTTP ${response.status}`);
    return parseStockDbJson(text);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`stockdb 请求超时（${timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stockDbPythonPath() {
  if (process.env.STOCKDB_PYTHONPATH) return process.env.STOCKDB_PYTHONPATH;
  const candidates = [
    path.resolve(projectDir, "..", "free-stockdb-windows-v0.3.2", "stockdb", "pybao"),
    path.resolve(projectDir, "..", "free-stockdb", "pybao"),
    path.resolve(process.cwd(), "..", "free-stockdb-windows-v0.3.2", "stockdb", "pybao"),
    path.resolve(process.cwd(), "..", "free-stockdb", "pybao")
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "stockdb.pyd")) || fs.existsSync(path.join(candidate, "stockdb.py"))) || "";
}

function stockDbRootPath() {
  if (process.env.STOCKDB_ROOT) return path.resolve(process.env.STOCKDB_ROOT);
  const pythonPath = stockDbPythonPath();
  return pythonPath ? path.dirname(pythonPath) : "";
}

function stockDbConceptPath() {
  if (process.env.STOCKDB_CONCEPT_PATH) return path.resolve(process.env.STOCKDB_CONCEPT_PATH);
  const root = stockDbRootPath();
  return root ? path.join(root, "概念板块.json") : "";
}

export function isStockDbConceptCode(value) {
  return /^\d{6}\.TI$/i.test(String(value ?? "").trim());
}

function loadStockDbConceptCatalog() {
  const filePath = stockDbConceptPath();
  if (!filePath || !fs.existsSync(filePath)) throw new Error("stockdb 概念板块.json 不存在，请设置 STOCKDB_ROOT");
  const modifiedAt = fs.statSync(filePath).mtimeMs;
  if (conceptCatalogCache?.filePath === filePath && conceptCatalogCache.modifiedAt === modifiedAt) return conceptCatalogCache.items;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("stockdb 概念板块.json 格式无效");
  const items = parsed.map((item) => ({
    code: String(item?.code ?? "").trim().toUpperCase(),
    name: String(item?.name ?? "").trim(),
    source: "stockdb",
    type: String(item?.type ?? "concept"),
    group: String(item?.group ?? ""),
    category: String(item?.category ?? ""),
    symbols: [...new Set((Array.isArray(item?.symbols) ? item.symbols : []).map(normalizeCode).filter(Boolean))]
  })).filter((item) => isStockDbConceptCode(item.code) && item.name && item.category === "概念");
  conceptCatalogCache = { filePath, modifiedAt, items };
  return items;
}

function stockMarketType(code) {
  if (/^(?:300|301)/.test(code)) return "创业板";
  if (/^(?:688|689)/.test(code)) return "科创板";
  if (/^(?:4|8|92)/.test(code)) return "京A";
  if (/^6/.test(code)) return "沪A主板";
  return "深A主板";
}

function stockLimitRatio(row) {
  if (row?.isSt || /^(?:\*?ST|S\*ST)/i.test(String(row?.name ?? ""))) return 0.05;
  if (/^(?:300|301|688|689)/.test(String(row?.code ?? ""))) return 0.20;
  if (/^(?:4|8|92)/.test(String(row?.code ?? ""))) return 0.30;
  return 0.10;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function privateCommand(request, timeoutMs = 30000) {
  const python = process.env.STOCKDB_PYTHON || "python";
  const pythonPath = stockDbPythonPath();
  if (!pythonPath) throw new Error("未找到 stockdb Python SDK，请设置 STOCKDB_PYTHONPATH");
  const env = {
    ...process.env,
    // Windows Python defaults to the console code page (GBK). Node sends the
    // JSON request as UTF-8, so force UTF-8 for both stdin and stdout.
    PYTHONUTF8: "1",
    PYTHONPATH: [pythonPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
  };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(python, [privateBridgePath], {
      cwd: projectDir,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`stockdb 私有存储超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(request));
  });
  const payload = parseStockDbJson(String(result.stdout || "").trim().split(/\r?\n/).pop() || "{}");
  if (result.code !== 0 || payload.ok === false) {
    const detail = payload.error || String(result.stderr || "").trim() || `退出码 ${result.code}`;
    throw new Error(`stockdb 私有存储失败：${detail}`);
  }
  return payload;
}

async function readPrivateDay(table, date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  const payload = await privateCommand({ op: "get_day", table, date: normalizedDate });
  return Array.isArray(payload.items) ? payload.items : [];
}

async function readPrivateDays(table, dates) {
  const normalizedDates = [...new Set((dates || []).map(normalizeDate).filter(Boolean))];
  if (!normalizedDates.length) return [];
  const payload = await privateCommand({ op: "get_days", table, dates: normalizedDates });
  return Array.isArray(payload.items) ? payload.items : [];
}

function mergeLimitUpRows(detailed, membership) {
  const byKey = new Map();
  for (const item of membership) if (item?.code && item?.date) byKey.set(`${item.date}:${item.code}`, item);
  for (const item of detailed) if (item?.code && item?.date) byKey.set(`${item.date}:${item.code}`, item);
  return [...byKey.values()];
}

function normalizeKlineRow(row, code) {
  if (!row || typeof row !== "object") return null;
  const date = String(row.date ?? "").replace(/-/g, "");
  if (!/^\d{8}(?:\d{6})?$/.test(date)) return null;
  // Never relabel a returned six-digit stock row as a requested .TI board.
  // Some stockdb SDK surfaces silently strip the .TI suffix; the public rd
  // table must therefore prove the returned code matches the requested code.
  const returnedCode = row.code == null || row.code === "" ? code : normalizeQuoteCode(row.code);
  if (!returnedCode || returnedCode !== code) return null;
  return {
    code: returnedCode,
    name: row.name || "",
    date,
    open: finiteNumber(row.open),
    close: finiteNumber(row.close),
    high: finiteNumber(row.high),
    low: finiteNumber(row.low),
    volume: finiteNumber(row.volume),
    amount: finiteNumber(row.amount),
    changePct: finiteNumber(row.pct_chg ?? row.changePct),
    turnoverPct: finiteNumber(row.turnover ?? row.turnoverPct),
    prevClose: finiteNumber(row.pre_close ?? row.prevClose),
    floatMarketCap: finiteNumber(row.float_mv ?? row.floatMarketCap),
    totalMarketCap: finiteNumber(row.total_mv ?? row.totalMarketCap),
    isSt: Boolean(row.is_st ?? row.isSt ?? false)
  };
}

function filterByDate(rows, start, end) {
  const startDate = normalizeDate(start);
  const endDate = normalizeDate(end);
  return rows.filter((row) => {
    const rowDate = row.date.slice(0, 8);
    return (!startDate || rowDate >= startDate) && (!endDate || rowDate <= endDate);
  });
}

// The bundled stockdb Windows service exposes the public market tables as
// read-only. Keep the retention policy at the application boundary so a
// request without an explicit range can never pull years of minute bars.
function minuteRetentionStartDate() {
  const retentionDays = Math.max(1, Number(process.env.STOCKDB_MINUTE_RETENTION_DAYS) || 365);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - retentionDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export async function fetchStockDbKline(code, options = {}) {
  const normalizedCode = normalizeQuoteCode(code);
  if (!normalizedCode) return [];
  const inputFrequency = String(options.frequency || options.period || "1d");
  const frequency = ({ daily: "1d", weekly: "1w", monthly: "1M", minute: "1m" })[inputFrequency] || inputFrequency.replace("min", "m");
  if (!["1d", "1w", "1M", "1m", "5m", "15m", "30m", "60m"].includes(frequency)) throw new Error("不支持的 K 线周期");
  const table = ["1m", "5m", "15m", "30m", "60m", "1min", "5min", "15min", "30min", "60min"].includes(frequency) ? "分钟k" : "日k";
  let startDate = normalizeDate(options.start);
  const endDate = normalizeDate(options.end);
  if (table === "分钟k") {
    const retentionStart = minuteRetentionStartDate();
    // An entirely older request cannot return retained data. For an open or
    // overlapping request, clamp the lower bound before querying stockdb.
    if (endDate && endDate < retentionStart) return [];
    if (!startDate || startDate < retentionStart) startDate = retentionStart;
  }
  const limit = Number(options.limit);
  const needsAggregation = !["1d", "1m"].includes(frequency);
  // Daily histories are small. Read the complete selected range for week/month
  // bars, so the first returned period is never silently truncated.
  const sourceLimit = needsAggregation ? (table === "日k" ? undefined : limit > 0 ? limit * Number.parseInt(frequency) + 242 : undefined) : limit;
  const { key2, num } = stockDbTimeQuery({ minute: table === "分钟k", start: startDate, end: endDate, limit: sourceLimit });
  const cacheKey = JSON.stringify([stockDbUrl(), normalizedCode, table, key2, num]);
  const cached = klineCache.get(cacheKey);
  let raw;
  if (!options.force && cached && Date.now() - cached.time < 30000) raw = cached.items;
  else {
    if (!klineInflight.has(cacheKey)) {
      const request = stockDbQuery("vals", table, `key:${normalizedCode}`, key2, { num, timeoutMs: options.timeoutMs }).then(items => {
        if (Array.isArray(items) && items.length) {
          if (klineCache.size >= 200) klineCache.delete(klineCache.keys().next().value);
          klineCache.set(cacheKey, { items, time: Date.now() });
        }
        return items;
      }).finally(() => klineInflight.delete(cacheKey));
      klineInflight.set(cacheKey, request);
    }
    raw = await klineInflight.get(cacheKey);
  }
  const values = Array.isArray(raw) ? raw : [];
  let rows = values.map(row => normalizeKlineRow(row, normalizedCode)).filter(row => row && row.code === normalizedCode);
  rows = aggregatePriceBars(filterByDate(rows, options.start, options.end), frequency);
  if (options.desc) rows.reverse();
  return Number.isFinite(limit) && limit > 0 ? rows.slice(options.desc ? 0 : -limit) : rows;
}

export async function fetchStockDbTradingDates(code = "000001", limit = 500) {
  const normalizedCode = normalizeCode(code) || "000001";
  const cached = stockDbTradingDatesCache.get(normalizedCode);
  if (cached && Date.now() - cached.time < stockDbReferenceCacheMs) {
    return cached.dates.slice(0, Math.max(1, Number(limit) || 500));
  }
  const raw = await stockDbCommand("keys", `日k:${normalizedCode}:*`);
  const dates = [...new Set((Array.isArray(raw) ? raw : []).map((key) => normalizeDate(String(key).split(":").pop())).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  stockDbTradingDatesCache.set(normalizedCode, { time: Date.now(), dates });
  return dates.slice(0, Math.max(1, Number(limit) || 500));
}

export async function fetchStockDbDailySnapshot(date, options = {}) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  const cached = stockDbSnapshotCache.get(normalizedDate);
  if (!options.force && cached && Date.now() - cached.time < stockDbReferenceCacheMs) return cached.items;
  if (!options.force && stockDbSnapshotInflight.has(normalizedDate)) return stockDbSnapshotInflight.get(normalizedDate);
  const pending = (async () => {
    // Missing-date market scans visit every symbol history. Check the same
    // observed trading calendar exposed to the UI before scanning the market.
    const dates = await fetchStockDbTradingDates("000001", 20000);
    if (!dates.includes(normalizedDate)) return [];
    return stockDbQuery("vals", "日k", "all:", `key:${normalizedDate}`, { timeoutMs: 60000 });
  })().then((raw) => {
    const items = (Array.isArray(raw) ? raw : []).map((row) => normalizeKlineRow(row, normalizeQuoteCode(row?.code))).filter(Boolean);
    if (items.length) {
      if (stockDbSnapshotCache.size >= 10) stockDbSnapshotCache.delete(stockDbSnapshotCache.keys().next().value);
      stockDbSnapshotCache.set(normalizedDate, { time: Date.now(), items });
    }
    return items;
  }).finally(() => stockDbSnapshotInflight.delete(normalizedDate));
  stockDbSnapshotInflight.set(normalizedDate, pending);
  return pending;
}

export async function fetchStockDbConceptBoards(options = {}) {
  const catalog = loadStockDbConceptCatalog();
  const limit = Math.max(1, Number(options.limit) || catalog.length);
  const dates = await fetchStockDbTradingDates("000001", 1);
  const date = normalizeDate(options.date) || dates[0] || "";
  const snapshot = date ? await fetchStockDbDailySnapshot(date, options) : [];
  if (!snapshot.length) throw new Error(`stockdb 尚无 ${date} 的日 K 快照`);
  const byCode = new Map(snapshot.map((row) => [row.code, row]));
  const items = catalog.slice(0, limit).map((board) => {
    const rows = board.symbols.map((code) => byCode.get(code)).filter(Boolean);
    const changes = rows.map(row => finiteNumber(row.changePct)).filter(value => value !== null);
    const changePct = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
    const native = byCode.get(board.code);
    let limitUpCount = 0;
    let limitDownCount = 0;
    for (const row of rows) {
      const ratio = stockLimitRatio(row) * 100;
      if (Number(row.changePct) >= ratio - 0.05) limitUpCount += 1;
      if (Number(row.changePct) <= -ratio + 0.05) limitDownCount += 1;
    }
    return {
      code: board.code,
      name: board.name,
      latestPrice: native?.close ?? null,
      prevClose: native?.prevClose ?? null,
      changePct: native?.changePct ?? (changePct === null ? null : Number(changePct.toFixed(2))),
      changeAmount: native?.close != null && native?.prevClose != null ? native.close - native.prevClose : null,
      volume: rows.reduce((sum, row) => sum + Number(row.volume || 0), 0),
      amount: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      amplitudePct: native?.prevClose > 0 ? (native.high - native.low) / native.prevClose * 100 : null,
      turnoverPct: rows.length ? Number((rows.reduce((sum, row) => sum + Number(row.turnoverPct || 0), 0) / rows.length).toFixed(2)) : 0,
      upCount: rows.filter((row) => Number(row.changePct) > 0).length,
      downCount: rows.filter((row) => Number(row.changePct) < 0).length,
      flatCount: rows.filter((row) => Number(row.changePct) === 0).length,
      limitUpCount,
      limitDownCount,
      mainNetInflow: null,
      leaderName: rows.slice().sort((a, b) => Number(b.changePct) - Number(a.changePct))[0]?.name || "",
      leaderChangePct: Number(rows.slice().sort((a, b) => Number(b.changePct) - Number(a.changePct))[0]?.changePct || 0),
      startTime: "",
      lowPriceTime: "",
      highPriceTime: "",
      news: "",
      memberCount: board.symbols.length,
      observedCount: rows.length,
      date,
      source: native ? "stockdb 板块原生行情" : "stockdb 成分股统计",
      quoteQuality: native ? "native" : "constituent-statistics",
      changeMethodology: native ? "板块原生涨跌幅" : "当日有效成分股等权涨跌幅，非板块指数"
    };
  });
  return { date, items };
}

function conceptBoard(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  return loadStockDbConceptCatalog().find((item) => item.code === normalized) || null;
}

export function fetchStockDbConceptMembers(code) {
  const board = conceptBoard(code);
  if (!board) throw new Error(`stockdb 中不存在概念板块：${code}`);
  return { code: board.code, name: board.name, symbols: [...board.symbols] };
}

function minuteTime(stamp) {
  const value = String(stamp ?? "");
  return /^\d{14}$/.test(value) ? `${value.slice(8, 10)}:${value.slice(10, 12)}` : "";
}

function enrichStockFromMinutes(daily, minuteRows) {
  const ordered = [...minuteRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let lowPriceTime = "";
  let highPriceTime = "";
  let startTime = "";
  let fallTime = "";
  let limitUpTime = "";
  let limitDownTime = "";
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let riseVolume = Number.NEGATIVE_INFINITY;
  let fallVolume = Number.NEGATIVE_INFINITY;
  let previousPrice = Number.NaN;
  const ratio = stockLimitRatio(daily);
  const upper = Math.round(Number(daily.prevClose) * (1 + ratio) * 100) / 100;
  const lower = Math.round(Number(daily.prevClose) * (1 - ratio) * 100) / 100;
  const intradayItems = [];
  for (const row of ordered) {
    const price = Number(row.close);
    const volume = Number(row.volume || 0);
    const time = minuteTime(row.date);
    if (!time || !(price > 0)) continue;
    intradayItems.push({ time, price, volume, amount: Number(row.amount || 0) });
    if (Number(row.low) < low) { low = Number(row.low); lowPriceTime = time; }
    if (Number(row.high) > high) { high = Number(row.high); highPriceTime = time; }
    if (Number.isFinite(previousPrice) && price > previousPrice && volume > riseVolume) { riseVolume = volume; startTime = time; }
    if (Number.isFinite(previousPrice) && price < previousPrice && volume > fallVolume) { fallVolume = volume; fallTime = time; }
    if (!limitUpTime && Number(row.high) >= upper - 0.011) limitUpTime = time;
    if (!limitDownTime && Number(row.low) <= lower + 0.011) limitDownTime = time;
    previousPrice = price;
  }
  const latestPrice = Number(daily.close || 0);
  return {
    code: daily.code,
    name: daily.name,
    changePct: daily.changePct,
    latestPrice,
    mainAmount: null,
    turnoverPct: daily.turnoverPct,
    marketType: stockMarketType(daily.code),
    lowPriceTime,
    highPriceTime,
    startTime,
    fallTime,
    limitUpTime,
    limitDownTime,
    circulatingMarketCap: daily.floatMarketCap,
    totalMarketCap: daily.totalMarketCap,
    volume: daily.volume,
    amount: daily.amount,
    date: daily.date,
    sectorStartTime: "",
    news: "",
    limitUp: daily.prevClose > 0 ? latestPrice >= upper - 0.001 : null,
    limitDown: daily.prevClose > 0 ? latestPrice <= lower + 0.001 : null,
    limitStatusQuality: "stockdb 日K+1分钟K",
    limitTypes: [],
    limitTypeStatus: "pending",
    intradayItems,
    prevClose: Number(daily.prevClose || 0),
    open: Number(daily.open || 0),
    high: Number(daily.high || 0),
    low: Number(daily.low || 0),
    source: "stockdb"
  };
}

export async function fetchStockDbConceptStocks(code, options = {}) {
  const board = conceptBoard(code);
  if (!board) throw new Error(`stockdb 中不存在概念板块：${code}`);
  const requested = options.codes ? board.symbols.filter(code => options.codes.includes(code)) : board.symbols;
  const { date, items } = await fetchStockDbStocks({ ...options, codes: requested });
  return { date, board, items };
}

export async function fetchStockDbStocks(options = {}) {
  const date = normalizeDate(options.date) || (await fetchStockDbTradingDates("000001", 1))[0] || "";
  const snapshot = await fetchStockDbDailySnapshot(date, options);
  if (!snapshot.length) throw new Error(`stockdb 尚无 ${date} 的日 K 快照`);
  const codes = Array.isArray(options.codes) ? new Set(options.codes.map(normalizeCode).filter(Boolean)) : null;
  const query = String(options.query || "").trim().toLowerCase();
  const dailyRows = snapshot.filter(row => /^(?:00|30|60|68|92|43|83|87|88)\d{4}$/.test(row.code)
    && (!codes || codes.has(row.code))
    && (!query || `${row.code} ${row.name}`.toLowerCase().includes(query)))
    .slice(0, Math.max(1, Number(options.limit) || 10000));
  const items = await mapConcurrent(dailyRows, 8, async (row) => {
    const minuteRows = options.withMinutes === false ? [] : await fetchStockDbKline(row.code, { frequency: "1m", start: date, end: date, timeoutMs: 30000 }).catch(() => []);
    return enrichStockFromMinutes(row, minuteRows);
  });
  return { date, items };
}

export async function fetchStockDbSectorKline(code, options = {}) {
  const board = conceptBoard(code);
  if (!board) throw new Error(`stockdb 中不存在概念板块：${code}`);
  const inputFrequency = String(options.frequency || "1d");
  const frequency = ({ daily: "1d", weekly: "1w", monthly: "1M", minute: "1m" })[inputFrequency] || inputFrequency.replace("min", "m");
  if (!["1d", "1w", "1M", "1m"].includes(frequency)) throw new Error("不支持的板块 K 线周期");

  // Current stockdb packages commonly expose .TI only as a concept/member
  // catalog. Do not hard-code that limitation: a future package can include
  // native board bars, which are more authoritative than a derived index.
  const nativeRows = await fetchStockDbKline(board.code, {
    frequency,
    start: normalizeDate(options.start) || undefined,
    end: normalizeDate(options.end) || undefined,
    limit: options.limit,
    desc: options.desc,
    force: options.force,
    timeoutMs: options.timeoutMs
  }).catch(() => []);
  if (nativeRows.length) {
    return nativeRows.map((row) => ({
      ...row,
      source: "stockdb .TI 原生板块行情",
      quoteQuality: "native",
      changeMethodology: "stockdb .TI 原生K线"
    }));
  }

  // No native .TI bar was returned locally. The bundled SDK's official zhishu
  // calculator is the canonical fallback for a constituent-derived index.
  const sourceFrequency = frequency === "1m" ? "1m" : "1d";
  const cacheKey = JSON.stringify([
    board.code,
    frequency,
    sourceFrequency,
    normalizeDate(options.start),
    normalizeDate(options.end),
    Number(options.limit) || 0,
    Number(options.method) || 1,
    Number(options.base) || 1000
  ]);
  const cached = sectorSeriesCache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.time < stockDbReferenceCacheMs) return cached.items;
  if (!options.force && sectorSeriesInflight.has(cacheKey)) return sectorSeriesInflight.get(cacheKey);
  const pending = (async () => {
    const sourceKey = JSON.stringify([
      board.code,
      sourceFrequency,
      normalizeDate(options.start),
      normalizeDate(options.end),
      Number(options.method) || 1,
      Number(options.base) || 1000
    ]);
    const readSource = async () => {
      const sourceCached = sectorSourceSeriesCache.get(sourceKey);
      if (!options.force && sourceCached && Date.now() - sourceCached.time < stockDbReferenceCacheMs) return sourceCached.items;
      if (!options.force && sectorSourceSeriesInflight.has(sourceKey)) return sectorSourceSeriesInflight.get(sourceKey);
      const sourcePending = (async () => {
        const payload = await privateCommand({
          op: "zhishu",
          symbols: board.symbols,
          start: normalizeDate(options.start) || undefined,
          end: normalizeDate(options.end) || undefined,
          frequency: sourceFrequency,
          method: Number(options.method) || 1,
          base: Number(options.base) || 1000
        }, Number(options.timeoutMs) || 60000);
        const items = (Array.isArray(payload.items) ? payload.items : []).map((row) => {
          const date = String(row?.date ?? "").replace(/-/g, "");
          const close = finiteNumber(row?.close);
          const pct = finiteNumber(row?.pct_chg ?? row?.changePct);
          const prevClose = close !== null && pct !== null && pct > -100 ? close / (1 + pct / 100) : null;
          return {
            code: board.code,
            name: board.name,
            date,
            open: finiteNumber(row?.open),
            high: finiteNumber(row?.high),
            low: finiteNumber(row?.low),
            close,
            volume: finiteNumber(row?.volume),
            amount: finiteNumber(row?.amount),
            changePct: pct,
            prevClose,
            stockCount: Number(row?.stock_count) || 0,
            source: "stockdb zhishu 成分股合成指数",
            quoteQuality: "constituent-index",
            changeMethodology: "stockdb zhishu method=1 等权成分股指数"
          };
        }).filter((row) => /^\d{8}(?:\d{6})?$/.test(row.date) && validPriceBar(row));
        if (sectorSourceSeriesCache.size >= 100) sectorSourceSeriesCache.delete(sectorSourceSeriesCache.keys().next().value);
        sectorSourceSeriesCache.set(sourceKey, { time: Date.now(), items });
        return items;
      })().finally(() => sectorSourceSeriesInflight.delete(sourceKey));
      if (!options.force) sectorSourceSeriesInflight.set(sourceKey, sourcePending);
      return sourcePending;
    };
    const rows = await readSource();
    const result = frequency === "1d" || frequency === "1m" ? rows : aggregatePriceBars(rows, frequency);
    const limited = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
      ? result.slice(options.desc ? 0 : -Number(options.limit))
      : result;
    if (sectorSeriesCache.size >= 100) sectorSeriesCache.delete(sectorSeriesCache.keys().next().value);
    sectorSeriesCache.set(cacheKey, { time: Date.now(), items: limited });
    return limited;
  })().finally(() => sectorSeriesInflight.delete(cacheKey));
  sectorSeriesInflight.set(cacheKey, pending);
  return pending;
}

export function describeStockDbSectorSeries(rows, options = {}) {
  const items = Array.isArray(rows) ? rows : [];
  const intraday = options.intraday === true;
  const nativeRow = items.find((row) => row?.quoteQuality === "native");
  const native = options.dataQuality === "native" || Boolean(nativeRow);
  const hasItems = items.length > 0;
  const subject = intraday ? "分时" : "K线";
  if (!hasItems) {
    return {
      source: "stockdb",
      dataQuality: "unavailable",
      methodology: undefined,
      warning: `stockdb 未返回该板块${subject}数据`
    };
  }
  if (native) {
    const online = /get_price/.test(String(nativeRow?.source || options.source || ""));
    return {
      source: online ? "stockdb get_price 原生板块行情" : "stockdb .TI 原生板块行情",
      dataQuality: "native",
      methodology: `stockdb ${online ? "get_price" : ".TI"} 原生${intraday ? "1分钟K" : "K线"}`,
      warning: undefined
    };
  }
  return {
    source: "stockdb zhishu 成分股合成指数",
    dataQuality: "constituent-index",
    methodology: "stockdb zhishu method=1 等权成分股指数",
    warning: `板块${subject}为按成分股计算的合成指数，并非 .TI 原生${intraday ? "分时" : "K线"}`
  };
}

export async function fetchStockDbSectorIntraday(code, date) {
  const board = conceptBoard(code);
  if (!board) throw new Error(`stockdb 中不存在概念板块：${code}`);
  const normalizedDate = normalizeDate(date) || (await fetchStockDbTradingDates("000001", 1))[0] || "";
  const rows = await fetchStockDbSectorKline(board.code, { frequency: "1m", start: normalizedDate, end: normalizedDate });
  const items = rows.map(row => ({
    time: minuteTime(row.date),
    price: row.close,
    volume: row.volume,
    amount: row.amount,
    average: null,
    source: row.source,
    quoteQuality: row.quoteQuality,
    changeMethodology: row.changeMethodology
  }));
  const provenance = describeStockDbSectorSeries(rows, { intraday: true });
  return {
    date: normalizedDate,
    name: board.name,
    items,
    ...provenance
  };
}

// The public minute table intentionally contains only OHLCV/amount fields.
// Resolve the selected day's daily row alongside minutes so consumers can
// render the stock name and previous close without fabricating metadata.
export async function fetchStockDbStockIntraday(code, date, options = {}) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) throw new Error(`无效股票代码：${code}`);
  const normalizedDate = normalizeDate(date) || (await fetchStockDbTradingDates(normalizedCode, 1))[0] || "";
  if (!normalizedDate) return { date: "", name: "", prevClose: null, items: [] };
  const [dailyRows, minuteRows] = await Promise.all([
    fetchStockDbKline(normalizedCode, {
      frequency: "1d",
      start: normalizedDate,
      end: normalizedDate,
      limit: 2,
      force: options.force,
      timeoutMs: options.timeoutMs
    }),
    fetchStockDbKline(normalizedCode, {
      frequency: "1m",
      start: normalizedDate,
      end: normalizedDate,
      limit: 2000,
      force: options.force,
      timeoutMs: options.timeoutMs
    })
  ]);
  const daily = dailyRows.find((row) => row.date.slice(0, 8) === normalizedDate) || dailyRows.at(-1);
  const fallbackPrevClose = daily && !Number.isFinite(Number(daily.prevClose))
    ? Number.NaN
    : Number(daily?.prevClose);
  const prevClose = Number.isFinite(fallbackPrevClose) && fallbackPrevClose > 0
    ? fallbackPrevClose
    : Number(daily?.close) > 0 ? Number(daily.close) : null;
  const items = minuteRows.map((row) => {
    const stamp = String(row.date ?? "");
    if (!/^\d{14}$/.test(stamp) || !(Number(row.close) > 0)) return null;
    return {
      time: minuteTime(stamp),
      price: Number(row.close),
      volume: Number(row.volume ?? 0),
      amount: Number(row.amount ?? 0),
      preClose: prevClose
    };
  }).filter((item) => item && item.time);
  return {
    date: normalizedDate,
    name: String(daily?.name ?? ""),
    prevClose,
    items
  };
}

export async function readStockDbLimitUp(date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  return readStockDbLimitUpDays([normalizedDate]);
}

export async function readStockDbLimitUpMembership(date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  return readPrivateDay(STOCKDB_PRIVATE_TABLES.limitUpMembership, normalizedDate);
}

export async function readStockDbLimitUpReasons(date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  return readPrivateDay(STOCKDB_PRIVATE_TABLES.limitUpReasons, normalizedDate);
}

export async function readStockDbLimitUpReviewStatus(date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return null;
  const rows = await readPrivateDay(STOCKDB_PRIVATE_TABLES.limitUpReviewRuns, normalizedDate);
  return rows[0] || null;
}

export async function writeStockDbLimitUpReviewStatus(status, { date } = {}) {
  const normalizedDate = normalizeDate(date || status?.date);
  if (!normalizedDate || !status || typeof status !== "object") return { ok: true, count: 0 };
  return privateCommand({
    op: "set_batch",
    table: STOCKDB_PRIVATE_TABLES.limitUpReviewRuns,
    rows: [{ key1: normalizedDate, key2: "status", value: { ...status, date: normalizedDate, updatedAt: new Date().toISOString(), storageVersion: "hot-money-limit-review-status-v1" } }]
  });
}

export async function readStockDbLimitUpDays(dates) {
  const normalizedDates = [...new Set((dates || []).map(normalizeDate).filter(Boolean))];
  if (!normalizedDates.length) return [];
  const [detailed, membership] = await Promise.all([
    readPrivateDays(STOCKDB_PRIVATE_TABLES.limitUp, normalizedDates),
    readPrivateDays(STOCKDB_PRIVATE_TABLES.limitUpMembership, normalizedDates)
  ]);
  // A detailed Eastmoney row is authoritative when both sources contain the
  // same date/code. Membership-only rows are still returned for the workbench.
  return mergeLimitUpRows(detailed, membership);
}

export async function writeStockDbLimitUp(rows, { date, source = "eastmoney", kind = "generic", replace = false } = {}) {
  const normalizedDate = normalizeDate(date);
  const values = (rows || []).map((row) => {
    const code = normalizeCode(row.code);
    if (!code || !normalizedDate) return null;
    return {
      key1: normalizedDate,
      key2: code,
      value: { ...row, code, date: normalizedDate, storageVersion: "hot-money-limit-up-v1", storageKind: kind, storageSource: source, storedAt: new Date().toISOString() }
    };
  }).filter(Boolean);
  const table = kind === "membership" ? STOCKDB_PRIVATE_TABLES.limitUpMembership : STOCKDB_PRIVATE_TABLES.limitUp;
  if (replace && normalizedDate) return privateCommand({ op: "replace_day", table, date: normalizedDate, rows: values });
  if (!values.length) return { ok: true, count: 0 };
  return privateCommand({ op: "set_batch", table, rows: values });
}

export async function writeStockDbLimitUpReasons(rows, { date, source = "同花顺涨停复盘", replace = true } = {}) {
  const normalizedDate = normalizeDate(date);
  const values = (rows || []).map((row) => {
    const code = normalizeCode(row.code);
    if (!code || !normalizedDate || !String(row.reason || "").trim()) return null;
    return {
      key1: normalizedDate,
      key2: code,
      value: { ...row, code, date: normalizedDate, storageVersion: "hot-money-limit-reason-v1", storageSource: source, storedAt: new Date().toISOString() }
    };
  }).filter(Boolean);
  if (replace && normalizedDate) return privateCommand({ op: "replace_day", table: STOCKDB_PRIVATE_TABLES.limitUpReasons, date: normalizedDate, rows: values });
  if (!values.length) return { ok: true, count: 0 };
  return privateCommand({ op: "set_batch", table: STOCKDB_PRIVATE_TABLES.limitUpReasons, rows: values });
}

export async function writeStockDbAuction(rows, { date, source = "eastmoney" } = {}) {
  const normalizedDate = normalizeDate(date);
  const values = (rows || []).map((row) => {
    const code = normalizeCode(row.code);
    if (!code || !normalizedDate) return null;
    return {
      key1: normalizedDate,
      key2: code,
      value: { ...row, code, date: normalizedDate, storageVersion: "hot-money-auction-v1", storageSource: source, storedAt: new Date().toISOString() }
    };
  }).filter(Boolean);
  if (!values.length) return { ok: true, count: 0 };
  return privateCommand({ op: "set_batch", table: STOCKDB_PRIVATE_TABLES.auction, rows: values });
}

export async function readStockDbAuction(date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  const [summary, snapshots] = await Promise.all([
    readPrivateDay(STOCKDB_PRIVATE_TABLES.auction, normalizedDate),
    readPrivateDay(STOCKDB_PRIVATE_TABLES.auctionSnapshots, normalizedDate)
  ]);
  const byCode = new Map();
  for (const item of summary) if (item?.code) byCode.set(String(item.code), item);
  // Snapshots contain the most recent auction quote, so prefer them over the
  // one-shot summary when both are available.
  for (const item of snapshots) if (item?.code) byCode.set(String(item.code), item);
  return [...byCode.values()];
}

export async function writeStockDbAuctionSnapshots(rows, { date, source = "eastmoney" } = {}) {
  const normalizedDate = normalizeDate(date);
  const values = (rows || []).map((row) => {
    const code = normalizeCode(row.code);
    if (!code || !normalizedDate) return null;
    return {
      key1: normalizedDate,
      key2: code,
      value: { ...row, code, date: normalizedDate, storageVersion: "hot-money-auction-snapshot-v1", storageSource: source, storedAt: new Date().toISOString() }
    };
  }).filter(Boolean);
  if (!values.length) return { ok: true, count: 0 };
  return privateCommand({ op: "set_batch", table: STOCKDB_PRIVATE_TABLES.auctionSnapshots, rows: values });
}

export async function stockDbHealth() {
  try {
    const value = await stockDbCommand("get", "股票代码", 3000);
    return { ok: true, source: stockDbUrl(), hasStockCatalog: Boolean(value && typeof value === "object") };
  } catch (error) {
    return { ok: false, source: stockDbUrl(), error: error.message };
  }
}
