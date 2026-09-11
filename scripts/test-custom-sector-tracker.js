import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDates, checkPayload, displayRow, mergeQuote, readSavedData, makeEntity, sortRows, typeText, catalogMatch } from '../web/custom-sector-tracker-model.js';

test('calendar uses actual service dates without adding weekends or speculative today', () => {
  assert.deepEqual(calendarDates(['20260904', '2026-09-03', '20260904', null, 'invalid']), ['20260903', '20260904']);
});
test('historical responses and entities from another date cannot contaminate quotes', () => {
  assert.throws(() => checkPayload({ ok: true, date: '20260909', items: [] }, '20260904'), /不一致/);
  assert.throws(() => checkPayload({ ok: true, date: '20260904', items: [{ date: '20260909' }] }, '20260904'), /其他交易日/);
  const row = { id: 'a', date: '20260904', code: '000001', changePct: 1 };
  assert.strictEqual(mergeQuote(row, { code: '000002', changePct: 8 }, '20260904'), row);
  assert.strictEqual(mergeQuote(row, { code: '000001', date: '20260909', changePct: 8 }, '20260904'), row);
});
test('legacy data is preserved but unverified market values are not displayed as current', () => {
  const data = { boards: [{ id: 'a', date: '20260904', code: '123.TI', changePct: 99 }], stocks: [], tags: ['3天'] };
  const saved = readSavedData(JSON.stringify(data));
  assert.equal(saved.boards[0].changePct, 99);
  assert.equal(displayRow(saved.boards[0]).changePct, null);
  assert.deepEqual(readSavedData(null), { tags: [], boards: [], stocks: [] });
  assert.throws(() => readSavedData('{invalid'));
});
test('same-entity refresh preserves valid optional details but represents missing numeric quotes as null', () => {
  const first = mergeQuote({ id: 'a', date: '20260904', code: '000001', dayTag: '3天' }, { code: '000001', changePct: 2, limitReasonDetail: 'Verified detail', limitTypes: [{ label: '深T板' }], limitTypeStatus: 'confirmed' }, '20260904');
  const next = mergeQuote(first, { code: '000001', changePct: null, limitReasonDetail: '', limitTypes: [], limitTypeStatus: 'unavailable' }, '20260904');
  assert.equal(next.limitReasonDetail, 'Verified detail');
  assert.equal(typeText(next.limitTypes), '深T板');
  assert.equal(next.changePct, null);
  assert.equal(next.dayTag, '3天');
  assert.equal(displayRow(next).limitReasonDetail, 'Verified detail');
  const confirmedEmpty = mergeQuote(next, { code: '000001', limitTypes: [], limitTypeStatus: 'confirmed' }, '20260904');
  assert.deepEqual(confirmedEmpty.limitTypes, []);
});
test('renaming to a manual entity clears quotes and never carries old code over', () => {
  const original = mergeQuote({ id: 'a', date: '20260904', code: '000001', name: 'Old' }, { code: '000001', changePct: 10 }, '20260904');
  const next = makeEntity({ kind: 'stock', original, selected: null, name: 'Manual', date: original.date, id: original.id, boardId: 'b' });
  assert.equal(next.code, '');
  assert.equal(next.changePct, undefined);
  assert.equal(next.boardId, 'b');
  const unchanged = makeEntity({ kind: 'stock', original, selected: null, name: 'Old', date: original.date, id: original.id, boardId: 'c' });
  assert.equal(unchanged.changePct, 10);
});
test('searching by code and switching entity preserves the canonical name and isolation', () => {
  const catalog = [{ code: '000001', name: '平安银行', changePct: 1 }];
  const selected = catalogMatch(catalog, '000001');
  const row = makeEntity({ kind: 'stock', selected, name: '000001', date: '20260904', id: 'a', boardId: 'b' });
  assert.equal(row.name, '平安银行');
  assert.equal(row.code, '000001');
  assert.equal(row.quoteDate, '20260904');
});
test('sorting treats unknown numbers consistently and renders project-defined type objects', () => {
  const rows = [{ changePct: -1 }, { changePct: null }, { changePct: 0 }, { changePct: 10 }];
  assert.deepEqual(sortRows(rows, 'changePct', -1).map(row => row.changePct), [10, 0, -1, null]);
  assert.deepEqual(sortRows(rows, 'changePct', 1).map(row => row.changePct), [-1, 0, 10, null]);
  assert.equal(typeText([{ label: '一字板', evidence: ['data'] }, { label: '深T板' }]), '一字板、深T板');
  assert.equal(typeText('[object Object]'), '');
});
