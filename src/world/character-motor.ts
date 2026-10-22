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
  delta: Vector3,
  from: number,
  to: number,
  layout: StreetLayout,
  obstacles: readonly Box[],
): readonly PathKey[] {
  let p = position,
    left = delta,
    time = from;
  const path: PathKey[] = [{ at: from, position: p }];
  const append = (at: number, point: Vector3) => {
    const last = path.at(-1);
    if (last && Math.abs(last.at - at) <= 1e-12)
      path[path.length - 1] = { at, position: point };
    else path.push({ at, position: point });
  };
  for (let iteration = 0; iteration < 12; iteration++) {
    if (length(left) <= 1e-10 || time >= to) {
      append(to, p);
      return path;
    }
    const end = add(p, left);
    let collision: { fraction: number; normal: Vector3 } | null = null;
    const consider = (fraction: number, normal: Vector3) => {
      if (
        fraction >= 0 &&
        fraction <= 1 &&
        dotInto(left, normal) < -1e-10 &&
        (!collision || fraction < collision.fraction)
      )
        collision = { fraction, normal };
    };
    for (const box of obstacles) {
      const hit = sweepBox(body(p), body(end), box);
      if (hit) consider(hit.fraction, hit.normal);
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
      if (plane.travel < 0)
        consider(Math.max(0, plane.distance) / -plane.travel, plane.normal);
    // Callback mutations are not inferred by TypeScript control-flow analysis.
    const hit = collision as { fraction: number; normal: Vector3 } | null;
    if (!hit) {
      append(to, end);
      return path;
    }
    p = add(p, mul(left, hit.fraction));
    time += (to - time) * hit.fraction;
    append(time, p);
    left = mul(left, 1 - hit.fraction);
    const inward = dotInto(left, hit.normal);
    if (inward < 0) left = sub(left, mul(hit.normal, inward));
  }
  throw new Error('Character collision response budget exceeded');
}
const dotInto = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
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
  const dt = (to - from) / 1000;
  let p = old.position,
    vy = old.velocity.y;
  if (jump && old.grounded && state.actions.jump.allowed) vy = 5.5;
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
    let dy: number;
    if (root?.verticalOwner === 'authored-root') {
      dy = authored.y;
      vy = seconds > 0 ? dy / seconds : 0;
    } else {
      dy = vy * seconds - 4.905 * seconds * seconds;
      vy -= 9.81 * seconds;
    }
    const resolved = slide(
      p,
      add(horizontal, v(0, dy, 0)),
      a,
      b,
      layout,
      obstacles,
    );
    const final = resolved.at(-1);
    if (!final) throw new Error('Empty resolved path');
    p = final.position;
    path.push(...resolved.slice(1));
    if (p.y <= 1e-8) {
      p = v(p.x, 0, p.z);
      vy = 0;
    }
  }
  const velocity = dt > 0 ? mul(sub(p, old.position), 1 / dt) : v();
  const grounded = p.y <= 1e-8;
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
