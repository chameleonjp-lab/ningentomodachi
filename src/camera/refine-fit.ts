/** A failed sample and a separately certified endpoint bound a local search.
 * Obstruction feasibility need NOT be monotone: this does not claim a global
 * optimum, and only a fresh successful verification can replace the endpoint.
 * The 1mm termination width is range precision, never collision/fit tolerance.
 */
export function refineVerifiedRange<T>(
  failedDistance: number,
  verified: { distance: number; value: T },
  verify: (distance: number) => T | undefined,
): { distance: number; value: T } {
  let lower = failedDistance;
  let best = verified;
  for (
    let attempt = 0;
    attempt < 8 && best.distance - lower > 0.001;
    attempt++
  ) {
    const distance = (lower + best.distance) * 0.5;
    const value = verify(distance);
    if (value === undefined) lower = distance;
    else best = { distance, value };
  }
  return best;
}
