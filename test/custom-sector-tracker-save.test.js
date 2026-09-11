import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as trackerModel from '../web/custom-sector-tracker-model.js';

const trackerSource = fs.readFileSync(new URL('../web/custom-sector-tracker.js', import.meta.url), 'utf8');
const bootstrapStart = trackerSource.indexOf("\n$('datePrev').onclick");

function exactLookupHarness(responder, { failPersist = false } = {}) {
  const requests = [];
  const source = trackerSource
    .slice(0, bootstrapStart)
    .replace(/^import .+?;\r?\n/, 'const { STORAGE_KEY, fields, numericFields, normalizeDate, normalizeCode, calendarDates, checkPayload, quoteValid, displayRow, mergeQuote, typeText, numberValue, catalogMatch, searchText, sortRows, readSavedData, makeEntity, isConceptCode } = trackerModel;\n')
    + '\nglobalThis.trackerApi = { exactEntryCode, resolveExactEntry, persistTags, state };';
  const toast = { textContent: '', classList: { toggle() {}, remove() {}, add() {} } };
  const context = vm.createContext({
    trackerModel, AbortSignal, URLSearchParams, Date, console,
    clearTimeout() {}, setTimeout() { return 0; },
    localStorage: { setItem() { if (failPersist) throw new Error('storage full'); } },
    document: { getElementById: () => toast },
    fetch: async (url) => {
      requests.push(String(url));
      return { ok: true, status: 200, json: async () => responder(String(url)) };
    }
  });
  vm.runInContext(source, context, { filename: 'custom-sector-tracker.js' });
  return { api: context.trackerApi, requests };
}

test('exact board and stock codes resolve before a picker catalog is available', async () => {
  const h = exactLookupHarness(url => {
    if (url.includes('/sectors?')) return { ok: true, date: '20260909', items: [{ code: '309265.TI', name: '机器人概念' }] };
    if (url.includes('/stock-search?')) return { ok: true, date: '20260909', items: [{ code: '000001', name: '平安银行' }] };
    throw new Error(`unexpected request: ${url}`);
  });

  const board = { kind: 'board', date: '20260909', catalog: [] };
  assert.equal((await h.api.resolveExactEntry(board, '309265.ti')).name, '机器人概念');
  assert.equal(board.catalog[0].code, '309265.TI');

  const stock = { kind: 'stock', date: '20260909', boardId: '', catalog: [] };
  assert.equal((await h.api.resolveExactEntry(stock, '000001')).name, '平安银行');
  assert.match(h.requests.at(-1), /codes=000001/);
});

test('free-text entries remain manual and do not trigger an exact-code lookup', async () => {
  const h = exactLookupHarness(() => { throw new Error('manual input must not request a lookup'); });
  assert.equal(h.api.exactEntryCode('board', '自定义观察板块'), '');
  assert.equal(h.api.exactEntryCode('stock', '自定义个股名称'), '');
  assert.equal(await h.api.resolveExactEntry({ kind: 'stock', date: '20260909', catalog: [] }, '自定义个股名称'), null);
  assert.deepEqual(h.requests, []);
});

test('tag mutations roll back their tag, board, and selected-filter state when persistence fails', () => {
  const h = exactLookupHarness(() => ({ ok: true, date: '20260909', items: [] }), { failPersist: true });
  Object.assign(h.api.state, {
    tags: ['二板'],
    boards: [{ id: 'board-1', dayTag: '二板' }],
    tag: '二板'
  });
  const saved = h.api.persistTags({
    tags: ['三板'],
    boards: [{ id: 'board-1', dayTag: '三板' }],
    tag: '三板'
  });
  assert.equal(saved, false);
  assert.equal(JSON.stringify(h.api.state.tags), JSON.stringify(['二板']));
  assert.equal(JSON.stringify(h.api.state.boards), JSON.stringify([{ id: 'board-1', dayTag: '二板' }]));
  assert.equal(h.api.state.tag, '二板');
});
