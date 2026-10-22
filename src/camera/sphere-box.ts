import type { Vector3 } from '../contracts';
import type { Box } from '../world/swept-shapes';

const axes = ['x', 'y', 'z'] as const;
const finite = (p: Vector3) =>
  p != null && axes.every((k) => Number.isFinite(p[k]));

/** Closed continuous sphere sweep for camera visibility, not gameplay TOI.
 * Point-to-box squared distance along a segment is piecewise quadratic. At most
 * six face crossings partition [0,1] into seven intervals; each minimum lies at
 * an endpoint or its quadratic stationary point. No sampling/advancement loop.
 * Invalid or numerically unrepresentable geometry fails closed.
 */
export function cameraSphereBlocked(
  a: Vector3,
  b: Vector3,
  box: Box,
  radius = 0.2,
): boolean {
  if (
    !finite(a) ||
    !finite(b) ||
    !box ||
    !finite(box.min) ||
    !finite(box.max) ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    axes.some((k) => box.min[k] > box.max[k])
  )
    return true;
  const relative = (p: Vector3): Vector3 => ({
    x: p.x - a.x,
    y: p.y - a.y,
    z: p.z - a.z,
  });
  const d = relative(b),
    lo = relative(box.min),
    hi = relative(box.max);
  const values = [
    ...Object.values(d),
    ...Object.values(lo),
    ...Object.values(hi),
  ];
  if (!values.every(Number.isFinite)) return true;
  // Preserve the existing outward tolerance and account conservatively for
  // floating-point arithmetic in the translated coordinates (not world origin).
  const tolerance =
    1e-8 + 32 * Number.EPSILON * Math.max(radius, ...values.map(Math.abs));
  const limit = (radius + tolerance) ** 2;
  if (!Number.isFinite(limit)) return true;
  const breaks = [0, 1];
  for (const k of axes)
    if (d[k] !== 0)
      for (const face of [lo[k], hi[k]]) {
        const t = face / d[k];
        if (t > 0 && t < 1) breaks.push(t);
      }
  breaks.sort((x, y) => x - y);
  const distanceSq = (t: number) => {
    let sum = 0;
    for (const k of axes) {
      const p = d[k] * t;
      const gap = Math.max(lo[k] - p, 0, p - hi[k]);
      sum += gap * gap;
    }
    return sum;
  };
  const blockedAt = (t: number) => {
    const sq = distanceSq(t);
    return !Number.isFinite(sq) || sq <= limit;
  };
  if (breaks.some(blockedAt)) return true;
  for (const [i, right] of breaks.entries()) {
    if (i === 0) continue;
    const left = breaks[i - 1];
    if (left === undefined) return true;
    const mid = (left + right) / 2;
    let aa = 0,
      ab = 0;
    for (const k of axes) {
      const p = d[k] * mid;
      const face = p < lo[k] ? lo[k] : p > hi[k] ? hi[k] : undefined;
      if (face !== undefined) {
        aa += d[k] * d[k];
        ab += d[k] * (p - face);
      }
    }
    if (!Number.isFinite(aa) || !Number.isFinite(ab)) return true;
    if (aa > 0 && blockedAt(Math.max(left, Math.min(right, mid - ab / aa))))
      return true;
  }
  return false;
}
