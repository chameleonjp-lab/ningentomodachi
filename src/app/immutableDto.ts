/** DTO-only copy: render nodes/engine resources must never enter committed public data. */
export function immutableDto<T>(value: T): T {
  const copy = structuredClone(value);
  const visited = new WeakSet<object>();
  function freeze(item: unknown) {
    if (item === null || typeof item !== 'object' || visited.has(item)) return;
    visited.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  }
  freeze(copy);
  return copy;
}
