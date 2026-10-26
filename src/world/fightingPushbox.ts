import { requirePhysicalValue } from './character-motor';
import type { SpatialActor, Vector3 } from '../contracts';
import type { PathKey } from './character-motor';
import { add, dot, finite, lerp, mul, sub, v } from './math';
import type { StreetLayout } from './street-layout';
import { type Box, type SweepHit, sweepBox } from './swept-shapes';

export interface FightingPushboxTrajectory {
  readonly actor: SpatialActor;
  readonly path: readonly PathKey[];
  /** Accepted proxy extent, not mesh anatomy. */
  readonly verticalBounds: { readonly min: number; readonly max: number };
}
export interface FightingPushboxResult {
  readonly trajectories: readonly FightingPushboxTrajectory[];
  /** Explicit unswept corrections; never interpolate attacks through these. */
  readonly seams: readonly {
    readonly kind: 'initial-overlap';
    readonly at: number;
    readonly before: readonly Vector3[];
    readonly after: readonly Vector3[];
  }[];
}
const RADIUS = 0.35,
  DIAMETER = 0.7,
  NUMERIC = 1e-10;
/** Analytic time only for a genuinely flat vertical face. Rounded edges retain
 * the conservative query and may explicitly fail qualification if unresolved. */
function wallTime(
  p: Vector3,
  s: Vector3,
  duration: number,
  box: Box,
  hit: SweepHit,
): number {
  let time = duration * hit.fraction;
  if (Math.abs(hit.normal.z) > 1 - 1e-10 && s.z !== 0) {
    const exact =
      ((hit.normal.z < 0 ? box.min.z - RADIUS : box.max.z + RADIUS) - p.z) /
      s.z;
    const x = p.x + s.x * exact;
    if (exact >= 0 && exact <= duration && x >= box.min.x && x <= box.max.x)
      time = exact;
  } else if (Math.abs(hit.normal.x) > 1 - 1e-10 && s.x !== 0) {
    const exact =
      ((hit.normal.x < 0 ? box.min.x - RADIUS : box.max.x + RADIUS) - p.x) /
      s.x;
    const z = p.z + s.z * exact;
    if (exact >= 0 && exact <= duration && z >= box.min.z && z <= box.max.z)
      time = exact;
  }
  return time;
}
function at(path: readonly PathKey[], time: number): Vector3 {
  if (time <= requirePhysicalValue(path[0]).at)
    return requirePhysicalValue(path[0]).position;
  for (let i = 1; i < path.length; i++) {
    const a = requirePhysicalValue(path[i - 1]),
      b = requirePhysicalValue(path[i]);
    if (time <= b.at)
      return lerp(a.position, b.position, (time - a.at) / (b.at - a.at));
  }
  return requirePhysicalValue(path.at(-1)).position;
}
/** Use the source segment derivative at every union cut. Forming a huge
 * reciprocal first can overflow even when coordinates were individually finite. */
function pathVelocity(path: readonly PathKey[], time: number): Vector3 {
  for (let i = 1; i < path.length; i++) {
    const a = requirePhysicalValue(path[i - 1]),
      b = requirePhysicalValue(path[i]);
    if (
      time >= a.at &&
      (time < b.at || (i === path.length - 1 && time === b.at))
    ) {
      const duration = b.at - a.at,
        delta = sub(b.position, a.position);
      const speed = v(
        (delta.x / duration) * 1000,
        (delta.y / duration) * 1000,
        (delta.z / duration) * 1000,
      );
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !finite(delta) ||
        !finite(speed) ||
        (['x', 'y', 'z'] as const).some(
          (axis) => delta[axis] !== 0 && speed[axis] === 0,
        )
      )
        throw new RangeError(
          'Fighting pushbox physical arithmetic overflow/underflow',
        );
      return speed;
    }
  }
  throw new RangeError('Missing fighting pushbox velocity coverage');
}
/** Pure two-body continuous resolver. Source keys are velocity changes, not a
 * catch-up target: wall/pair-rejected root displacement never becomes debt. */
export function resolveFightingPushbox(input: {
  readonly from: number;
  readonly to: number;
  readonly trajectories: readonly FightingPushboxTrajectory[];
  readonly layout: StreetLayout;
  readonly obstacles: readonly Box[];
}): FightingPushboxResult {
  const { from, to, trajectories, layout, obstacles } = input;
  if (
    ![from, to].every(Number.isFinite) ||
    to < from ||
    trajectories.length > 2 ||
    !trajectories.length ||
    ![layout.bounds.min, layout.bounds.max].every(finite) ||
    layout.bounds.max.x - layout.bounds.min.x < DIAMETER ||
    layout.bounds.max.z - layout.bounds.min.z < DIAMETER
  )
    throw new RangeError('Invalid fighting pushbox interval');
  const ids = new Set<string>();
  for (const t of trajectories) {
    if (
      ids.has(t.actor.actorId) ||
      t.path.length < 2 ||
      t.path[0]?.at !== from ||
      t.path.at(-1)?.at !== to ||
      !Number.isFinite(t.verticalBounds.min) ||
      !Number.isFinite(t.verticalBounds.max) ||
      t.verticalBounds.max - t.verticalBounds.min < DIAMETER
    )
      throw new RangeError('Invalid fighting pushbox trajectory');
    ids.add(t.actor.actorId);
    for (let i = 0; i < t.path.length; i++)
      if (
        !finite(requirePhysicalValue(t.path[i]).position) ||
        !Number.isFinite(requirePhysicalValue(t.path[i]).at) ||
        (i > 0 &&
          requirePhysicalValue(t.path[i]).at <=
            requirePhysicalValue(t.path[i - 1]).at)
      )
        throw new RangeError('Invalid fighting pushbox keys');
    for (let i = 1; i < t.path.length; i++)
      pathVelocity(t.path, requirePhysicalValue(t.path[i - 1]).at);
  }
  for (const b of obstacles)
    if (
      !finite(b.min) ||
      !finite(b.max) ||
      b.min.x > b.max.x ||
      b.min.y > b.max.y ||
      b.min.z > b.max.z
    )
      throw new RangeError('Invalid fighting pushbox obstacle');
  const positions = trajectories.map((t) => ({
    ...requirePhysicalValue(t.path[0]).position,
  }));
  const paths: PathKey[][] = trajectories.map(() => []);
  const seams: FightingPushboxResult['seams'][number][] = [];
  let speeds = trajectories.map(() => v());
  let requestedSpeeds = speeds;
  let heightActive = false;
  const append = (time: number) =>
    positions.forEach((p, i) => {
      const key = { at: time, position: { ...p } },
        path = requirePhysicalValue(paths[i]);
      if (path.at(-1)?.at === time) path[path.length - 1] = key;
      else path.push(key);
    });
  const overlapY = (ps = positions) => {
    if (ps.length < 2) return false;
    const a = requirePhysicalValue(trajectories[0]).verticalBounds,
      b = requirePhysicalValue(trajectories[1]).verticalBounds;
    return (
      requirePhysicalValue(ps[0]).y + a.max >=
        requirePhysicalValue(ps[1]).y + b.min &&
      requirePhysicalValue(ps[1]).y + b.max >=
        requirePhysicalValue(ps[0]).y + a.min
    );
  };
  const capsule = (i: number, p: Vector3) => ({
    kind: 'capsule' as const,
    start: add(
      p,
      v(
        0,
        requirePhysicalValue(trajectories[i]).verticalBounds.min + RADIUS,
        0,
      ),
    ),
    end: add(
      p,
      v(
        0,
        requirePhysicalValue(trajectories[i]).verticalBounds.max - RADIUS,
        0,
      ),
    ),
    radiusM: RADIUS,
  });
  function normals(i: number): Vector3[] {
    const p = requirePhysicalValue(positions[i]),
      n: Vector3[] = [];
    if (p.x <= layout.bounds.min.x + RADIUS + NUMERIC) n.push(v(1, 0, 0));
    if (p.x >= layout.bounds.max.x - RADIUS - NUMERIC) n.push(v(-1, 0, 0));
    if (p.z <= layout.bounds.min.z + RADIUS + NUMERIC) n.push(v(0, 0, 1));
    if (p.z >= layout.bounds.max.z - RADIUS - NUMERIC) n.push(v(0, 0, -1));
    for (const b of obstacles) {
      const extent = requirePhysicalValue(trajectories[i]).verticalBounds;
      if (p.y + extent.max <= b.min.y || p.y + extent.min >= b.max.y) continue;
      const x = Math.max(b.min.x, Math.min(b.max.x, p.x)),
        z = Math.max(b.min.z, Math.min(b.max.z, p.z));
      const dx = p.x - x,
        dz = p.z - z,
        d = Math.hypot(dx, dz);
      if (d > 0 && d <= RADIUS + NUMERIC) n.push(v(dx / d, 0, dz / d));
    }
    return n;
  }
  const project = (value: Vector3, ns: readonly Vector3[]) => {
    let r = value;
    for (const n of ns) {
      const inward = dot(r, n);
      if (inward < 0) r = sub(r, mul(n, inward));
    }
    return r;
  };
  function constrain() {
    const ns = positions.map((_, i) => normals(i));
    speeds = speeds.map((s, i) => project(s, requirePhysicalValue(ns[i])));
    if (!heightActive) return;
    const delta = sub(
        requirePhysicalValue(positions[1]),
        requirePhysicalValue(positions[0]),
      ),
      d = Math.hypot(delta.x, delta.z);
    if (d > DIAMETER + NUMERIC) return;
    const n = d > NUMERIC ? v(delta.x / d, 0, delta.z / d) : v(1, 0, 0);
    const closing = -dot(
      sub(requirePhysicalValue(speeds[1]), requirePhysicalValue(speeds[0])),
      n,
    );
    if (closing <= NUMERIC) return;
    const a = project(mul(n, -1), requirePhysicalValue(ns[0])),
      b = project(n, requirePhysicalValue(ns[1]));
    const freedom = dot(sub(b, a), n);
    if (freedom <= NUMERIC)
      throw new RangeError('Infeasible fighting pushbox constraints');
    const impulse = closing / freedom;
    speeds[0] = add(requirePhysicalValue(speeds[0]), mul(a, impulse));
    speeds[1] = add(requirePhysicalValue(speeds[1]), mul(b, impulse));
  }
  function correctOverlap(time: number) {
    for (let i = 0; i < positions.length; i++) {
      const p = requirePhysicalValue(positions[i]);
      if (
        p.x < layout.bounds.min.x + RADIUS - NUMERIC ||
        p.x > layout.bounds.max.x - RADIUS + NUMERIC ||
        p.z < layout.bounds.min.z + RADIUS - NUMERIC ||
        p.z > layout.bounds.max.z - RADIUS + NUMERIC
      )
        throw new RangeError('Fighting pushbox starts outside bounds');
    }
    if (!heightActive) return;
    const delta = sub(
        requirePhysicalValue(positions[1]),
        requirePhysicalValue(positions[0]),
      ),
      d = Math.hypot(delta.x, delta.z);
    if (d >= DIAMETER - NUMERIC) return;
    const before = positions.map((p) => ({ ...p }));
    const n =
      d > NUMERIC
        ? v(delta.x / d, 0, delta.z / d)
        : v(
            requirePhysicalValue(trajectories[0]).actor.actorId <
              requirePhysicalValue(trajectories[1]).actor.actorId
              ? 1
              : -1,
            0,
            0,
          );
    const a = project(mul(n, -1), normals(0)),
      b = project(n, normals(1));
    const freedom = dot(sub(b, a), n);
    if (freedom <= NUMERIC)
      throw new RangeError('Infeasible fighting initial overlap');
    const ca = -dot(a, n),
      cb = dot(b, n),
      gap = DIAMETER - d;
    const capacity = (i: number, direction: Vector3) => {
      const p = requirePhysicalValue(positions[i]);
      let available = Infinity;
      for (const [distance, velocity] of [
        [p.x - layout.bounds.min.x - RADIUS, direction.x],
        [layout.bounds.max.x - RADIUS - p.x, -direction.x],
        [p.z - layout.bounds.min.z - RADIUS, direction.z],
        [layout.bounds.max.z - RADIUS - p.z, -direction.z],
      ])
        if (requirePhysicalValue(velocity) < 0)
          available = Math.min(
            available,
            Math.max(0, requirePhysicalValue(distance)) /
              -requirePhysicalValue(velocity),
          );
      const correctionRate = Math.abs(dot(direction, n));
      if (correctionRate <= NUMERIC) return 0;
      const probe = Math.min(available, gap / correctionRate);
      for (const box of obstacles) {
        const hit = sweepBox(
          capsule(i, p),
          capsule(i, add(p, mul(direction, probe))),
          box,
        );
        if (hit && dot(direction, hit.normal) < -NUMERIC)
          available = Math.min(
            available,
            wallTime(p, direction, probe, box, hit),
          );
      }
      return available;
    };
    let da = Math.min(gap / freedom, capacity(0, a)),
      db = Math.min(gap / freedom, capacity(1, b));
    let remaining = gap - ca * da - cb * db;
    if (remaining > NUMERIC && ca > NUMERIC) {
      const extra = Math.min(remaining / ca, capacity(0, a) - da);
      da += extra;
      remaining -= ca * extra;
    }
    if (remaining > NUMERIC && cb > NUMERIC) {
      const extra = Math.min(remaining / cb, capacity(1, b) - db);
      db += extra;
      remaining -= cb * extra;
    }
    if (remaining > NUMERIC)
      throw new RangeError('Insufficient space for fighting initial overlap');
    positions[0] = add(requirePhysicalValue(positions[0]), mul(a, da));
    positions[1] = add(requirePhysicalValue(positions[1]), mul(b, db));
    // Correction is not allowed to tunnel into a nearby wall.
    for (let i = 0; i < positions.length; i++)
      for (const box of obstacles) {
        const hit = sweepBox(
          capsule(i, requirePhysicalValue(before[i])),
          capsule(i, requirePhysicalValue(positions[i])),
          box,
        );
        if (
          hit &&
          dot(
            sub(
              requirePhysicalValue(positions[i]),
              requirePhysicalValue(before[i]),
            ),
            hit.normal,
          ) < -NUMERIC &&
          wallTime(
            requirePhysicalValue(before[i]),
            sub(
              requirePhysicalValue(positions[i]),
              requirePhysicalValue(before[i]),
            ),
            1,
            box,
            hit,
          ) < 1
        )
          throw new RangeError(
            'Initial fighting overlap correction obstructed',
          );
      }
    seams.push({
      kind: 'initial-overlap',
      at: time,
      before,
      after: positions.map((p) => ({ ...p })),
    });
  }
  const cuts = [
    ...new Set([
      from,
      to,
      ...trajectories.flatMap((t) => t.path.map((k) => k.at)),
    ]),
  ].sort((a, b) => a - b);
  // Height-overlap switches are real path cuts, not an endpoint-only test.
  const sourceCuts = [...cuts];
  if (trajectories.length === 2)
    for (let k = 1; k < sourceCuts.length; k++) {
      const a = requirePhysicalValue(sourceCuts[k - 1]),
        b = requirePhysicalValue(sourceCuts[k]),
        p0 = trajectories.map((t) => at(t.path, a)),
        p1 = trajectories.map((t) => at(t.path, b));
      const d0 = requirePhysicalValue(p0[1]).y - requirePhysicalValue(p0[0]).y,
        d1 = requirePhysicalValue(p1[1]).y - requirePhysicalValue(p1[0]).y;
      if (![d0, d1, d1 - d0].every(Number.isFinite))
        throw new RangeError('Fighting pushbox height arithmetic overflow');
      if (d0 !== d1)
        for (const threshold of [
          requirePhysicalValue(trajectories[0]).verticalBounds.max -
            requirePhysicalValue(trajectories[1]).verticalBounds.min,
          requirePhysicalValue(trajectories[0]).verticalBounds.min -
            requirePhysicalValue(trajectories[1]).verticalBounds.max,
        ]) {
          const u = (threshold - d0) / (d1 - d0);
          if (u > 0 && u < 1) cuts.push(a + (b - a) * u);
        }
    }
  cuts.sort((a, b) => a - b);
  append(from);
  let work = 0;
  for (let k = 1; k < cuts.length; k++) {
    let time = requirePhysicalValue(cuts[k - 1]);
    const end = requirePhysicalValue(cuts[k]);
    if (end === time) continue;
    speeds = trajectories.map((t) => pathVelocity(t.path, time));
    requestedSpeeds = speeds;
    // Height cuts make this classification constant on the open interval.
    // A midpoint is classification evidence, not an epsilon time advance.
    heightActive = overlapY(
      trajectories.map((t) => at(t.path, time + (end - time) / 2)),
    );
    correctOverlap(time);
    append(time);
    while (time < end) {
      if (++work > 1024)
        throw new RangeError('Fighting pushbox work budget exhausted');
      constrain();
      if (!speeds.every(finite) || !positions.every(finite))
        throw new RangeError('Fighting pushbox physical arithmetic overflow');
      const seconds = (end - time) / 1000;
      let delta = seconds;
      const consider = (dt: number) => {
        if (dt >= 0 && dt < delta) delta = dt;
      };
      for (let i = 0; i < positions.length; i++) {
        const p = requirePhysicalValue(positions[i]),
          s = requirePhysicalValue(speeds[i]);
        for (const [distance, velocity] of [
          [p.x - (layout.bounds.min.x + RADIUS), s.x],
          [layout.bounds.max.x - RADIUS - p.x, -s.x],
          [p.z - (layout.bounds.min.z + RADIUS), s.z],
          [layout.bounds.max.z - RADIUS - p.z, -s.z],
        ])
          if (requirePhysicalValue(velocity) < -NUMERIC)
            consider(
              Math.max(0, requirePhysicalValue(distance)) /
                -requirePhysicalValue(velocity),
            );
        for (const box of obstacles) {
          const hit = sweepBox(
            capsule(i, p),
            capsule(i, add(p, mul(s, seconds))),
            box,
          );
          if (hit && dot(s, hit.normal) < -NUMERIC) {
            consider(wallTime(p, s, seconds, box, hit));
          }
        }
      }
      if (positions.length === 2) {
        const p = sub(
            requirePhysicalValue(positions[1]),
            requirePhysicalValue(positions[0]),
          ),
          s = sub(
            requirePhysicalValue(speeds[1]),
            requirePhysicalValue(speeds[0]),
          );
        const aa = s.x * s.x + s.z * s.z,
          bb = 2 * (p.x * s.x + p.z * s.z),
          cc = p.x * p.x + p.z * p.z - DIAMETER * DIAMETER;
        const disc = bb * bb - 4 * aa * cc;
        if (![aa, bb, cc, disc].every(Number.isFinite))
          throw new RangeError('Fighting pushbox contact arithmetic overflow');
        if (aa > NUMERIC && bb < 0 && disc >= 0 && cc > NUMERIC) {
          const dt = (-bb - Math.sqrt(disc)) / (2 * aa);
          if (dt >= 0 && dt <= seconds && heightActive) consider(dt);
        }
      }
      if (delta <= NUMERIC)
        throw new RangeError('Fighting pushbox made no progress');
      positions.forEach((p, i) => {
        const next = add(p, mul(requirePhysicalValue(speeds[i]), delta));
        if (!finite(next))
          throw new RangeError(
            'Fighting pushbox physical integration overflow',
          );
        positions[i] = next;
      });
      time = delta === seconds ? end : time + delta * 1000;
      append(time);
    }
  }
  // Install the one-sided instantaneous endpoint velocity, not a chord or a
  // constraint that already ended at this height cut. Walls are rechecked below.
  speeds = requestedSpeeds;
  if (positions.length === 2) {
    const a = requirePhysicalValue(trajectories[0]).verticalBounds,
      b = requirePhysicalValue(trajectories[1]).verticalBounds;
    const first = requirePhysicalValue(positions[0]),
      second = requirePhysicalValue(positions[1]);
    const rate =
      requirePhysicalValue(speeds[0]).y - requirePhysicalValue(speeds[1]).y;
    const gapA = first.y + a.max - second.y - b.min,
      gapB = second.y + b.max - first.y - a.min;
    heightActive =
      (gapA > 0 || (gapA === 0 && rate >= 0)) &&
      (gapB > 0 || (gapB === 0 && rate <= 0));
  }
  constrain();
  if (!speeds.every(finite) || !positions.every(finite))
    throw new RangeError('Fighting pushbox endpoint arithmetic overflow');
  return {
    trajectories: trajectories.map((t, i) => ({
      ...t,
      path: requirePhysicalValue(paths[i]),
      actor: {
        ...t.actor,
        position: requirePhysicalValue(positions[i]),
        velocity: requirePhysicalValue(speeds[i]),
      },
    })),
    seams,
  };
}
