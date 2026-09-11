/**
 * 市场数据同步服务
 * 负责从东方财富API获取数据并存储到本地数据库
 */

import marketDatabase from './market-database.js';
import {
  fetchEastmoneyMarketState,
  fetchStockKline,
  fetchBatchStockKline,
  fetchAuctionData,
  fetchAuctionGainers
} from './eastmoney-auto.js';
import { fetchEastmoneyDetailedLimitUpPool } from './eastmoney-auto.js';
import { fetchThsLimitUpPool } from './ths-auto.js';
import { fetchStockDbKline, readStockDbLimitUp, writeStockDbLimitUp, writeStockDbAuction } from './stockdb-client.js';

export async function syncPostmarketPool(date) {
  const requestedDate = String(date || '').replaceAll('-', '');
  if (!/^\d{8}$/.test(requestedDate)) return { success: false, error: 'Invalid trade date' };
  try {
    const official = await fetchThsLimitUpPool({ date: requestedDate, limit: 1000, ttlMs: 0 });
    if (String(official.date) !== requestedDate) throw new Error('Limit-up pool date does not match requested date');
    if (!official.items?.length) throw new Error(`涨停池 ${requestedDate} 尚未发布`);
    await writeStockDbLimitUp(official.items, { date: requestedDate, source: 'ths', kind: 'membership', replace: true });
    const details = await fetchEastmoneyDetailedLimitUpPool(requestedDate);
    const detailedByCode = new Map(details.map((row) => [String(row.code), row]));
    const previous = new Map((await readStockDbLimitUp(requestedDate)).map((row) => [String(row.code), row]));
    const rows = official.items.map((item) => ({
      ...(previous.get(item.code) || {}),
      ...(detailedByCode.get(item.code) || {}),
      code: item.code, name: item.name, limitReason: item.limitReason,
      boardCount: item.highDaysValue ?? detailedByCode.get(item.code)?.boardCount ?? null,
      firstLimitTime: item.firstLimitTime ?? detailedByCode.get(item.code)?.firstLimitTime ?? null,
      lastLimitTime: item.lastLimitTime ?? detailedByCode.get(item.code)?.lastLimitTime ?? null
    }));
    await writeStockDbLimitUp(rows, { date: requestedDate, source: 'ths-membership/eastmoney-details', kind: 'detailed', replace: true });
    const missingDetails = official.items.filter((item) => !detailedByCode.has(item.code)).map((item) => item.code);
    const success = missingDetails.length === 0;
    marketDatabase.logSync('limit_up', requestedDate, rows.length, success ? 'success' : 'partial', missingDetails.length ? `Missing detail fields for ${missingDetails.length} stocks` : null);
    return { success, date: requestedDate, limitUpCount: rows.length, detailCount: rows.length - missingDetails.length, missingDetails, ...(success ? {} : { error: `涨停池已保存，但 ${missingDetails.length} 只个股明细待补齐` }) };
  } catch (error) {
    marketDatabase.logSync('limit_up', requestedDate, 0, 'error', error.message);
    return { success: false, date: requestedDate, error: error.message };
  }
}

/**
 * 同步涨停池、跌停池、板块数据到数据库
 * @param {string} date - 日期 YYYY-MM-DD 或 YYYYMMDD
 * @returns {Promise<Object>} 同步结果
 */
export async function syncDailyMarketData(date = null) {
  try {
    console.log(`[市场数据同步] 开始同步 ${date || '今日'} 数据...`);

    // 获取市场数据
    const marketData = await fetchEastmoneyMarketState(date);

    if (!marketData || !marketData.date) {
      throw new Error('获取市场数据失败');
    }

    const syncDate = marketData.date;
    console.log(`[市场数据同步] 实际交易日: ${syncDate}`);

    // 同步涨停池
    const poolsTrusted = marketData.dataQuality?.limitPoolsTrusted === true;
    if (poolsTrusted && marketData.limitUpPool && marketData.limitUpPool.length > 0) {
      const limitUpData = marketData.limitUpPool.map(item => ({
        date: syncDate,
        code: item.code,
        name: item.name,
        latestPrice: item.latestPrice,
        changePct: item.changePct,
        amount: item.amount,
        turnoverPct: item.turnoverPct,
        boardCount: item.boardCount,
        firstLimitTime: item.firstLimitTime,
        lastLimitTime: item.lastLimitTime,
        sealAmount: item.sealAmount,
        brokenCount: item.brokenCount,
        industry: item.industry
      }));

      await writeStockDbLimitUp(limitUpData, { date: syncDate, source: 'eastmoney', kind: 'detailed' });
      console.log(`[市场数据同步] 涨停池: ${limitUpData.length} 只`);
      marketDatabase.logSync('limit_up', syncDate, limitUpData.length, 'success');
    }

    // 同步跌停池
    if (poolsTrusted && marketData.limitDownPool && marketData.limitDownPool.length > 0) {
      const limitDownData = marketData.limitDownPool.map(item => ({
        date: syncDate,
        code: item.code,
        name: item.name,
        latestPrice: item.latestPrice,
        changePct: item.changePct,
        amount: item.amount,
        turnoverPct: item.turnoverPct,
        industry: item.industry
      }));

      marketDatabase.batchInsertLimitDown(limitDownData);
      console.log(`[市场数据同步] 跌停池: ${limitDownData.length} 只`);
      marketDatabase.logSync('limit_down', syncDate, limitDownData.length, 'success');
    }

    // 同步概念板块
    if (marketData.conceptBoards && marketData.conceptBoards.length > 0) {
      const sectorData = marketData.conceptBoards.map(item => ({
        date: syncDate,
        code: item.code,
        name: item.name,
        latestPrice: item.latestPrice,
        changePct: item.changePct,
        mainNetInflow: item.mainNetInflow,
        leaderCode: item.leaderName ? extractLeaderCode(item.leaderName) : null,
        leaderName: item.leaderName,
        leaderChangePct: item.leaderChangePct
      }));

      marketDatabase.batchInsertSector(sectorData);
      console.log(`[市场数据同步] 概念板块: ${sectorData.length} 个`);
      marketDatabase.logSync('sector', syncDate, sectorData.length, 'success');
    }

    // 同步市场指数
    if (marketData.marketIndices) {
      const indices = marketData.marketIndices;
      const indexData = [];

      const indexMap = {
        'shanghaiComposite': indices.shanghaiComposite,
        'shenzhenComponent': indices.shenzhenComponent,
        'chinext': indices.chinext,
        'hs300': indices.hs300,
        'science50': indices.science50,
        'guozheng2000': indices.guozheng2000
      };

      for (const [key, data] of Object.entries(indexMap)) {
        if (data && data.code) {
          indexData.push({
            date: syncDate,
            code: data.secid || data.code,
            name: data.name,
            latestPrice: data.latestPrice,
            prevClose: data.prevClose,
            changePct: data.changePct,
            changeAmount: data.changeAmount,
            amplitudePct: data.amplitudePct,
            volume: data.volume,
            amount: data.amount
          });
        }
      }

      if (indexData.length > 0) {
        marketDatabase.batchInsertIndex(indexData);
        console.log(`[市场数据同步] 市场指数: ${indexData.length} 个`);
        marketDatabase.logSync('index', syncDate, indexData.length, 'success');
      }
    }

    console.log(`[市场数据同步] 完成 ${syncDate}`);

    return {
      success: true,
      date: syncDate,
      limitUpCount: poolsTrusted ? (marketData.limitUpPool?.length || 0) : 0,
      limitDownCount: poolsTrusted ? (marketData.limitDownPool?.length || 0) : 0,
      sectorCount: marketData.conceptBoards?.length || 0,
      indexCount: Object.keys(marketData.marketIndices || {}).length,
      dataQuality: marketData.dataQuality ?? null,
      dataSources: marketData.dataSources ?? {}
    };

  } catch (error) {
    console.error('[市场数据同步] 失败:', error.message);
    marketDatabase.logSync('daily_market', date || 'today', 0, 'error', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 同步个股K线数据
 * @param {string} code - 股票代码
 * @param {Object} options - 配置选项
 * @param {string} options.period - 周期: daily, weekly, monthly
 * @param {number} options.limit - 获取数量
 * @param {boolean} options.incremental - 是否增量更新
 * @returns {Promise<Object>} 同步结果
 */
export async function syncStockKline(code, options = {}) {
  const { period = 'daily', limit = 100, incremental = true } = options;

  try {
    console.log(`[K线同步] 开始同步 ${code} ${period}...`);

    // 如果是增量更新，先查询最新日期
    let fetchLimit = limit;
    if (incremental) {
      const latestDate = marketDatabase.getLatestKlineDate(code);
      if (latestDate) {
        console.log(`[K线同步] ${code} 最新数据: ${latestDate}`);
        // 获取最近30天数据用于增量更新
        fetchLimit = 30;
      }
    }

    // stockdb is the canonical K-line source.  Keep the old Eastmoney call as
    // an explicit fallback for machines where the local service is offline.
    let klineData = [];
    try {
      klineData = await fetchStockDbKline(code, { frequency: period === 'daily' ? '1d' : period === 'weekly' ? '1w' : '1M', limit: fetchLimit });
    } catch {
      klineData = [];
    }
    if (!klineData.length) {
      klineData = await fetchStockKline(code, {
        period,
        limit: fetchLimit,
        adjustType: 1 // 前复权
      });
    }

    if (!klineData || klineData.length === 0) {
      console.log(`[K线同步] ${code} 无数据`);
      return { success: true, code, count: 0 };
    }

    // 存储到数据库
    const insertData = klineData.map(item => ({
      code: item.code,
      name: item.name,
      date: item.date,
      open: item.open,
      close: item.close,
      high: item.high,
      low: item.low,
      volume: item.volume,
      amount: item.amount,
      changePct: item.changePct,
      amplitudePct: item.amplitude,
      turnoverPct: item.turnoverPct
    }));

    // Do not copy canonical stockdb bars into the legacy SQLite database.
    // This keeps the reset database empty and prevents two stores drifting.
    console.log(`[K线同步] ${code} 完成: ${insertData.length} 条`);

    marketDatabase.logSync('stock_kline', code, insertData.length, 'success');

    return {
      success: true,
      code,
      count: insertData.length,
      dateRange: {
        start: klineData[klineData.length - 1]?.date,
        end: klineData[0]?.date
      }
    };

  } catch (error) {
    console.error(`[K线同步] ${code} 失败:`, error.message);
    marketDatabase.logSync('stock_kline', code, 0, 'error', error.message);
    return {
      success: false,
      code,
      error: error.message
    };
  }
}

/**
 * 批量同步多只股票的K线数据
 * @param {Array<string>} codes - 股票代码数组
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 同步结果
 */
export async function syncBatchStockKline(codes, options = {}) {
  console.log(`[批量K线同步] 开始同步 ${codes.length} 只股票...`);

  const results = [];
  const batchSize = 10; // 每批处理10只股票

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(code => syncStockKline(code, options))
    );
    results.push(...batchResults);

    console.log(`[批量K线同步] 进度: ${Math.min(i + batchSize, codes.length)}/${codes.length}`);

    // 避免请求过快，延迟1秒
    if (i + batchSize < codes.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const totalRecords = results.reduce((sum, r) => sum + (r.count || 0), 0);

  console.log(`[批量K线同步] 完成: 成功 ${successCount}/${codes.length}, 总计 ${totalRecords} 条`);

  return {
    success: true,
    total: codes.length,
    successCount,
    totalRecords,
    results
  };
}

/**
 * 同步涨停池股票的K线数据
 * @param {string} date - 日期
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 同步结果
 */
export async function syncLimitUpStockKline(date, options = {}) {
  try {
    // 先获取涨停池数据
    let limitUpStocks = [];
    try { limitUpStocks = await readStockDbLimitUp(date); } catch { limitUpStocks = []; }
    if (!limitUpStocks.length) limitUpStocks = marketDatabase.getLimitUpHistory(date);

    if (!limitUpStocks || limitUpStocks.length === 0) {
      console.log(`[涨停池K线同步] ${date} 无涨停股票`);
      return { success: true, count: 0 };
    }

    const codes = limitUpStocks.map(stock => stock.code);
    console.log(`[涨停池K线同步] ${date} 共 ${codes.length} 只涨停股票`);

    // 批量同步K线数据
    return await syncBatchStockKline(codes, options);

  } catch (error) {
    console.error('[涨停池K线同步] 失败:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 增量同步：同步最近N天的市场数据
 * @param {number} days - 天数
 * @returns {Promise<Array>} 同步结果数组
 */
export async function syncRecentDays(days = 7) {
  console.log(`[增量同步] 开始同步最近 ${days} 天数据...`);

  const results = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);

    console.log(`[增量同步] 同步 ${dateStr}...`);
    const result = await syncDailyMarketData(dateStr);
    results.push(result);

    // 延迟避免请求过快
    if (i < days - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[增量同步] 完成: ${successCount}/${days} 天`);

  return results;
}

/**
 * 从龙头股名称中提取股票代码（如果包含）
 * @param {string} leaderName - 龙头股名称
 * @returns {string|null} 股票代码
 */
function extractLeaderCode(leaderName) {
  if (!leaderName) return null;
  const match = leaderName.match(/\((\d{6})\)/);
  return match ? match[1] : null;
}

/**
 * 同步竞价数据
 * 注意：只在交易日 9:15-9:25 期间调用
 * @param {string} date - 日期 YYYY-MM-DD
 * @returns {Promise<Object>} 同步结果
 */
export async function syncAuctionData(date = null) {
  try {
    const syncDate = date || new Date().toISOString().slice(0, 10);
    console.log(`[竞价数据同步] 开始同步 ${syncDate}...`);

    // 获取竞价数据
    const auctionData = await fetchAuctionGainers(100);

    if (!auctionData || auctionData.length === 0) {
      console.log('[竞价数据同步] 无数据（可能不在竞价时间段）');
      return { success: true, count: 0, message: '无竞价数据' };
    }

    // 存储到数据库
    const insertData = auctionData.map(item => ({
      date: syncDate,
      code: item.code,
      name: item.name,
      auctionPrice: item.auctionPrice,
      auctionChangePct: item.auctionChangePct,
      auctionVolume: item.auctionVolume,
      auctionAmount: item.auctionAmount,
      prevClose: item.prevClose
    }));

    await writeStockDbAuction(insertData, { date: syncDate, source: 'eastmoney' });
    console.log(`[竞价数据同步] 完成: ${insertData.length} 只`);

    marketDatabase.logSync('auction', syncDate, insertData.length, 'success');

    return {
      success: true,
      date: syncDate,
      count: insertData.length
    };

  } catch (error) {
    console.error('[竞价数据同步] 失败:', error.message);
    marketDatabase.logSync('auction', date || 'today', 0, 'error', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  syncPostmarketPool,
  syncDailyMarketData,
  syncStockKline,
  syncBatchStockKline,
  syncLimitUpStockKline,
  syncRecentDays,
  syncAuctionData
};
