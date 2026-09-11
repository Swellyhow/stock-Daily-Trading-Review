import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import searchRoutes from "./search-routes.js";
import auctionLiveRoutes from "./auction-live-routes.js";
import marketManagementRoutes from "./market-management-routes.js";
import keyManagementRoutes from "./key-management-routes.js";
import auctionManagementRoutes from "./auction-management-routes.js";
import cmesRoutes from "./cmes-routes.js";
import { handleRawDataRequest } from "./raw-data-routes.js";
import {
  handleKlineRequest,
  handleLimitUpHistoryRequest,
  handleLimitDownHistoryRequest,
  handleSectorHistoryRequest,
  handleIndexHistoryRequest,
  handleAuctionDataRequest,
  handleTradingDatesRequest,
  handleSyncStatusRequest
} from "./history-routes.js";
import { fetchStockDbKline, fetchStockDbStockIntraday } from "../src/lib/collector/stockdb-client.js";
import { startScheduler, getAutomaticSyncStatus } from "../src/lib/collector/market-scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;
app.use(express.json({ limit: "128kb" }));

app.get('/api/operations/status', (_req, res) => {
  const readRuntime = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../data/runtime', name), 'utf8')); } catch { return null; }
  };
  const service = readRuntime('service-state.json');
  res.json({
    ok: true,
    time: new Date().toISOString(),
    automatic: getAutomaticSyncStatus(),
    service: service ? { ...service, heartbeatFresh: Date.now() - Date.parse(service.checkedAt || '') < 90000 } : null,
    desired: readRuntime('service-enabled.json')
  });
});

// 数据库连接
const db = new Database(path.join(__dirname, '../src/data/market.db'));

// 实时K线数据API（支持分时）- 放在最前面
app.get('/api/kline', async (req, res) => {
  try {
    const { code, period = 'daily', limit = 100 } = req.query;

    if (!code) {
      return res.status(400).json({ error: '缺少股票代码参数' });
    }

    // stockdb is the canonical local source for daily/minute bars. Minute
    // history is retention-limited in fetchStockDbKline; never fall back to a
    // remote provider for that path or an old request could bypass the policy.
    const frequency = period === 'daily' ? '1d' : period === 'weekly' ? '1w' : period === 'monthly' ? '1M' : period === 'minute' ? '1m' : period;
    const isMinute = ['1m', '5m', '15m', '30m', '60m', '1min', '5min', '15min', '30min', '60min'].includes(String(frequency));
    const data = await fetchStockDbKline(code, { frequency, limit: Math.min(2000, Math.max(1, parseInt(limit) || 100)), start: req.query.start, end: req.query.end || req.query.date });

    // 如果API返回数据，直接返回
    if (data && data.length > 0) {
      return res.json(data);
    }

    // 没有数据
    res.json([]);
  } catch (error) {
    console.error('[K线API] 错误:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use(express.static(__dirname));
app.use(searchRoutes);
app.use(auctionLiveRoutes);
app.use(marketManagementRoutes);
app.use(keyManagementRoutes);
app.use(auctionManagementRoutes);
app.use(cmesRoutes);

// 原始数据API
app.get('/api/raw-data', async (req, res) => {
  await handleRawDataRequest(req, res);
});

// 历史数据API
app.get('/api/history/kline', async (req, res) => {
  await handleKlineRequest(req, res);
});

app.get('/api/history/limit-up', async (req, res) => {
  await handleLimitUpHistoryRequest(req, res);
});

app.get('/api/history/limit-down', async (req, res) => {
  await handleLimitDownHistoryRequest(req, res);
});

app.get('/api/history/sector', async (req, res) => {
  await handleSectorHistoryRequest(req, res);
});

app.get('/api/history/index', async (req, res) => {
  await handleIndexHistoryRequest(req, res);
});

app.get('/api/history/auction', async (req, res) => {
  await handleAuctionDataRequest(req, res);
});

app.get('/api/history/trading-dates', async (req, res) => {
  await handleTradingDatesRequest(req, res);
});

app.get('/api/history/sync-status', async (req, res) => {
  await handleSyncStatusRequest(req, res);
});

// Legacy tick-compatible endpoint. The product's charting contract is the
// local stockdb minute series; do not let an older caller quietly fall back to
// a remote Tick source with different availability and values.
app.get('/api/tick', async (req, res) => {
  try {
    const { code, date } = req.query;

    if (!code) {
      return res.status(400).json({ error: '缺少股票代码参数' });
    }

    const payload = await fetchStockDbStockIntraday(code, date, { timeoutMs: 30000 });
    // Keep this endpoint's historical array shape for older consumers. Times
    // include seconds because the original client filters continuous auction
    // data with values such as 09:30:00.
    res.json(payload.items.map((item) => ({
      ...item,
      time: /^\d{2}:\d{2}$/.test(String(item.time)) ? `${item.time}:00` : item.time,
      preClose: payload.preClose
    })));
  } catch (error) {
    console.error('[Tick数据API] 错误:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: err.message, stack: err.stack });
});

app.listen(port, () => {
  startScheduler({ dailySyncTimes: ["15:30", "17:00"], reviewSyncTimes: ["16:00"] });
  console.log(`Search server running at http://localhost:${port}`);
  console.log(`- 新闻搜索: http://localhost:${port}/search.html`);
  console.log(`- 新闻列表: http://localhost:${port}/news-list.html`);
  console.log(`- 原始数据: http://localhost:${port}/data-viewer.html`);
  console.log(`- 历史数据: http://localhost:${port}/history-viewer.html`);
  console.log(`- K线图表: http://localhost:${port}/chart-viewer.html`);
  console.log(`- 竞价监控: http://localhost:${port}/auction-monitor.html`);
  console.log(`- 市场管理: http://localhost:${port}/market-management.html`);
  console.log(`\nAPI端点:`);
  console.log(`- 实时数据: /api/raw-data`);
  console.log(`- K线数据: /api/kline?code=000001&period=daily&limit=100`);
  console.log(`- K线历史: /api/history/kline?code=000001&limit=100`);
  console.log(`- 涨停池历史: /api/history/limit-up?date=2026-04-26`);
  console.log(`- 板块历史: /api/history/sector?date=2026-04-26`);
  console.log(`- 同步状态: /api/history/sync-status`);
});
