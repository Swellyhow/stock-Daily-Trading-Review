import test from "node:test";
import assert from "node:assert/strict";
import { enrichStocksWithLimitUpMetadata } from "../web/market-management-routes.js";

test("stock list enrichment uses THS membership and only siliconflow review details", async () => {
  const result = await enrichStocksWithLimitUpMetadata([
    { code: "601999", name: "出版传媒", limitUp: false, limitReason: "旧标签", limitReasonDetail: "不可信旧明细" },
    { code: "002285", name: "世联行", limitUp: true, limitReason: "过期标签", limitReasonDetail: "也不可信" }
  ], "20260908", {
    fetchPool: async () => ({ date: "20260908", items: [{ code: "601999", limitReason: "文化传媒" }] }),
    readReasons: async () => [
      { code: "601999", reason: "出版传媒受政策催化", extractedBy: "siliconflow" },
      { code: "002285", reason: "旧的段落回退", extractedBy: "article-text" }
    ]
  });

  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => ({ code: item.code, limitUp: item.limitUp, limitReason: item.limitReason, limitReasonDetail: item.limitReasonDetail })), [
    { code: "601999", limitUp: true, limitReason: "文化传媒", limitReasonDetail: "出版传媒受政策催化" },
    { code: "002285", limitUp: false, limitReason: "", limitReasonDetail: "" }
  ]);
});

test("stock list enrichment preserves quote rows when optional sources fail", async () => {
  const result = await enrichStocksWithLimitUpMetadata([
    { code: "601999", name: "出版传媒", latestPrice: 8.5, limitUp: true, limitReason: "已有标签", limitReasonDetail: "旧明细" }
  ], "20260908", {
    fetchPool: async () => { throw new Error("pool offline"); },
    readReasons: async () => { throw new Error("review offline"); }
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].latestPrice, 8.5);
  assert.equal(result.items[0].limitUp, true);
  assert.equal(result.items[0].limitReason, "已有标签");
  assert.equal(result.items[0].limitReasonDetail, "");
  assert.equal(result.warnings.length, 2);
});
