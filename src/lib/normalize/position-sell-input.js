function normalizeHolding(holding = {}) {
  return {
    symbol: holding.symbol ?? holding.name ?? "UNKNOWN",
    name: holding.name ?? holding.symbol ?? "UNKNOWN",
    theme: holding.theme ?? "Unknown",
    role: holding.role ?? null,
    positionPct: Number(holding.positionPct ?? 0),
    pnlPct: Number(holding.pnlPct ?? 0),
    holdingDays: Number(holding.holdingDays ?? 0),
    entryStyle: holding.entryStyle ?? "Unknown",
    plannedSetup: holding.plannedSetup ?? holding.setup ?? "Unknown",
    actualSetup: holding.actualSetup ?? holding.setup ?? "Unknown",
    matchedPlan: holding.matchedPlan !== undefined ? Boolean(holding.matchedPlan) : null,
    notes: holding.notes ?? ""
  };
}

export function normalizePositionSellInput(raw = {}) {
  return {
    date: raw.date ?? raw.marketNotes?.date ?? null,
    marketNotes: raw.marketNotes ?? {},
    holdings: Array.isArray(raw.holdings) ? raw.holdings.map(normalizeHolding) : []
  };
}
