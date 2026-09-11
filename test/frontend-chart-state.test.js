import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../web/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function element() {
  const children = new Map(), classes = new Set();
  return {
    textContent: "", innerHTML: "", dataset: {}, style: {}, options: [],
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name), toggle: (name, active) => active ? classes.add(name) : classes.delete(name) },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); },
    querySelectorAll: () => [], addEventListener() {}, setAttribute() {}, insertAdjacentHTML() {}, before() {}, appendChild() {}, add() {}, showModal() {}, close() {}
  };
}

function harness(page) {
  const nodes = new Map(), calls = [], plots = new Map();
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const fetch = (url, options = {}) => { const call = { url: String(url), options, ...deferred() }; calls.push(call); return call.promise; };
  const context = vm.createContext({
    AbortController, URLSearchParams, Intl, Date, console, fetch,
    setTimeout() {}, setInterval() {}, clearTimeout() {},
    location: { search: "", pathname: "/" + page },
    localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, getElementById: get, createElement: element, querySelector: get, querySelectorAll: () => [], addEventListener() {} },
    echarts: { init(node) { const plot = { clear() { this.option = null; }, setOption(option) { this.option = option; }, resize() {}, on() {}, off() {} }; plots.set(node, plot); return plot; } },
    Split: () => ({ destroy() {}, setSizes() {} }),
    addEventListener(name, callback) { if (name === "DOMContentLoaded") callback(); },
    Option: function (text, value) { return { text, value }; }
  });
  context.window = context;
  vm.runInContext(read("chart-request.js"), context);
  vm.runInContext(read("kline-tooltip.js"), context);
  if (page) {
    const inline = [...read(page).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
    for (let source of inline) {
      if (page === "auction-monitor.html") {
        const end = source.lastIndexOf("});");
        source = source.slice(0, end) + "globalThis.pageApi={state,loadChart,loadIntraday,renderTable};\n" + source.slice(end);
      } else if (page === "limit-up-ladder.html") source += "\nglobalThis.pageApi={state,loadChart,loadIntraday,renderSectors,renderLadder};";
      else source += "\nglobalThis.pageApi={state,loadChart,loadIntraday};";
      vm.runInContext(source, context, { filename: page });
    }
  }
  const respond = (call, body) => call.resolve({ ok: true, status: 200, json: async () => body });
  return { context, nodes, calls, plots, get, respond };
}

test("latest request aborts superseded work and ignores a late response even when fetch ignores abort", async () => {
  const h = harness(), requests = h.context.ChartRequest.createLatestRequests();
  const values = [];
  const old = requests.run("stock", "/old", { success: body => values.push(body.value) });
  const latest = requests.run("stock", "/latest", { success: body => values.push(body.value) });
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.respond(h.calls[1], { value: "latest" }); await latest;
  h.respond(h.calls[0], { value: "old" }); await old;
  assert.deepEqual(values, ["latest"]);
});

test("identical in-flight requests share one fetch and cancelAll suppresses completion", async () => {
  const h = harness(), requests = h.context.ChartRequest.createLatestRequests();
  let applied = 0;
  const one = requests.run("stock", "/same", { success: () => applied++ });
  const two = requests.run("stock", "/same", { success: () => applied++ });
  assert.equal(h.calls.length, 1);
  requests.cancelAll(); h.respond(h.calls[0], { items: [] }); await Promise.all([one, two]);
  assert.equal(applied, 0);
});

test("stale request invocation cannot cancel the currently selected request", async () => {
  const h = harness(), requests = h.context.ChartRequest.createLatestRequests();
  let selected = "current", result;
  const current = requests.run("sector", "/current", { isCurrent: () => selected === "current", success: body => result = body });
  await requests.run("sector", "/old", { isCurrent: () => selected === "old" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.signal.aborted, false);
  h.respond(h.calls[0], { value: 1 }); await current;
  assert.equal(result.value, 1);
});

test("sorting keeps absent values last in both directions and preserves zero", () => {
  const compare = harness().context.ChartRequest.compare;
  const values = [null, 0, 10, "", -1, "--", undefined];
  assert.deepEqual(values.slice().sort((a,b) => compare(a,b,1)).slice(0,3), [-1,0,10]);
  assert.deepEqual(values.slice().sort((a,b) => compare(a,b,-1)).slice(0,3), [10,0,-1]);
});

test("K-line tooltip uses explicit previous close and never turns missing values into zero", () => {
  const format = harness().context.KlineTooltip.format;
  const text = format([{ date: "20260909", open: 11, close: 12, high: 12, low: 10, prevClose: 10, turnoverPct: null, changePct: null }], 0);
  assert.match(text, /开盘涨幅：\+10\.00%/);
  assert.match(text, /涨跌：\+20\.00%/);
  assert.match(text, /换手：--/);
  assert.match(format([{open:10,close:11}],0), /涨跌：--/);
});

test("连板天梯排序后会按当前显示顺序重编号概念和个股列表", () => {
  const ladder = read("limit-up-ladder.html");
  const sectorRender = ladder.slice(ladder.indexOf("function renderSectors"), ladder.indexOf("function toggleSort"));
  assert.match(sectorRender, /\.sort\([\s\S]*?\);\s*rows\.forEach\(\(row,index\)=>\{row\.rowNumber=index\+1\}\)/);
  // The ladder tables intentionally omit a row-number field; only the
  // concept table renders a sortable sequence column.
  assert.doesNotMatch(ladder.slice(ladder.indexOf("function renderLadder"), ladder.indexOf("function boardText")), /rowNumber/);
});

test("竞价工作台排序后会按当前显示顺序重编号概念和个股列表", () => {
  const auction = read("auction-monitor.html");
  const render = auction.slice(auction.indexOf("function renderTable"), auction.indexOf("async function loadDates"));
  assert.match(render, /\.sort\([\s\S]*?\);\s*rows\.forEach\(\(row,index\)=>\{row\.rowNumber=index\+1\}\)/);
});

test("市场管理两张表启用空值末尾排序器，序号列仍由当前显示行计算", () => {
  const market = read("market-management.html");
  assert.match(market, /function emptyLastSorter\(a, b\)/);
  assert.match(market, /def\.sorter \|\| emptyLastSorter/);
  assert.match(market, /function indexFormatter\(cell\)[\s\S]*?getRows\("display"\)/);
});

test("连板天梯概念表排序后实际渲染序号从1开始", () => {
  const h = harness("limit-up-ladder.html");
  const {state, renderSectors} = h.context.pageApi;
  state.sectors = [
    {code: "A", name: "低", changePct: 1, upCount: 1, downCount: 2, limitUpCount: 0},
    {code: "B", name: "高", changePct: 9, upCount: 2, downCount: 1, limitUpCount: 3}
  ];
  state.sectorSort = {key: "changePct", dir: -1};
  renderSectors();
  const html = h.get("sectorTable").querySelector("tbody").innerHTML;
  assert.match(html, /^<tr data-code="B"/);
  assert.match(html, /<td[^>]*>1<\/td>/);
});

test("竞价工作台概念表排序后实际渲染序号从1开始", () => {
  const h = harness("auction-monitor.html");
  const {state, renderTable} = h.context.pageApi;
  state.sort.sector = {key: "changePct", dir: -1};
  renderTable("sector", [
    {code: "A", name: "低", changePct: 1, upCount: 1, downCount: 2, limitUpCount: 0, limitDownCount: 0},
    {code: "B", name: "高", changePct: 9, upCount: 2, downCount: 1, limitUpCount: 3, limitDownCount: 0}
  ]);
  const html = h.get("sectorTable").querySelector("tbody").innerHTML;
  assert.match(html, /^<tr data-code="B"/);
  assert.match(html, /<td[^>]*>1<\/td>/);
});

for (const page of ["market-management.html", "limit-up-ladder.html", "auction-monitor.html"]) {
  test(`${page}: actual chart loader keeps the latest stock and sends selected date`, async () => {
    const h = harness(page), {state, loadChart} = h.context.pageApi;
    if (page === "market-management.html") { state.chartDate = "20260909"; state.selectedStock = {code:"000001"}; }
    else { state.date = "20260909"; state.stock = {code:"000001"}; }
    const first = loadChart("stock", "000001");
    if (page === "market-management.html") state.selectedStock = {code:"000002"}; else state.stock = {code:"000002"};
    const second = loadChart("stock", "000002");
    const calls = h.calls.filter(call => call.url.includes("stock-kline"));
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1].url,"http://local").searchParams.get("date"),"20260909");
    h.respond(calls[1], {items:[{date:"20260909",open:20,close:22,low:19,high:23}]}); await second;
    h.respond(calls[0], {items:[{date:"20260909",open:10,close:11,low:9,high:12}]}); await first;
    const plot = h.plots.get(h.get("stockChart"));
    assert.equal(plot.option.series[0].data[0][1],22);
  });

  test(`${page}: date-mismatched minute data is rejected and kind is explicit`, async () => {
    const h = harness(page), {state,loadIntraday} = h.context.pageApi;
    if (page === "market-management.html") { state.chartDate="20260909"; state.selectedSector={code:"880001.TI"}; }
    else { state.date="20260909"; state.sector={code:"880001.TI"}; }
    const pending = page === "auction-monitor.html" ? loadIntraday("sector","880001.TI") : loadIntraday("sector","880001.TI","20260909");
    const call = h.calls.find(call=>call.url.includes("/intraday?"));
    assert.equal(new URL(call.url,"http://local").searchParams.get("kind"),"sector");
    h.respond(call,{date:"20260908",items:[{time:"0930",price:10}]}); await pending;
    assert.equal(h.plots.get(h.get("sectorIntradayChart")).option,null);
    assert.match(h.get("sectorIntradayEmpty").textContent,/日期与当前选择不一致/);
  });
}
