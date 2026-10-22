/** Checked internal/table lookup, rather than a compile-only non-null assertion. */
export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Required game invariant value is missing');
  return value;
}
