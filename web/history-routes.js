/**
 * 历史数据API路由
 * 提供K线、涨停池、板块等历史数据查询接口
 */

import marketDatabase from '../src/lib/collector/market-database.js';
import { fetchStockDbKline, fetchStockDbTradingDates, readStockDbAuction, readStockDbLimitUp, readStockDbLimitUpDays, stockDbHealth } from '../src/lib/collector/stockdb-client.js';

/**
 * 获取最近的交易日
 * 如果指定日期不是交易日，返回最近的交易日
 */
async function getNearestTradingDate(requestedDate) {
  let tradingDates = [];
  try { tradingDates = await fetchStockDbTradingDates('000001', 100); } catch { tradingDates = []; }
  if (!tradingDates.length) tradingDates = marketDatabase.getTradingDates(100).map((date) => String(date).replace(/-/g, ''));
  const requested = String(requestedDate ?? '').replace(/-/g, '');

  if (!tradingDates || tradingDates.length === 0) {
    return { date: requested, isFallback: false };
  }

  // 如果请求的日期在交易日列表中，直接返回
  if (tradingDates.includes(requested)) {
    return { date: requested, isFallback: false };
  }

  // 找到最近的交易日（小于等于请求日期）
  const nearestDate = tradingDates.find(date => String(date).replace(/-/g, '') <= requested);

  if (nearestDate) {
    return { date: nearestDate, isFallback: true, requestedDate: requested };
  }

  // Never replace a date older than the retained window with future data.
  return { date: requested, isFallback: false, unavailable: true, requestedDate: requested };
}

/**
 * 处理K线历史数据请求
 * GET /api/history/kline?code=000001&start=2026-01-01&end=2026-04-26&limit=100
 */
export async function handleKlineRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');
    const limit = parseInt(url.searchParams.get('limit') || '100');

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少股票代码参数' }));
      return;
    }

    console.log(`[K线API] 查询: ${code}, ${startDate || '不限'} ~ ${endDate || '不限'}, limit=${limit}`);

    const data = await fetchStockDbKline(code, { start: startDate, end: endDate, limit, frequency: url.searchParams.get('period') || '1d' });

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      code,
      source: 'stockdb',
      count: data.length,
      data
    }, null, 2));

  } catch (error) {
    console.error('[K线API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理涨停池历史数据请求
 * GET /api/history/limit-up?date=2026-04-26
 * GET /api/history/limit-up?start=2026-04-01&end=2026-04-26&code=000001
 */
export async function handleLimitUpHistoryRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const date = url.searchParams.get('date');
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');
    const code = url.searchParams.get('code');

    let data;
    let actualDate = date;
    let isFallback = false;

    if (date) {
      // 查询单日数据 - 使用交易日过滤
      const tradingDateInfo = await getNearestTradingDate(date);
      actualDate = tradingDateInfo.date;
      isFallback = tradingDateInfo.isFallback;

      console.log(`[涨停池API] 查询单日: ${date}${isFallback ? ` -> ${actualDate} (回退)` : ''}${code ? ', 股票: ' + code : ''}`);

      let privateItems = [];
      try { privateItems = await readStockDbLimitUp(actualDate); } catch { privateItems = []; }
      if (code) privateItems = privateItems.filter((item) => String(item.code) === String(code));
      data = privateItems.length ? privateItems : (code
        ? [marketDatabase.getLimitUpHistory(actualDate, code)].filter(Boolean)
        : marketDatabase.getLimitUpHistory(actualDate));
    } else if (startDate && endDate) {
      // 查询日期范围
      console.log(`[涨停池API] 查询范围: ${startDate} ~ ${endDate}${code ? ', 股票: ' + code : ''}`);
      let privateRows = [];
      try {
        const dates = (await fetchStockDbTradingDates('000001', 500)).filter((value) => value >= String(startDate).replace(/-/g, '') && value <= String(endDate).replace(/-/g, ''));
        privateRows = (await readStockDbLimitUpDays(dates)).filter((item) => !code || String(item.code) === String(code));
      } catch {
        privateRows = [];
      }
      data = privateRows.length ? privateRows : marketDatabase.getLimitUpByDateRange(startDate, endDate, code);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '需要提供 date 或 start+end 参数' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      date: actualDate,
      requestedDate: isFallback ? date : undefined,
      isFallback,
      count: data.length,
      data
    }, null, 2));

  } catch (error) {
    console.error('[涨停池API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理跌停池历史数据请求
 * GET /api/history/limit-down?date=2026-04-26
 */
export async function handleLimitDownHistoryRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const date = url.searchParams.get('date');

    if (!date) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少日期参数' }));
      return;
    }

    // 使用交易日过滤
    const tradingDateInfo = await getNearestTradingDate(date);
    const actualDate = tradingDateInfo.date;
    const isFallback = tradingDateInfo.isFallback;

    console.log(`[跌停池API] 查询: ${date}${isFallback ? ` -> ${actualDate} (回退)` : ''}`);
    const data = marketDatabase.getLimitDownHistory(actualDate);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      date: actualDate,
      requestedDate: isFallback ? date : undefined,
      isFallback,
      count: data.length,
      data
    }, null, 2));

  } catch (error) {
    console.error('[跌停池API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理板块历史数据请求
 * GET /api/history/sector?date=2026-04-26
 * GET /api/history/sector?start=2026-04-01&end=2026-04-26&code=BK0001
 */
export async function handleSectorHistoryRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const date = url.searchParams.get('date');
    const startDate = url.searchParams.get('start');
    const endDate = url.searchParams.get('end');
    const sectorCode = url.searchParams.get('code');

    let data;
    let actualDate = date;
    let isFallback = false;

    if (date) {
      // 使用交易日过滤
      const tradingDateInfo = await getNearestTradingDate(date);
      actualDate = tradingDateInfo.date;
      isFallback = tradingDateInfo.isFallback;

      console.log(`[板块API] 查询单日: ${date}${isFallback ? ` -> ${actualDate} (回退)` : ''}${sectorCode ? ', 板块: ' + sectorCode : ''}`);
      data = sectorCode
        ? [marketDatabase.getSectorHistory(actualDate, sectorCode)].filter(Boolean)
        : marketDatabase.getSectorHistory(actualDate);
    } else if (startDate && endDate) {
      console.log(`[板块API] 查询范围: ${startDate} ~ ${endDate}${sectorCode ? ', 板块: ' + sectorCode : ''}`);
      data = marketDatabase.getSectorByDateRange(startDate, endDate, sectorCode);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '需要提供 date 或 start+end 参数' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      date: actualDate,
      requestedDate: isFallback ? date : undefined,
      isFallback,
      count: data.length,
      data
    }, null, 2));

  } catch (error) {
    console.error('[板块API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理指数历史数据请求
 * GET /api/history/index?date=2026-04-26
 */
export async function handleIndexHistoryRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const date = url.searchParams.get('date');
    const indexCode = url.searchParams.get('code');

    if (!date) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少日期参数' }));
      return;
    }

    // 使用交易日过滤
    const tradingDateInfo = await getNearestTradingDate(date);
    const actualDate = tradingDateInfo.date;
    const isFallback = tradingDateInfo.isFallback;

    console.log(`[指数API] 查询: ${date}${isFallback ? ` -> ${actualDate} (回退)` : ''}${indexCode ? ', 指数: ' + indexCode : ''}`);
    const data = marketDatabase.getIndexHistory(actualDate, indexCode);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      date: actualDate,
      requestedDate: isFallback ? date : undefined,
      isFallback,
      count: Array.isArray(data) ? data.length : 1,
      data: Array.isArray(data) ? data : [data].filter(Boolean)
    }, null, 2));

  } catch (error) {
    console.error('[指数API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理竞价数据请求
 * GET /api/history/auction?date=2026-04-26
 */
export async function handleAuctionDataRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const date = url.searchParams.get('date');

    if (!date) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '缺少日期参数' }));
      return;
    }

    // 使用交易日过滤
    const tradingDateInfo = await getNearestTradingDate(date);
    const actualDate = tradingDateInfo.date;
    const isFallback = tradingDateInfo.isFallback;

    console.log(`[竞价API] 查询: ${date}${isFallback ? ` -> ${actualDate} (回退)` : ''}`);
    let data = [];
    try { data = await readStockDbAuction(actualDate); } catch { data = []; }
    if (!data.length) data = marketDatabase.getAuctionData(actualDate);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      date: actualDate,
      requestedDate: isFallback ? date : undefined,
      isFallback,
      count: data.length,
      data
    }, null, 2));

  } catch (error) {
    console.error('[竞价API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理交易日列表请求
 * GET /api/history/trading-dates?limit=100
 */
export async function handleTradingDatesRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') || '100');

    console.log(`[交易日API] 查询: limit=${limit}`);
    let dates = [];
    try { dates = await fetchStockDbTradingDates('000001', limit); } catch { dates = []; }
    if (!dates.length) dates = marketDatabase.getTradingDates(limit);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      count: dates.length,
      dates
    }, null, 2));

  } catch (error) {
    console.error('[交易日API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * 处理同步状态请求
 * GET /api/history/sync-status
 */
export async function handleSyncStatusRequest(req, res) {
  try {
    console.log('[同步状态API] 查询');

    const status = {
      lastSync: {},
      database: {}
    };

    // 获取各类数据的最后同步时间
    const dataTypes = ['limit_up', 'limit_down', 'sector', 'index', 'stock_kline', 'auction'];

    for (const type of dataTypes) {
      const lastDate = marketDatabase.getLastSyncDate(type);
      status.lastSync[type] = lastDate;
    }

    // 获取数据库统计
    status.database.stockCount = marketDatabase.getStockCount();
    status.database.tradingDates = marketDatabase.getTradingDates(10);
    status.database.marketDataSource = 'stockdb';
    status.database.stockdb = await stockDbHealth();
    if (status.database.stockdb.ok) {
      status.database.tradingDates = await fetchStockDbTradingDates('000001', 10);
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(status, null, 2));

  } catch (error) {
    console.error('[同步状态API] 错误:', error);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ error: error.message }));
  }
}
