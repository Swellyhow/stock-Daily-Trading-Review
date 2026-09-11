export const STORAGE_KEY = 'custom-sector-tracker:v1';
export const fields = [
  { key: 'code', label: '代码' }, { key: 'name', label: '名称' },
  { key: 'boardCount', label: '连板' }, { key: 'changePct', label: '涨幅' },
  { key: 'auctionChangePct', label: '竞价涨幅' }, { key: 'turnoverPct', label: '换手' },
  { key: 'firstLimitTime', label: '首次涨停时间' }, { key: 'lastLimitTime', label: '最终涨停时间' },
  { key: 'sealAmount', label: '封单金额' }, { key: 'limitAmount', label: '涨停成交金额' },
  { key: 'circulatingMarketCap', label: '流通市值' }, { key: 'limitTypes', label: '涨停类型' },
  { key: 'limitReason', label: '涨停原因标签' }, { key: 'limitReasonDetail', label: '涨停详细原因' },
  { key: 'marketType', label: '上市板块' }, { key: 'industry', label: '所属行业' }
];
export const numericFields = new Set(['boardCount', 'changePct', 'auctionChangePct', 'turnoverPct', 'sealAmount', 'limitAmount', 'circulatingMarketCap']);
const quoteKeys = fields.map(field => field.key).filter(key => !['code', 'name'].includes(key));
const detailKeys = new Set(['limitReason', 'limitReasonDetail', 'limitTypes', 'firstLimitTime', 'lastLimitTime', 'marketType', 'industry']);
export const normalizeDate = value => String(value || '').replace(/-/g, '').slice(0, 8);
export const normalizeCode = value => String(value || '').trim().toUpperCase();
export const searchText = value => String(value ?? '').replace(/[\s\u3000]/g, '').toLocaleLowerCase();
export const validDate = value => /^\d{8}$/.test(normalizeDate(value));
export const isConceptCode = value => /^[A-Z0-9]+\.TI$/.test(normalizeCode(value));
export const numberValue = value => value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function typeText(value) {
  if (Array.isArray(value)) return value.map(typeText).filter(Boolean).join('、');
  if (value && typeof value === 'object') return String(value.label || value.name || value.typeCode || '');
  const text = String(value ?? '').trim();
  return text.includes('[object Object]') ? '' : text;
}
export function calendarDates(values) {
  return [...new Set((values || []).filter(validDate).map(normalizeDate))].sort();
}
export function checkPayload(payload, date, sector = '') {
  if (payload?.ok === false) throw new Error(payload.error || '行情读取失败');
  if (normalizeDate(payload?.date) !== date) throw new Error(`返回交易日 ${payload?.date || '未知'} 与 ${date} 不一致`);
  if (sector && payload.sector && normalizeCode(payload.sector) !== normalizeCode(sector)) throw new Error('返回板块与当前选择不一致');
  if (!Array.isArray(payload?.items)) throw new Error('行情数据格式无效');
  if (payload.items.some(row => row.date && normalizeDate(row.date) !== date)) throw new Error('行情中混入其他交易日数据');
  return payload.items;
}
export function quoteValid(row) {
  return row.quoteDate === row.date && row.quoteCode === normalizeCode(row.code) && !row.sample;
}
export function displayRow(row) {
  if (quoteValid(row)) return row;
  return { ...row, ...Object.fromEntries(quoteKeys.map(key => [key, null])) };
}
export function mergeQuote(row, incoming, date) {
  if (!incoming || row.date !== date || normalizeCode(row.code) !== normalizeCode(incoming.code) || (incoming.date && normalizeDate(incoming.date) !== date)) return row;
  const result = { ...row };
  const sameQuote = quoteValid(row);
  if (!sameQuote) for (const key of quoteKeys) result[key] = null;
  for (const key of quoteKeys) {
    if (!Object.hasOwn(incoming, key)) continue;
    const value = incoming[key];
    if (detailKeys.has(key) && (!typeText(value) || value === null)) {
      if (key === 'limitTypes' && ['confirmed', 'not_applicable', 'touched'].includes(incoming.limitTypeStatus)) result[key] = [];
      continue;
    }
    result[key] = numericFields.has(key) ? numberValue(value) : value;
  }
  if (incoming.limitTypeStatus) result.limitTypeStatus = incoming.limitTypeStatus;
  return { ...result, quoteDate: date, quoteCode: normalizeCode(row.code), quoteUpdatedAt: new Date().toISOString(), quoteStatus: 'current', sample: false };
}
export function catalogMatch(items, input) {
  const value = searchText(input);
  if (!value) return null;
  return items.find(row => searchText(row.name) === value || searchText(row.code) === value) || null;
}
export function sortRows(rows, key, direction) {
  return [...rows].sort((a, b) => {
    const av = numericFields.has(key) ? numberValue(a[key]) : typeText(a[key]);
    const bv = numericFields.has(key) ? numberValue(b[key]) : typeText(b[key]);
    const aEmpty = av === null || av === '', bEmpty = bv === null || bv === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    return (typeof av === 'number' ? av - bv : av.localeCompare(bv, 'zh-CN', { numeric: true })) * direction;
  });
}
export function readSavedData(value) {
  if (value === null) return { tags: [], boards: [], stocks: [] };
  const data = JSON.parse(value);
  if (!data || !Array.isArray(data.boards) || !Array.isArray(data.stocks)) throw new Error('本页保存的数据格式异常，原始数据已保留');
  return {
    tags: Array.isArray(data.tags) ? [...new Set(data.tags.filter(tag => typeof tag === 'string' && tag.trim()))] : [],
    boards: data.boards, stocks: data.stocks,
    tradingDates: calendarDates(data.tradingDates), version: data.version
  };
}
export function makeEntity({ kind, original, selected, name, date, id, direction, dayTag, boardId }) {
  const sameEntity = original && original.date === date && (selected ? normalizeCode(selected.code) === normalizeCode(original.code) : name.trim() === original.name);
  const result = sameEntity ? { ...original } : { id, date, name: name.trim(), code: selected ? normalizeCode(selected.code) : '', sample: false };
  result.name = selected?.name || name.trim();
  if (kind === 'board') { result.direction = direction; result.dayTag = dayTag; }
  else result.boardId = boardId;
  return selected ? mergeQuote(result, selected, date) : result;
}
