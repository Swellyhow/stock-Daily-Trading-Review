import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { fetchThsLimitUpPool } from "../src/lib/collector/ths-auto.js";
import { mergePostmarketLimitUpItem } from "../src/lib/collector/market-sync.js";

function poolResponse(info, date = "20260917") {
  return {
    status_code: 0,
    data: {
      date,
      page: { total: info.length },
      info
    }
  };
}

test("THS N-day/M-board labels stay aggregate metadata, never current boardCount", async (t) => {
  t.mock.method(axios, "get", async () => ({
    data: poolResponse([
      { code: "000980", name: "众泰汽车", high_days: "8天5板" },
      { code: "600001", name: "测试一", high_days: "4天3板" },
      { code: "600002", name: "测试二", high_days: "5天4板" },
      { code: "600003", name: "测试三", high_days: "首板" }
    ])
  }));

  const result = await fetchThsLimitUpPool({ date: "20260917", limit: 20, ttlMs: 0 });
  const byCode = new Map(result.items.map((item) => [item.code, item]));

  assert.equal(byCode.get("000980").highDays, "8天5板");
  assert.equal(byCode.get("000980").highDaysTotal, 5);
  assert.equal(byCode.get("000980").highDaysDays, 8);
  assert.equal(byCode.get("000980").periodBoardCount, 5);
  assert.equal(byCode.get("000980").highDaysValue, 5);
  assert.equal(byCode.get("600001").highDaysTotal, 3);
  assert.equal(byCode.get("600001").highDaysDays, 4);
  assert.equal(byCode.get("600002").highDaysTotal, 4);
  assert.equal(byCode.get("600002").highDaysDays, 5);
  assert.equal(byCode.get("600003").highDaysTotal, 1);

  // The THS response is only an aggregate activity label. A consecutive
  // streak must come from Eastmoney lbc or a verified day-to-day derivation.
  for (const item of byCode.values()) assert.equal(item.boardCount, undefined);
});

test("encoded THS high_days_value is retained as aggregate total, not boardCount", async (t) => {
  t.mock.method(axios, "get", async () => ({
    data: poolResponse([
      // THS encoding: (total boards << 16) | window days = (5 << 16) | 8.
      { code: "000980", name: "众泰汽车", high_days_value: (5 << 16) | 8 }
    ])
  }));

  const result = await fetchThsLimitUpPool({ date: "20260917", limit: 20, ttlMs: 0 });
  const item = result.items[0];
  assert.equal(item.highDaysTotal, 5);
  assert.equal(item.highDaysDays, 8);
  assert.equal(item.periodBoardCount, 5);
  assert.equal(item.highDaysValue, 5);
  assert.equal(item.boardCount, undefined);
});

test("postmarket merge uses Eastmoney lbc instead of THS rolling total", () => {
  const row = mergePostmarketLimitUpItem(
    { code: "000980", name: "众泰汽车", highDays: "8天5板", highDaysValue: 5, limitReason: "" },
    { code: "000980", boardCount: 1, stats: { days: 8, ct: 5 } },
    { code: "000980", boardCount: 5 }
  );
  assert.equal(row.boardCount, 1);
  assert.equal(row.boardCountSource, "eastmoney-lbc");
});
