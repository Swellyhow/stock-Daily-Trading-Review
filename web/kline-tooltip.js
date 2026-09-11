(function (global) {
  function finite(value) {
    if (value == null || (typeof value === "string" && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function price(value) {
    const number = finite(value);
    return number == null ? "--" : number.toFixed(2);
  }

  function percent(value) {
    const number = finite(value);
    return number == null ? "--" : `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
  }

  function compactNumber(value) {
    const number = finite(value);
    if (number == null) return "--";
    const trim = (text) => text.replace(/\.0+$|(?<=\.\d)0+$/, "");
    if (Math.abs(number) >= 100000000) return `${trim((number / 100000000).toFixed(2))}亿`;
    if (Math.abs(number) >= 10000) return `${trim((number / 10000).toFixed(1))}万`;
    return number.toLocaleString("zh-CN");
  }

  function date(value) {
    const text = String(value ?? "");
    return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text || "--";
  }

  function formatKlineTooltip(items, index) {
    const rows = Array.isArray(items) ? items : [];
    const item = rows[index] || {};
    const previousClose = finite(item.prevClose ?? item.previousClose ?? item.preClose) ?? finite(rows[index - 1]?.close);
    const open = finite(item.open);
    const openingChange = previousClose && previousClose > 0 && open != null
      ? ((open - previousClose) / previousClose) * 100
      : null;
    const base = previousClose && previousClose > 0 ? previousClose : null;
    const close = finite(item.close);
    const high = finite(item.high);
    const low = finite(item.low);
    const change = finite(item.changePct) ?? (base && base > 0 && close != null ? ((close - base) / base) * 100 : null);
    const amplitude = finite(item.amplitudePct ?? item.amplitude) ?? (base && base > 0 && high != null && low != null ? ((high - low) / base) * 100 : null);
    const turnover = finite(item.turnoverPct);
    return [
      `<strong>${date(item.date)}</strong>`,
      `开盘：${price(item.open)}`,
      `最高：${price(item.high)}`,
      `最低：${price(item.low)}`,
      `收盘：${price(item.close)}`,
      `涨跌：${percent(change)}`,
      `振幅：${amplitude == null ? "--" : `${amplitude.toFixed(2)}%`}`,
      `成交量：${compactNumber(item.volume)}`,
      `成交额：${compactNumber(item.amount)}`,
      `换手：${turnover == null ? "--" : `${turnover.toFixed(2)}%`}`,
      `开盘涨幅：${percent(openingChange)}`
    ].join("<br>");
  }

  global.KlineTooltip = Object.freeze({ format: formatKlineTooltip });
})(window);
