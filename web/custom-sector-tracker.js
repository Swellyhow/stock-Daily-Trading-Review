import { STORAGE_KEY, fields, numericFields, normalizeDate, normalizeCode, calendarDates, checkPayload, quoteValid, displayRow, mergeQuote, typeText, numberValue, catalogMatch, searchText, sortRows, readSavedData, makeEntity, isConceptCode } from './custom-sector-tracker-model.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const dateText = value => value ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : '--';
const uid = () => `local-${crypto.randomUUID()}`;
const state = { dates: [], date: '', tags: [], boards: [], stocks: [], direction: 'all', tag: 'all', selectedBoard: null, selectedStock: null, editing: null, generation: 0, loading: false, writable: true, sort: { board: { key: 'changePct', dir: -1 }, stock: { key: 'changePct', dir: -1 } } };
const cache = new Map();
let calendarPromise;

function toast(message, error = false) {
  const element = $('toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 5000);
}
function persist() {
  if (!state.writable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, tags: state.tags, boards: state.boards, stocks: state.stocks, tradingDates: state.dates }));
    return true;
  } catch {
    toast('本页清单未能保存，请导出备份并检查浏览器存储空间', true);
    return false;
  }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = readSavedData(raw);
    if (raw && saved.version !== 2 && !localStorage.getItem(`${STORAGE_KEY}:before-v2`)) localStorage.setItem(`${STORAGE_KEY}:before-v2`, raw);
    state.tags = saved.tags;
    state.boards = saved.boards;
    state.stocks = saved.stocks;
    state.dates = calendarDates([...(saved.tradingDates || []), ...saved.boards.filter(row => !row.sample).map(row => row.date)]);
  } catch (error) {
    state.writable = false;
    toast(error.message || '本地清单读取失败，原始数据已保留', true);
  }
}
async function requestJSON(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || body.warning || `数据读取失败 (${response.status})`);
  return body;
}
function cachedRequest(key, loader, force = false) {
  const previous = cache.get(key);
  if (previous?.promise) return previous.promise;
  if (!force && previous && Date.now() - previous.time < 60000) return Promise.resolve(previous.value);
  const entry = { promise: null };
  entry.promise = loader().then(value => {
    if (cache.get(key) === entry) cache.set(key, { value, time: Date.now() });
    while (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  }).catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
  cache.set(key, entry);
  return entry.promise;
}
const boardCatalog = (date, force = false) => cachedRequest(`boards:${date}`, async () => {
  const body = await requestJSON(`/api/market-management/sectors?date=${date}&limit=5000${force ? '&force=1' : ''}`);
  return checkPayload(body, date);
}, force);
const stockCatalog = (board, date, force = false) => !isConceptCode(board?.code) ? Promise.resolve([]) : cachedRequest(`stocks:${date}:${board.code}`, async () => {
  const body = await requestJSON(`/api/market-management/stocks?date=${date}&sector=${encodeURIComponent(board.code)}&tab=all&market=all&limit=5000${force ? '&force=1' : ''}`);
  return checkPayload(body, date, board.code);
}, force);
const ladderCatalog = (date, force = false) => cachedRequest(`ladder:${date}`, async () => {
  const body = await requestJSON(`/api/market-management/limit-up-ladder?date=${date}&types=1${force ? '&force=1' : ''}`);
  return checkPayload(body, date);
}, force);
const searchStocks = (date, query = '', codes = [], force = false) => cachedRequest(`search:${date}:${query}:${codes.join(',')}`, async () => {
  const params = new URLSearchParams({ date, q: query, codes: codes.join(','), limit: '1000' });
  const body = await requestJSON(`/api/market-management/stock-search?${params}${force ? '&force=1' : ''}`);
  return checkPayload(body, date);
}, force);
const stockDetails = (date, code) => cachedRequest(`detail:${date}:${code}`, async () => {
  const body = await requestJSON(`/api/market-management/stock-details?date=${date}&codes=${encodeURIComponent(code)}`);
  return checkPayload(body, date);
});

async function loadDates() {
  if (calendarPromise) return calendarPromise;
  calendarPromise = (async () => {
    const body = await requestJSON('/api/market-management/trading-dates');
    const dates = calendarDates(body.dates);
    if (!dates.length) throw new Error('交易日数据暂不可用');
    // The server calendar is authoritative. Local custom rows are scoped to
    // real stockdb trading dates and must not reintroduce stale or future
    // dates from an older browser snapshot.
    const followLatest = !state.date || state.date === state.dates.at(-1);
    state.dates = dates;
    if (followLatest || !state.dates.includes(state.date)) state.date = dates.at(-1);
    renderDates(true);
  })().finally(() => { calendarPromise = null; });
  return calendarPromise;
}
function renderDates(scroll = false) {
  const dates = state.dates;
  const currentScroll = $('dateList').scrollLeft;
  $('dateList').innerHTML = dates.map((date, index) => {
    const offset = dates.length - 1 - index;
    const label = offset < 3 ? ['今天', '昨天', '前天'][offset] : dateText(date).slice(5);
    return `<button class="date-item ${date === state.date ? 'active' : ''}" data-date="${date}" aria-pressed="${date === state.date}"><strong>${label}</strong><span>${dateText(date)}</span></button>`;
  }).join('');
  $('dateMeta').textContent = dates.length ? `${dates.length} 个交易日` : '暂无交易日';
  $('dateList').querySelectorAll('[data-date]').forEach(button => button.onclick = () => {
    if (state.date === button.dataset.date) return;
    state.date = button.dataset.date;
    state.selectedBoard = null;
    state.selectedStock = null;
    renderDates();
    renderAll();
    refreshData();
  });
  $('dateList').scrollLeft = currentScroll;
  if (scroll) requestAnimationFrame(() => {
    const active = $('dateList').querySelector('.active');
    if (active) $('dateList').scrollTo({ left: Math.max(0, active.offsetLeft - $('dateList').clientWidth + active.offsetWidth), behavior: 'instant' });
  });
}
function visibleBoards() {
  return state.boards.filter(row => !row.sample && row.date === state.date && (state.direction === 'all' || row.direction === state.direction) && (state.tag === 'all' || row.dayTag === state.tag));
}
function visibleStocks() {
  return state.stocks.filter(row => !row.sample && row.date === state.date && row.boardId === state.selectedBoard);
}
function formatMoney(value) {
  const number = numberValue(value);
  if (number === null) return '--';
  return number >= 1e8 ? `${(number / 1e8).toFixed(2)}亿` : number >= 1e4 ? `${(number / 1e4).toFixed(2)}万` : number.toLocaleString('zh-CN');
}
function fieldCell(row, key) {
  const value = row[key];
  if (key === 'name') return `<div class="name-cell">${row.direction ? `<span class="direction ${row.direction === 'down' ? 'down' : ''}">${row.direction === 'down' ? '跌' : '涨'}</span>` : ''}<strong>${esc(value || '--')}</strong></div>`;
  if (key === 'boardCount') return numberValue(value) > 0 ? `<span class="badge">${esc(value)}板</span>` : '--';
  if (['changePct', 'auctionChangePct', 'turnoverPct'].includes(key)) {
    const number = numberValue(value);
    return number === null ? '--' : `<span class="${number > 0 ? 'up' : number < 0 ? 'down' : ''}">${key !== 'turnoverPct' && number > 0 ? '+' : ''}${number.toFixed(2)}%</span>`;
  }
  if (['sealAmount', 'limitAmount', 'circulatingMarketCap'].includes(key)) return `<span class="money">${formatMoney(value)}</span>`;
  if (key === 'limitTypes') return esc(typeText(value) || (row.limitTypeStatus === 'confirmed' ? '未命中类型' : '--'));
  return esc(typeText(value) || '--');
}
function renderTable(kind, originalRows) {
  const table = $(`${kind}Table`), sort = state.sort[kind];
  const columns = kind === 'board' ? [fields[0], fields[1], { key: 'dayTag', label: '天数标签' }, ...fields.slice(2)] : fields;
  const rows = sortRows(originalRows.map(displayRow), sort.key, sort.dir);
  table.querySelector('thead').innerHTML = `<tr>${columns.map(field => `<th aria-sort="${sort.key === field.key ? sort.dir === 1 ? 'ascending' : 'descending' : 'none'}"><button class="sort-btn" data-sort="${field.key}">${field.label}<span aria-hidden="true">${sort.key === field.key ? sort.dir === 1 ? '↑' : '↓' : '↕'}</span></button></th>`).join('')}<th>数据状态</th><th>操作</th></tr>`;
  table.querySelectorAll('[data-sort]').forEach(button => button.onclick = () => {
    const key = button.dataset.sort;
    sort.dir = sort.key === key ? sort.dir * -1 : numericFields.has(key) ? -1 : 1;
    sort.key = key;
    renderAll();
  });
  const selected = kind === 'board' ? state.selectedBoard : state.selectedStock;
  const empty = kind === 'board' ? '当前交易日暂无自定义板块' : '当前板块暂无自定义个股';
  table.querySelector('tbody').innerHTML = rows.length ? rows.map(row => `<tr data-id="${esc(row.id)}" tabindex="0" aria-selected="${row.id === selected}" class="${row.id === selected ? 'selected' : ''}">${columns.map(field => `<td class="${field.key.includes('Reason') ? 'reason-cell' : ''}" title="${esc(typeText(row[field.key]))}">${fieldCell(row, field.key)}</td>`).join('')}<td class="muted" title="${esc(row.quoteError || row.quoteUpdatedAt || '')}">${row.quoteStatus === 'error' ? (quoteValid(row) ? '上次成功数据' : '获取失败') : quoteValid(row) ? dateText(row.quoteDate) : row.code ? '待核验' : '手动名称'}</td><td><button class="reason-btn" data-reason="${esc(row.id)}">查看原因</button></td></tr>`).join('') : `<tr><td colspan="${columns.length + 2}" class="table-empty">${empty}</td></tr>`;
  table.querySelectorAll('tr[data-id]').forEach(tr => {
    const select = () => {
      if (kind === 'board') { state.selectedBoard = tr.dataset.id; state.selectedStock = null; }
      else state.selectedStock = tr.dataset.id;
      renderAll();
    };
    tr.onclick = select;
    tr.onkeydown = event => { if (event.target === tr && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } };
  });
  table.querySelectorAll('[data-reason]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    openReason(originalRows.find(row => row.id === button.dataset.reason), kind);
  });
}
function renderTags() {
  $('tagRow').innerHTML = `<button class="tag ${state.tag === 'all' ? 'active' : ''}" data-tag-index="-1">全部</button>` + state.tags.map((tag, index) => `<button class="tag ${state.tag === tag ? 'active' : ''}" data-tag-index="${index}">${esc(tag)}</button>`).join('');
  $('tagRow').querySelectorAll('button').forEach(button => button.onclick = () => {
    state.tag = Number(button.dataset.tagIndex) < 0 ? 'all' : state.tags[Number(button.dataset.tagIndex)];
    state.selectedBoard = null;
    renderAll();
  });
}
function persistTags(next) {
  const previous = { tags: [...state.tags], boards: state.boards.map(row => ({ ...row })), tag: state.tag };
  state.tags = next.tags;
  state.boards = next.boards;
  state.tag = next.tag;
  if (persist()) return true;
  Object.assign(state, previous);
  return false;
}
function renderAll() {
  const boards = visibleBoards();
  if (!boards.some(row => row.id === state.selectedBoard)) state.selectedBoard = boards[0]?.id || null;
  const stocks = visibleStocks();
  if (!stocks.some(row => row.id === state.selectedStock)) state.selectedStock = null;
  renderTags();
  document.querySelectorAll('[data-direction]').forEach(button => button.classList.toggle('active', button.dataset.direction === state.direction));
  renderTable('board', boards);
  renderTable('stock', stocks);
  $('boardMeta').textContent = `${boards.length} 个 · ${dateText(state.date)}`;
  const board = boards.find(row => row.id === state.selectedBoard);
  $('stockScope').textContent = board ? `${board.name} · ${stocks.length} 只` : '选择板块';
  $('editBoard').disabled = $('deleteBoard').disabled = !board || !state.writable;
  $('editStock').disabled = $('deleteStock').disabled = !state.selectedStock || !state.writable;
  $('addBoard').disabled = !state.date || !state.writable;
  $('addStock').disabled = !board || !state.writable;
  $('copyPrevious').disabled = !state.date || !state.writable;
}
function applyRows(kind, rows, date, ids) {
  const byCode = new Map(rows.map(row => [normalizeCode(row.code), row]));
  const key = kind === 'board' ? 'boards' : 'stocks';
  state[key] = state[key].map(row => row.date === date && ids.has(row.id) && !row.sample ? mergeQuote(row, byCode.get(normalizeCode(row.code)), date) : row);
}
async function refreshData(force = false) {
  const date = state.date;
  if (!date) return;
  const generation = ++state.generation;
  const active = () => generation === state.generation && date === state.date;
  state.loading = true;
  $('dataStatus').textContent = `${dateText(date)} · 正在更新`;
  const boards = state.boards.filter(row => row.date === date && !row.sample && isConceptCode(row.code));
  const stocks = state.stocks.filter(row => row.date === date && !row.sample && /^\d{6}$/.test(row.code));
  const errors = [];
  const apply = (kind, rows, ids) => { if (active()) { applyRows(kind, rows, date, ids); renderAll(); } };
  const fail = (error, ids) => {
    errors.push(error.message || '行情读取超时');
    if (active()) for (const key of ['boards', 'stocks']) state[key] = state[key].map(row => ids.has(row.id) ? { ...row, quoteStatus: 'error', quoteError: error.message || '行情读取超时' } : row);
  };
  const tasks = [];
  if (boards.length) tasks.push(boardCatalog(date, force).then(rows => apply('board', rows, new Set(boards.map(row => row.id)))).catch(error => fail(error, new Set(boards.map(row => row.id)))));
  for (let index = 0; index < stocks.length; index += 100) {
    const members = stocks.slice(index, index + 100);
    const ids = new Set(members.map(row => row.id));
    tasks.push(searchStocks(date, '', [...new Set(members.map(row => row.code))], force).then(rows => apply('stock', rows, ids)).catch(error => fail(error, ids)));
  }
  await Promise.allSettled(tasks);
  // Optional detail work must not delay basic quotes or prevent saving names.
  if (active() && stocks.length) {
    try { apply('stock', await ladderCatalog(date, force), new Set(stocks.map(row => row.id))); }
    catch (error) { errors.push(error.message || '涨停详情暂不可用'); }
  }
  if (!active()) return;
  state.loading = false;
  persist();
  renderAll();
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  $('dataStatus').textContent = `${dateText(date)} · ${errors.length ? `部分数据获取失败：${errors[0]}` : tasks.length || stocks.length ? `${time} 已更新` : '暂无关联行情'}`;
}

function pickerCurrent(editing, revision) {
  return state.editing === editing && editing.revision === revision && $('entityDialog').open;
}
function selectedInput(editing) {
  const value = $('entityPicker').value.trim();
  const match = catalogMatch(editing.catalog, value);
  if (match) return match;
  if (editing.original && value === editing.original.name && editing.boardId === (editing.original.boardId || '')) return editing.original;
  return null;
}
function exactEntryCode(kind, value) {
  const code = normalizeCode(value);
  if (kind === 'board') return isConceptCode(code) ? code : '';
  return /^\d{6}$/.test(code) ? code : '';
}
function addCatalogRow(editing, row) {
  if (!row) return null;
  const code = normalizeCode(row.code);
  const existing = editing.catalog.findIndex(item => normalizeCode(item.code) === code);
  if (existing >= 0) editing.catalog[existing] = { ...editing.catalog[existing], ...row };
  else editing.catalog = [...editing.catalog, row];
  return editing.catalog.find(item => normalizeCode(item.code) === code) || null;
}
async function resolveExactEntry(editing, value) {
  const code = exactEntryCode(editing.kind, value);
  if (!code) return null;
  const local = editing.catalog.find(row => normalizeCode(row.code) === code);
  if (local) return local;

  if (editing.kind === 'board') {
    const rows = await boardCatalog(editing.date);
    return addCatalogRow(editing, rows.find(row => normalizeCode(row.code) === code));
  }

  // Prefer the selected concept's member snapshot when available, then fall
  // back to the stockdb code lookup so an exact stock code can still link to a
  // manually created board.
  const board = state.boards.find(row => row.id === editing.boardId);
  if (isConceptCode(board?.code)) {
    const members = await stockCatalog(board, editing.date);
    const member = members.find(row => normalizeCode(row.code) === code);
    if (member) return addCatalogRow(editing, member);
  }
  const rows = await searchStocks(editing.date, '', [code]);
  return addCatalogRow(editing, rows.find(row => normalizeCode(row.code) === code));
}
function fillAutoFields(item) {
  for (const field of fields.filter(field => field.key !== 'name')) {
    const input = $('entityFields').querySelector(`[data-auto="${field.key}"]`);
    if (input) input.value = item ? typeText(item[field.key]) : '';
  }
}
function applyPicker(editing, enrich = false) {
  editing.selected = selectedInput(editing);
  fillAutoFields(editing.selected && (editing.selected === editing.original || editing.selected.quoteDate) ? displayRow(editing.selected) : editing.selected);
  const status = $('pickerStatus');
  status.textContent = editing.selected ? `${editing.selected.code || '手动名称'} · ${dateText(editing.date)}` : editing.loading ? '正在加载候选数据' : editing.error || ($('entityPicker').value.trim() ? '手动名称 · 暂无关联行情' : `${editing.catalog.length} 条候选`);
  status.classList.toggle('matched', Boolean(editing.selected?.code));
  renderOptions(editing);
  if (enrich && editing.kind === 'stock' && editing.selected && /^\d{6}$/.test(editing.selected.code)) enrichPicker(editing);
}
function renderOptions(editing) {
  const text = searchText($('entityPicker').value);
  const options = editing.catalog.filter(row => !text || searchText(`${row.name} ${row.code}`).includes(text)).slice(0, 40);
  $('entityOptions').innerHTML = options.map(row => `<button type="button" class="entity-option" data-code="${esc(row.code)}">${esc(row.name)}<span>${esc(row.code)}</span></button>`).join('') || `<div class="option-empty">${editing.loading ? '加载中' : '无匹配候选'}</div>`;
  $('entityOptions').querySelectorAll('[data-code]').forEach(button => button.onclick = () => {
    const item = editing.catalog.find(row => normalizeCode(row.code) === normalizeCode(button.dataset.code));
    if (!item) return;
    $('entityPicker').value = item.name;
    applyPicker(editing, true);
  });
  $('entityOptions').querySelectorAll('[data-code]').forEach(button => button.onpointerdown = event => event.preventDefault());
}
async function enrichPicker(editing) {
  const code = editing.selected.code, revision = editing.revision;
  const sameSelection = () => pickerCurrent(editing, revision) && normalizeCode(editing.selected?.code) === normalizeCode(code);
  try {
    const rows = await stockDetails(editing.date, code);
    if (!sameSelection()) return;
    const item = rows.find(row => normalizeCode(row.code) === normalizeCode(code));
    if (item) {
      let merged = mergeQuote({ ...editing.selected, date: editing.date, quoteCode: normalizeCode(code), quoteDate: editing.date }, item, editing.date);
      editing.catalog = editing.catalog.map(row => normalizeCode(row.code) === normalizeCode(code) ? merged : row);
      editing.selected = merged;
      fillAutoFields(merged);
      const ladder = await ladderCatalog(editing.date);
      if (!sameSelection()) return;
      const detail = ladder.find(row => normalizeCode(row.code) === normalizeCode(code));
      if (detail) {
        merged = mergeQuote(merged, detail, editing.date);
        editing.catalog = editing.catalog.map(row => normalizeCode(row.code) === normalizeCode(code) ? merged : row);
        editing.selected = merged;
        fillAutoFields(merged);
      }
    }
  } catch { if (sameSelection()) $('pickerStatus').textContent += ' · 涨停详情暂不可用'; }
}
async function loadPicker(editing) {
  const revision = ++editing.revision;
  editing.loading = true;
  editing.catalog = [];
  editing.error = '';
  applyPicker(editing);
  try {
    const board = state.boards.find(row => row.id === editing.boardId);
    const rows = editing.kind === 'board' ? await boardCatalog(editing.date) : isConceptCode(board?.code) ? await stockCatalog(board, editing.date) : await searchStocks(editing.date);
    if (!pickerCurrent(editing, revision)) return;
    editing.catalog = rows;
    editing.loading = false;
    applyPicker(editing, true);
  } catch (error) {
    if (!pickerCurrent(editing, revision)) return;
    editing.loading = false;
    editing.error = error.message || '候选数据读取超时';
    applyPicker(editing);
  }
}
function openEntity(kind, original = null) {
  const editing = { kind, original, id: original?.id || uid(), date: state.date, boardId: original?.boardId || (kind === 'stock' ? state.selectedBoard : ''), catalog: [], selected: original, revision: 0, searchRevision: 0, loading: true };
  state.editing = editing;
  $('entityTitle').textContent = `${original ? '编辑' : '新增'}${kind === 'board' ? '板块' : '个股'} · ${dateText(editing.date)}`;
  const extras = kind === 'board' ? `<div class="form-field"><label for="entityDirection">方向</label><select id="entityDirection"><option value="up">涨板块</option><option value="down">跌板块</option></select></div><div class="form-field"><label for="entityTag">天数标签</label><select id="entityTag"><option value="">未设置</option>${state.tags.map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join('')}</select></div>` : `<div class="form-field wide"><label for="entityBoardSelect">关联板块</label><select id="entityBoardSelect">${state.boards.filter(row => row.date === editing.date && !row.sample).map(board => `<option value="${esc(board.id)}">${esc(board.name)}</option>`).join('')}</select></div>`;
  $('entityFields').innerHTML = extras + `<div class="form-field picker-field"><label for="entityPicker">${kind === 'board' ? '板块' : '个股'}名称 *</label><input id="entityPicker" required maxlength="80" autocomplete="off" placeholder="搜索名称或代码，或手动录入" value="${esc(original?.name || '')}" aria-controls="entityOptions"><div class="entity-options" id="entityOptions" aria-label="候选列表"></div><div class="picker-status" id="pickerStatus" role="status">加载中</div></div>` + fields.filter(field => field.key !== 'name').map(field => `<div class="form-field auto-field ${field.key === 'limitReasonDetail' ? 'wide' : ''}"><label for="auto-${field.key}">${field.label}</label>${field.key === 'limitReasonDetail' ? `<textarea id="auto-${field.key}" data-auto="${field.key}" readonly></textarea>` : `<input id="auto-${field.key}" data-auto="${field.key}" readonly>`}</div>`).join('');
  if (kind === 'board') { $('entityDirection').value = original?.direction || (state.direction === 'down' ? 'down' : 'up'); $('entityTag').value = original?.dayTag || (state.tag === 'all' ? '' : state.tag); }
  else {
    $('entityBoardSelect').value = editing.boardId;
    $('entityBoardSelect').onchange = () => {
      editing.searchRevision += 1;
      clearTimeout(editing.searchTimer);
      editing.boardId = $('entityBoardSelect').value;
      editing.selected = null;
      $('entityPicker').value = '';
      loadPicker(editing);
    };
  }
  $('entityPicker').oninput = () => {
    const revision = ++editing.searchRevision;
    clearTimeout(editing.searchTimer);
    applyPicker(editing);
    if (kind !== 'stock' || !$('entityPicker').value.trim()) return;
    editing.searchTimer = setTimeout(async () => {
      const query = $('entityPicker').value.trim();
      try {
        const rows = await searchStocks(editing.date, query);
        if (state.editing !== editing || revision !== editing.searchRevision || !$('entityDialog').open) return;
        const byCode = new Map(editing.catalog.map(row => [normalizeCode(row.code), row]));
        for (const row of rows) if (!byCode.has(normalizeCode(row.code))) byCode.set(normalizeCode(row.code), row);
        editing.catalog = [...byCode.values()];
        applyPicker(editing, true);
      } catch (error) { if (state.editing === editing && revision === editing.searchRevision) { editing.error = error.message || '搜索暂不可用'; applyPicker(editing); } }
    }, 250);
  };
  $('entityPicker').onchange = () => applyPicker(editing, true);
  $('entityDialog').showModal();
  $('entityPicker').focus();
  loadPicker(editing);
}
async function saveEntity(event) {
  event.preventDefault();
  const editing = state.editing;
  if (!editing || !state.writable || editing.saving) return;
  const name = $('entityPicker').value.trim();
  if (!name) { toast('名称不能为空', true); return; }
  let selected = selectedInput(editing);
  const exactCode = exactEntryCode(editing.kind, name);
  if (!selected && exactCode) {
    editing.saving = true;
    try {
      selected = await resolveExactEntry(editing, name);
    } catch (error) {
      toast(error.message || '代码关联读取失败，请稍后重试', true);
      return;
    } finally {
      editing.saving = false;
    }
    // The editor can be closed or replaced while the exact-code lookup runs.
    if (state.editing !== editing || !$('entityDialog').open) return;
    if (selected) applyPicker(editing, true);
  }
  const boardId = editing.kind === 'stock' ? $('entityBoardSelect').value : '';
  if (editing.kind === 'stock' && !state.boards.some(row => row.id === boardId && row.date === editing.date && !row.sample)) { toast('关联板块不存在，请重新选择', true); return; }
  // Reuse the latest persisted row so a background refresh cannot be erased by an old editor snapshot.
  const list = editing.kind === 'board' ? state.boards : state.stocks;
  const original = list.find(row => row.id === editing.id);
  const row = makeEntity({ kind: editing.kind, original, selected: selected === editing.original ? null : selected, name, date: editing.date, id: editing.id, direction: $('entityDirection')?.value, dayTag: $('entityTag')?.value || '', boardId });
  if (editing.kind === 'stock' && row.code && !/^\d{6}$/.test(row.code)) { toast('个股代码格式无效', true); return; }
  if (list.some(item => item.id !== row.id && item.date === row.date && !item.sample && (row.code ? normalizeCode(item.code) === normalizeCode(row.code) : item.name === row.name) && (editing.kind === 'board' || item.boardId === row.boardId))) { toast('该对象已在当前清单中', true); return; }
  const index = list.findIndex(item => item.id === row.id), previous = index >= 0 ? list[index] : null;
  if (index >= 0) list[index] = row; else list.push(row);
  if (!persist()) { if (index >= 0) list[index] = previous; else list.pop(); return; }
  state.selectedBoard = editing.kind === 'board' ? row.id : row.boardId;
  state.selectedStock = editing.kind === 'stock' ? row.id : null;
  $('entityDialog').close();
  renderAll();
  toast('已保存至本页清单');
  refreshData();
}
function deleteCurrent(kind) {
  const id = kind === 'board' ? state.selectedBoard : state.selectedStock;
  if (!id || !confirm(kind === 'board' ? '删除本页当前板块及其关联个股？' : '删除本页当前个股？')) return;
  const previous = { boards: state.boards, stocks: state.stocks };
  if (kind === 'board') { state.boards = state.boards.filter(row => row.id !== id); state.stocks = state.stocks.filter(row => row.boardId !== id); }
  else state.stocks = state.stocks.filter(row => row.id !== id);
  if (!persist()) { Object.assign(state, previous); return; }
  renderAll();
}
function openReason(original, kind) {
  if (!original) return;
  const row = displayRow(original), board = state.boards.find(item => item.id === row.boardId);
  $('reasonTitle').textContent = `${row.name} · 详细涨停原因`;
  $('reasonMeta').innerHTML = `<div><small>交易日</small><strong>${dateText(row.date)}</strong></div><div><small>关联板块</small><strong>${esc(kind === 'board' ? row.name : board?.name || '--')}</strong></div><div><small>涨停类型</small><strong>${esc(typeText(row.limitTypes) || '--')}</strong></div><div><small>原因标签</small><strong>${esc(row.limitReason || '--')}</strong></div>`;
  $('reasonCopy').textContent = row.limitReasonDetail || '当前交易日暂无详细涨停原因';
  $('reasonDialog').showModal();
}
function renderTagDialog() {
  $('tagList').innerHTML = state.tags.map((tag, index) => `<div class="tag-line"><span>${esc(tag)}</span><div class="tag-line-actions"><button class="button" data-rename="${index}">重命名</button><button class="button danger" data-remove="${index}">删除</button></div></div>`).join('') || '<div class="muted">暂无天数标签</div>';
  $('tagList').querySelectorAll('[data-rename]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.rename), old = state.tags[index];
    const name = prompt('标签名称', old)?.trim();
    if (!name || name === old) return;
    if (name.length > 12 || state.tags.includes(name) || name === 'all') { toast('标签需为 1 至 12 字，且名称不能重复', true); return; }
    const tags = state.tags.map((tag, tagIndex) => tagIndex === index ? name : tag);
    const boards = state.boards.map(row => row.dayTag === old ? { ...row, dayTag: name } : row);
    if (!persistTags({ tags, boards, tag: state.tag === old ? name : state.tag })) return;
    renderTagDialog(); renderAll();
  });
  $('tagList').querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.remove), old = state.tags[index];
    if (!confirm(`删除标签“${old}”？对应清单将改为未设置标签。`)) return;
    const tags = state.tags.filter((_, tagIndex) => tagIndex !== index);
    const boards = state.boards.map(row => row.dayTag === old ? { ...row, dayTag: '' } : row);
    if (!persistTags({ tags, boards, tag: state.tag === old ? 'all' : state.tag })) return;
    renderTagDialog(); renderAll();
  });
}
function copyPrevious() {
  const previousDate = calendarDates(state.boards.filter(row => !row.sample && row.date < state.date).map(row => row.date)).at(-1);
  if (!previousDate) { toast('此前交易日没有可沿用的清单'); return; }
  const current = state.boards.filter(row => row.date === state.date && !row.sample), mapping = new Map(), additions = [];
  for (const board of state.boards.filter(row => row.date === previousDate && !row.sample)) {
    let next = current.find(row => board.code ? row.code === board.code : row.name === board.name);
    if (!next) { next = { id: uid(), date: state.date, name: board.name, code: board.code, direction: board.direction, dayTag: board.dayTag }; additions.push(next); }
    mapping.set(board.id, next.id);
  }
  const stocks = state.stocks.filter(row => row.date === previousDate && !row.sample && mapping.has(row.boardId)).filter(row => !state.stocks.some(currentRow => currentRow.date === state.date && currentRow.boardId === mapping.get(row.boardId) && (row.code ? row.code === currentRow.code : row.name === currentRow.name))).map(row => ({ id: uid(), date: state.date, boardId: mapping.get(row.boardId), code: row.code, name: row.name }));
  const previous = { boards: state.boards, stocks: state.stocks };
  state.boards = [...state.boards, ...additions]; state.stocks = [...state.stocks, ...stocks];
  if (!persist()) { Object.assign(state, previous); return; }
  state.direction = 'all'; state.tag = 'all'; renderAll(); refreshData();
  toast(`已沿用 ${dateText(previousDate)} 清单：${additions.length} 个板块，${stocks.length} 只个股`);
}

$('datePrev').onclick = () => $('dateList').scrollBy({ left: -$('dateList').clientWidth, behavior: 'smooth' });
$('dateNext').onclick = () => $('dateList').scrollBy({ left: $('dateList').clientWidth, behavior: 'smooth' });
$('dateList').addEventListener('wheel', event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); $('dateList').scrollLeft += event.deltaY; } }, { passive: false });
document.querySelectorAll('[data-direction]').forEach(button => button.onclick = () => { state.direction = button.dataset.direction; state.selectedBoard = null; renderAll(); });
$('addBoard').onclick = () => openEntity('board');
$('editBoard').onclick = () => openEntity('board', state.boards.find(row => row.id === state.selectedBoard));
$('deleteBoard').onclick = () => deleteCurrent('board');
$('addStock').onclick = () => openEntity('stock');
$('editStock').onclick = () => openEntity('stock', state.stocks.find(row => row.id === state.selectedStock));
$('deleteStock').onclick = () => deleteCurrent('stock');
$('entityForm').onsubmit = saveEntity;
$('entityDialog').onclose = () => { if (state.editing) clearTimeout(state.editing.searchTimer); state.editing = null; };
$('closeEntity').onclick = $('cancelEntity').onclick = () => $('entityDialog').close();
$('closeReason').onclick = $('doneReason').onclick = () => $('reasonDialog').close();
$('manageTags').onclick = () => { renderTagDialog(); $('tagDialog').showModal(); };
$('closeTags').onclick = $('doneTags').onclick = () => $('tagDialog').close();
$('quickAddTag').onclick = () => $('manageTags').click();
$('tagForm').onsubmit = event => {
  event.preventDefault();
  const name = $('tagInput').value.trim();
  if (!state.writable || !name) return;
  if (state.tags.includes(name) || name === 'all' || name.length > 12) { toast('标签需为 1 至 12 字，且名称不能重复', true); return; }
  if (!persistTags({ tags: [...state.tags, name], boards: state.boards, tag: state.tag })) return;
  $('tagInput').value = ''; renderTagDialog(); renderTags();
};
$('copyPrevious').onclick = copyPrevious;
$('refreshData').onclick = async () => { try { await loadDates(); renderAll(); await refreshData(true); } catch (error) { toast(error.message || '数据读取超时', true); } };
$('exportPage').onclick = () => {
  const data = localStorage.getItem(STORAGE_KEY) || JSON.stringify({ tags: state.tags, boards: state.boards, stocks: state.stocks });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `custom-sector-tracker-${state.date || 'backup'}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function start() {
  restore();
  try { await loadDates(); }
  catch (error) { state.date = state.dates.at(-1) || ''; $('dataStatus').textContent = error.message || '交易日读取超时'; toast('交易日读取失败，保留本页已有日期', true); }
  renderDates(true); renderAll();
  new ResizeObserver(() => {
    const active = $('dateList').querySelector('.active');
    if (active) $('dateList').scrollTo({ left: Math.max(0, active.offsetLeft - $('dateList').clientWidth + active.offsetWidth), behavior: 'instant' });
  }).observe($('dateList'));
  await refreshData();
  setInterval(async () => {
    if (document.hidden || state.loading || $('entityDialog').open) return;
    try { await loadDates(); renderAll(); } catch { /* Keep the last verified calendar when the service is temporarily unavailable. */ }
    refreshData();
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.loading && !$('entityDialog').open) refreshData(); });
}
start();
