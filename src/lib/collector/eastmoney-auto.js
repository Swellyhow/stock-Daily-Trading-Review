import axios from "axios";

function toQueryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

async function fetchJson(baseUrl, params) {
  const url = `${baseUrl}?${toQueryString(params)}`;
  const request = (targetUrl) => axios.get(targetUrl, {
    timeout: 20000,
    responseType: "json",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://quote.eastmoney.com/",
      "Accept": "application/json,text/plain,*/*"
    }
  });
  try {
    return (await request(url)).data;
  } catch (error) {
    // push2delay is the same public Eastmoney quote service and is used when
    // the primary CDN resets a connection in the local network.
    if (!/\/\/push2\.eastmoney\.com\//.test(baseUrl)) throw error;
    const delayedUrl = url.replace("//push2.eastmoney.com/", "//push2delay.eastmoney.com/");
    return (await request(delayedUrl)).data;
  }
}

async function fetchText(url, extraHeaders = {}) {
  const response = await axios.get(url, {
    timeout: 20000,
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://www.eastmoney.com/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...extraHeaders
    }
  });

  return response.data;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function shiftDate(dateString, deltaDays) {
  const base = new Date(`${dateString.slice(0, 4)}-${dateString.slice(4, 6)}-${dateString.slice(6, 8)}T00:00:00+08:00`);
  base.setDate(base.getDate() + deltaDays);
  return formatDate(base);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stockSecId(code) {
  const raw = String(code ?? "");

  // 如果已经是secid格式（如1.000001），直接返回
  if (/^\d+\.\d+$/.test(raw)) {
    return raw;
  }

  // 板块代码（如BK1173）保持原样
  if (/^BK\d+$/i.test(raw)) {
    return raw;
  }

  // 股票代码转换
  if (/^(5|6|9)/.test(raw)) {
    return `1.${raw}`;
  }
  return `0.${raw}`;
}

function marketTypeForCode(code) {
  const raw = String(code ?? "");
  if (/^688/.test(raw)) return "科创板";
  if (/^30[0-9]/.test(raw)) return "创业板";
  if (/^(4|8|92)/.test(raw)) return "京A";
  if (/^(60|68)/.test(raw)) return "沪A主板";
  if (/^(000|001|002|003)/.test(raw)) return "深A主板";
  return "A股";
}

export function getMarketType(code) {
  return marketTypeForCode(code);
}

async function fetchPool(baseUrl, date, sort) {
  const payload = await fetchJson(baseUrl, {
    ut: "7eea3edcaed734bea9cbfc24409ed989",
    dpt: "wz.ztzt",
    Pageindex: 0,
    pagesize: 10000,
    sort,
    date,
    _: Date.now()
  });
  return payload?.data?.pool ?? [];
}

function normalizeLimitUpPoolItem(item) {
  const rawBoardCount = Number(item.lbc);
  return {
    code: item.c,
    name: item.n,
    latestPrice: Number(item.p ?? 0) / 1000,
    changePct: Number(item.zdp ?? 0),
    amount: Number(item.amount ?? item.a ?? 0),
    turnoverPct: Number(item.hs ?? 0),
    boardCount: Number.isFinite(rawBoardCount) && rawBoardCount > 0 ? rawBoardCount : null,
    boardCountSource: "eastmoney-lbc",
    firstLimitTime: item.fbt ?? null,
    lastLimitTime: item.lbt ?? null,
    sealAmount: Number(item.fund ?? 0),
    brokenCount: Number(item.zbc ?? 0),
    industry: item.hybk ?? "未知行业",
    circulatingMarketCap: Number(item.ltsz ?? 0),
    totalMarketCap: Number(item.tshare ?? 0),
    limitAmount: Number(item.amount ?? item.a ?? 0),
    stats: item.zttj ?? item.ztp ?? null
  };
}

// Detailed limit-up pool for the ladder workspace. The fields complement the
// official THS membership pool, which deliberately returns membership only.
export async function fetchEastmoneyDetailedLimitUpPool(date) {
  const items = await fetchPool("https://push2ex.eastmoney.com/getTopicZTPool", date, "fbt:asc");
  return items.map((item) => ({ ...normalizeLimitUpPoolItem(item), marketType: marketTypeForCode(item.c) }));
}

function normalizeLimitDownPoolItem(item) {
  return {
    code: item.c,
    name: item.n,
    latestPrice: Number(item.p ?? 0) / 1000,
    changePct: Number(item.zdp ?? 0),
    amount: Number(item.amount ?? item.a ?? 0),
    turnoverPct: Number(item.hs ?? 0),
    boardCount: 0,
    industry: item.hybk ?? "未知行业"
  };
}

function normalizePrevLimitUpItem(item) {
  return {
    code: item.c,
    name: item.n,
    changePct: Number(item.zdp ?? 0),
    boardCount: Number(item.lbc ?? 0),
    amount: Number(item.amount ?? item.a ?? 0),
    turnoverPct: Number(item.hs ?? 0),
    industry: item.hybk ?? "未知行业"
  };
}

function normalizeConceptBoardItem(item) {
  return {
    code: item.f12,
    name: item.f14,
    latestPrice: Number(item.f2 ?? 0),
    changePct: Number(item.f3 ?? 0),
    mainNetInflow: Number(item.f62 ?? 0),
    leaderName: item.f128 ?? "",
    leaderChangePct: Number(item.f136 ?? 0)
  };
}

async function fetchConceptBoards() {
  const payload = await fetchJson("https://push2.eastmoney.com/api/qt/clist/get", {
    pn: 1,
    pz: 100,
    po: 1,
    np: 1,
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: 2,
    invt: 2,
    fid: "f3",
    fs: "m:90+t:3+f:!50",
    fields: "f12,f14,f2,f3,f62,f128,f136",
    _: Date.now()
  });

  return (payload?.data?.diff ?? []).map(normalizeConceptBoardItem);
}

async function fetchQuoteSnapshot(secid) {
  const payload = await fetchJson("https://push2.eastmoney.com/api/qt/stock/get", {
    ut: "fa5fd1943c7b386f172d6893dbfba10b",
    fltt: 2,
    invt: 2,
    fields: "f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f168,f169,f170,f171,f92,f137,f193",
    secid,
    _: Date.now()
  });
  return payload?.data ?? {};
}

export async function fetchConceptBoardList(limit = 100) {
  const requestedLimit = Math.min(5000, Math.max(20, Number(limit) || 100));
  const pageSize = 300;
  const requestPage = (page) => fetchJson("https://push2.eastmoney.com/api/qt/clist/get", {
    pn: page,
    pz: pageSize,
    po: 1,
    np: 1,
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: 2,
    invt: 2,
    fid: "f3",
    fs: "m:90+t:3+f:!50",
    fields: "f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f20,f21,f62,f100,f104,f105,f106,f128,f136,f152",
    _: Date.now()
  });
  const first = await requestPage(1);
  const firstRows = first?.data?.diff ?? [];
  const expected = Math.min(requestedLimit, Number(first?.data?.total ?? firstRows.length));
  // The endpoint may cap pz below the requested value. Use the actual first
  // page size for the page count, otherwise later pages are silently omitted.
  const actualPageSize = firstRows.length;
  if (!actualPageSize && expected) throw new Error("东方财富概念板块列表第一页为空");
  const pageCount = Math.max(1, Math.ceil(expected / Math.max(1, actualPageSize)));
  const remaining = [];
  for (let page = 2; page <= pageCount; page += 1) remaining.push(await requestPage(page));
  const rawItems = [first, ...remaining].flatMap((payload) => payload?.data?.diff ?? []).slice(0, requestedLimit);
  if (rawItems.length < expected) throw new Error(`东方财富概念板块列表不完整：应有 ${expected} 条，实际 ${rawItems.length} 条`);
  return rawItems.map((item) => ({
    code: item.f12,
    name: item.f14,
    latestPrice: Number(item.f2 ?? 0),
    changePct: Number(item.f3 ?? 0),
    changeAmount: Number(item.f4 ?? 0),
    volume: Number(item.f5 ?? 0),
    amount: Number(item.f6 ?? 0),
    amplitudePct: Number(item.f7 ?? 0),
    turnoverPct: Number(item.f8 ?? 0),
    upCount: Number(item.f104 ?? 0),
    downCount: Number(item.f105 ?? 0),
    flatCount: Number(item.f106 ?? 0),
    limitUpCount: Number(item.f152 ?? 0),
    limitDownCount: 0,
    mainNetInflow: Number(item.f62 ?? 0),
    leaderName: item.f128 ?? "",
    leaderChangePct: Number(item.f136 ?? 0),
    startTime: "",
    news: ""
  }));
}

export async function fetchConceptBoardStocks(sectorCode, limit = 500) {
  const code = String(sectorCode ?? "").trim();
  if (!/^BK\d+$/i.test(code)) return [];
  const requestedLimit = Math.min(5000, Math.max(50, Number(limit) || 500));
  const pageSize = 1000;
  const requestPage = (page) => fetchJson("https://push2.eastmoney.com/api/qt/clist/get", {
    pn: page,
    pz: pageSize,
    po: 1,
    np: 1,
    ut: "bd1d9ddb04089700cf9c27f6f7426281",
    fltt: 2,
    invt: 2,
    fid: "f3",
    fs: `b:${code}`,
    fields: "f2,f3,f4,f5,f6,f8,f12,f14,f20,f21,f62,f100,f104,f105,f106,f152,f160,f161,f162,f163",
    _: Date.now()
  });
  const first = await requestPage(1);
  const firstRows = first?.data?.diff ?? [];
  const expected = Math.min(requestedLimit, Number(first?.data?.total ?? firstRows.length));
  const actualPageSize = firstRows.length;
  if (!actualPageSize && expected) throw new Error("东方财富概念成分股第一页为空");
  const pageCount = Math.max(1, Math.ceil(expected / Math.max(1, actualPageSize)));
  const remaining = [];
  for (let page = 2; page <= pageCount; page += 1) remaining.push(await requestPage(page));
  const rawItems = [first, ...remaining].flatMap((payload) => payload?.data?.diff ?? []).slice(0, requestedLimit);
  if (rawItems.length < expected) throw new Error(`东方财富概念成分股不完整：应有 ${expected} 条，实际 ${rawItems.length} 条`);
  return rawItems.map((item) => {
    const stockCode = item.f12 || "";
    return {
      code: stockCode,
      name: item.f14 || "",
      changePct: Number(item.f3 ?? 0),
      latestPrice: Number(item.f2 ?? 0),
      mainAmount: Number(item.f62 ?? 0),
      turnoverPct: Number(item.f8 ?? 0),
      marketType: marketTypeForCode(stockCode),
      lowTime: "",
      limitUpTime: "",
      limitDownTime: "",
      circulatingMarketCap: Number(item.f21 ?? 0),
      totalMarketCap: Number(item.f20 ?? 0),
      sectorStartTime: "",
      news: "",
      limitUp: Number(item.f152 ?? 0) > 0 || Number(item.f3 ?? 0) >= 9.5,
      limitDown: Number(item.f3 ?? 0) <= -9.5
    };
  });
}

export async function fetchStockQuote(code) {
  const secid = stockSecId(code);
  const payload = await fetchQuoteSnapshot(secid);

  return {
    code: payload.f57 ?? String(code ?? ""),
    name: payload.f58 ?? "",
    secid,
    latestPrice: Number(payload.f43 ?? 0),
    changePct: Number(payload.f170 ?? 0),
    changeAmount: Number(payload.f169 ?? 0),
    prevClose: Number(payload.f60 ?? 0),
    open: Number(payload.f46 ?? 0),
    high: Number(payload.f44 ?? 0),
    low: Number(payload.f45 ?? 0),
    volume: Number(payload.f47 ?? 0),
    amount: Number(payload.f48 ?? 0),
    turnoverPct: Number(payload.f168 ?? 0),
    volumeRatio: Number(payload.f50 ?? 0),
    collectedAt: new Date().toISOString()
  };
}

function parseQuotePct(value) {
  return Number((Number(value ?? 0) / 100).toFixed(2));
}

function parsePrice(value) {
  return Number((Number(value ?? 0) / 100).toFixed(2));
}

function normalizeIndexSnapshot(payload = {}, secid, label) {
  return {
    secid,
    label,
    code: payload.f57 ?? secid.split(".")[1],
    name: payload.f58 ?? label,
    latestPrice: parsePrice(payload.f43),
    prevClose: parsePrice(payload.f60),
    changePct: parseQuotePct(payload.f170),
    changeAmount: parsePrice(payload.f169),
    amplitudePct: parseQuotePct(payload.f171),
    volume: Number(payload.f47 ?? 0),
    amount: Number(payload.f48 ?? 0)
  };
}

async function fetchIndexDailyAmounts(secid) {
  const payload = await fetchJson("https://push2his.eastmoney.com/api/qt/stock/kline/get", {
    secid,
    ut: "fa5fd1943c7b386f172d6893dbfba10b",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt: 101,
    fqt: 0,
    end: 20500000,
    lmt: 2,
    _: Date.now()
  });

  const klines = payload?.data?.klines ?? [];
  if (klines.length === 0) {
    return { latestAmount: 0, previousAmount: 0 };
  }

  const parsed = klines.map((line) => {
    const parts = String(line).split(",");
    return {
      date: parts[0],
      amount: Number(parts[6] ?? 0)
    };
  });

  const latest = parsed[parsed.length - 1] ?? { amount: 0 };
  const previous = parsed[parsed.length - 2] ?? latest;
  return {
    latestAmount: Number(latest.amount ?? 0),
    previousAmount: Number(previous.amount ?? 0)
  };
}

async function fetchIndexPackage(definition) {
  const [quote, history] = await Promise.all([
    fetchQuoteSnapshot(definition.secid),
    fetchIndexDailyAmounts(definition.secid)
  ]);

  return {
    ...normalizeIndexSnapshot(quote, definition.secid, definition.label),
    latestHistoryAmount: Number(history.latestAmount ?? 0),
    previousHistoryAmount: Number(history.previousAmount ?? 0)
  };
}

async function fetchMarketIndices() {
  const definitions = [
    { key: "shanghaiComposite", secid: "1.000001", label: "上证指数" },
    { key: "shenzhenComponent", secid: "0.399001", label: "深证成指" },
    { key: "chinext", secid: "0.399006", label: "创业板指" },
    { key: "hs300", secid: "1.000300", label: "沪深300" },
    { key: "guozheng2000", secid: "0.399303", label: "国证2000" },
    { key: "science50", secid: "1.000688", label: "科创50" },
    { key: "science50", secid: "1.000688", label: "科创50" },
    { key: "guozheng2000", secid: "0.399303", label: "国证2000" }
  ];

  const entries = await Promise.all(definitions.map(async (definition) => {
    try {
      return [definition.key, await fetchIndexPackage(definition)];
    } catch {
      return [definition.key, null];
    }
  }));

  const map = Object.fromEntries(entries);
  const shanghai = map.shanghaiComposite;
  const shenzhen = map.shenzhenComponent;
  const chinext = map.chinext;
  const hs300 = map.hs300;
  const smallCap = map.guozheng2000 ?? map.science50 ?? chinext;
  const broadChange = [shanghai?.changePct, shenzhen?.changePct].filter((value) => value !== undefined && value !== null);
  const broadIndexChangePct = broadChange.length > 0
    ? Number((broadChange.reduce((sum, value) => sum + value, 0) / broadChange.length).toFixed(2))
    : null;
  const totalTurnover = Number(shanghai?.amount ?? 0) + Number(shenzhen?.amount ?? 0);
  const previousTurnover = Number(shanghai?.previousHistoryAmount ?? 0) + Number(shenzhen?.previousHistoryAmount ?? 0);
  const turnoverDeltaPct = previousTurnover > 0
    ? Number((((totalTurnover - previousTurnover) / previousTurnover) * 100).toFixed(2))
    : null;
  const styleSpreadPct = smallCap && hs300
    ? Number((Number(smallCap.changePct ?? 0) - Number(hs300.changePct ?? 0)).toFixed(2))
    : null;
  const growthSpreadPct = chinext && hs300
    ? Number((Number(chinext.changePct ?? 0) - Number(hs300.changePct ?? 0)).toFixed(2))
    : null;

  return {
    indexChangePct: broadIndexChangePct,
    growthIndexChangePct: chinext?.changePct ?? map.science50?.changePct ?? null,
    totalTurnoverBn: totalTurnover > 0 ? Number((totalTurnover / 100000000).toFixed(2)) : null,
    turnoverDeltaPct,
    largeCapIndexChangePct: hs300?.changePct ?? null,
    smallCapIndexChangePct: smallCap?.changePct ?? null,
    styleSpreadPct,
    growthSpreadPct,
    shanghaiComposite: shanghai,
    shenzhenComponent: shenzhen,
    chinext,
    hs300,
    science50: map.science50,
    guozheng2000: map.guozheng2000,
    source: "eastmoney-index-quote+kline",
    estimatedFields: {
      indexChangePct: broadIndexChangePct === null,
      growthIndexChangePct: (chinext?.changePct ?? map.science50?.changePct ?? null) === null,
      totalTurnoverBn: !(totalTurnover > 0),
      turnoverDeltaPct: turnoverDeltaPct === null,
      largeCapIndexChangePct: hs300?.changePct === null || hs300?.changePct === undefined,
      smallCapIndexChangePct: smallCap?.changePct === null || smallCap?.changePct === undefined,
      styleSpreadPct: styleSpreadPct === null,
      growthSpreadPct: growthSpreadPct === null
    }
  };
}

function normalizeTrendPoint(line) {
  const parts = String(line).split(",");
  return {
    timestamp: parts[0] ?? "",
    price: Number(parts[1] ?? 0),
    averagePrice: Number(parts[2] ?? 0),
    volume: Number(parts[3] ?? 0),
    amount: Number(parts[4] ?? 0)
  };
}

async function fetchStockTrend(secid) {
  const payload = await fetchJson("https://push2his.eastmoney.com/api/qt/stock/trends2/get", {
    secid,
    ut: "fa5fd1943c7b386f172d6893dbfba10b",
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8",
    fields2: "f51,f53,f54,f55,f56,f57,f58",
    iscr: 0,
    ndays: 1,
    _: Date.now()
  });

  return (payload?.data?.trends ?? []).map(normalizeTrendPoint);
}

function summarizeTrend(points = []) {
  if (points.length === 0) {
    return {
      openMovePct: 0,
      closeVsAveragePct: 0,
      recoveryRatio: 0,
      supportRatio: 0,
      amplitudePct: 0,
      first15RisePct: 0,
      middayPullbackPct: 0,
      lateRecoveryPct: 0,
      breakoutAcceptance: 0,
      pullbackControl: 0,
      intradayWeaknessRisk: 0
    };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const high = points.reduce((max, item) => Math.max(max, item.price), first.price);
  const low = points.reduce((min, item) => Math.min(min, item.price), first.price);
  const supportRatio = points.filter((item) => item.price >= item.averagePrice).length / points.length;
  const firstSegment = points.slice(0, Math.min(points.length, 8));
  const middleSegment = points.slice(Math.max(0, Math.floor(points.length * 0.35)), Math.max(0, Math.floor(points.length * 0.7)));
  const lateSegment = points.slice(Math.max(0, points.length - 10));
  const first15High = firstSegment.reduce((max, item) => Math.max(max, item.price), first.price);
  const middleLow = middleSegment.length > 0 ? middleSegment.reduce((min, item) => Math.min(min, item.price), middleSegment[0].price) : low;
  const lateHigh = lateSegment.length > 0 ? lateSegment.reduce((max, item) => Math.max(max, item.price), lateSegment[0].price) : last.price;
  const openMovePct = first.price > 0 ? ((Math.max(...points.slice(0, Math.min(points.length, 5)).map((item) => item.price)) - first.price) / first.price) * 100 : 0;
  const closeVsAveragePct = last.averagePrice > 0 ? ((last.price - last.averagePrice) / last.averagePrice) * 100 : 0;
  const recoveryRatio = high > low ? (last.price - low) / (high - low) : 1;
  const amplitudePct = first.price > 0 ? ((high - low) / first.price) * 100 : 0;
  const first15RisePct = first.price > 0 ? ((first15High - first.price) / first.price) * 100 : 0;
  const middayPullbackPct = first15High > 0 ? ((middleLow - first15High) / first15High) * 100 : 0;
  const lateRecoveryPct = middleLow > 0 ? ((lateHigh - middleLow) / middleLow) * 100 : 0;
  const breakoutAcceptance = clamp(
    (closeVsAveragePct > 0 ? 0.35 : 0) +
    recoveryRatio * 0.35 +
    supportRatio * 0.2 +
    (lateRecoveryPct > 0 ? 0.1 : 0),
    0,
    1
  );
  const pullbackControl = clamp(
    (middayPullbackPct >= -1.5 ? 0.45 : Math.max(0, 0.45 + middayPullbackPct * 0.08)) +
    supportRatio * 0.25 +
    (closeVsAveragePct > -0.3 ? 0.2 : 0) +
    recoveryRatio * 0.1,
    0,
    1
  );
  const intradayWeaknessRisk = clamp(
    (closeVsAveragePct < 0 ? Math.min(Math.abs(closeVsAveragePct) / 2, 1) * 0.35 : 0) +
    (middayPullbackPct < -2 ? Math.min(Math.abs(middayPullbackPct) / 5, 1) * 0.3 : 0) +
    (lateRecoveryPct <= 0 ? 0.15 : 0) +
    (supportRatio < 0.45 ? (0.45 - supportRatio) * 0.45 : 0),
    0,
    1
  );

  return {
    openMovePct: Number(openMovePct.toFixed(2)),
    closeVsAveragePct: Number(closeVsAveragePct.toFixed(2)),
    recoveryRatio: Number(clamp(recoveryRatio, 0, 1).toFixed(2)),
    supportRatio: Number(clamp(supportRatio, 0, 1).toFixed(2)),
    amplitudePct: Number(amplitudePct.toFixed(2)),
    first15RisePct: Number(first15RisePct.toFixed(2)),
    middayPullbackPct: Number(middayPullbackPct.toFixed(2)),
    lateRecoveryPct: Number(lateRecoveryPct.toFixed(2)),
    breakoutAcceptance: Number(breakoutAcceptance.toFixed(2)),
    pullbackControl: Number(pullbackControl.toFixed(2)),
    intradayWeaknessRisk: Number(intradayWeaknessRisk.toFixed(2))
  };
}

async function fetchMicrostructureForStocks(items = []) {
  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    if (!item?.code || seen.has(item.code)) {
      continue;
    }
    seen.add(item.code);
    uniqueItems.push(item);
  }

  const tasks = uniqueItems.map(async (item) => {
    const secid = stockSecId(item.code);
    try {
      const [quote, trend] = await Promise.all([
        fetchQuoteSnapshot(secid),
        fetchStockTrend(secid)
      ]);
      const trendSummary = summarizeTrend(trend);
      const amount = Number(item.amount ?? 0);
      const sealAmount = Number(item.sealAmount ?? 0);
      const sealStrength = amount > 0 ? clamp(sealAmount / amount, 0, 1) : 0;
      const recloseQuality = clamp((item.brokenCount ?? 0) === 0 ? 0.85 : 0.85 - (item.brokenCount ?? 0) * 0.18, 0, 1);
      const supportStrength = clamp(trendSummary.supportRatio * 0.55 + trendSummary.recoveryRatio * 0.25 + (trendSummary.closeVsAveragePct > 0 ? 0.2 : 0), 0, 1);
      return {
        code: item.code,
        name: item.name,
        secid,
        quote: {
          latestPrice: parsePrice(quote.f43),
          changePct: parseQuotePct(quote.f170),
          amount: Number(quote.f48 ?? 0)
        },
        sealStrength: Number(sealStrength.toFixed(2)),
        recloseQuality: Number(recloseQuality.toFixed(2)),
        supportStrength: Number(supportStrength.toFixed(2)),
        trendSummary,
        trendPoints: trend.slice(-60)
      };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

function stripHtml(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFastNewsBlocks(html) {
  const listItems = html.match(/<li[\s\S]*?<\/li>/gi) ?? [];
  return listItems.filter((block) => /<a[\s\S]*?>[\s\S]*?<\/a>/i.test(block));
}

function normalizeEastmoneyNewsDate(value, fallbackTime = null) {
  const fallbackDate = fallbackTime ? new Date(fallbackTime) : new Date();
  const raw = String(value ?? "").trim();
  const match = raw.match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    const iso = fallbackDate.toISOString();
    return {
      date: iso.slice(0, 10),
      publishedAt: iso
    };
  }

  const year = Number(match[1] ?? fallbackDate.getFullYear());
  const month = String(match[2]).padStart(2, "0");
  const day = String(match[3]).padStart(2, "0");
  const hour = String(match[4] ?? 0).padStart(2, "0");
  const minute = String(match[5] ?? 0).padStart(2, "0");
  const second = String(match[6] ?? 0).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    publishedAt: `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`
  };
}

function parseJsonpPayload(text) {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("(");
  const end = raw.lastIndexOf(")");
  if (start < 0 || end <= start) {
    throw new Error("Eastmoney JSONP payload is invalid.");
  }
  return JSON.parse(raw.slice(start + 1, end));
}

function normalizeEastmoneySearchSort(sortBy) {
  return String(sortBy ?? "relate") === "time" ? "time" : "default";
}

function dedupeEastmoneyItems(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = [item.jumpUrl || "", item.title || "", item.publishedAt || item.date || ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function normalizeEastmoneySearchItem(item, index) {
  const normalizedDate = normalizeEastmoneyNewsDate(item?.date);
  return {
    id: item?.code ?? `eastmoney-article-${index}`,
    title: stripHtml(item?.title ?? ""),
    content: stripHtml(item?.content ?? ""),
    trunk: stripHtml(item?.content ?? ""),
    date: normalizedDate.date,
    publishedAt: normalizedDate.publishedAt,
    source: stripHtml(item?.mediaName ?? "东方财富资讯搜索"),
    sourceFamily: "东方财富资讯搜索",
    informationType: "NEWS",
    informationTypeLabel: "新闻",
    normalizedInformationType: "NEWS",
    jumpUrl: item?.url ?? "",
    image: item?.image ?? "",
    raw: item
  };
}

export async function fetchEastmoneyArticleSearch(keyword, options = {}) {
  const query = String(keyword ?? "").trim();
  if (!query) {
    return [];
  }

  const sort = normalizeEastmoneySearchSort(options.sortBy);
  const pageSize = clamp(Number(options.pageSize ?? 15), 1, 30);
  const pageCount = clamp(Number(options.pageCount ?? 2), 1, 3);

  const tasks = Array.from({ length: pageCount }, async (_, index) => {
    const pageIndex = index + 1;
    const callback = `jQuery${Date.now()}_${pageIndex}`;
    const payload = {
      uid: "",
      keyword: query,
      type: ["cmsArticleWebOld"],
      client: "web",
      clientType: "web",
      clientVersion: "curr",
      param: {
        cmsArticleWebOld: {
          searchScope: "default",
          sort,
          pageIndex,
          pageSize,
          preTag: "<em>",
          postTag: "</em>"
        }
      }
    };
    const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=${callback}&param=${encodeURIComponent(JSON.stringify(payload))}`;
    const text = await fetchText(url, {
      "Referer": "https://so.eastmoney.com/",
      "Accept": "*/*"
    });
    const parsed = parseJsonpPayload(text);
    return parsed?.result?.cmsArticleWebOld ?? [];
  });

  try {
    const pages = await Promise.all(tasks);
    return dedupeEastmoneyItems(
      pages
        .flat()
        .map((item, index) => normalizeEastmoneySearchItem(item, index))
        .filter((item) => item.title)
    );
  } catch {
    return [];
  }
}

export async function fetchEastmoneyFastNews() {
  try {
    const html = await fetchText("https://kuaixun.eastmoney.com/");
    const blocks = extractFastNewsBlocks(html);
    const collectedAt = new Date().toISOString();
    const seen = new Set();
    const items = [];

    for (const block of blocks) {
      const titleMatch = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      const title = stripHtml(titleMatch?.[1] ?? "");
      if (!title || title.length < 10 || title.length > 120) {
        continue;
      }
      if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(title)) {
        continue;
      }
      if (/东方财富|首页|更多|app下载|登录|注册|股票|基金|理财|期货|外汇/.test(title)) {
        continue;
      }
      if (seen.has(title)) {
        continue;
      }
      seen.add(title);

      const dateMatch = block.match(/(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2})/);
      const normalizedDate = normalizeEastmoneyNewsDate(dateMatch?.[1] ?? null, collectedAt);
      items.push({
        title,
        source: "东方财富快讯",
        informationType: "FAST_NEWS",
        ...normalizedDate
      });
    }

    return items;
  } catch {
    return [];
  }
}

export async function fetchEastmoneyMarketState(targetDate) {
  const date = targetDate ?? formatDate(new Date());
  // The trading UI is standardized on THS.  Eastmoney's pool endpoints are
  // kept only as an explicitly opt-in compatibility path; mixing them into a
  // THS concept/constituent view can produce materially different results.
  const allowLegacyPools = process.env.ALLOW_EASTMONEY_LIMIT_POOLS === "1";
  const limitUpPoolRaw = allowLegacyPools
    ? await fetchPool("https://push2ex.eastmoney.com/getTopicZTPool", date, "fbt:asc")
    : [];

  let resolvedDate = date;
  let limitUpPool = limitUpPoolRaw.map(normalizeLimitUpPoolItem);
  if (allowLegacyPools && limitUpPool.length === 0) {
    for (let i = 1; i <= 7; i += 1) {
      const fallbackDate = shiftDate(date, -i);
      const fallbackRaw = await fetchPool("https://push2ex.eastmoney.com/getTopicZTPool", fallbackDate, "fbt:asc");
      if (fallbackRaw.length > 0) {
        resolvedDate = fallbackDate;
        limitUpPool = fallbackRaw.map(normalizeLimitUpPoolItem);
        break;
      }
    }
  }

  // Keep concept-board membership on the same provider as the management UI.
  // Do not fall back to Eastmoney here: the two providers use different
  // membership taxonomies and would contaminate theme aggregation.
  const [limitDownPool, previousLimitUpPool, conceptBoards, marketIndices] = await Promise.all([
    allowLegacyPools ? fetchPool("https://push2ex.eastmoney.com/getTopicDTPool", resolvedDate, "fund:asc") : [],
    allowLegacyPools ? fetchPool("https://push2ex.eastmoney.com/getYesterdayZTPool", resolvedDate, "zs:desc") : [],
    import("./ths-auto.js").then(({ fetchThsConceptBoardList }) => fetchThsConceptBoardList(5000, { enrich: false })).catch(() => []),
    fetchMarketIndices().catch(() => null)
  ]);

  // 导入财联社采集器
  let clsNews = [];
  try {
    const clsCollector = await import('./cls-collector.js');
    if (clsCollector.isClsDatabaseAvailable()) {
      clsNews = await clsCollector.fetchClsRecentNews(24);
      console.log(`[财联社] 获取到 ${clsNews.length} 条新闻`);
    } else {
      console.log('[财联社] 数据库不可用，跳过新闻获取');
    }
  } catch (error) {
    console.log('[财联社] 采集器加载失败，跳过新闻获取:', error.message);
  }

  return {
    date: `${resolvedDate.slice(0, 4)}-${resolvedDate.slice(4, 6)}-${resolvedDate.slice(6, 8)}`,
    requestedTradeDate: date,
    resolvedTradeDate: resolvedDate,
    isFallbackTradeDate: date !== resolvedDate,
    limitUpPool,
    limitDownPool: limitDownPool.map(normalizeLimitDownPoolItem),
    previousLimitUpPool: previousLimitUpPool.map(normalizePrevLimitUpItem),
    conceptBoards,
    clsNews,
    marketIndices,
    dataSources: {
      limitUpPool: allowLegacyPools ? "东方财富（兼容模式，非统一同花顺口径）" : "同花顺：未接入已验证涨停池接口",
      limitDownPool: allowLegacyPools ? "东方财富（兼容模式，非统一同花顺口径）" : "同花顺：未接入已验证跌停池接口",
      previousLimitUpPool: allowLegacyPools ? "东方财富（兼容模式，非统一同花顺口径）" : "同花顺：未接入已验证昨日涨停池接口",
      conceptBoards: "同花顺概念板块",
      marketIndices: marketIndices?.source ?? "东方财富"
    },
    dataQuality: {
      limitPoolsAvailable: allowLegacyPools && (limitUpPool.length > 0 || limitDownPool.length > 0),
      limitPoolsTrusted: false,
      warning: allowLegacyPools
        ? "当前启用了东方财富涨跌停池兼容模式；其板块归属不得与同花顺概念板块混用。"
        : "同花顺涨跌停池接口尚未完成验证，已停用东方财富涨跌停池，避免产生口径错误。"
    }
  };
}

export async function fetchEastmoneyIntradayMicrostructure(limitUpPool = [], watchNames = []) {
  const watchSet = new Set(watchNames.filter(Boolean));
  const candidates = limitUpPool.filter((item) => watchSet.has(item.name));
  if (candidates.length === 0) {
    return [];
  }
  return fetchMicrostructureForStocks(candidates);
}

/**
 * 获取个股K线历史数据
 * @param {string} code - 股票代码
 * @param {Object} options - 配置选项
 * @param {string} options.period - 周期: 1min, 5min, 15min, 30min, 60min, daily(日K), weekly(周K), monthly(月K)
 * @param {number} options.limit - 返回数量限制
 * @param {number} options.adjustType - 复权类型: 0不复权, 1前复权, 2后复权
 * @returns {Promise<Array>} K线数据数组
 */
export async function fetchStockKline(code, options = {}) {
  const { period = 'daily', limit = 100, adjustType = 1 } = options;

  const secid = stockSecId(code);

  // 周期映射: 1=1分钟, 5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟, 101=日K, 102=周K, 103=月K
  const kltMap = {
    '1min': 1,
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '60min': 60,
    'daily': 101,
    'weekly': 102,
    'monthly': 103
  };
  const klt = kltMap[period] || 101;

  try {
    const payload = await fetchJson("https://push2.eastmoney.com/api/qt/stock/kline/get", {
      secid,
      ut: "fa5fd1943c7b386f172d6893dbfba10b",
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
      klt,
      fqt: adjustType,
      end: 20500000,
      lmt: limit,
      _: Date.now()
    });

    const klines = payload?.data?.klines ?? [];
    const stockName = payload?.data?.name || '';
    const stockCode = payload?.data?.code || code;

    return klines.map((line) => {
      const parts = String(line).split(",");
      return {
        code: stockCode,
        name: stockName,
        date: parts[0] || '',
        open: Number(parts[1] ?? 0),
        close: Number(parts[2] ?? 0),
        high: Number(parts[3] ?? 0),
        low: Number(parts[4] ?? 0),
        volume: Number(parts[5] ?? 0),
        amount: Number(parts[6] ?? 0),
        amplitude: Number(parts[7] ?? 0),
        changePct: Number(parts[8] ?? 0),
        changeAmount: Number(parts[9] ?? 0),
        turnoverPct: Number(parts[10] ?? 0)
      };
    });
  } catch (error) {
    console.error(`[K线数据] 获取失败 ${code}:`, error.message);
    return [];
  }
}

/**
 * 批量获取多只股票的K线数据
 * @param {Array<string>} codes - 股票代码数组
 * @param {Object} options - 配置选项
 * @returns {Promise<Array>} 所有股票的K线数据
 */
export async function fetchBatchStockKline(codes, options = {}) {
  const tasks = codes.map(code => fetchStockKline(code, options));
  const results = await Promise.all(tasks);
  return results.flat();
}

/**
 * 获取分时数据（当日1分钟级别数据）
 * @param {string} code - 股票代码
 * @returns {Promise<Array>} 分时数据数组
 */
/**
 * 获取秒级分时tick数据（真正的分时图数据）
 * @param {string} code - 股票代码
 * @param {Object} options - 配置选项
 * @param {number} options.pos - 数据位置，-0表示最新数据
 * @returns {Promise<Array>} 秒级tick数据数组
 */
export async function fetchTickData(code, options = {}) {
  const { pos = -0 } = options;
  const secid = stockSecId(code);

  try {
    const payload = await fetchJson("https://push2.eastmoney.com/api/qt/stock/details/get", {
      secid,
      fields1: "f1,f2,f3,f4",
      fields2: "f51,f52,f53,f54,f55",
      pos,
      _: Date.now()
    });

    const details = payload?.data?.details ?? [];
    const stockCode = payload?.data?.code || code;
    const preClose = Number(payload?.data?.prePrice ?? 0);

    return details.map((line) => {
      const parts = String(line).split(",");
      const price = Number(parts[1] ?? 0);
      return {
        code: stockCode,
        time: parts[0] || '',           // 时间 HH:MM:SS
        price: price,                    // 成交价
        volume: Number(parts[2] ?? 0),   // 成交量（手）
        direction: Number(parts[3] ?? 0), // 买卖方向：0=买入，1=卖出，2=中性
        type: Number(parts[4] ?? 0),     // 成交类型
        preClose: preClose,
        changePct: preClose > 0 ? ((price - preClose) / preClose * 100) : 0
      };
    });
  } catch (error) {
    console.error(`[Tick数据] 获取失败 ${code}:`, error.message);
    return [];
  }
}

/**
 * 获取分钟级聚合数据（用于历史回顾）
 * @deprecated 使用fetchTickData获取秒级实时数据
 */
export async function fetchMinuteData(code) {
  const secid = stockSecId(code);

  try {
    const payload = await fetchJson("https://push2.eastmoney.com/api/qt/stock/trends2/get", {
      secid,
      ut: "fa5fd1943c7b386f172d6893dbfba10b",
      fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
      iscr: 0,
      ndays: 1,
      _: Date.now()
    });

    const trends = payload?.data?.trends ?? [];
    const stockName = payload?.data?.name || '';
    const preClose = Number(payload?.data?.preClose ?? 0);

    return trends.map((line) => {
      const parts = String(line).split(",");
      return {
        code,
        name: stockName,
        time: parts[0] || '',
        price: Number(parts[2] ?? 0),
        volume: Number(parts[1] ?? 0),
        avgPrice: Number(parts[3] ?? 0),
        preClose,
        changePct: preClose > 0 ? ((Number(parts[2] ?? 0) - preClose) / preClose * 100) : 0
      };
    });
  } catch (error) {
    console.error(`[分时数据] 获取失败 ${code}:`, error.message);
    return [];
  }
}

/**
 * 获取集合竞价数据
 * 注意：竞价数据只在交易日 9:15-9:25 期间可获取
 * @param {Object} options - 配置选项
 * @param {string} options.sortBy - 排序字段: change_pct(涨幅), volume(成交量)
 * @param {number} options.limit - 返回数量限制
 * @returns {Promise<Array>} 竞价数据数组
 */
export async function fetchAuctionData(options = {}) {
  const { sortBy = 'change_pct', limit = 100 } = options;

  try {
    // 竞价阶段的股票列表
    // 按涨幅排序获取竞价异动股票
    const payload = await fetchJson("https://push2.eastmoney.com/api/qt/clist/get", {
      pn: 1,
      pz: limit,
      po: 1,
      np: 1,
      ut: "bd1d9ddb04089700cf9c27f6f7426281",
      fltt: 2,
      invt: 2,
      fid: sortBy === 'volume' ? 'f5' : 'f3',
      fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
      fields: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25,f22,f11,f62,f100,f128,f136,f115,f152",
      _: Date.now()
    });

    const stocks = payload?.data?.diff ?? [];

    return stocks.map(item => ({
      code: item.f12 || '',
      name: item.f14 || '',
      sector: item.f100 || '未分类',
      industry: item.f100 || '未分类',
      marketType: marketTypeForCode(item.f12),
      auctionPrice: Number(item.f2 ?? 0),
      auctionChangePct: Number(item.f3 ?? 0),
      auctionVolume: Number(item.f5 ?? 0),
      auctionAmount: Number(item.f6 ?? 0),
      prevClose: Number(item.f18 ?? 0),
      open: Number(item.f17 ?? 0),
      high: Number(item.f15 ?? 0),
      low: Number(item.f16 ?? 0),
      latestPrice: Number(item.f2 ?? 0),
      turnoverPct: Number(item.f8 ?? 0),
      volumeRatio: Number(item.f10 ?? 0)
    }));

  } catch (error) {
    console.error('[竞价数据] 获取失败:', error.message);
    return [];
  }
}

/**
 * 获取竞价涨幅榜
 * @param {number} limit - 返回数量
 * @returns {Promise<Array>} 竞价涨幅榜
 */
export async function fetchAuctionGainers(limit = 50) {
  return fetchAuctionData({ sortBy: 'change_pct', limit });
}

/**
 * 获取竞价成交量榜
 * @param {number} limit - 返回数量
 * @returns {Promise<Array>} 竞价成交量榜
 */
export async function fetchAuctionVolumeLeaders(limit = 50) {
  return fetchAuctionData({ sortBy: 'volume', limit });
}
