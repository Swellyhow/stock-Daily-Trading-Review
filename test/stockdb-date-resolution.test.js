import test from "node:test";
import assert from "node:assert/strict";
import { resolveStockDbDate } from "../web/auction-management-routes.js";

test("无日期时使用 stockdb 最新交易日", async () => {
  const date = await resolveStockDbDate("", async () => ["20260908"]);
  assert.equal(date, "20260908");
});

test("显式日期保持用户选择，不被最新交易日覆盖", async () => {
  const date = await resolveStockDbDate("2026-09-07", async () => ["20260908"]);
  assert.equal(date, "20260907");
});

test("stockdb 无交易日时明确失败", async () => {
  await assert.rejects(() => resolveStockDbDate("", async () => []), /没有可用交易日/);
});
