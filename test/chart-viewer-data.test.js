import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../web/chart-viewer.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find(Boolean);

function harness() {
  const nodes = new Map();
  const plots = [];
  const calls = [];
  const node = () => ({
    value: "", style: {}, innerHTML: "", textContent: "",
    classList: { add() {}, remove() {} },
    addEventListener() {},
    parentElement: { style: {} }
  });
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const plot = {
    option: null,
    clear() { this.option = null; },
    setOption(option) { this.option = option; },
    resize() {}
  };
  plots.push(plot);
  const fetch = (url, options = {}) => {
    let resolve;
    const promise = new Promise((yes) => { resolve = yes; });
    const call = { url: String(url), options, resolve };
    calls.push(call);
    return promise;
  };
  const context = vm.createContext({
    AbortController, URLSearchParams, Date, console,
    document: {
      getElementById: get,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: node
    },
    echarts: {
      init: () => plot,
      graphic: { LinearGradient: class {} }
    },
    fetch,
    setTimeout() {}, setInterval() {}, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: "", pathname: "/chart-viewer.html" }
  });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(`${script}\nglobalThis.pageApi={renderTickChart,loadKlineData,cancelChartRequest};`, context);
  return { context, plot, get, calls };
}

test("分时保留09:30并过滤集合竞价、午休和收盘后数据", () => {
  const h = harness();
  h.context.pageApi.renderTickChart([
    { time: "09:25", price: 9, volume: 100, amount: 900 },
    { time: "09:30", price: 10, volume: 100, amount: 1000 },
    { time: "11:30", price: 11, volume: 100, amount: 1100 },
    { time: "12:00", price: 8, volume: 100, amount: 800 },
    { time: "13:00", price: 12, volume: 100, amount: 1200 },
    { time: "15:01", price: 13, volume: 100, amount: 1300 }
  ], "000001", "平安银行", 9);
  assert.deepEqual(h.plot.option.xAxis[0].data, ["09:30", "11:30", "13:00"]);
});

test("分时均价使用stockdb原始成交额/成交量，不把成交量当手数或用收盘价推导", () => {
  const h = harness();
  h.context.pageApi.renderTickChart([
    { time: "09:30", price: 10, volume: 2, amount: 100 },
    { time: "09:31", price: 20, volume: 1, amount: 50 }
  ], "000001", "", 10);
  const average = h.plot.option.series.find((series) => series.name === "均价");
  assert.deepEqual(average.data, [50, 50]);
});

test("板块明确average:null时即使有成分股成交额也不伪造均价线", () => {
  const h = harness();
  h.context.pageApi.renderTickChart([
    { time: "09:30", price: 10, volume: 2, amount: 100, average: null },
    { time: "09:31", price: 11, volume: 1, amount: 50, average: null }
  ], "309264.TI", "板块", null);
  assert.equal(h.plot.option.series.some((series) => series.name === "均价"), false);
});

test("取消图表请求会使请求令牌失效并清空旧图", () => {
  const h = harness();
  h.plot.option = { stale: true };
  h.context.pageApi.cancelChartRequest();
  assert.equal(h.plot.option, null);
});

test("实际个股加载入口中，切换股票会中止旧请求并忽略晚到图表响应", async () => {
  const h = harness();
  h.get("period").value = "daily";
  h.get("limit").value = "60";
  h.get("date").value = "2026-09-09";

  const oldLoad = h.context.pageApi.loadKlineData("000001");
  const latestLoad = h.context.pageApi.loadKlineData("000002");
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(new URL(h.calls[1].url, "http://local").searchParams.get("date"), "20260909");

  h.calls[1].resolve({ ok: true, status: 200, json: async () => ({
    ok: true, source: "stockdb", items: [{ date: "20260909", open: 20, close: 22, low: 19, high: 23, volume: 3 }]
  }) });
  await latestLoad;
  h.calls[0].resolve({ ok: true, status: 200, json: async () => ({
    ok: true, source: "stockdb", items: [{ date: "20260909", open: 10, close: 11, low: 9, high: 12, volume: 2 }]
  }) });
  await oldLoad;

  assert.equal(h.plot.option.title.text, "000002 - ");
  assert.equal(h.plot.option.series[0].data[0][1], 22);
  assert.match(h.get("dataNote").textContent, /stockdb/);
});

test("实际加载入口发送当前周期和日期，并显示板块来源元数据", async () => {
  const h = harness();
  h.get("period").value = "weekly";
  h.get("limit").value = "30";
  h.get("date").value = "2026-09-09";
  const weekly = h.context.pageApi.loadKlineData("000001");
  const weeklyUrl = new URL(h.calls[0].url, "http://local");
  assert.equal(weeklyUrl.searchParams.get("period"), "weekly");
  assert.equal(weeklyUrl.searchParams.get("date"), "20260909");
  h.calls[0].resolve({ ok: true, status: 200, json: async () => ({ ok: true, source: "stockdb", items: [{ date: "20260908", open: 10, close: 11, low: 9, high: 12, volume: 2 }] }) });
  await weekly;

  h.get("period").value = "daily";
  const sector = h.context.pageApi.loadKlineData("309264.TI", "测试板块");
  const sectorUrl = new URL(h.calls[1].url, "http://local");
  assert.equal(sectorUrl.searchParams.get("date"), "20260909");
  assert.equal(sectorUrl.searchParams.get("period"), "daily");
  h.calls[1].resolve({ ok: true, status: 200, json: async () => ({ ok: true, source: "stockdb .TI 原生板块行情", methodology: "stockdb .TI 原生K线", items: [{ date: "20260909", open: 1, close: 2, low: 1, high: 2, volume: 10 }] }) });
  await sector;
  assert.match(h.get("dataNote").textContent, /stockdb \.TI 原生板块行情/);
});

test("零成交分钟沿用上一有效累计VWAP", () => {
  const h = harness();
  h.context.pageApi.renderTickChart([
    { time: "09:30", price: 10, volume: 2, amount: 100 },
    { time: "09:31", price: 20, volume: 0, amount: 0 },
    { time: "09:32", price: 12, volume: 1, amount: 60 }
  ], "000001", "", 10);
  const average = h.plot.option.series.find((series) => series.name === "均价");
  assert.deepEqual(average.data, [50, 50, 160 / 3]);
});
