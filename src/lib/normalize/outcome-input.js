export function normalizeOutcomeInput(raw = {}) {
  const trades = Array.isArray(raw.trades) ? raw.trades : [];
  return {
    date: raw.date ?? null,
    summary: {
      totalPnlPct: Number(raw.summary?.totalPnlPct ?? 0),
      realizedPnlPct: Number(raw.summary?.realizedPnlPct ?? raw.summary?.totalPnlPct ?? 0),
      maxDrawdownPct: Number(raw.summary?.maxDrawdownPct ?? 0),
      winRate: Number(raw.summary?.winRate ?? 0),
      tradeCount: Number(raw.summary?.tradeCount ?? trades.length),
      disciplineScore: Number(raw.summary?.disciplineScore ?? 0),
      notes: raw.summary?.notes ?? ""
    },
    trades: trades.map((trade) => ({
      symbol: trade.symbol ?? "UNKNOWN",
      theme: trade.theme ?? "Unknown",
      setup: trade.setup ?? "Unknown",
      pnlPct: Number(trade.pnlPct ?? 0),
      result: trade.result ?? (Number(trade.pnlPct ?? 0) >= 0 ? "win" : "loss"),
      matchedPlan: Boolean(trade.matchedPlan),
      positionPct: Number(trade.positionPct ?? 0),
      holdingDays: Number(trade.holdingDays ?? 0),
      entryStyle: trade.entryStyle ?? "Unknown",
      exitReason: trade.exitReason ?? "",
      entryConfidence: trade.entryConfidence !== undefined ? Number(trade.entryConfidence) : null,
      plannedSetup: trade.plannedSetup ?? trade.setup ?? "Unknown",
      plannedTheme: trade.plannedTheme ?? trade.theme ?? "Unknown",
      tags: Array.isArray(trade.tags) ? trade.tags : [],
      notes: trade.notes ?? ""
    }))
  };
}
