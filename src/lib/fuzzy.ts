/**
 * Subsequence fuzzy match. Returns a score (higher is better) or -1 if `query` doesn't match.
 * Rewards contiguous runs and matches at word starts.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) return 1000 - direct + (direct === 0 || /\W/.test(t[direct - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    run = found === ti ? run + 1 : 0;
    score += 10 + run * 5 + (found === 0 || /\W/.test(t[found - 1]) ? 15 : 0) - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
