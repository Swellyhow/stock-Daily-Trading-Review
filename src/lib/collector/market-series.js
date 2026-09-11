export function finiteNumber(value) {
  if (value == null || value === "" || value === "-") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function validPriceBar(row) {
  return [row.open, row.high, row.low, row.close].every(value => finiteNumber(value) > 0)
    && row.high + 1e-8 >= Math.max(row.open, row.close)
    && row.low - 1e-8 <= Math.min(row.open, row.close);
}

// The installed HTTP service traverses fwd ranges newest-first. num > 0
// keeps the newest records; a negative num takes the old end of the range.
export function stockDbTimeQuery({ minute, start, end, limit }) {
  const lower = start || "00000000";
  const upper = end || "99991231";
  return {
    key2: `fwd:${lower}${minute ? "000000" : ""},${upper}${minute ? "235959" : ""}`,
    num: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined
  };
}

function periodKey(stamp, frequency) {
  const day = String(stamp).slice(0, 8);
  if (frequency === "1M") return day.slice(0, 6);
  if (frequency === "1w") {
    const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }
  const minutes = Number(frequency.slice(0, -1));
  const time = Number(String(stamp).slice(8, 10)) * 60 + Number(String(stamp).slice(10, 12));
  if (time === 570 || time === 780) return `${day}:${time}`;
  const session = time <= 690 ? 570 : 780;
  if (time < 570 || (time > 690 && time < 780) || time > 900) return `${stamp}`;
  return `${day}:${session}:${Math.ceil((time - session) / minutes)}`;
}

export function aggregatePriceBars(rows, frequency = "1d") {
  const sorted = rows.filter(validPriceBar).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (["1d", "1m"].includes(frequency)) return sorted;
  const groups = new Map();
  for (const row of sorted) {
    const key = periodKey(row.date, frequency);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(group => {
    const first = group[0];
    const last = group.at(-1);
    const sum = field => {
      const values = group.map(row => finiteNumber(row[field]));
      return values.some(value => value === null) ? null : values.reduce((a, b) => a + b, 0);
    };
    const prevClose = finiteNumber(first.prevClose);
    const high = Math.max(...group.map(row => row.high));
    const low = Math.min(...group.map(row => row.low));
    return {
      ...last, date: last.date, open: first.open, high, low,
      prevClose, volume: sum("volume"), amount: sum("amount"), turnoverPct: sum("turnoverPct"),
      changePct: prevClose > 0 ? (last.close / prevClose - 1) * 100 : null,
      amplitudePct: prevClose > 0 ? (high - low) / prevClose * 100 : null
    };
  });
}
