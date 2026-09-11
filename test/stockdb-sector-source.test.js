import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

test(".TI board reads reject colliding stock codes and invalid returned identities", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const requestedCodes = [];
  globalThis.fetch = async (input) => {
    requestedCodes.push(new URL(String(input)).searchParams.get("k1"));
    return new Response(JSON.stringify(["300843", "300843.invalid"].map(code => ({
      code, name: "stock, not a board", date: "20260909",
      open: 127, high: 128.22, low: 123.77, close: 124.61
    }))));
  };
  const { fetchStockDbKline } = await import("../src/lib/collector/stockdb-client.js");
  const rows = await fetchStockDbKline("300843.TI", { end: "20260909", force: true });
  assert.deepEqual(rows, []);
  assert.deepEqual(requestedCodes, ["key:300843.TI"]);
});

test("daily snapshots preserve native .TI identity for board list statistics", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("cmd") === "keys") return new Response(JSON.stringify(["日k:000001:20260909"]));
    return new Response(JSON.stringify([{
      code: "309264.TI", date: "20260909", open: 100, high: 103, low: 99,
      close: 102, pre_close: 100, pct_chg: 2
    }]));
  };
  const { fetchStockDbConceptBoards } = await import("../src/lib/collector/stockdb-client.js");
  const result = await fetchStockDbConceptBoards({ date: "20260909", force: true });
  const board = result.items.find(row => row.code === "309264.TI");
  assert.equal(board.latestPrice, 102);
  assert.equal(board.changePct, 2);
  assert.equal(board.quoteQuality, "native");
});

test("板块 K 线优先使用 stockdb 已提供的 .TI 原生行情", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const table = url.searchParams.get("t");
    const code = url.searchParams.get("k1");
    if (url.searchParams.get("cmd") === "vals" && table === "日k" && code === "key:309264.TI") {
      return new Response(JSON.stringify([{
        code: "309264.TI", name: "测试概念", date: "20260909",
        open: 100, high: 103, low: 99, close: 102, volume: 123, amount: 456,
        pre_close: 101, pct_chg: 0.99
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };

  const { fetchStockDbSectorKline, describeStockDbSectorSeries } = await import("../src/lib/collector/stockdb-client.js");
  const rows = await fetchStockDbSectorKline("309264.TI", {
    frequency: "1d", start: "20260909", end: "20260909", force: true
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].close, 102);
  assert.equal(rows[0].quoteQuality, "native");
  assert.equal(rows[0].source, "stockdb .TI 原生板块行情");
  assert.deepEqual(describeStockDbSectorSeries(rows), {
    source: "stockdb .TI 原生板块行情",
    dataQuality: "native",
    methodology: "stockdb .TI 原生K线",
    warning: undefined
  });
  assert.deepEqual(describeStockDbSectorSeries([{ quoteQuality: "constituent-index" }], { intraday: true }), {
    source: "stockdb zhishu 成分股合成指数",
    dataQuality: "constituent-index",
    methodology: "stockdb zhishu method=1 等权成分股指数",
    warning: "板块分时为按成分股计算的合成指数，并非 .TI 原生分时"
  });
});

test("市场管理板块接口把原生 .TI K线标记为 native", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const command = url.searchParams.get("cmd");
    const table = url.searchParams.get("t");
    const code = url.searchParams.get("k1");
    if (command === "keys" && table === "日k:000001:*") {
      return new Response(JSON.stringify(["日k:000001:20260909"]), { status: 200 });
    }
    if (command === "vals" && code === "key:309264.TI") {
      const minute = table === "分钟k";
      return new Response(JSON.stringify([{
        code: "309264.TI", name: "测试概念", date: minute ? "20260909093000" : "20260909",
        open: 100, high: 103, low: 99, close: 102, volume: 123, amount: 456,
        pre_close: 101, pct_chg: 0.99
      }]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };

  const { default: routes } = await import("../web/market-management-routes.js");
  const app = express();
  app.use(routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const kline = await (await originalFetch(`${base}/api/market-management/sector-kline?code=309264.TI&date=20260909&period=daily&limit=20&force=1`)).json();
  const intraday = await (await originalFetch(`${base}/api/market-management/intraday?code=309264.TI&date=20260909&kind=sector`)).json();
  for (const payload of [kline, intraday]) {
    assert.equal(payload.source, "stockdb .TI 原生板块行情");
    assert.equal(payload.dataQuality, "native");
    assert.equal(payload.warning, undefined);
  }
  assert.equal(kline.methodology, "stockdb .TI 原生K线");
  assert.equal(intraday.methodology, "stockdb .TI 原生1分钟K");
});
