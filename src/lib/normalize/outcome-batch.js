export function normalizeOutcomeBatchInput(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (Array.isArray(raw?.outcomes)) {
    return raw.outcomes;
  }

  return [];
}
