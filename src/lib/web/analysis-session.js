function pad(value) {
  return String(value).padStart(2, "0");
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateKey(dateKey, hour = 0, minute = 0) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function addDays(dateKey, offset) {
  const date = fromDateKey(dateKey, 12, 0);
  date.setDate(date.getDate() + offset);
  return toDateKey(date);
}

export function isTradingDay(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey ?? ""))) {
    return false;
  }
  const day = fromDateKey(dateKey, 12, 0).getDay();
  return day !== 0 && day !== 6;
}

export function nextTradingDayOnOrAfter(dateKey) {
  let cursor = String(dateKey);
  while (!isTradingDay(cursor)) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

export function previousTradingDayOnOrBefore(dateKey) {
  let cursor = String(dateKey);
  while (!isTradingDay(cursor)) {
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

export function resolveAnalysisSession(now = new Date()) {
  const todayKey = toDateKey(now);
  const nextTradingDate = nextTradingDayOnOrAfter(todayKey);
  const nextOpen = fromDateKey(nextTradingDate, 9, 30);
  const premarketWindowStart = new Date(nextOpen.getTime() - 10 * 60 * 60 * 1000);
  const marketOpen = isTradingDay(todayKey) ? fromDateKey(todayKey, 9, 30) : null;
  const marketClose = isTradingDay(todayKey) ? fromDateKey(todayKey, 15, 0) : null;
  const isDuringTradingHours = Boolean(marketOpen && marketClose && now >= marketOpen && now < marketClose);
  const isAfterCloseToday = Boolean(marketClose && now >= marketClose);

  if (now >= premarketWindowStart && now < nextOpen) {
    return {
      now: now.toISOString(),
      analysisType: "premarket",
      targetTradeDate: nextTradingDate,
      referenceTradeDate: previousTradingDayOnOrBefore(addDays(nextTradingDate, -1)),
      sessionLabel: `${nextTradingDate} 盘前分析`,
      summary: `距离 ${nextTradingDate} 开盘不足 10 小时，默认按盘前分析处理。`,
      windowStart: premarketWindowStart.toISOString(),
      openingTime: nextOpen.toISOString(),
      manualIntradaySuggested: false,
      manualIntradayMessage: null
    };
  }

  const latestClosedTradingDate = isAfterCloseToday
    ? todayKey
    : previousTradingDayOnOrBefore(isTradingDay(todayKey) ? addDays(todayKey, -1) : todayKey);

  return {
    now: now.toISOString(),
    analysisType: "postmarket",
    targetTradeDate: latestClosedTradingDate,
    referenceTradeDate: latestClosedTradingDate,
    sessionLabel: `${latestClosedTradingDate} 盘后复盘`,
    summary: `当前不在盘前 10 小时窗口内，默认展示上一个已完成交易日的盘后分析。`,
    windowStart: premarketWindowStart.toISOString(),
    openingTime: nextOpen.toISOString(),
    manualIntradaySuggested: isDuringTradingHours,
    manualIntradayMessage: isDuringTradingHours
      ? "当前处于交易时段，如需跟踪分时结构，请手动运行盘中分析。"
      : null
  };
}
