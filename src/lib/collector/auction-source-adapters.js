import { fetchThsConceptBoardList, fetchThsLimitUpPool } from "./ths-auto.js";
import { fetchStockDbConceptStocks, readStockDbAuction, readStockDbLimitUpReasons } from "./stockdb-client.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep explicit process variables authoritative, while allowing the local
// project/skill environment files used by this workspace to be loaded when
// the web server is started directly from npm.
function loadProjectEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
  for (const file of [path.join(root, ".env"), path.join(root, ".codex", "skills", ".env")]) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || match[1] in process.env) continue;
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Missing environment files are valid; the source reports unavailable.
    }
  }
}

loadProjectEnv();

const DEFAULT_MX_URL = "https://mkapi2.dfcfs.com/finskillshub";
function mxUrl() { return process.env.MX_API_URL || DEFAULT_MX_URL; }
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const historicalCache = new Map();

function number(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[,亿万股元%]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function marketPrefix(code) {
  const raw = String(code ?? "").replace(/\.(SH|SZ|BJ)$/i, "");
  if (/^(6|68)/.test(raw)) return "sh";
  if (/^(0|3)/.test(raw)) return "sz";
  if (/^(4|8|92)/.test(raw)) return "bj";
  return "";
}

function marketType(code) {
  const raw = String(code ?? "").replace(/\.(SH|SZ|BJ)$/i, "");
  if (/^688|^689/.test(raw)) return "科创板";
  if (/^30/.test(raw)) return "创业板";
  if (/^(4|8|92)/.test(raw)) return "京A";
  if (/^6/.test(raw)) return "沪A主板";
  if (/^(0|2)/.test(raw)) return "深A主板";
  return "A股";
}

function baseStock(member) {
  const code = String(member.code ?? "").replace(/\.(SH|SZ|BJ)$/i, "");
  return {
    code,
    name: member.name || "",
    marketType: member.marketType || marketType(code),
    boardLabel: member.boardLabel || "",
    yesterdayBoardCount: member.yesterdayBoardCount ?? null,
    yesterdayHigh: member.yesterdayHigh ?? null,
    yesterdayClose: member.yesterdayClose ?? null,
    news: member.news || "",
    auctionPrice: null,
    auctionChangePct: null,
    auctionVolume: null,
    auctionAmount: null,
    todayOpen: null,
    latestPrice: null,
    prevClose: null,
    changePct: null,
    changeAmount: null,
    high: null,
    low: null,
    volume: null,
    amount: null,
    turnoverPct: null,
    dataQuality: "unavailable",
    auctionDataStatus: "未提供竞价字段"
    ,latestPrice: member.latestPrice ?? member.close ?? null
    ,prevClose: member.prevClose ?? member.yesterdayClose ?? null
    ,todayOpen: member.todayOpen ?? member.open ?? null
    ,changePct: member.changePct ?? null
    ,changeAmount: member.changeAmount ?? null
    ,high: member.high ?? null
    ,low: member.low ?? null
    ,volume: member.volume ?? null
    ,amount: member.amount ?? null
    ,turnoverPct: member.turnoverPct ?? null
    ,circulatingMarketCap: member.circulatingMarketCap ?? member.floatMarketCap ?? null
  };
}

function normalizeMember(member) {
  return baseStock(member);
}

function applyQuote(row, quote, source, status = "普通实时行情") {
  return {
    ...row,
    ...quote,
    source,
    dataQuality: "observed",
    auctionDataStatus: status
  };
}

function currentPhase() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (day === 0 || day === 6) return "closed";
  if (minutes < 555) return "before-auction";
  if (minutes < 570) return "auction";
  if (minutes <= 900) return "trading";
  return "closed";
}

function previousTradeDate(value = new Date()) {
  const raw = String(value ?? "");
  const date = /^\d{8}$/.test(raw)
    ? new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00+08:00`)
    : new Date(value);
  do { date.setDate(date.getDate() - 1); } while (date.getDay() === 0 || date.getDay() === 6);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function applySessionFields(row, source) {
  const phase = currentPhase();
  if (phase === "before-auction" || phase === "closed") {
    return { ...row, latestPrice: row.prevClose ?? row.latestPrice, changePct: 0, todayOpen: null, auctionPrice: null, auctionChangePct: null, auctionDataStatus: "上一个交易日快照（竞价未开始）" };
  }
  if (phase === "auction") {
    const price = row.latestPrice;
    const change = row.prevClose && price != null ? (price - row.prevClose) / row.prevClose * 100 : null;
    return { ...row, todayOpen: row.todayOpen > 0 ? row.todayOpen : null, auctionPrice: price, auctionChangePct: change, auctionDataStatus: `${source}实时快照（集合竞价阶段）` };
  }
  // 集合竞价结束后，开盘价就是竞价撮合形成的最终价格。新浪/腾讯没有
  // 专用竞价字段时，用同一来源的今日开盘价补齐，避免把其他来源数据混入。
  if (phase === "trading" && row.auctionPrice == null && row.todayOpen != null && row.todayOpen > 0) {
    const change = row.prevClose && row.todayOpen != null ? (row.todayOpen - row.prevClose) / row.prevClose * 100 : null;
    return { ...row, auctionPrice: row.todayOpen, auctionChangePct: change, auctionDataStatus: `${source}实时行情推导（开盘价=竞价成交价）` };
  }
  return row;
}

async function fetchPreviousDaily(code, source) {
  const key = `${source}:${code}`;
  if (historicalCache.has(key)) return historicalCache.get(key);
  const prefix = marketPrefix(code);
  if (!prefix) return null;
  let result = null;
  try {
    if (source === "sina") {
      const response = await fetch(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${prefix}${code}&scale=240&ma=no&datalen=2`, { headers: { "User-Agent": USER_AGENT } });
      const rows = await response.json();
      const item = Array.isArray(rows) && rows.length > 1 ? rows[rows.length - 2] : rows?.[0];
      if (item) result = { yesterdayHigh: number(item.high), yesterdayClose: number(item.close) };
    } else if (source === "tencent") {
      const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,2,qfq`, { headers: { "User-Agent": USER_AGENT } });
      const payload = await response.json();
      const rows = payload?.data?.[`${prefix}${code}`]?.qfqday || [];
      const item = rows.length > 1 ? rows[rows.length - 2] : rows[0];
      if (item) result = { yesterdayHigh: number(item[2]), yesterdayClose: number(item[3]) };
    }
  } catch {
    result = null;
  }
  historicalCache.set(key, result);
  return result;
}

async function enrichHistorical(rows, source) {
  const result = [];
  for (let index = 0; index < rows.length; index += 12) {
    const batch = rows.slice(index, index + 12);
    result.push(...await Promise.all(batch.map(async (row) => ({ ...row, ...(await fetchPreviousDaily(row.code, source) || {}) }))));
  }
  return result;
}

async function applyBoardStatus(rows) {
  try {
    const phase = currentPhase();
    // 连板必须同时核对当前日和上一交易日官方涨停池。
    // is_again_limit 只表示今日反复触及/回封，不代表连续第二板。
    const pool = await fetchThsLimitUpPool({ limit: 1000, ttlMs: 15000, ...(phase === "trading" ? {} : { date: previousTradeDate() }) });
    const referenceDate = String(pool.date || (phase === "trading" ? new Date().toISOString().slice(0, 10).replace(/-/g, "") : previousTradeDate())).replace(/-/g, "");
    const previousPool = await fetchThsLimitUpPool({ limit: 1000, date: previousTradeDate(referenceDate), ttlMs: 24 * 60 * 60 * 1000 }).catch(() => ({ items: [] }));
    const byCode = new Map((pool.items || []).map((item) => [String(item.code), item]));
    const previousByCode = new Map((previousPool.items || []).map((item) => [String(item.code), item]));
    const countOf = (item) => {
      const value = Number(item?.highDaysValue);
      return Number.isFinite(value) && value > 0 ? value : item ? 1 : null;
    };
    return rows.map((row) => {
      const item = byCode.get(String(row.code));
      const previousCount = countOf(previousByCode.get(String(row.code)));
      if (!item) return { ...row, limitUp: false, boardCount: null, boardLabel: "", yesterdayBoardCount: previousCount };
      const boardCount = Number.isFinite(Number(item.highDaysValue)) && Number(item.highDaysValue) > 0
        ? Number(item.highDaysValue)
        : previousCount ? previousCount + 1 : 1;
      return {
        ...row,
        limitUp: true,
        boardCount,
        boardLabel: `${boardCount}连板`,
        yesterdayBoardCount: previousCount ?? Math.max(0, boardCount - 1),
        firstLimitTime: item.firstLimitTime || item.firstBoardTime || row.firstLimitTime || "",
        lastLimitTime: item.lastLimitTime || item.lastBoardTime || row.lastLimitTime || "",
        sealAmount: item.sealAmount ?? row.sealAmount ?? null,
        brokenCount: item.brokenCount ?? row.brokenCount ?? null,
        limitType: item.limitType || item.limitTypes || row.limitType || ""
      };
    });
  } catch {
    return rows;
  }
}

function parseSinaLine(line) {
  const match = String(line).match(/hq_str_(?:sh|sz|bj)(\d{6})="([^"]*)"/);
  if (!match) return null;
  const values = match[2].split(",");
  const code = match[1];
  const latest = number(values[3]);
  const prevClose = number(values[2]);
  return {
    code,
    name: values[0] || "",
    latestPrice: latest,
    prevClose,
    todayOpen: number(values[1]),
    high: number(values[4]),
    low: number(values[5]),
    volume: number(values[8]),
    amount: number(values[9]),
    changePct: prevClose && latest != null ? (latest - prevClose) / prevClose * 100 : null,
    quoteTime: values[30] && values[31] ? `${values[30]} ${values[31]}` : ""
  };
}

async function fetchSinaQuotes(members) {
  const rows = members.map(normalizeMember);
  const byCode = new Map();
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100).filter((row) => marketPrefix(row.code));
    if (!batch.length) continue;
    const symbols = batch.map((row) => `${marketPrefix(row.code)}${row.code}`).join(",");
    const response = await fetch(`https://hq.sinajs.cn/list=${symbols}`, {
      headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": USER_AGENT }
    });
    if (!response.ok) throw new Error(`新浪行情请求失败: ${response.status}`);
    const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
    for (const line of text.split(/\r?\n/)) {
      const quote = parseSinaLine(line);
      if (quote) byCode.set(quote.code, quote);
    }
  }
  const quoted = rows.map((row) => byCode.has(row.code)
    ? applyQuote(row, byCode.get(row.code), "新浪行情", "普通实时行情（未提供竞价字段）")
    : { ...row, source: "新浪行情", dataQuality: "unavailable" });
  return applyBoardStatus((await enrichHistorical(quoted, "sina")).map((row) => applySessionFields(row, "新浪行情")));
}

function parseTencentLine(line) {
  const match = String(line).match(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/);
  if (!match) return null;
  const values = match[2].split("~");
  const code = match[1];
  const latest = number(values[3]);
  const prevClose = number(values[4]);
  return {
    code,
    name: values[1] || "",
    latestPrice: latest,
    prevClose,
    todayOpen: number(values[5]),
    high: number(values[33]),
    low: number(values[34]),
    volume: number(values[6]),
    amount: number(String(values[37] || "").split("/").pop()),
    changePct: number(values[32]),
    quoteTime: values[30] || ""
  };
}

async function fetchTencentQuotes(members) {
  const rows = members.map(normalizeMember);
  const byCode = new Map();
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100).filter((row) => marketPrefix(row.code));
    if (!batch.length) continue;
    const symbols = batch.map((row) => `${marketPrefix(row.code)}${row.code}`).join(",");
    const response = await fetch(`https://qt.gtimg.cn/q=${symbols}`, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`腾讯行情请求失败: ${response.status}`);
    const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
    for (const line of text.split(/\r?\n/)) {
      const quote = parseTencentLine(line);
      if (quote) byCode.set(quote.code, quote);
    }
  }
  const quoted = rows.map((row) => byCode.has(row.code)
    ? applyQuote(row, byCode.get(row.code), "腾讯行情", "普通实时行情（未提供竞价字段）")
    : { ...row, source: "腾讯行情", dataQuality: "unavailable" });
  return applyBoardStatus((await enrichHistorical(quoted, "tencent")).map((row) => applySessionFields(row, "腾讯行情")));
}

function cmesBridgeUrl() {
  return String(process.env.CMES_BRIDGE_URL || "http://127.0.0.1:7897").replace(/\/$/, "");
}

async function fetchCmesBatch(securities) {
  const url = new URL(`${cmesBridgeUrl()}/quotes`);
  url.searchParams.set("securities", securities.join(","));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CMES_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `CMES 行情请求失败: ${response.status}`);
    return Array.isArray(body.data) ? body.data : [];
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("CMES 行情请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCmesQuotes(members) {
  const securities = members.map((member) => {
    const code = String(member.code || "").replace(/\.(SH|SZ|BJ)$/i, "");
    const market = marketPrefix(code).toUpperCase();
    return market ? `${market}.${code}` : "";
  }).filter(Boolean);
  if (!securities.length) return applyBoardStatus(members.map(normalizeMember));
  // cmesdata limits one quote request to 80 securities. Keep a small amount
  // of parallelism so a large concept board does not block the workbench.
  const batches = [];
  for (let index = 0; index < securities.length; index += 80) batches.push(securities.slice(index, index + 80));
  const results = [];
  for (let index = 0; index < batches.length; index += 2) {
    const rows = await Promise.all(batches.slice(index, index + 2).map(fetchCmesBatch));
    results.push(...rows.flat());
  }
  const byCode = new Map(results.map((row) => [String(row.code || "").replace(/\.(SH|SZ|BJ)$/i, ""), row]));
  const items = members.map((member) => {
    const row = normalizeMember(member);
    const quote = byCode.get(row.code);
    if (!quote) return { ...row, source: "CMES cmesdata", dataQuality: "unavailable", auctionDataStatus: "CMES 未返回行情" };
    const merged = {
      latestPrice: quote.price,
      prevClose: quote.preclose,
      todayOpen: quote.open,
      high: quote.high,
      low: quote.low,
      volume: quote.volume,
      amount: quote.amount,
      changePct: quote.pct,
      auctionPrice: quote.price,
      auctionChangePct: quote.pct,
      name: quote.name || row.name,
      bids: quote.bids,
      asks: quote.asks,
      quoteTime: quote.time,
      totalBuy: quote.total_buy,
      totalSell: quote.total_sell,
      orderImbalance: quote.order_imbalance
    };
    return applyQuote(row, merged, "CMES cmesdata", "CMES VIP 实时五档");
  });
  return applyBoardStatus(items);
}

function mxDataList(payload) {
  return payload?.data?.data?.data?.allResults?.result?.dataList
    || payload?.data?.data?.allResults?.result?.dataList
    || [];
}

function findRowValue(row, matcher) {
  // 妙想字段名会随工具版本变化，部分版本还会把字段放在嵌套对象中。
  const visited = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return null;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (matcher.test(String(key))) return child;
    }
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found != null && found !== "") return found;
    }
    return null;
  };
  return visit(row);
}

async function fetchMxQuotes(sectorName, members) {
  const mxKey = process.env.MX_APIKEY || "";
  if (!mxKey) throw new Error("未配置 MX_APIKEY");
  const response = await fetch(`${mxUrl()}/api/claw/stock-screen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: mxKey },
    body: JSON.stringify({ keyword: `${sectorName}概念板块今日集合竞价涨跌幅、集合竞价成交价、集合竞价成交量、集合竞价成交额，返回股票代码、股票名称、最新价、涨跌幅、昨日收盘价、昨日最高价、换手率` })
  });
  if (!response.ok) throw new Error(`妙想竞价请求失败: ${response.status}`);
  const payload = await response.json();
  const membersByCode = new Map(members.map((member) => [String(member.code), normalizeMember(member)]));
  const returned = new Map();
  for (const row of mxDataList(payload)) {
    const code = String(row.SECURITY_CODE || row.code || "").replace(/\.(SH|SZ|BJ)$/i, "");
    if (!membersByCode.has(code)) continue;
    const latest = number(row.NEWEST_PRICE);
    const prevClose = number(row.PREV_CLOSE || row.PRE_CLOSE || row.YESTERDAY_CLOSE || row["昨日收盘价"] || findRowValue(row, /PREV[\s_-]*CLOSE|PRE[\s_-]*CLOSE|YESTERDAY[\s_-]*CLOSE|昨收|昨日收盘/));
    returned.set(code, {
      latestPrice: latest,
      prevClose,
      todayOpen: number(row.OPEN || row["今日开盘价"]),
      changePct: number(row.CHG),
      auctionPrice: number(findRowValue(row, /AUC_PRICE|集合竞价成交价/)),
      auctionChangePct: number(findRowValue(row, /AUC_RANGE|集合竞价涨跌幅/)),
      auctionVolume: number(findRowValue(row, /AUC_VOLUME|集合竞价成交量/)),
      auctionAmount: number(findRowValue(row, /AUC_AMOUNT|AUC_VALUE|集合竞价成交额/)),
      turnoverPct: number(findRowValue(row, /TURNOVER_RATE|换手率/)),
      yesterdayHigh: number(findRowValue(row, /PREV[\s_-]*(?:HIGH|HIGHEST)|PRE[\s_-]*(?:HIGH|HIGHEST)|YESTERDAY[\s_-]*HIGH|HIGH[\s_-]*(?:PREV|YESTERDAY)|昨日最高价|昨高/)),
      yesterdayClose: prevClose,
      name: row.SECURITY_SHORT_NAME || row.SECURITY_NAME || ""
    });
  }
  // 妙想返回的是问句结果，可能只覆盖部分股票或缺少普通行情字段。
  // 对缺失行情的股票用新浪/腾讯补齐，竞价字段仍严格保留妙想结果，不跨源伪造。
  const fallbackMembers = members.filter((member) => {
    const quote = returned.get(String(member.code));
    return !quote || ["latestPrice", "prevClose", "todayOpen", "yesterdayHigh"].some((key) => quote[key] == null);
  });
  let fallbackRows = [];
  if (fallbackMembers.length) {
    try { fallbackRows = await fetchSinaQuotes(fallbackMembers); }
    catch { try { fallbackRows = await fetchTencentQuotes(fallbackMembers); } catch { fallbackRows = []; } }
  }
  const fallbackByCode = new Map(fallbackRows.map((row) => [String(row.code), row]));
  const quoteFields = ["latestPrice", "prevClose", "todayOpen", "changePct", "changeAmount", "high", "low", "volume", "amount", "turnoverPct", "yesterdayHigh", "yesterdayClose", "name"];
  const defined = (value) => value != null && value !== "" && !(typeof value === "number" && !Number.isFinite(value));
  const items = members.map((member) => {
    const row = normalizeMember(member);
    const mxQuote = returned.get(row.code);
    const fallback = fallbackByCode.get(row.code);
    const fallbackQuote = fallback ? Object.fromEntries(quoteFields.map((key) => [key, fallback[key]]).filter(([, value]) => defined(value))) : {};
    if (!mxQuote && fallback) {
      const fallbackSource = `妙想东方财富+${fallback.source || "新浪行情"}`;
      const sessionFallback = applySessionFields({ ...fallback, source: fallbackSource }, fallbackSource);
      sessionFallback.source = fallbackSource;
      sessionFallback.auctionDataStatus = currentPhase() === "trading" && sessionFallback.todayOpen > 0
        ? "妙想未返回，普通行情推导（开盘价=竞价成交价）"
        : "妙想未返回，普通行情已兜底";
      return sessionFallback;
    }
    if (!mxQuote) return { ...row, source: "妙想东方财富", dataQuality: "unavailable", auctionDataStatus: "妙想未返回，普通行情无兜底" };
    const mergedQuote = { ...fallbackQuote, ...Object.fromEntries(Object.entries(mxQuote).filter(([, value]) => defined(value))) };
    const source = fallback ? "妙想东方财富+普通行情兜底" : "妙想东方财富";
    const sessionRow = applySessionFields(applyQuote({ ...row, ...fallbackQuote }, mergedQuote, source, fallback ? "妙想竞价字段，普通行情兜底" : "妙想竞价字段"), source);
    if (fallback && !["auctionPrice", "auctionChangePct", "auctionVolume", "auctionAmount"].some((key) => defined(mxQuote[key]))) {
      if (currentPhase() === "trading" && sessionRow.todayOpen > 0 && sessionRow.prevClose > 0) {
        sessionRow.auctionPrice = sessionRow.todayOpen;
        sessionRow.auctionChangePct = (sessionRow.todayOpen - sessionRow.prevClose) / sessionRow.prevClose * 100;
        sessionRow.auctionDataStatus = "妙想竞价字段未返回，普通行情推导（开盘价=竞价成交价）";
      } else {
        sessionRow.auctionPrice = null;
        sessionRow.auctionChangePct = null;
        sessionRow.auctionVolume = null;
        sessionRow.auctionAmount = null;
        sessionRow.auctionDataStatus = "妙想竞价字段未返回，普通行情已兜底";
      }
    }
    return sessionRow;
  });
  return applyBoardStatus(items);
}

export async function fetchThsAuctionSectors(limit = 5000, options = {}) {
  // The auction page needs the catalog to render immediately. Enriching all
  // concepts here fans out hundreds of realtime and intraday requests and can
  // leave the first page load waiting on an unavailable upstream service.
  const items = await fetchThsConceptBoardList(limit, { enrich: options.enrich === true, resolveCodes: options.resolveCodes === true });
  return items.map((item) => ({
    ...item,
    code: item.code || (item.thsCode ? `BK${item.thsCode}` : `THS${item.conceptId}`),
    source: "同花顺概念板块"
  }));
}

export async function fetchAuctionStocksBySource(sectorCode, sectorName, source, limit = 1000, options = {}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
  const requested = String(options.date || "").replace(/-/g, "");
  // A natural-day request is live only during the active market session.
  // Outside that window, even an explicit `today` must use the latest saved
  // stockdb snapshot so historical data is never mislabeled as live auction data.
  if (requested && (requested !== today || options.realtime !== true)) {
    const loaded = await fetchStockDbConceptStocks(sectorCode, { date: requested, withMinutes: false });
    const auction = await readStockDbAuction(requested).catch(() => []);
    const reasons = await readStockDbLimitUpReasons(requested).catch(() => []);
    const auctionByCode = new Map(auction.filter(row => String(row.date).replace(/-/g, "") === requested).map(row => [String(row.code), row]));
    const reasonByCode = new Map(reasons.map(row => [String(row.code), row.reason]));
    return loaded.items.slice(0, limit).map(row => {
      const quote = auctionByCode.get(row.code) || {};
      return {
        ...row, date: requested, quoteDate: requested, dataQuality: "historical",
        auctionPrice: number(quote.auctionPrice ?? quote.auction_price),
        auctionChangePct: number(quote.auctionChangePct ?? quote.auction_change_pct),
        auctionVolume: number(quote.auctionVolume ?? quote.auction_volume),
        auctionAmount: number(quote.auctionAmount ?? quote.auction_amount),
        auctionDataStatus: auctionByCode.has(row.code) ? "历史竞价记录" : "未保存当日竞价记录",
        limitReasonDetail: reasonByCode.get(row.code) || ""
      };
    });
  }
  const loaded = await fetchStockDbConceptStocks(sectorCode, { withMinutes: false });
  const members = (loaded.items || []).slice(0, limit);
  if (source === "cmes") return fetchCmesQuotes(members);
  if (source === "sina") return fetchSinaQuotes(members);
  if (source === "tencent") return fetchTencentQuotes(members);
  return fetchMxQuotes(sectorName || sectorCode, members);
}

export const AUCTION_STOCK_SOURCES = {
  cmes: { label: "CMES VIP", source: "CMES cmesdata" },
  mx: { label: "妙想", source: "妙想东方财富" },
  sina: { label: "新浪", source: "新浪行情" },
  tencent: { label: "腾讯", source: "腾讯行情" }
};
