import assert from "node:assert/strict";
import { fetchStockDbKline } from "../src/lib/collector/stockdb-client.js";

const date = process.argv[2] || "20260908";
const fields = { open: "open", high: "high", low: "low", close: "close", volume: "volume", amount: "amount", prevClose: "pre_close", changePct: "pct_chg" };
async function raw(table, code, day) {
  const url = new URL(process.env.STOCKDB_URL || "http://127.0.0.1:7899");
  for (const [key, value] of Object.entries({ cmd: "vals", t: table, k1: `key:${code}`, k2: table === "日k" ? `key:${day}` : `qz:${day}` })) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  return response.json();
}
for (const code of ["000001", "600519", "300750", "688981", "920001"]) {
  const original = await raw("日k", code, date);
  if (!original.length) { console.log(JSON.stringify({ code, date, skipped: "no raw daily record" })); continue; }
  const started = performance.now();
  const rows = await fetchStockDbKline(code, { end: date, limit: 20, force: true });
  assert.equal(rows.at(-1).date, date);
  for (const [key, source] of Object.entries(fields)) assert.equal(rows.at(-1)[key], original[0][source]);
  const minutes = await raw("分钟k", code, date);
  const actualMinutes = await fetchStockDbKline(code, { frequency: "1m", start: date, end: date, force: true });
  assert.equal(actualMinutes.length, minutes.length);
  const byTime = new Map(minutes.map(row => [String(row.date), row]));
  for (const row of actualMinutes) for (const key of ["open", "high", "low", "close", "volume", "amount"]) assert.equal(row[key], byTime.get(row.date)[key]);
  const sameEnd = await fetchStockDbKline(code, { start: "20260101", end: date, limit: 20 });
  assert.deepEqual(sameEnd, rows);
  console.log(JSON.stringify({ code, date, daily: rows.length, minutes: actualMinutes.length, rawEquality: true, elapsedMs: Math.round(performance.now() - started) }));
}
