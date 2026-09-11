import assert from "node:assert/strict";
import test from "node:test";
import { mergeLimitUpReviewReasons } from "../src/lib/collector/ths-review.js";

test("partial review retries retain prior detailed reasons and replace refreshed rows", () => {
  const rows = mergeLimitUpReviewReasons(
    [
      { code: "000001", reason: "previous reason" },
      { code: "000002", reason: "retained reason" }
    ],
    [
      { code: "000001", reason: "refreshed reason" },
      { code: "000003", reason: "new reason" }
    ],
    new Set(["000001", "000002", "000003"])
  );
  assert.deepEqual(rows.map((row) => [row.code, row.reason]), [
    ["000001", "refreshed reason"],
    ["000002", "retained reason"],
    ["000003", "new reason"]
  ]);
});

test("review merge rejects missing reasons and codes outside the official pool", () => {
  const rows = mergeLimitUpReviewReasons(
    [{ code: "000001", reason: "valid" }, { code: "000099", reason: "stale" }],
    [{ code: "000002", reason: "" }, { code: "000003", reason: "outside" }],
    new Set(["000001", "000002"])
  );
  assert.deepEqual(rows, [{ code: "000001", reason: "valid" }]);
});
