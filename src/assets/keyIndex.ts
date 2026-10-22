/** First key strictly after time. Curves are validated once before publication. */
export function upperBound(
  keys: readonly { readonly atMs: number }[],
  time: number,
): number {
  let low = 0,
    high = keys.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      key = keys[middle];
    if (!key) throw new Error('Missing indexed key');
    if (key.atMs <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Select every interior key, without mapping/scanning unrelated curve history.
 * Sorting/deduplication matches the original merged-boundary semantics exactly. */
export function intervalKeyTimes(
  from: number,
  to: number,
  ...curves: readonly (readonly { readonly atMs: number }[])[]
): number[] {
  const times = new Set([from, to]);
  for (const keys of curves) {
    for (let i = upperBound(keys, from); i < keys.length; i++) {
      const key = keys[i];
      if (!key) throw new Error('Missing indexed boundary');
      if (key.atMs >= to) break;
      times.add(key.atMs);
    }
  }
  return [...times].sort((a, b) => a - b);
}
