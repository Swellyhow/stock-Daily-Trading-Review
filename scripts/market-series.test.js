import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePriceBars, finiteNumber, stockDbTimeQuery } from "../src/lib/collector/market-series.js";

const bar = (date, open, close, extra = {}) => ({ date, code: "000001", open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, prevClose: open - 1, volume: 100, amount: 1000, turnoverPct: 1, ...extra });

test("range queries use newest-first positive limits and concrete bounds", () => {
  assert.deepEqual(stockDbTimeQuery({ end: "20260908", limit: 3 }), { key2: "fwd:00000000,20260908", num: 3 });
  assert.deepEqual(stockDbTimeQuery({ minute: true, start: "20260908", end: "20260908", limit: 3 }), { key2: "fwd:20260908000000,20260908235959", num: 3 });
});

test("unknown values remain null and real zero remains zero", () => {
  for (const value of [null, undefined, "", "-", "bad"]) assert.equal(finiteNumber(value), null);
  assert.equal(finiteNumber(0), 0);
});

test("weekly bars use Shanghai calendar days, not prior UTC days", () => {
  const rows = [bar("20260831", 11, 12), bar("20260904", 12, 13), bar("20260907", 14, 15), bar("20260908", 15, 16)];
  const result = aggregatePriceBars(rows, "1w");
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(row => [row.date, row.open, row.close, row.volume]), [["20260904", 11, 13, 200], ["20260908", 14, 16, 200]]);
  assert.equal(result[0].changePct, 30.000000000000004);
});

test("monthly bars retain a valid full date and preserve unavailable volume", () => {
  const rows = [bar("20260831", 11, 12), bar("20260901", 12, 13), bar("20260908", 13, 14, { volume: null })];
  const result = aggregatePriceBars(rows, "1M");
  assert.deepEqual(result.map(row => row.date), ["20260831", "20260908"]);
  assert.equal(result[1].volume, null);
});

test("invalid OHLC rows cannot turn into zero-price candles", () => {
  assert.equal(aggregatePriceBars([bar("20260908", 10, 11), bar("20260907", 10, 11, { high: 1 }), bar("20260906", 0, 0)]).length, 1);
});

test("five-minute bars use trading sessions and never combine lunch break", () => {
  const result = aggregatePriceBars([bar("20260908112900", 10, 11), bar("20260908113000", 11, 12), bar("20260908130000", 12, 13), bar("20260908130100", 13, 14)], "5m");
  assert.deepEqual(result.map(row => row.volume), [200, 100, 100]);
});
