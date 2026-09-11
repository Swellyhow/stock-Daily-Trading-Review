import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The project intentionally keeps credentials in the ignored root .env file.
// Load only missing variables so explicit process-level configuration wins.
function loadProjectEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Missing .env is valid; status endpoint will report the missing token.
  }
}

loadProjectEnv();

const DEFAULT_IFIND_URL = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp";
const DEFAULT_IFIND_INDEX_URL = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-index-mcp";
function ifindUrl() { return process.env.IFIND_MCP_URL || DEFAULT_IFIND_URL; }
function ifindIndexUrl() { return process.env.IFIND_INDEX_MCP_URL || DEFAULT_IFIND_INDEX_URL; }
function ifindKey() { return process.env.IFIND_MCP_TOKEN || process.env.IFIND_MCP_KEY || process.env.IFIND_API_KEY || ""; }
function ifindTimeoutMs() { return Number(process.env.IFIND_MCP_TIMEOUT_MS || 20000); }

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function dateKey(value) {
  const raw = text(value).replace(/-/g, "");
  return /^\d{8}$/.test(raw) ? raw : "";
}

function contentValue(result) {
  const content = result?.result?.content ?? result?.content;
  if (Array.isArray(content)) {
    const joined = content.filter((item) => item?.type === "text").map((item) => item.text).join("\n");
    if (joined) {
      try { return JSON.parse(joined); } catch { return joined; }
    }
  }
  return result?.result ?? result;
}

function markdownRecords(value) {
  const lines = String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (lines.length < 3) return [];
  const headers = lines[0].split("|").slice(1, -1).map((x) => x.trim());
  return lines.slice(2).filter((line) => !line.split("|").slice(1, -1).every((cell) => /^[-\s]*$/.test(cell))).map((line) => {
    const cells = line.split("|").slice(1, -1).map((x) => x.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function unwrapValue(value) {
  if (typeof value === "string") {
    try { return unwrapValue(JSON.parse(value)); } catch { return value; }
  }
  if (!value || typeof value !== "object") return value;
  if (typeof value.data === "string" || value.data && typeof value.data === "object") return unwrapValue(value.data);
  if (typeof value.answer === "string") return markdownRecords(value.answer);
  return value;
}

function collectRecords(value, records = []) {
  value = unwrapValue(value);
  if (typeof value === "string") return records.concat(markdownRecords(value));
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, records);
    return records;
  }
  if (!value || typeof value !== "object") return records;
  const keys = Object.keys(value);
  const looksLikeRecord = keys.some((key) => /code|ticker|symbol|证券|股票|板块|sector|name|名称/i.test(key));
  if (looksLikeRecord) records.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectRecords(child, records);
  }
  return records;
}

function first(value, keys) {
  for (const key of keys) {
    if (value?.[key] != null && value[key] !== "") return value[key];
  }
  return null;
}

function normalizeMarket(code, value = "") {
  const raw = text(value);
  if (raw) return raw;
  const c = text(code);
  if (/^688/.test(c)) return "科创板";
  if (/^30/.test(c)) return "创业板";
  if (/^(4|8|92)/.test(c)) return "京A";
  if (/^6/.test(c)) return "沪A主板";
  if (/^(000|001|002|003)/.test(c)) return "深A主板";
  return "A股";
}

function normalizeSector(item, index) {
  const code = text(first(item, ["code", "sector_code", "sectorCode", "板块代码", "index_code", "ticker"]));
  const name = text(first(item, ["name", "sector_name", "sectorName", "板块名称", "名称"]));
  return {
    rowNumber: index + 1, code, name,
    changePct: number(first(item, ["changePct", "change_pct", "涨跌幅", "涨幅", "pct_chg"])),
    auctionChangePct: number(first(item, ["auctionChangePct", "auction_change_pct", "竞价涨幅", "竞价涨跌幅"])),
    latestPrice: number(first(item, ["latestPrice", "latest_price", "price", "现价"])),
    upCount: number(first(item, ["upCount", "up_count", "涨家数"])),
    downCount: number(first(item, ["downCount", "down_count", "跌家数"])),
    limitUpCount: number(first(item, ["limitUpCount", "limit_up_count", "涨停数"])),
    limitDownCount: number(first(item, ["limitDownCount", "limit_down_count", "跌停数"])),
    lowPriceTime: text(first(item, ["lowPriceTime", "low_price_time", "最低价时间"])),
    highPriceTime: text(first(item, ["highPriceTime", "high_price_time", "最高价时间"])),
    source: "iFinD MCP"
  };
}

function normalizeStock(item, index) {
  const code = text(first(item, ["code", "stock_code", "stockCode", "ticker", "证券代码"])).replace(/\.(SZ|SH|BJ|HK)$/i, "");
  const yesterdayBoardCount = number(first(item, ["yesterdayBoardCount", "yesterday_board_count", "昨日连板", "连板数"]));
  const boardCount = number(first(item, ["boardCount", "board_count", "连续涨停天数", "连板"]));
  const boardLabel = text(first(item, ["boardLabel", "board_label", "连板标签"])) || (boardCount == null ? "" : `${boardCount}连板`);
  return {
    rowNumber: index + 1, code,
    name: text(first(item, ["name", "stock_name", "stockName", "证券简称", "名称"])),
    marketType: normalizeMarket(code, first(item, ["marketType", "market_type", "上市交易所", "市场"])),
    boardLabel, boardCount, yesterdayBoardCount,
    todayOpen: number(first(item, ["todayOpen", "today_open", "open", "今日开盘价"])),
    auctionPrice: number(first(item, ["auctionPrice", "auction_price", "竞价价", "集合竞价价"])),
    auctionChangePct: number(first(item, ["auctionChangePct", "auction_change_pct", "竞价涨幅", "竞价涨跌幅"])),
    yesterdayHigh: number(first(item, ["yesterdayHigh", "yesterday_high", "prevHigh", "昨日最高价"])),
    yesterdayClose: number(first(item, ["yesterdayClose", "yesterday_close", "prevClose", "昨收", "昨日收盘价"])),
    latestPrice: number(first(item, ["latestPrice", "latest_price", "price", "现价"])),
    turnoverPct: number(first(item, ["turnoverPct", "turnover_pct", "turnover", "换手率"])),
    auctionVolume: number(first(item, ["auctionVolume", "auction_volume", "竞价成交量"])),
    auctionAmount: number(first(item, ["auctionAmount", "auction_amount", "竞价成交额"])),
    limitUp: Boolean(first(item, ["limitUp", "limit_up", "涨停"])),
    source: "iFinD MCP"
  };
}

function normalizeKline(item) {
  return {
    date: dateKey(first(item, ["date", "trade_date", "日期"])),
    open: number(first(item, ["open", "开盘"])), close: number(first(item, ["close", "收盘"])),
    high: number(first(item, ["high", "最高"])), low: number(first(item, ["low", "最低"])),
    volume: number(first(item, ["volume", "成交量"])), amount: number(first(item, ["amount", "成交额"])),
    changePct: number(first(item, ["changePct", "change_pct", "涨跌幅"])), turnoverPct: number(first(item, ["turnoverPct", "turnover_pct", "换手率"]))
  };
}

function normalizeIntraday(item) {
  return {
    time: text(first(item, ["time", "trade_time", "时间"])),
    price: number(first(item, ["price", "latestPrice", "最新价", "现价"])),
    average: number(first(item, ["average", "avgPrice", "均价"])),
    volume: number(first(item, ["volume", "成交量"])), amount: number(first(item, ["amount", "成交额"]))
  };
}

export function ifindConfigured() { return Boolean(ifindKey()); }
export function ifindConfigStatus() { return { configured: ifindConfigured(), endpoint: ifindUrl(), source: "iFinD MCP" }; }

export async function callIfindTool(name, args = {}, endpoint = ifindUrl()) {
  const key = ifindKey();
  if (!key) throw new Error("未配置 IFIND_MCP_TOKEN（请将 51ifind 个人中心的 MCP Authorization 密钥写入环境变量）");
  const response = await axios.post(endpoint, { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }, {
    timeout: ifindTimeoutMs(), headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/json" }
  });
  if (response.data?.error) throw new Error(response.data.error.message || `iFinD 工具 ${name} 调用失败`);
  return contentValue(response.data);
}

export async function fetchIfindSectors(limit = 5000) {
  const raw = await callIfindTool("sector_data", { query: `A股概念板块实时行情，返回最多${limit}个概念板块的板块代码、板块名称、涨跌幅、上涨家数、下跌家数、涨停家数、跌停家数、竞价涨幅` }, ifindIndexUrl());
  return collectRecords(raw).map(normalizeSector).filter((item) => /^\d{6,12}$/.test(item.code) && item.name && item.name !== "板块名称").slice(0, limit);
}

export async function fetchIfindSectorStocks(sectorCode, limit = 1000) {
  const raw = await callIfindTool("search_stocks", { query: `属于概念板块${sectorCode}的全部A股股票，返回股票代码、股票名称、股票市场类型，最多${limit}只` }, ifindUrl());
  return collectRecords(raw).map(normalizeStock).filter((item) => /^\d{6}$/.test(item.code)).slice(0, limit);
}

export async function fetchIfindStockQuote(code) {
  const raw = await callIfindTool("get_stock_summary", { stock_codes: [code], codes: [code], code });
  return normalizeStock(collectRecords(raw)[0] || {}, 0);
}

export async function fetchIfindKline(code, period = "daily", limit = 1000, kind = "stock") {
  const tool = kind === "sector" ? "sector_data" : "get_stock_performance";
  const endpoint = kind === "sector" ? ifindIndexUrl() : ifindUrl();
  const args = kind === "sector"
    ? { query: `概念板块${code}的${period === "weekly" ? "周" : period === "monthly" ? "月" : "日"}K线，返回日期、开盘、最高、最低、收盘、成交量、成交额，最多${limit}根` }
    : { stock_codes: [code], codes: [code], code, period, limit };
  const raw = await callIfindTool(tool, args, endpoint);
  return collectRecords(raw).map(normalizeKline).filter((item) => item.date).slice(-limit);
}

export async function fetchIfindIntraday(code, date, kind = "stock") {
  const tool = kind === "sector" ? "sector_data" : "get_stock_performance";
  const endpoint = kind === "sector" ? ifindIndexUrl() : ifindUrl();
  const args = kind === "sector"
    ? { query: `概念板块${code}在${date}的分时行情，返回时间、价格、均价、成交量、成交额` }
    : { stock_codes: [code], codes: [code], code, period: "intraday", date, trade_date: date };
  const raw = await callIfindTool(tool, args, endpoint);
  return collectRecords(raw).map(normalizeIntraday).filter((item) => item.time && item.price != null);
}
