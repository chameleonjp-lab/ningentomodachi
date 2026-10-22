import type { HitVolume, Vector3 } from '../contracts';
import {
  add,
  clamp,
  dot,
  finite,
  length,
  lerp,
  mul,
  sub,
  unit,
  v,
} from './math';
export interface Box {
  readonly min: Vector3;
  readonly max: Vector3;
}
export interface SweepHit {
  readonly fraction: number;
  readonly point: Vector3;
  readonly normal: Vector3;
}
interface Segment {
  a: Vector3;
  b: Vector3;
  r: number;
}
function segment(shape: HitVolume): Segment {
  const a = shape.kind === 'sphere' ? shape.center : shape.start;
  const b = shape.kind === 'sphere' ? shape.center : shape.end;
  if (
    !finite(a) ||
    !finite(b) ||
    !Number.isFinite(shape.radiusM) ||
    shape.radiusM < 0
  )
    throw new RangeError('Invalid hit volume');
  return { a, b, r: shape.radiusM };
}
export function interpolateVolume(
  a: HitVolume,
  b: HitVolume,
  t: number,
): HitVolume {
  const x = segment(a),
    y = segment(b);
  return {
    kind: 'capsule',
    start: lerp(x.a, y.a, t),
    end: lerp(x.b, y.b, t),
    radiusM: x.r + (y.r - x.r) * t,
  };
}
function nearest(a: Segment, b: Segment): [Vector3, Vector3] {
  const d1 = sub(a.b, a.a),
    d2 = sub(b.b, b.a),
    r = sub(a.a, b.a);
  const aa = dot(d1, d1),
    ee = dot(d2, d2),
    f = dot(d2, r);
  let s = 0,
    t = 0;
  if (aa <= 1e-20 && ee <= 1e-20) return [a.a, b.a];
  if (aa <= 1e-20) t = clamp(f / ee);
  else {
    const c = dot(d1, r);
    if (ee <= 1e-20) s = clamp(-c / aa);
    else {
      const bb = dot(d1, d2),
        den = aa * ee - bb * bb;
      s = den > 1e-20 ? clamp((bb * f - c * ee) / den) : 0;
      t = (bb * s + f) / ee;
      if (t < 0) {
        t = 0;
        s = clamp(-c / aa);
      } else if (t > 1) {
        t = 1;
        s = clamp((bb - c) / aa);
      }
    }
  }
  return [add(a.a, mul(d1, s)), add(b.a, mul(d2, t))];
}
const mix = (a: Segment, b: Segment, t: number): Segment => ({
  a: lerp(a.a, b.a, t),
  b: lerp(a.b, b.b, t),
  r: a.r + (b.r - a.r) * t,
});
const speed = (a: Segment, b: Segment): number =>
  Math.max(length(sub(b.a, a.a)), length(sub(b.b, a.b))) + Math.abs(b.r - a.r);
/** Conservative advancement using an endpoint/radius Lipschitz bound. No endpoint-only test.
 * Tolerance is 1e-8 metres, max 8192 iterations; exhaustion throws rather than drops a contact. */
function advance(
  evaluate: (t: number) => { a: Vector3; b: Vector3; gap: number; r: number },
  bound: number,
): SweepHit | null {
  let t = 0;
  for (let i = 0; i < 8192; i++) {
    const sample = evaluate(t);
    if (sample.gap <= 1e-8) {
      // A shared exact end belongs to the next interval. Do not widen that boundary by tolerance.
      if (t >= 1 - 1e-10) return null;
      const normal = unit(sub(sample.a, sample.b), v(1, 0, 0));
      return {
        fraction: t,
        point: sub(sample.a, mul(normal, sample.r)),
        normal,
      };
    }
    if (bound <= 1e-15) return null;
    const step = sample.gap / bound;
    if (t + step >= 1 - 1e-12) return null;
    t += Math.max(step, 1e-12);
  }
  throw new Error('Continuous collision iteration budget exceeded');
}
export function sweepVolumes(
  from: HitVolume,
  to: HitVolume,
  targetFrom: HitVolume,
  targetTo: HitVolume,
): SweepHit | null {
  const a = segment(from),
    b = segment(to),
    c = segment(targetFrom),
    d = segment(targetTo);
  return advance((t) => {
    const x = mix(a, b, t),
      y = mix(c, d, t);
    const [p, q] = nearest(x, y);
    return { a: p, b: q, gap: length(sub(p, q)) - x.r - y.r, r: x.r };
  }, speed(a, b) + speed(c, d));
}
const boxPoint = (p: Vector3, box: Box): Vector3 =>
  v(
    clamp(p.x, box.min.x, box.max.x),
    clamp(p.y, box.min.y, box.max.y),
    clamp(p.z, box.min.z, box.max.z),
  );
export function sweepBox(
  from: HitVolume,
  to: HitVolume,
  box: Box,
): SweepHit | null {
  if (
    !finite(box.min) ||
    !finite(box.max) ||
    box.min.x > box.max.x ||
    box.min.y > box.max.y ||
    box.min.z > box.max.z
  )
    throw new RangeError('Invalid box');
  const a = segment(from),
    b = segment(to);
  return advance(
    (t) => {
      const x = mix(a, b, t);
      let lo = 0,
        hi = 1;
      // Distance to a convex box along a line is convex. Minimize segment parameter.
      for (let i = 0; i < 64; i++) {
        const u = (2 * lo + hi) / 3,
          w = (lo + 2 * hi) / 3;
        const p = lerp(x.a, x.b, u),
          q = lerp(x.a, x.b, w);
        if (length(sub(p, boxPoint(p, box))) < length(sub(q, boxPoint(q, box))))
          hi = w;
        else lo = u;
      }
      const p = lerp(x.a, x.b, (lo + hi) / 2),
        q = boxPoint(p, box);
      return { a: p, b: q, gap: length(sub(p, q)) - x.r, r: x.r };
    },
    speed(a, b),
  );
}
