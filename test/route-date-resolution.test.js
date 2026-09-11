import test from "node:test";
import assert from "node:assert/strict";
import { resolveStockDbDate as resolveAuctionDate } from "../web/auction-management-routes.js";
import { resolveStockDbDate as resolveMarketDate } from "../web/market-management-routes.js";

for (const [name, resolve] of [["auction", resolveAuctionDate], ["market", resolveMarketDate]]) {
  test(`${name} route uses latest stockdb trading date when date is omitted`, async () => {
    let calls = 0;
    const date = await resolve("", async (code, limit) => {
      calls += 1;
      assert.equal(code, "000001");
      assert.equal(limit, 1);
      return ["2026-09-08", "2026-09-07"];
    });
    assert.equal(date, "20260908");
    assert.equal(calls, 1);
  });

  test(`${name} route preserves an explicitly requested trading date`, async () => {
    let called = false;
    const date = await resolve("2026-09-02", async () => {
      called = true;
      return ["20260908"];
    });
    assert.equal(date, "20260902");
    assert.equal(called, false);
  });

  test(`${name} route rejects an empty stockdb trading calendar`, async () => {
    await assert.rejects(() => resolve("", async () => []), /没有可用交易日/);
  });
}
