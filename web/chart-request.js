(function (global) {
  function missing(value) {
    return value == null || (typeof value === "string" && ["", "--"].includes(value.trim())) || (typeof value === "number" && !Number.isFinite(value));
  }

  function compare(a, b, direction = 1) {
    if (missing(a) || missing(b)) return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
    const first = Number(a), second = Number(b);
    return (Number.isFinite(first) && Number.isFinite(second) ? first - second : String(a).localeCompare(String(b), "zh-CN", { numeric: true })) * direction;
  }

  function sortHeader(label, key, sort, attribute = "data-sort", className = "sort-button") {
    const active = sort.key === key;
    const direction = active ? (sort.dir > 0 ? "ascending" : "descending") : "none";
    return `<th aria-sort="${direction}"><button class="${className}" ${attribute}="${key}" title="${label}：${active && sort.dir > 0 ? "降序" : "升序"}" aria-label="${label}排序">${label}<span class="sort-indicator ${active ? (sort.dir > 0 ? "ascending" : "descending") : ""}" aria-hidden="true"></span></button></th>`;
  }

  function createLatestRequests(fetcher = global.fetch.bind(global)) {
    const slots = new Map();
    function cancel(slot) {
      const previous = slots.get(slot);
      if (previous) previous.controller.abort();
      slots.delete(slot);
    }
    async function run(slot, url, handlers = {}) {
      if (handlers.isCurrent && !handlers.isCurrent()) return;
      const previous = slots.get(slot);
      if (previous?.url === url && previous.pending) return previous.pending;
      cancel(slot);
      const entry = { url, controller: new AbortController(), pending: null, loaded: false };
      slots.set(slot, entry);
      const current = () => slots.get(slot) === entry && !entry.controller.signal.aborted && (!handlers.isCurrent || handlers.isCurrent());
      if (current()) handlers.loading?.({ refresh: previous?.url === url && previous.loaded });
      entry.pending = (async () => {
        try {
          const response = await fetcher(url, { signal: entry.controller.signal, cache: "no-store" });
          const body = await response.json();
          if (!response.ok || body.ok === false) throw Error(body.error || `请求失败 ${response.status}`);
          if (current()) { handlers.success?.(body); entry.loaded = true; }
        } catch (error) {
          if (current() && error.name !== "AbortError") handlers.error?.(error);
        } finally {
          if (slots.get(slot) === entry) entry.pending = null;
        }
      })();
      return entry.pending;
    }
    return Object.freeze({ run, cancel, cancelAll: () => [...slots.keys()].forEach(cancel) });
  }

  global.ChartRequest = Object.freeze({ createLatestRequests, compare, missing, sortHeader });
})(window);
