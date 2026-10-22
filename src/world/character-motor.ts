import type {
  ActorState,
  MotionIntervalSample,
  SpatialActor,
  Vector3,
} from '../contracts';
import { add, clamp, length, localToWorld, mul, sub, unit, v } from './math';
import type { StreetLayout } from './street-layout';
import { type Box, sweepBox } from './swept-shapes';
export interface PathKey {
  readonly at: number;
  readonly position: Vector3;
}
export interface MotorResult {
  readonly actor: SpatialActor;
  readonly path: readonly PathKey[];
}
export function body(position: Vector3) {
  return {
    kind: 'capsule' as const,
    start: add(position, v(0, 0.35, 0)),
    end: add(position, v(0, 1.5, 0)),
    radiusM: 0.35,
  };
}
export const toBox = (position: Vector3, halfExtents: Vector3): Box => ({
  min: sub(position, halfExtents),
  max: add(position, halfExtents),
});
/** Resolve each contact in its original time coordinate. The returned bend/stop keys
 * are also the gameplay trajectory; final-pose interpolation must never replace them. */
function slide(
  position: Vector3,
  velocity: Vector3,
  gravity: number,
  from: number,
  to: number,
  layout: StreetLayout,
  obstacles: readonly Box[],
): { path: readonly PathKey[]; velocity: Vector3 } {
  let p = position,
    speed = velocity,
    acceleration = v(0, gravity, 0),
    time = from;
  const travel = (seconds: number) =>
    add(mul(speed, seconds), mul(acceleration, (seconds * seconds) / 2));
  const path: PathKey[] = [{ at: from, position: p }];
  const append = (at: number, point: Vector3) => {
    const last = path.at(-1);
    if (last && Math.abs(last.at - at) <= 1e-12)
      path[path.length - 1] = { at, position: point };
    else path.push({ at, position: point });
  };
  for (let iteration = 0; iteration < 12; iteration++) {
    const remaining = (to - time) / 1000;
    const left = travel(remaining);
    if (length(left) <= 1e-10 || time >= to) {
      append(to, p);
      return { path, velocity: add(speed, mul(acceleration, remaining)) };
    }
    const end = add(p, left);
    let collision: {
      fraction: number;
      normal: Vector3;
      exact: boolean;
    } | null = null;
    const consider = (fraction: number, normal: Vector3, exact = false) => {
      if (
        fraction >= 0 &&
        fraction <= 1 &&
        dotInto(left, normal) < -1e-10 &&
        (!collision || fraction < collision.fraction)
      )
        collision = { fraction, normal, exact };
    };
    for (const box of obstacles) {
      // Generic contact candidates are half-open; motor endpoint contact still
      // cancels velocity before the next interval can remove the obstacle.
      for (const face of [
        { y: box.max.y, normal: v(0, 1, 0) },
        { y: box.min.y - 1.85, normal: v(0, -1, 0) },
      ]) {
        const t = verticalContact(
          p.y,
          speed.y,
          acceleration.y,
          face.y,
          remaining,
        );
        if (t !== null) {
          const point = add(p, travel(t));
          if (
            point.x >= box.min.x &&
            point.x <= box.max.x &&
            point.z >= box.min.z &&
            point.z <= box.max.z
          )
            consider(t / remaining, face.normal, true);
        }
      }
      const hit = sweepBox(body(p), body(end), box);
      if (hit) {
        let fraction = hit.fraction;
        let exact = false;
        // Only a genuinely flat face may use the vertical quadratic. Rounded
        // capsule/box edges retain the existing conservative linear query.
        if (Math.abs(hit.normal.y) > 1 - 1e-10) {
          const targetY = hit.normal.y > 0 ? box.max.y : box.min.y - 1.85;
          const t = verticalContact(
            p.y,
            speed.y,
            acceleration.y,
            targetY,
            remaining,
          );
          if (t !== null) {
            const point = add(p, travel(t));
            if (
              point.x >= box.min.x &&
              point.x <= box.max.x &&
              point.z >= box.min.z &&
              point.z <= box.max.z
            ) {
              fraction = t / remaining;
              exact = true;
            }
          }
        }
        consider(fraction, hit.normal, exact);
      }
    }
    // The ground and rectangle edges are collision planes, not after-the-fact clamps.
    const planes = [
      {
        distance: p.x - (layout.bounds.min.x + 0.35),
        travel: left.x,
        normal: v(1, 0, 0),
      },
      {
        distance: layout.bounds.max.x - 0.35 - p.x,
        travel: -left.x,
        normal: v(-1, 0, 0),
      },
      {
        distance: p.z - (layout.bounds.min.z + 0.35),
        travel: left.z,
        normal: v(0, 0, 1),
      },
      {
        distance: layout.bounds.max.z - 0.35 - p.z,
        travel: -left.z,
        normal: v(0, 0, -1),
      },
      { distance: p.y, travel: left.y, normal: v(0, 1, 0) },
    ];
    for (const plane of planes)
      if (plane.travel < 0) {
        const t =
          plane.normal.y === 1
            ? verticalContact(p.y, speed.y, acceleration.y, 0, remaining)
            : null;
        consider(
          t === null
            ? Math.max(0, plane.distance) / -plane.travel
            : t / remaining,
          plane.normal,
          t !== null,
        );
      }
    // Callback mutations are not inferred by TypeScript control-flow analysis.
    const hit = collision as {
      fraction: number;
      normal: Vector3;
      exact: boolean;
    } | null;
    if (!hit) {
      append(to, end);
      return { path, velocity: add(speed, mul(acceleration, remaining)) };
    }
    const elapsed = remaining * hit.fraction;
    p = add(p, hit.exact ? travel(elapsed) : mul(left, hit.fraction));
    speed = add(speed, mul(acceleration, elapsed));
    time += elapsed * 1000;
    append(time, p);
    const inward = dotInto(speed, hit.normal);
    if (inward < 0) speed = sub(speed, mul(hit.normal, inward));
    const force = dotInto(acceleration, hit.normal);
    if (force < 0) acceleration = sub(acceleration, mul(hit.normal, force));
  }
  throw new Error('Character collision response budget exceeded');
}
/** Earliest vertical crossing within a monotone (apex-split) interval. */
function verticalContact(
  y: number,
  vy: number,
  ay: number,
  target: number,
  duration: number,
): number | null {
  if (Math.abs(y - target) <= 1e-8) return 0;
  if (ay === 0) {
    const t = (target - y) / vy;
    return t >= 0 && t <= duration ? t : null;
  }
  const discriminant = vy * vy - 2 * ay * (y - target);
  if (discriminant < 0) return null;
  const roots = [
    (-vy - Math.sqrt(discriminant)) / ay,
    (-vy + Math.sqrt(discriminant)) / ay,
  ];
  return (
    roots.filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b)[0] ??
    null
  );
}
function supported(p: Vector3, obstacles: readonly Box[]): boolean {
  return (
    p.y <= 1e-8 ||
    obstacles.some(
      (box) =>
        Math.abs(p.y - box.max.y) <= 1e-8 &&
        p.x >= box.min.x &&
        p.x <= box.max.x &&
        p.z >= box.min.z &&
        p.z <= box.max.z,
    )
  );
}
const dotInto = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
/** Arithmetic-domain guard, not a gameplay duration cap. Public callers run this
 * before committing tick/residency state; the pure motor also defends itself. */
export function assertFiniteMotorInterval(from: number, to: number): void {
  const seconds = (to - from) / 1000;
  if (
    ![from, to, to - from, 9.81 * seconds, 4.905 * seconds * seconds].every(
      Number.isFinite,
    )
  )
    throw new RangeError('Spatial interval integration arithmetic overflow');
}
export function stepCharacter(
  old: SpatialActor,
  state: ActorState,
  from: number,
  to: number,
  movement: Vector3,
  jump: boolean,
  sample: MotionIntervalSample | undefined,
  attackStart: number,
  layout: StreetLayout,
  obstacles: readonly Box[],
): MotorResult {
  assertFiniteMotorInterval(from, to);
  const dt = (to - from) / 1000;
  let p = old.position,
    vy = old.velocity.y;
  if (
    jump &&
    old.grounded &&
    supported(p, obstacles) &&
    state.actions.jump.allowed
  )
    vy = 5.5;
  const path: PathKey[] = [{ at: from, position: p }];
  const cuts = new Set([from, to]);
  for (const r of sample?.rootSegments ?? []) {
    cuts.add(Math.max(from, Math.min(to, attackStart + r.from.atMs)));
    cuts.add(Math.max(from, Math.min(to, attackStart + r.to.atMs)));
  }
  for (const h of sample?.hitVolumeSegments ?? []) {
    cuts.add(Math.max(from, Math.min(to, attackStart + h.fromMs)));
    cuts.add(Math.max(from, Math.min(to, attackStart + h.toMs)));
  }
  const times = [...cuts].sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1]!,
      b = times[i]!,
      seconds = (b - a) / 1000;
    const root = sample?.rootSegments.find(
      (r) =>
        attackStart + r.from.atMs <= a + 1e-8 &&
        attackStart + r.to.atMs >= b - 1e-8,
    );
    const factor = root ? (b - a) / (root.to.atMs - root.from.atMs) : 0;
    const authored = root
      ? localToWorld(mul(root.deltaTranslation, factor), old.facing)
      : v();
    const horizontal =
      root?.horizontalOwner === 'authored-root'
        ? v(authored.x, 0, authored.z)
        : mul(movement, state.actions.move.allowed ? 4 * seconds : 0);
    const authoredY = root?.verticalOwner === 'authored-root';
    if (authoredY) vy = seconds > 0 ? authored.y / seconds : 0;
    // Preserve accepted durations. Beyond 256 slices the explicit chord-error
    // bound is 9.81 * (seconds / 256)^2 / 8, not fixed-step precision.
    const count = authoredY
      ? 1
      : Math.min(256, Math.max(1, Math.ceil(seconds * 240)));
    const horizontalSpeed = seconds > 0 ? mul(horizontal, 1 / seconds) : v();
    for (let slice = 0; slice < count; slice++) {
      let begin = a + (b - a) * (slice / count);
      const finish = a + (b - a) * ((slice + 1) / count);
      // At most one extra apex cut per slice. Each sweep remains monotone in Y.
      let apexCut = false;
      while (begin < finish) {
        const apex =
          !apexCut && !authoredY && vy > 0
            ? begin + (vy / 9.81) * 1000
            : finish;
        const end = apex > begin && apex < finish ? apex : finish;
        apexCut = true;
        const resolved = slide(
          p,
          v(horizontalSpeed.x, vy, horizontalSpeed.z),
          authoredY ? 0 : -9.81,
          begin,
          end,
          layout,
          obstacles,
        );
        const final = resolved.path.at(-1);
        if (!final) throw new Error('Empty resolved path');
        p = final.position;
        vy = resolved.velocity.y;
        path.push(...resolved.path.slice(1));
        if (p.y <= 1e-8) p = v(p.x, 0, p.z);
        if (vy <= 0 && supported(p, obstacles)) vy = 0;
        begin = end;
      }
    }
  }
  const velocity = dt > 0 ? mul(sub(p, old.position), 1 / dt) : v();
  const grounded = vy <= 0 && supported(p, obstacles);
  return {
    actor: {
      ...old,
      position: p,
      velocity: v(velocity.x, grounded ? 0 : vy, velocity.z),
      grounded,
      locomotion: !grounded
        ? 'jump'
        : Math.hypot(velocity.x, velocity.z) < 0.01
          ? 'idle'
          : Math.hypot(velocity.x, velocity.z) > 2
            ? 'run'
            : 'walk',
    },
    path,
  };
}
export function faceToward(
  old: Vector3,
  target: Vector3,
  maxAngle: number,
): Vector3 {
  const desired = unit(v(target.x, 0, target.z), old);
  let difference = Math.atan2(desired.x, desired.z) - Math.atan2(old.x, old.z);
  difference = Math.atan2(Math.sin(difference), Math.cos(difference));
  const angle =
    Math.atan2(old.x, old.z) + clamp(difference, -maxAngle, maxAngle);
  return v(Math.sin(angle), 0, Math.cos(angle));
}
