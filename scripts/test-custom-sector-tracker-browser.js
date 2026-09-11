import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, extname } from 'node:path';

const playwrightPath = process.env.TRACKER_PLAYWRIGHT;
const { chromium } = playwrightPath ? await import(pathToFileURL(join(playwrightPath, 'index.mjs')).href) : await import('playwright');
const root = fileURLToPath(new URL('../web/', import.meta.url));
const dates = ['20260824', '20260825', '20260826', '20260827', '20260828', '20260831', '20260901', '20260902', '20260903', '20260904', '20260907', '20260908'];
const requestLog = [];
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = join(root, path.slice(1) || 'custom-sector-tracker.html');
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const boardRows = [{ code: '309265.TI', name: '季报预增', changePct: 2.5 }, { code: '308000.TI', name: '机器人', changePct: -1 }];
const stockRows = [{ code: '603893', name: '瑞芯微', changePct: 10, turnoverPct: 6 }, { code: '000001', name: '平安银行', changePct: -1 }];
async function setup(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requestLog.push({ method: route.request().method(), path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const date = url.searchParams.get('date'), sector = url.searchParams.get('sector');
    let body = { ok: true, date, items: [] };
    if (url.pathname.endsWith('/trading-dates')) body = { ok: true, dates: [...dates].reverse() };
    if (url.pathname.endsWith('/sectors')) body.items = boardRows.map(row => ({ ...row, date, changePct: date === '20260907' ? 7.5 : row.changePct }));
    if (url.pathname.endsWith('/stocks') || url.pathname.endsWith('/stock-search')) body = { ...body, sector, items: stockRows.map(row => ({ ...row, date })) };
    if (url.pathname.endsWith('/stock-details') || url.pathname.endsWith('/limit-up-ladder')) {
      await new Promise(resolve => setTimeout(resolve, 100));
      body.items = [{ ...stockRows[0], date, boardCount: 3, limitTypes: [{ label: '深T板', evidence: ['verified'] }], limitTypeStatus: 'confirmed', limitReason: '芯片', limitReasonDetail: '选定交易日的详细涨停原因' }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  await setup(page);
  await page.goto(`${base}/custom-sector-tracker.html`);
  await page.waitForFunction(() => document.querySelectorAll('#dateList button').length === 12);
  assert.equal(await page.locator('#boardTable tbody tr[data-id]').count(), 0);
  assert.equal(await page.locator('#dateList .active span').textContent(), '2026-09-08');
  const visibleDates = await page.locator('#dateList').evaluate(element => [...element.children].filter(child => { const r = child.getBoundingClientRect(), p = element.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; }).length);
  assert.equal(visibleDates, 10);
  await page.getByRole('button', { name: '管理天数标签', exact: true }).click();
  await page.locator('#tagInput').fill('3天');
  await page.locator('#tagForm').getByRole('button', { name: '新增', exact: true }).click();
  await page.locator('#doneTags').click();
  console.log('Verified calendar and tags');
  await page.locator('#addBoard').click();
  await page.locator('#entityPicker').fill('季报');
  await page.getByRole('button', { name: '季报预增 309265.TI' }).click();
  await page.locator('#entityTag').selectOption('3天');
  assert.equal(await page.locator('#auto-code').inputValue(), '309265.TI');
  assert.equal(await page.locator('#auto-changePct').inputValue(), '2.5');
  assert.equal(await page.locator('#auto-changePct').getAttribute('readonly'), '');
  await page.locator('#entityForm').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#boardTable tr[data-id]').length === 1);
  console.log('Verified board linking');
  await page.locator('#addStock').click();
  await page.locator('#entityPicker').fill('603893');
  await page.getByRole('button', { name: '瑞芯微 603893' }).click();
  await page.waitForFunction(() => document.getElementById('auto-limitTypes').value === '深T板');
  assert.equal(await page.locator('#auto-limitReasonDetail').inputValue(), '选定交易日的详细涨停原因');
  await page.locator('#entityForm').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#stockTable tbody').textContent.includes('深T板'));
  console.log('Verified stock linking');
  await page.locator('#stockTable [data-reason]').click();
  assert.equal(await page.locator('#reasonCopy').textContent(), '选定交易日的详细涨停原因');
  await page.locator('#doneReason').click();
  await page.locator('#dateList [data-date="20260907"]').click();
  assert.equal(await page.locator('#boardTable tbody tr[data-id]').count(), 0);
  await page.locator('#copyPrevious').click();
  assert.equal(await page.locator('#boardTable tbody tr[data-id]').count(), 0);
  await page.locator('#addBoard').click();
  await page.locator('#entityPicker').fill('季报预增');
  await page.waitForFunction(() => document.getElementById('auto-changePct').value === '7.5');
  await page.locator('#entityForm').getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('#dateList [data-date="20260908"]').click();
  await page.waitForFunction(() => document.querySelector('#boardTable tbody').textContent.includes('+2.50%'));
  await page.locator('#addBoard').click();
  await page.locator('#entityPicker').fill('手动观察板块');
  await page.locator('#entityForm').getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('#addStock').click();
  await page.locator('#entityPicker').fill('手动观察个股');
  await page.locator('#entityForm').getByRole('button', { name: '保存', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('custom-sector-tracker:v1')));
  assert.equal(saved.boards.find(row => row.name === '手动观察板块').code, '');
  assert.equal(saved.stocks.find(row => row.name === '手动观察个股').code, '');
  assert(saved.tags.includes('3天'));
  assert(saved.stocks.some(row => row.name === '瑞芯微' && Array.isArray(row.limitTypes)));
  assert(requestLog.every(request => request.method === 'GET'));
  assert(requestLog.filter(request => !request.path.endsWith('/trading-dates')).every(request => dates.includes(request.query.date)));
  await page.locator('#boardTable [data-sort="changePct"]').click();
  assert.equal(await page.locator('#boardTable th[aria-sort="ascending"]').count(), 1);
  await page.screenshot({ path: join(process.env.TEMP || '.', 'custom-sector-tracker-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(process.env.TEMP || '.', 'custom-sector-tracker-mobile.png'), fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#boardTable tr[data-id]').length === 2);
  const racePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  racePage.setDefaultTimeout(8000);
  await setup(racePage);
  await racePage.addInitScript(() => localStorage.setItem('custom-sector-tracker:v1', JSON.stringify({
    tags: ['3天'],
    boards: [{ id: 'a', date: '20260908', code: '309265.TI', name: '季报预增', direction: 'up', changePct: 999 }, { id: 'b', date: '20260908', code: '308000.TI', name: '机器人', direction: 'up' }, { id: 'old', date: '20260907', code: '309265.TI', name: '季报预增', direction: 'up' }, { id: 'sample', date: '20260908', name: '旧示例', sample: true, changePct: 999 }], stocks: []
  })));
  let releaseMembers, memberRequested;
  const memberStarted = new Promise(resolve => { memberRequested = resolve; });
  const memberGate = new Promise(resolve => { releaseMembers = resolve; });
  await racePage.route('**/api/market-management/stocks?**', async route => {
    const url = new URL(route.request().url()), sector = url.searchParams.get('sector');
    if (sector === '309265.TI') { memberRequested(); await memberGate; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, date: '20260908', sector, items: sector === '309265.TI' ? [stockRows[0]] : [stockRows[1]] }) });
  });
  await racePage.goto(`${base}/custom-sector-tracker.html`);
  await racePage.waitForFunction(() => document.querySelectorAll('#boardTable tr[data-id]').length === 2);
  assert.equal(await racePage.locator('#boardTable').getByText('旧示例').count(), 0);
  assert.equal(await racePage.evaluate(() => JSON.parse(localStorage.getItem('custom-sector-tracker:v1:before-v2')).boards[0].changePct), 999);
  await racePage.locator('#addStock').click();
  await memberStarted;
  await racePage.locator('#entityBoardSelect').selectOption('b');
  await racePage.getByRole('button', { name: '平安银行 000001' }).waitFor();
  const oldResponse = racePage.waitForResponse(response => response.url().includes('/stocks?') && response.url().includes('309265.TI'));
  releaseMembers();
  await oldResponse;
  await racePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await racePage.getByRole('button', { name: '瑞芯微 603893' }).count(), 0);
  await racePage.getByRole('button', { name: '平安银行 000001' }).click();
  assert.equal(await racePage.locator('#auto-code').inputValue(), '000001');
  await racePage.locator('#cancelEntity').click();
  let releaseHistorical, historicalRequested;
  const historicalStarted = new Promise(resolve => { historicalRequested = resolve; });
  const historicalGate = new Promise(resolve => { releaseHistorical = resolve; });
  await racePage.route('**/api/market-management/sectors?**', async route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    if (date === '20260907') { historicalRequested(); await historicalGate; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, date, items: boardRows.map(row => ({ ...row, changePct: date === '20260907' ? 888 : row.changePct })) }) });
  });
  await racePage.locator('#dateList [data-date="20260907"]').click();
  await historicalStarted;
  await racePage.locator('#dateList [data-date="20260908"]').click();
  const historicalResponse = racePage.waitForResponse(response => response.url().includes('/sectors?date=20260907'));
  releaseHistorical();
  await historicalResponse;
  await racePage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await racePage.locator('#dateList .active span').textContent(), '2026-09-08');
  assert.equal(await racePage.locator('#boardTable').getByText('+888.00%').count(), 0);
  const raceSaved = await racePage.evaluate(() => JSON.parse(localStorage.getItem('custom-sector-tracker:v1')));
  assert.equal(raceSaved.boards.find(row => row.id === 'old').changePct, undefined);
  assert(raceSaved.boards.some(row => row.id === 'sample'));
  assert.deepEqual(errors, []);
  console.log('Tracker browser workflow passed: calendar, 10 visible dates, empty initial list, custom tags, dated board and stock linking, detailed reasons, readonly quotes, manual names, persistence, sorting, mobile sizing, GET-only API access, legacy backup, hidden sample quotes, and out-of-order board/date responses.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
