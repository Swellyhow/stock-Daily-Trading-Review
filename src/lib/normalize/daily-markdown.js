function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJsonBlock(markdown, title) {
  const escapedTitle = escapeRegExp(title);
  const pattern = new RegExp("##\\s+" + escapedTitle + "\\s*[\\r\\n]+\\s*```json\\s*([\\s\\S]*?)```", "i");
  const match = markdown.match(pattern);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1].trim());
}

function extractDate(markdown) {
  const match = markdown.match(/^date:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

export function normalizeDailyMarkdown(markdown) {
  return {
    date: extractDate(markdown),
    marketNotes: extractJsonBlock(markdown, "MarketNotes") ?? { market: {}, themes: [], stocks: [] },
    outcome: extractJsonBlock(markdown, "Outcome") ?? null
  };
}
