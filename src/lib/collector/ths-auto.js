import axios from "axios";
import * as cheerio from "cheerio";

const THS_QUOTE_BASE = "https://d.10jqka.com.cn";
const THS_CONCEPT_BASE = "https://q.10jqka.com.cn";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const cache = new Map();
let catalogPromise;

const THS_LIMIT_UP_POOL_URL = "https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool";
// The compact pool response only contains membership/status tags. This is
// the field list used by the THS-backed 55188 limit-up table and includes
// reason_type, the human-readable limit-up catalyst.
const THS_LIMIT_UP_POOL_FIELDS = "199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004";

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function cacheGet(key, ttlMs) {
  const entry = cache.get(key);
  return entry && Date.now() - entry.time < ttlMs ? entry.value : null;
}

function cacheSet(key, value) {
  cache.set(key, { time: Date.now(), value });
  return value;
}

// 同花顺分时接口返回的成交量/成交额是截至该分钟的累计值。
// 图表与量价分析需要分钟增量，且用元数据避免重复差分。
export function normalizeIntradayItems(items) {
  const rows = Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
  if (!rows.length || rows.some((item) => item.volumeMode === "interval")) return rows;
  const cumulativeFields = ["volume", "amount"].filter((field) => {
    const values = rows.map((item) => Number(item[field])).filter(Number.isFinite);
    if (values.length < 3 || values[values.length - 1] <= values[0]) return false;
    let monotonic = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] >= values[index - 1]) monotonic += 1;
    }
    return monotonic / (values.length - 1) >= 0.85 && values[values.length - 1] > values[0] * 2;
  });
  if (!cumulativeFields.length) return rows.map((item) => ({ ...item, volumeMode: "interval" }));
  const previous = { volume: 0, amount: 0 };
  return rows.map((item) => {
    const next = { ...item, volumeMode: "interval" };
    for (const field of cumulativeFields) {
      const value = Number(item[field]);
      next[field] = Number.isFinite(value) ? Math.max(0, value - previous[field]) : 0;
      if (Number.isFinite(value)) previous[field] = value;
    }
    return next;
  });
}

async function fetchBuffer(url, referer = THS_CONCEPT_BASE) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": USER_AGENT, Referer: referer, Accept: "text/html,application/javascript,*/*" }
  });
  return response.data;
}

/**
 * Fetch the official Tonghuashun limit-up pool. The endpoint returns pool
 * membership/tags; quote fields are intentionally left empty because they are
 * not part of this response and must not be fabricated from another vendor.
 */
export async function fetchThsLimitUpPool(options = {}) {
  const requestedLimit = Math.min(1000, Math.max(20, Number(options.limit) || 1000));
  const pageSize = Math.min(100, requestedLimit);
  const requestedDate = String(options.date ?? "").replace(/-/g, "");
  const cacheKey = `ths-limit-up-pool:v2:${requestedDate || "latest"}:${requestedLimit}`;
  const ttlMs = options.ttlMs == null ? 15000 : Math.max(0, Number(options.ttlMs) || 0);
  const cached = ttlMs > 0 ? cacheGet(cacheKey, ttlMs) : null;
  if (cached) return cached;
  const requestPage = async (page) => (await axios.get(THS_LIMIT_UP_POOL_URL, {
    timeout: 15000,
    headers: { "User-Agent": USER_AGENT, Referer: "https://data.10jqka.com.cn/limitup/limit_up/", Accept: "application/json,text/plain,*/*" },
    params: {
      limit: pageSize,
      page,
      field: THS_LIMIT_UP_POOL_FIELDS,
      filter: "HS,GEM2STAR",
      order_field: 330324,
      order_type: 0,
      ...(requestedDate ? { date: requestedDate } : {})
    }
  })).data;
  const body = await requestPage(1);
  if (Number(body?.status_code) !== 0 || !Array.isArray(body?.data?.info)) {
    throw new Error("同花顺涨停池响应格式无效");
  }
  const actualDate = String(body.data.date || "").replace(/-/g, "");
  if (requestedDate && actualDate !== requestedDate) throw new Error(`同花顺涨停池日期不匹配：请求 ${requestedDate}，返回 ${actualDate || "未知"}`);
  const total = Math.min(requestedLimit, Number(body.data.page?.total ?? body.data.info.length));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const remaining = pageCount > 1 ? await mapConcurrent(Array.from({ length: pageCount - 1 }, (_, index) => index + 2), 4, requestPage) : [];
  if (remaining.some(page => Number(page?.status_code) !== 0 || !Array.isArray(page?.data?.info) || String(page.data.date || "").replace(/-/g, "") !== actualDate)) throw new Error("同花顺涨停池分页缺失或日期不一致");
  const rawItems = [body, ...remaining].flatMap((page) => Number(page?.status_code) === 0 && Array.isArray(page?.data?.info) ? page.data.info : []);
  const boardCount = (value, encoded) => {
    const label = String(value ?? "").trim();
    const daysAndBoards = label.match(/\d+天(\d+)板/);
    if (daysAndBoards) return Number(daysAndBoards[1]);
    if (label === "首板") return 1;
    const boards = label.match(/(\d+)板/);
    if (boards) return Number(boards[1]);
    const numeric = Number(encoded);
    return Number.isFinite(numeric) && numeric > 0 && numeric < 100 ? numeric : null;
  };
  const items = rawItems
    .map((item) => ({
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
      marketId: item.market_id ?? null,
      marketType: String(item.market_type ?? "").trim(),
      changeTag: String(item.change_tag ?? "").trim(),
      // reason_type is the actual THS limit-up catalyst, e.g. "数字人民币+金融科技".
      // change_tag only describes a board event (such as a re-seal) and is
      // deliberately kept separate rather than presented as a reason.
      limitReason: String(item.reason_type ?? item.limit_reason ?? item.reason ?? item.change_reason ?? item.limit_up_reason ?? "").trim(),
      reasonType: String(item.reason_type ?? "").trim(),
      firstLimitTime: item.first_limit_up_time ?? null,
      lastLimitTime: item.last_limit_up_time ?? null,
      limitUpType: String(item.limit_up_type ?? "").trim(),
      isNew: Boolean(item.is_new),
      isAgainLimit: Boolean(item.is_again_limit),
      highDays: String(item.high_days ?? "").trim(),
      highDaysValue: boardCount(item.high_days, item.high_days_value),
      source: "同花顺涨停池"
    }))
    .filter((item) => /^\d{6}$/.test(item.code))
    .slice(0, requestedLimit);
  return cacheSet(cacheKey, {
    items,
    total: Number(body.data.page?.total ?? items.length),
    date: String(body.data.date ?? "").replace(/-/g, ""),
    fetchedAt: new Date().toISOString(),
    source: "同花顺涨停池"
  });
}

function parseJsonp(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("同花顺行情响应格式无效");
  return JSON.parse(text.slice(start + 1, end));
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseMoney(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "--") return 0;
  const match = text.replace(/,/g, "").match(/^(-?[\d.]+)(亿|万)?$/);
  if (!match) return asNumber(text);
  const factor = match[2] === "亿" ? 1e8 : match[2] === "万" ? 1e4 : 1;
  return asNumber(match[1]) * factor;
}

function marketTypeForCode(code) {
  const raw = String(code ?? "");
  if (/^688/.test(raw)) return "科创板";
  if (/^30[0-9]/.test(raw)) return "创业板";
  if (/^(4|8|92)/.test(raw)) return "京A";
  if (/^6/.test(raw)) return "沪A主板";
  if (/^(000|001|002|003)/.test(raw)) return "深A主板";
  return "A股";
}

function supportsAfterHoursTrading(code) {
  const raw = String(code ?? "").replace(/^.*_/, "");
  // Closing-price fixed-price trading: STAR, ChiNext and Beijing Stock
  // Exchange. Shanghai/Shenzhen main-board stocks end at 15:00.
  return /^(?:300|301|688|689|4|8|92)/.test(raw);
}

function normalizeRealtime(code, payload) {
  const item = payload?.items ?? {};
  const rawCode = String(item["5"] ?? code).replace(/^.*_/, "");
  const latestPrice = asNumber(item["10"]);
  const prevClose = asNumber(item["6"]);
  return {
    code: rawCode,
    name: item.name ?? payload?.name ?? payload?.data?.name ?? "",
    latestPrice,
    prevClose,
    open: asNumber(item["7"]),
    high: asNumber(item["8"]),
    low: asNumber(item["9"]),
    changePct: asNumber(item["199112"]),
    changeAmount: latestPrice && prevClose ? Number((latestPrice - prevClose).toFixed(2)) : 0,
    volume: asNumber(item["17"]),
    amount: asNumber(item["19"]),
    turnoverPct: asNumber(item["592920"] || item["1149395"]),
    circulatingMarketCap: asNumber(item["3475914"]),
    totalMarketCap: asNumber(item["3541450"]),
    mainAmount: asNumber(item["527198"]),
    marketType: payload?.marketType ?? marketTypeForCode(rawCode),
    collectedAt: item.time ?? item.updateTime ?? payload?.time ?? new Date().toISOString()
  };
}

async function fetchRealHead(prefix, code) {
  const key = `realhead:${prefix}:${code}`;
  const cached = cacheGet(key, 15000);
  if (cached) return cached;
  const buffer = await fetchBuffer(`${THS_QUOTE_BASE}/v2/realhead/${prefix}_${code}/last.js`, `${THS_CONCEPT_BASE}/`);
  return cacheSet(key, parseJsonp(buffer));
}

function parseCatalogPage(buffer) {
  const html = new TextDecoder("gbk").decode(buffer);
  const $ = cheerio.load(html);
  const byCid = new Map();
  $(".cate_items a[href*='/gn/detail/code/']").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const match = href.match(/detail\/code\/(\d+)/);
    if (match) byCid.set(match[1], { cid: match[1], name: $(element).text().trim() });
  });
  let stats = {};
  try { stats = JSON.parse($("#gnSection").val() || "{}"); } catch { stats = {}; }
  for (const item of Object.values(stats)) {
    if (!item?.cid) continue;
    const existing = byCid.get(String(item.cid)) ?? { cid: String(item.cid), name: item.platename ?? "" };
    byCid.set(String(item.cid), { ...existing, thsCode: String(item.platecode ?? ""), stats: item });
  }
  return [...byCid.values()].filter((item) => item.name);
}

async function fetchDetailPlateCode(cid) {
  const key = `concept-plate-code:${cid}`;
  const cached = cacheGet(key, 24 * 60 * 60 * 1000);
  if (cached) return cached;
  const buffer = await fetchBuffer(`${THS_CONCEPT_BASE}/gn/detail/code/${cid}/`, `${THS_CONCEPT_BASE}/gn/`);
  const html = new TextDecoder("gbk").decode(buffer);
  const plateCode = String(cheerio.load(html)("#clid").val() ?? "").trim();
  return /^\d{6}$/.test(plateCode) ? cacheSet(key, plateCode) : "";
}

async function resolveCatalogPlateCodes(items) {
  return mapConcurrent(items, 8, async (item) => {
    if (item.thsCode) return item;
    try {
      const thsCode = await fetchDetailPlateCode(item.cid);
      return thsCode ? { ...item, thsCode } : item;
    } catch {
      return item;
    }
  });
}

async function loadCatalog(options = {}) {
  const cached = cacheGet("concept-catalog", 60000);
  if (cached) return cached;
  if (!catalogPromise) {
    const resolveCodes = options.resolveCodes !== false;
    catalogPromise = fetchBuffer(`${THS_CONCEPT_BASE}/gn/`).then(parseCatalogPage).then((items) => resolveCodes ? resolveCatalogPlateCodes(items) : items).then((items) => cacheSet("concept-catalog", items)).finally(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

async function fetchThsIntradayMetrics(prefix, code) {
  const key = `intraday-metrics:${prefix}:${code}`;
  const cached = cacheGet(key, 30000);
  if (cached !== null) return cached;
  const buffer = await fetchBuffer(`${THS_QUOTE_BASE}/v6/time/${prefix}_${code}/last.js`, `${THS_CONCEPT_BASE}/gn/`);
  const payload = parseJsonp(buffer);
  const data = String(payload?.[`${prefix}_${code}`]?.data ?? "");
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let lowPriceTime = "";
  let highPriceTime = "";
  let riseVolume = Number.NEGATIVE_INFINITY;
  let fallVolume = Number.NEGATIVE_INFINITY;
  let startTime = "";
  let fallTime = "";
  let previousPrice = Number.NaN;
  for (const line of data.split(";")) {
    const [time, priceText, amountText, _averageText, volumeText] = line.split(",");
    const price = Number(priceText);
    const volume = Number(volumeText || amountText);
    if (!/^\d{4}$/.test(time) || !Number.isFinite(price)) continue;
    const formattedTime = `${time.slice(0, 2)}:${time.slice(2)}`;
    if (price < low) { low = price; lowPriceTime = formattedTime; }
    if (price > high) { high = price; highPriceTime = formattedTime; }
    if (Number.isFinite(volume) && Number.isFinite(previousPrice)) {
      if (price > previousPrice && volume > riseVolume) { riseVolume = volume; startTime = formattedTime; }
      if (price < previousPrice && volume > fallVolume) { fallVolume = volume; fallTime = formattedTime; }
    }
    previousPrice = price;
  }
  return cacheSet(key, { lowPriceTime, highPriceTime, startTime, fallTime });
}

function priceLimitRatio(stock) {
  if (/^(?:\*?ST|S\*ST)/i.test(String(stock.name ?? ""))) return 0.05;
  if (/^(?:300|301|688|689)/.test(stock.code)) return 0.20;
  if (/^(?:4|8|92)/.test(stock.code)) return 0.30;
  return 0.10;
}

function priceLimitStatus(stock, realtime, intraday) {
  if (intraday.limitUpTime) return { limitUp: true, limitDown: false, limitStatusQuality: "同花顺分时命中" };
  if (intraday.limitDownTime) return { limitUp: false, limitDown: true, limitStatusQuality: "同花顺分时命中" };
  const prevClose = Number(realtime.prevClose);
  const latestPrice = Number(realtime.latestPrice);
  if (!(prevClose > 0) || !(latestPrice > 0)) return { limitUp: false, limitDown: false, limitStatusQuality: "unavailable" };
  const ratio = priceLimitRatio(stock);
  const upper = Math.round(prevClose * (1 + ratio) * 100) / 100;
  const lower = Math.round(prevClose * (1 - ratio) * 100) / 100;
  return {
    limitUp: latestPrice >= upper - 0.001,
    limitDown: latestPrice <= lower + 0.001,
    limitStatusQuality: "同花顺实时价+前收盘价"
  };
}

function intradayMinutes(time) {
  const match = String(time ?? "").match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

function limitTypeEntityTolerance(stock) {
  const ratio = priceLimitRatio(stock);
  if (ratio === 0.05) return 0.01;
  if (/^(?:300|301|688|689)/.test(String(stock.code))) return 0.02;
  if (/^(?:4|8|92)/.test(String(stock.code))) return 0.03;
  return 0.01;
}

export function classifyLimitTypes(stock, realtime, intraday) {
  const items = Array.isArray(intraday?.items) ? intraday.items.filter((item) => Number.isFinite(Number(item.price)) && Number(item.price) > 0) : [];
  const prevClose = Number(realtime?.prevClose);
  const open = Number(realtime?.open);
  const high = Number(realtime?.high);
  const low = Number(realtime?.low);
  const close = Number(realtime?.latestPrice);
  const ratio = priceLimitRatio(stock);
  if (!(prevClose > 0) || !(open > 0) || !(high > 0) || !(low > 0) || !(close > 0) || !items.length) return { limitTypes: [], limitTypeStatus: "unknown" };
  const epsilon = 0.011;
  const upper = Math.round(prevClose * (1 + ratio) * 100) / 100;
  const lower = Math.round(prevClose * (1 - ratio) * 100) / 100;
  const sealed = (price) => Number(price) >= upper - epsilon;
  const closedAtLimit = sealed(close);
  const firstLimitIndex = items.findIndex((item) => sealed(item.price));
  const firstLimitTime = firstLimitIndex >= 0 ? items[firstLimitIndex].time : "";
  const afterFirst = firstLimitIndex >= 0 ? items.slice(firstLimitIndex) : [];
  const hasBreakAfterFirst = afterFirst.some((item) => Number(item.price) < upper - epsilon);
  const entityTolerance = limitTypeEntityTolerance(stock);
  const nearUpper = (price) => Math.abs(Number(price) - upper) / prevClose <= entityTolerance + epsilon / prevClose;
  const bodyNearUpper = nearUpper(open) && nearUpper(close);
  const evidence = (typeCode, label, values, confidence = "高") => ({ typeCode, label, confidence, evidence: values });
  const types = [];

  // 一字板：四价均在涨停价附近，且实体按市场允许的误差范围内。
  if (closedAtLimit && nearUpper(open) && nearUpper(high) && nearUpper(low) && bodyNearUpper && !hasBreakAfterFirst) {
    types.push(evidence("one_line", "一字板", [`实体偏离涨停价不超过${entityTolerance * 100}%`, "开高低收均在涨停价附近", "盘中未打开涨停"]));
  }

  // T 字板：一字板主体打开后下探，再回封；浅、深按涨跌幅限制的一半划分。
  const dropFromUpper = (upper - low) / prevClose;
  if (closedAtLimit && bodyNearUpper && firstLimitIndex >= 0 && hasBreakAfterFirst && dropFromUpper >= 0) {
    const tEvidence = [`涨停价向下下探约${(dropFromUpper * 100).toFixed(2)}%`, "下探后重新封住涨停"];
    if (dropFromUpper <= ratio / 2 + epsilon / prevClose) types.push(evidence("shallow_t", "浅T板", [...tEvidence, "下探幅度不超过涨跌幅限制一半"]));
    if (dropFromUpper >= ratio / 2 - epsilon / prevClose) types.push(evidence("deep_t", "深T板", [...tEvidence, "下探幅度达到涨跌幅限制一半"]));
  }

  // 高开秒板：高开达到限制的一半，5 分钟内封板，封板后不开板。
  const openGap = (open - prevClose) / prevClose;
  const firstLimitMinute = intradayMinutes(firstLimitTime);
  if (closedAtLimit && openGap >= ratio / 2 - epsilon / prevClose && firstLimitIndex >= 0 && Number.isFinite(firstLimitMinute) && firstLimitMinute <= 9 * 60 + 35 && !hasBreakAfterFirst) {
    types.push(evidence("high_open_fast", "高开秒板", [`开盘高开约${(openGap * 100).toFixed(2)}%`, "开盘后5分钟内封住涨停", "封板后全天未开板"]));
  }

  // 直线板：任意连续 3 分钟内完成至少 70% 的涨跌幅限制并触及涨停。
  if (closedAtLimit) {
    for (let index = 0; index < items.length; index += 1) {
      const start = Number(items[index].price);
      if (!(start > 0)) continue;
      const startMinute = intradayMinutes(items[index].time);
      for (let endIndex = index + 1; endIndex < items.length; endIndex += 1) {
        const endMinute = intradayMinutes(items[endIndex].time);
        if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute - startMinute > 3) break;
        const rise = (Number(items[endIndex].price) - start) / prevClose;
        if (sealed(items[endIndex].price) && rise >= ratio * 0.7 - epsilon / prevClose) {
          types.push(evidence("straight_board", "直线板", [`连续${endMinute - startMinute}分钟拉升`, `完成涨跌幅限制约${(rise / ratio * 100).toFixed(1)}%`, "达到涨停并收盘封板"]));
          index = items.length;
          break;
        }
      }
    }
  }

  // 换手板：开盘涨跌幅在限制一半以内，换手率达到 30%。
  if (closedAtLimit && Math.abs(openGap) <= ratio / 2 + epsilon / prevClose && Number(realtime.turnoverPct) >= 30) {
    types.push(evidence("turnover_board", "换手板", [`开盘涨跌幅绝对值约${(Math.abs(openGap) * 100).toFixed(2)}%`, `换手率${Number(realtime.turnoverPct).toFixed(2)}%`, "收盘达到涨停价附近"]));
  }

  // 阶梯推升板：识别至少两段横盘后各自 2%-4% 的抬升。
  if (closedAtLimit) {
    const preLimit = firstLimitIndex >= 0 ? items.slice(0, firstLimitIndex + 1) : items;
    const steps = [];
    let cursor = 0;
    let previousPlatform = Number.NEGATIVE_INFINITY;
    while (cursor + 14 < preLimit.length && steps.length < 2) {
      let found = false;
      for (let startIndex = cursor; startIndex + 14 < preLimit.length && !found; startIndex += 1) {
        const base = Number(preLimit[startIndex].price);
        if (!(base > 0) || base < previousPlatform) continue;
        let endIndex = startIndex + 14;
        while (endIndex < preLimit.length) {
          const window = preLimit.slice(startIndex, endIndex + 1).map((item) => Number(item.price));
          const range = (Math.max(...window) - Math.min(...window)) / prevClose;
          if (range > 0.015 + epsilon / prevClose) break;
          const riseIndex = endIndex + 1;
          if (riseIndex < preLimit.length) {
            const rise = (Number(preLimit[riseIndex].price) - Math.max(...window)) / prevClose;
            if (rise >= 0.02 - epsilon / prevClose && rise <= 0.04 + epsilon / prevClose) {
              steps.push({ startIndex, endIndex, riseIndex });
              previousPlatform = Math.max(...window);
              cursor = riseIndex + 1;
              found = true;
              break;
            }
          }
          endIndex += 1;
        }
      }
      if (!found) break;
    }
    if (steps.length >= 2) types.push(evidence("stair_step", "阶梯推升板", [`识别到${steps.length}段横盘整理`, "每段横盘至少15分钟且振幅不超过1.5%", "每次拉升幅度在2%-4%", "平台高点逐步抬高", "最终封住涨停"]));
  }

  // 地天板：最低价距跌停 2% 以内，3 分钟内拉到距涨停 2% 以内，收盘也在涨停 2% 以内。
  const lowChange = (low - prevClose) / prevClose;
  const closeChange = (close - prevClose) / prevClose;
  const lowIndex = items.reduce((best, item, index) => Number(item.price) < Number(items[best]?.price ?? Number.POSITIVE_INFINITY) ? index : best, 0);
  const lowMinute = intradayMinutes(items[lowIndex]?.time);
  const reboundThreshold = ratio - 0.02 - epsilon / prevClose;
  const reboundIndex = items.findIndex((item, index) => index >= lowIndex && Number.isFinite(lowMinute) && Number.isFinite(intradayMinutes(item.time)) && intradayMinutes(item.time) - lowMinute <= 3 && (Number(item.price) - prevClose) / prevClose >= reboundThreshold);
  if (lowChange <= -(ratio - 0.02) + epsilon / prevClose && reboundIndex >= 0 && closeChange >= reboundThreshold) {
    types.push(evidence("earth_to_sky", "地天板", [`最低价距离跌停约${(Math.abs(lowChange) * 100).toFixed(2)}%`, "从最低价3分钟内拉到距离涨停2%以内", "收盘价距离涨停2%以内"]));
  }

  return { limitTypes: types, limitTypeStatus: closedAtLimit ? "confirmed" : firstLimitIndex >= 0 ? "touched" : "not_applicable" };
}

async function fetchThsStockIntraday(stock, prevClose) {
  const key = `stock-intraday:${stock.code}`;
  const cached = cacheGet(key, 30000);
  if (cached) return cached;
  const buffer = await fetchBuffer(`${THS_QUOTE_BASE}/v6/time/hs_${stock.code}/last.js`, `${THS_CONCEPT_BASE}/gn/`);
  const payload = parseJsonp(buffer);
  const data = String(payload?.[`hs_${stock.code}`]?.data ?? "");
  const ratio = priceLimitRatio(stock);
  const upper = prevClose > 0 ? prevClose * (1 + ratio) : Number.POSITIVE_INFINITY;
  const lower = prevClose > 0 ? prevClose * (1 - ratio) : Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let lowPriceTime = "";
  let highPriceTime = "";
  let riseVolume = Number.NEGATIVE_INFINITY;
  let fallVolume = Number.NEGATIVE_INFINITY;
  let startTime = "";
  let fallTime = "";
  let previousPrice = Number.NaN;
  let limitUpTime = "";
  let limitDownTime = "";
  const items = [];
  for (const line of data.split(";")) {
    const [time, priceText, amountText, _averageText, volumeText] = line.split(",");
    if (/^\d{4}$/.test(time) && Number(time) > 1500 && !supportsAfterHoursTrading(stock.code)) continue;
    const price = Number(priceText);
    const volume = Number(volumeText || amountText);
    if (!/^\d{4}$/.test(time) || !Number.isFinite(price)) continue;
    const formattedTime = `${time.slice(0, 2)}:${time.slice(2)}`;
    items.push({ time: formattedTime, price, volume: Number.isFinite(volume) ? volume : 0, amount: asNumber(amountText) });
    if (price < low) { low = price; lowPriceTime = formattedTime; }
    if (price > high) { high = price; highPriceTime = formattedTime; }
    if (Number.isFinite(volume) && Number.isFinite(previousPrice)) {
      if (price > previousPrice && volume > riseVolume) { riseVolume = volume; startTime = formattedTime; }
      if (price < previousPrice && volume > fallVolume) { fallVolume = volume; fallTime = formattedTime; }
    }
    if (!limitUpTime && price >= upper - 0.011) limitUpTime = formattedTime;
    if (!limitDownTime && price <= lower + 0.011) limitDownTime = formattedTime;
    previousPrice = price;
  }
  return cacheSet(key, { lowPriceTime, highPriceTime, startTime, fallTime, limitUpTime, limitDownTime, items: normalizeIntradayItems(items) });
}

async function enrichConceptStock(stock, sectorStartTime) {
  try {
    const realtime = await fetchThsStockRealtime(stock.code);
    const intraday = await fetchThsStockIntraday(stock, realtime.prevClose).catch(() => ({ lowPriceTime:"", highPriceTime:"", startTime:"", fallTime:"", limitUpTime:"", limitDownTime:"", items:[] }));
    const limitStatus = priceLimitStatus(stock, realtime, intraday);
    const limitTypeResult = classifyLimitTypes(stock, realtime, intraday);
    const { items: _intradayItems, ...intradayMetrics } = intraday;
    return {
      ...stock,
      ...realtime,
      ...intradayMetrics,
      name: stock.name || realtime.name,
      marketType: marketTypeForCode(stock.code),
      sectorStartTime,
      news: "",
      ...limitTypeResult,
      ...limitStatus
    };
  } catch {
    return { ...stock, sectorStartTime, limitUp: false, limitDown: false, limitTypes: [], limitTypeStatus: "unknown", limitStatusQuality: "unavailable" };
  }
}

async function enrichConceptBoard(item) {
  if (!item.thsCode) return item;
  try {
    const [realtime, metrics] = await Promise.all([
      fetchThsSectorRealtime(`BK${item.thsCode}`),
      fetchThsIntradayMetrics("bk", item.thsCode).catch(() => ({ lowPriceTime:"", highPriceTime:"", startTime:"", fallTime:"" }))
    ]);
    return { ...item, ...realtime, ...metrics, code: `BK${item.thsCode}`, conceptId: item.conceptId, thsCode: item.thsCode, name: item.name, source: "同花顺" };
  } catch {
    return item;
  }
}

export async function fetchThsConceptBoardList(limit = 5000, options = {}) {
  const catalog = await loadCatalog({ resolveCodes: options.resolveCodes !== false });
  const items = catalog.slice(0, Math.max(1, Number(limit) || catalog.length)).map((item) => {
    const stats = item.stats ?? {};
    return {
      code: item.thsCode ? `BK${item.thsCode}` : `THS${item.cid}`,
      conceptId: item.cid,
      thsCode: item.thsCode ?? "",
      name: item.name,
      latestPrice: 0,
      changePct: asNumber(stats["199112"]),
      changeAmount: 0,
      volume: 0,
      amount: 0,
      amplitudePct: 0,
      turnoverPct: 0,
      upCount: 0,
      downCount: 0,
      flatCount: 0,
      limitUpCount: 0,
      limitDownCount: 0,
      mainNetInflow: asNumber(stats.zjjlr),
      leaderName: "",
      leaderChangePct: 0,
      startTime: "",
      news: "",
      source: "同花顺"
    };
  });
  if (options.enrich === false) return items;
  return mapConcurrent(items, 4, enrichConceptBoard);
}

function findCatalogItem(sectorCode, catalog) {
  const raw = String(sectorCode ?? "").replace(/^BK/i, "");
  return catalog.find((item) => item.thsCode === raw || item.cid === raw || `THS${item.cid}`.toUpperCase() === String(sectorCode).toUpperCase());
}

function parseStockRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table").last().find("tbody tr").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => $(cell).text().trim().replace(/\s+/g, " ")).get();
    const code = cells[1] ?? "";
    if (!/^\d{6}$/.test(code)) return;
    rows.push({
      code,
      name: cells[2] ?? "",
      latestPrice: asNumber(cells[3]),
      changePct: asNumber(cells[4]),
      changeAmount: asNumber(cells[5]),
      turnoverPct: asNumber(cells[7]),
      amount: parseMoney(cells[10]),
      circulatingMarketCap: parseMoney(cells[12]),
      totalMarketCap: parseMoney(cells[12]),
      marketType: marketTypeForCode(code)
    });
  });
  return rows;
}

async function fetchDetailPage(cid, page = 1) {
  const suffix = page === 1 ? `/gn/detail/code/${cid}/` : `/gn/detail/page/${page}/code/${cid}`;
  const buffer = await fetchBuffer(`${THS_CONCEPT_BASE}${suffix}`, `${THS_CONCEPT_BASE}/gn/`);
  const html = new TextDecoder("gbk").decode(buffer);
  const $ = cheerio.load(html);
  const pages = asNumber($(".m-pager .page_info").text().split("/")[1]) || 1;
  return { rows: parseStockRows(html), pages };
}

async function fetchDetailPageWithRetry(cid, page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await fetchDetailPage(cid, page);
      // Every non-final page must contain rows. Empty content is normally a
      // throttled response, never a valid component-stock page.
      if (result.rows.length) return result;
      lastError = new Error(`同花顺成分股第 ${page} 页为空`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`同花顺成分股第 ${page} 页获取失败：${lastError?.message ?? "未知错误"}`);
}

export async function fetchThsConceptBoardStocks(sectorCode, limit = 1000, options = {}) {
  const catalog = await loadCatalog();
  const item = findCatalogItem(sectorCode, catalog);
  if (!item) return [];
  const first = await fetchDetailPageWithRetry(item.cid, 1);
  const pages = Math.min(first.pages, Math.ceil(Math.max(1, Number(limit) || 1000) / 10));
  // The upstream site can return a login/verification page with HTTP 200.
  // Do not turn those missing pages into an apparently valid partial snapshot.
  const rest = await mapConcurrent(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2), 2, (page) => fetchDetailPageWithRetry(item.cid, page));
  const rows = [first, ...rest].flatMap((page) => page.rows).slice(0, Math.max(1, Number(limit) || 1000)).map((stock) => ({
    ...stock,
    mainAmount: 0,
    lowPriceTime: "",
    highPriceTime: "",
    startTime: "",
    fallTime: "",
    limitUpTime: "",
    limitDownTime: "",
    sectorStartTime: "",
    news: "",
    limitTypes: [],
    limitTypeStatus: "pending",
    limitUp: false,
    limitDown: false,
    limitStatusQuality: "pending"
  }));
  const uniqueRows = [...new Map(rows.map((row) => [row.code, row])).values()];
  if (options?.enrich === false) return uniqueRows;
  const sectorStartTime = item.thsCode ? (await fetchThsIntradayMetrics("bk", item.thsCode).catch(() => ({ startTime:"" }))).startTime : "";
  return mapConcurrent(uniqueRows, 8, (stock) => enrichConceptStock(stock, sectorStartTime));
}

function parseLineData(buffer) {
  const payload = parseJsonp(buffer);
  return String(payload?.data ?? "").split(";").filter(Boolean).map((line) => {
    const parts = line.split(",");
    return { date: parts[0] ?? "", open: asNumber(parts[1]), high: asNumber(parts[2]), low: asNumber(parts[3]), close: asNumber(parts[4]), volume: asNumber(parts[5]), amount: asNumber(parts[6]), changePct: asNumber(parts[7]) };
  });
}

function parseIntradayData(buffer, key, requestedDate = "") {
  const payload = parseJsonp(buffer);
  const item = payload?.[key] ?? {};
  const isSector = /^bk_/i.test(key);
  const rows = String(item.data ?? "").split(";").filter(Boolean).map((line) => {
    const [time, priceText, amountText, averageText, volumeText] = line.split(",");
    return {
      date: String(item.date ?? requestedDate ?? ""),
      time: String(time ?? ""),
      price: asNumber(priceText),
      // The sector endpoint uses this slot for a non-price metric. It is not
      // the stock-style average price, so do not expose it as an average line.
      average: isSector ? null : asNumber(averageText),
      volume: asNumber(volumeText),
      amount: asNumber(amountText)
    };
  }).filter((row) => /^\d{4}$/.test(row.time) && row.price > 0);
  return { date: String(item.date ?? requestedDate ?? ""), name: item.name ?? "", items: normalizeIntradayItems(rows) };
}

async function fetchTencentHistoricalIntraday(rawCode, requestedDate) {
  const market = /^6|^68/.test(rawCode) ? "sh" : /^0|^3/.test(rawCode) ? "sz" : "bj";
  const response = await axios.get(`https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${market}${rawCode}`, {
    timeout: 15000,
    headers: { "User-Agent": USER_AGENT, Referer: "https://gu.qq.com/" }
  });
  const entry = response.data?.data?.[`${market}${rawCode}`]?.data?.find((item) => String(item.date) === requestedDate);
  if (!entry) return null;
  const lines = Array.isArray(entry.data) ? entry.data : String(entry.data ?? "").split(";").filter(Boolean);
  const items = lines.map((line) => {
    const [time, priceText, volumeText, amountText] = String(line).trim().split(/\s+/);
    return {
      date: requestedDate,
      time: String(time ?? ""),
      price: asNumber(priceText),
      average: asNumber(priceText),
      volume: asNumber(volumeText) * 100,
      amount: asNumber(amountText)
    };
  }).filter((row) => /^\d{4}$/.test(row.time) && row.price > 0);
  return items.length ? { date: requestedDate, name: response.data?.data?.[`${market}${rawCode}`]?.qt?.[`${market}${rawCode}`]?.[1] ?? "", items: normalizeIntradayItems(items) } : null;
}

export async function fetchThsIntraday(code, date = "") {
  const original = String(code ?? "");
  const isSector = /^BK/i.test(original);
  const prefix = isSector ? "bk" : "hs";
  const raw = original.replace(/^BK/i, "");
  if (!/^\d{6}$/.test(raw)) return { date, name: "", items: [] };
  const normalizedDate = /^\d{8}$/.test(String(date)) ? String(date) : "";
  const shanghaiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
  const isToday = normalizedDate && normalizedDate === shanghaiDate;
  const suffix = normalizedDate || "last";
  const key = `intraday-series:v3:${prefix}:${raw}:${suffix}`;
  // Today's series is a live snapshot; do not freeze it for a whole day.
  const cached = cacheGet(key, isToday ? 15000 : normalizedDate ? 24 * 60 * 60 * 1000 : 30000);
  if (cached) return cached;
  const buffer = await fetchBuffer(`${THS_QUOTE_BASE}/v6/time/${prefix}_${raw}/${suffix}.js`, `${THS_CONCEPT_BASE}/gn/`);
  const payload = parseIntradayData(buffer, `${prefix}_${raw}`, normalizedDate);
  if (!isSector && !supportsAfterHoursTrading(raw)) {
    payload.items = payload.items.filter((item) => !/^\d{4}$/.test(item.time) || Number(item.time) <= 1500);
  }
  if (normalizedDate && payload.date !== normalizedDate && !isSector) {
    const historical = await fetchTencentHistoricalIntraday(raw, normalizedDate).catch(() => null);
    if (historical) return cacheSet(key, historical);
    return cacheSet(key, { date: normalizedDate, name: payload.name, items: [] });
  }
  if (normalizedDate && payload.date !== normalizedDate && isSector) {
    return cacheSet(key, { date: normalizedDate, name: payload.name, items: [] });
  }
  return cacheSet(key, payload);
}

export async function fetchThsKline(code, limit = 120, period = "daily") {
  const original = String(code);
  let raw = original.replace(/^BK/i, "");
  let prefix = /^BK/i.test(original) ? "bk" : "hs";
  if (/^THS\d+$/i.test(String(code))) {
    const item = findCatalogItem(code, await loadCatalog());
    raw = item?.thsCode ?? "";
    prefix = "bk";
  }
  if (!/^\d{6}$/.test(raw)) return [];
  const periodCode = { daily: "01", weekly: "11", monthly: "21" }[String(period)] ?? "01";
  const key = `kline:${prefix}:${raw}:${periodCode}`;
  const cached = cacheGet(key, 30000);
  if (cached) return cached.slice(-limit);
  const buffer = await fetchBuffer(`${THS_QUOTE_BASE}/v4/line/${prefix}_${raw}/${periodCode}/last.js`, `${THS_CONCEPT_BASE}/`);
  return cacheSet(key, parseLineData(buffer)).slice(-limit);
}

export async function fetchThsStockRealtime(code) {
  const raw = String(code).replace(/^.*_/, "");
  const payload = await fetchRealHead("hs", raw);
  return normalizeRealtime(raw, payload);
}

export async function fetchThsSectorRealtime(code) {
  const raw = String(code).replace(/^BK/i, "");
  const payload = await fetchRealHead("bk", raw);
  const normalized = normalizeRealtime(raw, payload);
  const item = payload?.items ?? {};
  // 同花顺板块 realhead 字段：37=成分股总数，38=下跌家数，39=上涨家数。
  // 37 不能当作涨家数，否则融资融券会显示 3857 家上涨，实际这是成分股总数。
  const totalCount = asNumber(item["37"]);
  const downCount = asNumber(item["38"]);
  const upCount = asNumber(item["39"]);
  const flatCount = totalCount != null && upCount != null && downCount != null
    ? Math.max(0, totalCount - upCount - downCount)
    : null;
  return { ...normalized, code: `BK${raw}`, marketType: "概念板块", totalCount, upCount, downCount, flatCount, limitUpCount: asNumber(item["276"]), limitDownCount: asNumber(item["277"]), mainNetInflow: asNumber(item["527198"]), source: "同花顺" };
}
