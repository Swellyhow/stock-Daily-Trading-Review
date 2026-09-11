import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import marketSync from './market-sync.js';
import marketDatabase from './market-database.js';
import { fetchAndStoreThsDailyLimitUpReview } from './ths-review.js';
import { readStockDbLimitUpReviewStatus } from './stockdb-client.js';
import { fetchStockDbTradingDates } from './stockdb-client.js';
import { createDurableScheduler, shanghaiClock, previousWeekday, readSchedulerState } from './durable-scheduler.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schedulerStatePath = path.join(projectRoot, 'data/runtime/postmarket-state.json');
let automaticScheduler = null;

export async function dailySyncTask(date = shanghaiClock().date) {
  const marketData = await marketSync.syncPostmarketPool(date);
  return { success: marketData.success, date, marketData, errors: marketData.success ? [] : [marketData.error] };
}

export async function auctionSyncTask() {
  return marketSync.syncAuctionData();
}

export async function incrementalSyncTask(days = 7) {
  const clock = shanghaiClock();
  const dates = (await fetchStockDbTradingDates('000001', days + 1)).filter((date) => date < clock.date || (date === clock.date && clock.minute >= 930)).slice(0, days);
  const results = [];
  for (const date of dates) results.push(await dailySyncTask(date));
  const successCount = results.filter((result) => result.success).length;
  return { success: successCount === dates.length, total: dates.length, successCount, results };
}

export async function maintenanceTask() {
  try {
    marketDatabase.db.exec('VACUUM');
    return { success: true, stockCount: marketDatabase.getStockCount() };
  } catch (error) { return { success: false, error: error.message }; }
}

export function getAutomaticSyncStatus() {
  return { enabled: !!automaticScheduler, timeZone: 'Asia/Shanghai', schedule: { publicClose: '15:50', publicFinalCheck: '00:30', pool: '15:30', review: '16:00', retries: '15m/30m/1h/2h/4h', catchupTradingDays: 7 }, ...readSchedulerState(schedulerStatePath), running: automaticScheduler?.status().running || false };
}

export function getSyncStatus() {
  return {
    lastSync: Object.fromEntries(['stockdb_public', 'limit_up', 'limit_down', 'sector', 'index', 'stock_kline', 'auction'].map((type) => [type, marketDatabase.getLastSyncDate(type)])),
    database: { stockCount: marketDatabase.getStockCount(), tradingDates: marketDatabase.getTradingDates(5) },
    automatic: getAutomaticSyncStatus()
  };
}

export async function reviewSyncTask(date = shanghaiClock().date) {
  try {
    const result = await fetchAndStoreThsDailyLimitUpReview(date);
    if (result.ok !== true && result.success !== true) throw new Error(result.warning || result.error || '涨停复盘未完成');
    return { ...result, success: true, date };
  } catch (error) { return { success: false, date, error: error.message }; }
}

export function selectLatestVerifiedRow(raw, date) {
  const rows = Array.isArray(raw)
    ? raw.flat(2).filter((value) => value && typeof value === 'object')
    : raw && typeof raw === 'object' ? [raw] : [];
  return rows
    .filter((value) => String(value?.date).slice(0, 8) === date && Number(value?.close) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

export async function verifyStockDbPublicDate(date, { fetchImpl = fetch, baseUrl = process.env.STOCKDB_URL || 'http://127.0.0.1:7899' } = {}) {
  const checked = [];
  for (const code of ['000001', '600000', '300750', '688001']) {
    for (const table of ['日k', '分钟k']) {
      const url = new URL(baseUrl);
      url.searchParams.set('cmd', 'vals');
      url.searchParams.set('t', table);
      url.searchParams.set('k1', `key:${code}`);
      // qz selects the day; num=-1 would truncate it to the oldest bar.
      url.searchParams.set('k2', table === '日k' ? `key:${date}` : `qz:${date}`);
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`stockdb verification HTTP ${response.status}`);
      const raw = await response.json();
      const row = selectLatestVerifiedRow(raw, date);
      if (!row) throw new Error(`公共行情更新后，数据库尚不能读取 ${date} ${table}；等待上游发布或数据库重新加载。`);
      if (table === '分钟k' && String(row.date).slice(8, 12) < '1500') throw new Error(`${code} ${date} 分钟K尚未更新至收盘，最新时间 ${row.date}`);
      checked.push({ table, code, date: row.date, close: Number(row.close) });
    }
  }
  return checked;
}

export async function publicDataSyncTask(date) {
  if (process.platform !== 'win32') return { success: false, date, error: 'stockdb public updater requires Windows' };
  const script = path.join(projectRoot, 'scripts/update-stockdb.ps1');
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Date', date], { cwd: projectRoot, windowsHide: true });
    let errorText = '';
    child.stdout.on('data', (data) => console.log(String(data).trim()));
    child.stderr.on('data', (data) => { errorText = (errorText + data).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(errorText || `Updater exited ${code}`)));
  });
  // Download completion does not prove the running database has loaded new bars.
  const checked = await verifyStockDbPublicDate(date);
  marketDatabase.logSync('stockdb_public', date, checked.length, 'success');
  return { success: true, date, checked };
}

export function stopScheduler() {
  automaticScheduler?.stop();
  automaticScheduler = null;
}

// Scheduler windows use Shanghai minutes so the host timezone cannot move a
// post-market job into the trading session.  The overnight window belongs to
// the previous trading date and is handled by the final public-data check.
export function isPublicInitialWindow(now) {
  const clock = shanghaiClock(now);
  // The first updater runs after close.  At 00:30 the final-check job takes
  // over, so the two jobs never target the same date concurrently.
  return clock.minute >= 950;
}

export function isPublicFinalWindow(now) {
  const clock = shanghaiClock(now);
  // The overnight final check follows the initial post-close window on every
  // calendar day, including a Friday snapshot checked early Saturday.
  return clock.minute >= 30 && clock.minute < 540;
}

export function isPostmarketPoolWindow(now) {
  const clock = shanghaiClock(now);
  return [0, 6].includes(clock.weekday) || clock.minute < 540 || clock.minute >= 930;
}

export function isReviewWindow(now) {
  const clock = shanghaiClock(now);
  return [0, 6].includes(clock.weekday) || clock.minute < 540 || clock.minute >= 960;
}

export function startScheduler(schedule = {}) {
  stopScheduler();
  const completedDates = async (now, minute) => {
    const clock = shanghaiClock(now);
    const dates = (await fetchStockDbTradingDates('000001', 10)).filter((date) => date < clock.date || (date === clock.date && clock.minute >= minute));
    // The pool/review may be published before the downloadable daily database.
    // The provider's exact-date check rejects holidays and premature responses.
    if (![0, 6].includes(clock.weekday) && clock.minute >= minute) dates.unshift(clock.date);
    return [...new Set(dates)].slice(0, 7);
  };
  automaticScheduler = createDurableScheduler({
    statePath: schedulerStatePath,
    jobs: [
      ...(schedule.enableDailySync === false ? [] : [{ name: 'public-market-data', resource: 'stockdb-public', allowed: isPublicInitialWindow, dates: async (now) => [previousWeekday(now)], run: publicDataSyncTask }]),
      ...(schedule.enableDailySync === false ? [] : [{ name: 'public-market-data-final', resource: 'stockdb-public', allowed: isPublicFinalWindow, dates: async (now) => [previousWeekday(now, 1440)], run: publicDataSyncTask }]),
      ...(schedule.enableDailySync === false ? [] : [{ name: 'limit-up-pool', allowed: isPostmarketPoolWindow, dates: (now) => completedDates(now, 930), run: dailySyncTask }]),
      ...(schedule.enableReviewSync === false ? [] : [{
        name: 'limit-up-review',
        allowed: isReviewWindow,
        dates: (now) => completedDates(now, 960),
        isComplete: async (date) => {
          const status = await readStockDbLimitUpReviewStatus(date);
          return status?.status === 'completed' && (!Number.isFinite(Number(status.expectedCount)) || Number(status.count) >= Number(status.expectedCount))
            ? { ok: true, date, count: Number(status.count), expectedCount: Number(status.expectedCount), missingCount: Number(status.missingCount || 0) }
            : false;
        },
        run: reviewSyncTask
      }])
    ]
  });
  automaticScheduler.start();
  console.log('[自动盘后更新] 15:50 后同步公共行情；涨停池和详细原因自动补跑，失败退避重试。');
  return { dailySyncTask, auctionSyncTask, reviewSyncTask, incrementalSyncTask, maintenanceTask, getSyncStatus };
}

export default { dailySyncTask, auctionSyncTask, reviewSyncTask, incrementalSyncTask, maintenanceTask, getSyncStatus, getAutomaticSyncStatus, startScheduler, stopScheduler };
