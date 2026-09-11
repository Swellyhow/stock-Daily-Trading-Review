import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDurableScheduler, previousWeekday, shanghaiClock } from '../src/lib/collector/durable-scheduler.js';
import { isPublicFinalWindow, isPublicInitialWindow, isPostmarketPoolWindow, isReviewWindow, selectLatestVerifiedRow, verifyStockDbPublicDate } from '../src/lib/collector/market-scheduler.js';

test('Shanghai cutoff and weekend catchup do not use the host timezone', () => {
  assert.deepEqual(shanghaiClock(new Date('2026-09-09T07:50:00Z')), { date: '20260909', minute: 950, weekday: 3 });
  assert.equal(previousWeekday(new Date('2026-09-09T01:00:00Z')), '20260908');
  assert.equal(previousWeekday(new Date('2026-09-09T07:50:00Z')), '20260909');
  assert.equal(previousWeekday(new Date('2026-09-07T00:00:00Z')), '20260904');
});

test('post-market jobs stay out of the trading session and do not overlap updater windows', () => {
  const at1550 = new Date('2026-09-09T07:50:00Z'); // 15:50 Shanghai
  const at1600 = new Date('2026-09-09T08:00:00Z'); // 16:00 Shanghai
  const at0030 = new Date('2026-09-08T16:30:00Z'); // 00:30 Shanghai next day
  const at0900 = new Date('2026-09-09T01:00:00Z'); // 09:00 Shanghai
  assert.equal(isPublicInitialWindow(at1550), true);
  assert.equal(isPublicFinalWindow(at1550), false);
  assert.equal(isPostmarketPoolWindow(at1550), true);
  assert.equal(isReviewWindow(at1550), false);
  assert.equal(isPublicFinalWindow(at0030), true);
  assert.equal(isPublicInitialWindow(at0030), false);
  assert.equal(isPublicInitialWindow(new Date('2026-09-09T08:10:00Z')), true); // 16:10
  assert.equal(isPublicFinalWindow(new Date('2026-09-09T08:10:00Z')), false);
  assert.equal(isPostmarketPoolWindow(at0900), false);
  assert.equal(isReviewWindow(at0900), false);
  assert.equal(isReviewWindow(at1600), true);
});

test('failures retry, completed dates survive restart, and interrupted dates resume', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'postmarket-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'state.json');
  let calls = 0;
  let date = new Date('2026-09-09T08:00:00Z');
  const jobs = [{ name: 'pool', dates: async () => ['20260909'], run: async () => ++calls === 1 ? { ok: false, warning: 'Not published' } : { success: true } }];
  const make = () => createDurableScheduler({ statePath, jobs, now: () => date, retryMs: 60000 });
  const first = make();
  await first.tick();
  assert.equal(first.status().jobs['pool:20260909'].status, 'failed');
  await first.tick();
  assert.equal(calls, 1);
  date = new Date(date.getTime() + 60000);
  await first.tick();
  assert.equal(calls, 2);
  assert.equal(first.status().jobs['pool:20260909'].status, 'completed');
  await make().tick();
  assert.equal(calls, 2);
  const state = JSON.parse(fs.readFileSync(statePath));
  state.jobs['pool:20260909'] = { status: 'running', attempt: 2 };
  fs.writeFileSync(statePath, JSON.stringify(state));
  await make().tick();
  assert.equal(calls, 3);
});

test('durable completion reconciles an externally completed job before stale retry backoff', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'postmarket-reconcile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, jobs: {
    'review:20260909': { name: 'review', date: '20260909', status: 'failed', retryAt: '2099-01-01T00:00:00.000Z', attempt: 4 }
  }}));
  let runs = 0;
  const scheduler = createDurableScheduler({
    statePath,
    jobs: [{ name: 'review', dates: async () => ['20260909'], isComplete: async () => ({ ok: true, count: 2 }), run: async () => { runs++; return { success: true }; } }]
  });
  await scheduler.tick();
  assert.equal(runs, 0);
  assert.equal(scheduler.status().jobs['review:20260909'].status, 'completed');
  assert.equal(scheduler.status().jobs['review:20260909'].result.reconciled, true);
});

test('a slow public updater cannot block independent pool and review jobs or overlap itself', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'postmarket-parallel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let release;
  let publicCalls = 0;
  let finalCalls = 0;
  let privateCalls = 0;
  const publicWait = new Promise((resolve) => { release = resolve; });
  const scheduler = createDurableScheduler({
    statePath: path.join(directory, 'state.json'),
    jobs: [
      { name: 'public', resource: 'stockdb-public', dates: async () => ['20260909'], run: async () => { publicCalls++; await publicWait; return { success: true }; } },
      { name: 'public-final', resource: 'stockdb-public', dates: async () => ['20260909'], run: async () => { finalCalls++; return { success: true }; } },
      { name: 'pool', dates: async () => ['20260909'], run: async () => { privateCalls++; return { success: true }; } }
    ]
  });
  const first = scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(privateCalls, 1);
  await scheduler.tick();
  assert.equal(publicCalls, 1);
  assert.equal(finalCalls, 0);
  release();
  await first;
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(finalCalls, 1);
});

test('trading-session gate prevents updater launch', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'postmarket-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const scheduler = createDurableScheduler({ statePath: path.join(directory, 'state.json'), jobs: [{ name: 'public', allowed: () => false, dates: async () => ['20260908'], run: async () => { calls++; return { success: true }; } }] });
  await scheduler.tick();
  assert.equal(calls, 0);
});

test('public-data verification uses the latest valid minute row for the requested date', () => {
  const raw = [[
    { date: 20260909150000, close: 11.70 },
    { date: 20260909093000, close: 11.76 },
    { date: 20260909145900, close: 11.71 },
    { date: 20260908150000, close: 11.80 },
    { date: 20260909150100, close: 0 }
  ]];
  assert.deepEqual(selectLatestVerifiedRow(raw, '20260909'), { date: 20260909150000, close: 11.70 });
  assert.equal(selectLatestVerifiedRow([{ date: 20260908150000, close: 11.8 }], '20260909'), null);
});

test('public-data verification queries complete exact-day minute data without truncation', async () => {
  const checked = await verifyStockDbPublicDate('20260909', {
    fetchImpl: async (url) => {
      const minute = url.searchParams.get('t') === '分钟k';
      assert.equal(url.searchParams.get('k2'), minute ? 'qz:20260909' : 'key:20260909');
      assert.equal(url.searchParams.has('num'), false);
      return { ok: true, json: async () => minute
        ? [{ date: 20260909093000, close: 11.76 }, { date: 20260909150000, close: 11.70 }]
        : [{ date: 20260909, close: 11.70 }] };
    }
  });
  assert.equal(checked.length, 8);
  assert.ok(checked.filter((row) => row.table === '分钟k').every((row) => row.date === 20260909150000));
});

test('public-data verification rejects minute data before close', async () => {
  await assert.rejects(verifyStockDbPublicDate('20260909', {
    fetchImpl: async (url) => ({ ok: true, json: async () => [{ date: url.searchParams.get('t') === '分钟k' ? 20260909145900 : 20260909, close: 11.70 }] })
  }), /尚未更新至收盘/);
});
