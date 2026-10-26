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
  floorY = 0,
  fighting = false,
): {
  path: readonly PathKey[];
  velocity: Vector3;
  pieces: readonly FightingMotorPiece[];
  collisions: readonly FightingMotorCollision[];
} {
  let p = position,
    speed = velocity,
    acceleration = v(0, gravity, 0),
    time = from;
  const travel = (seconds: number) =>
    add(mul(speed, seconds), mul(acceleration, (seconds * seconds) / 2));
  const path: PathKey[] = [{ at: from, position: p }];
  const pieces: FightingMotorPiece[] = [];
  const collisions: FightingMotorCollision[] = [];
  const segment = (end: number) => {
    if (end > time)
      pieces.push({
        from: time,
        to: end,
        position: p,
        velocity: speed,
        acceleration,
        frozen: false,
        grounded:
          (fighting ? p.y === floorY : Math.abs(p.y - floorY) <= 1e-8) &&
          speed.y <= 0 &&
          acceleration.y === 0,
      });
  };
  const append = (at: number, point: Vector3) => {
    const last = path.at(-1);
    if (last && (fighting ? last.at === at : Math.abs(last.at - at) <= 1e-12))
      path[path.length - 1] = { at, position: point };
    else path.push({ at, position: point });
  };
  for (let iteration = 0; iteration < 12; iteration++) {
    const remaining = (to - time) / 1000;
    const left = travel(remaining);
    if (
      (fighting
        ? left.x === 0 && left.y === 0 && left.z === 0
        : length(left) <= 1e-10) ||
      time >= to
    ) {
      segment(to);
      append(to, p);
      return {
        path,
        velocity: add(speed, mul(acceleration, remaining)),
        pieces,
        collisions,
      };
    }
    const end = add(p, left);
    let collision: FightingMotorResponse | null = null;
    const tied: FightingMotorResponse[] = [];
    const consider = (
      fraction: number,
      normal: Vector3,
      exact = false,
      surface: FightingMotorCollision['surface'] = 'obstacle',
    ) => {
      const at = time + (to - time) * fraction;
      const inside = fighting
        ? at >= time && at <= to
        : fraction >= 0 && fraction <= 1;
      if (inside && dotInto(left, normal) < (fighting ? 0 : -1e-10)) {
        const response = { fraction, at, normal, exact, surface };
        if (
          !collision ||
          (fighting ? at < collision.at : fraction < collision.fraction)
        ) {
          collision = response;
          tied.length = 0;
          tied.push(response);
        } else if (fighting && at === collision.at) {
          // The public game-time cut is authoritative. Distinct arithmetic
          // fractions may name exactly the SAME representable physical instant.
          tied.push(response);
        }
      }
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
          fighting,
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
            fighting,
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
        if (
          fighting &&
          (Math.abs(hit.normal.x) > 1 - 1e-10 ||
            Math.abs(hit.normal.z) > 1 - 1e-10)
        ) {
          const axis = Math.abs(hit.normal.x) > 1 - 1e-10 ? 'x' : 'z';
          const other = axis === 'x' ? 'z' : 'x';
          const target =
            hit.normal[axis] < 0 ? box.min[axis] - 0.35 : box.max[axis] + 0.35;
          const t = (target - p[axis]) / speed[axis];
          const point = add(p, travel(t));
          if (
            t >= 0 &&
            t <= remaining &&
            point[other] >= box.min[other] &&
            point[other] <= box.max[other] &&
            point.y + 1.5 >= box.min.y &&
            point.y + 0.35 <= box.max.y
          ) {
            fraction = t / remaining;
            exact = true;
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
      { distance: p.y - floorY, travel: left.y, normal: v(0, 1, 0) },
    ];
    for (const plane of planes)
      if (plane.travel < 0) {
        const t =
          plane.normal.y === 1
            ? verticalContact(
                p.y,
                speed.y,
                acceleration.y,
                floorY,
                remaining,
                fighting,
              )
            : null;
        consider(
          t === null
            ? Math.max(0, plane.distance) / -plane.travel
            : t / remaining,
          plane.normal,
          t !== null,
          plane.normal.y === 1 ? 'floor' : 'bounds',
        );
      }
    // Callback mutations are not inferred by TypeScript control-flow analysis.
    const hit = collision as FightingMotorResponse | null;
    if (!hit) {
      segment(to);
      append(to, end);
      return {
        path,
        velocity: add(speed, mul(acceleration, remaining)),
        pieces,
        collisions,
      };
    }
    const at = fighting ? hit.at : time + remaining * hit.fraction * 1000;
    // Evaluate the exact physical piece at its canonical timestamp, not using
    // a separately rounded fraction duration that can disagree with that cut.
    const elapsed = fighting ? (at - time) / 1000 : remaining * hit.fraction;
    segment(at);
    p = add(
      p,
      fighting || hit.exact ? travel(elapsed) : mul(left, hit.fraction),
    );
    const responses = fighting ? tied : [hit];
    if (fighting && responses.some((response) => response.surface === 'floor'))
      p = v(p.x, floorY, p.z);
    speed = add(speed, mul(acceleration, elapsed));
    time = at;
    append(time, p);
    for (const response of responses) {
      collisions.push({
        at: time,
        position: p,
        normal: response.normal,
        surface: response.surface,
      });
      const inward = dotInto(speed, response.normal);
      if (inward < 0) speed = sub(speed, mul(response.normal, inward));
      const force = dotInto(acceleration, response.normal);
      if (force < 0)
        acceleration = sub(acceleration, mul(response.normal, force));
    }
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
  exactStart = false,
): number | null {
  if (exactStart ? y === target : Math.abs(y - target) <= 1e-8) return 0;
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

/** Private physical response evidence, including zero-duration floor contact. */
interface FightingMotorResponse {
  readonly fraction: number;
  readonly at: number;
  readonly normal: Vector3;
  readonly exact: boolean;
  readonly surface: FightingMotorCollision['surface'];
}
interface FightingMotorCollision {
  readonly at: number;
  readonly position: Vector3;
  readonly normal: Vector3;
  readonly surface: 'floor' | 'bounds' | 'obstacle';
}
/** A resolved constant-force piece. Frozen pieces retain velocity as state but do
 * not integrate it. This is physical evidence, never an independently running clock. */
export interface FightingMotorPiece {
  readonly from: number;
  readonly to: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly acceleration: Vector3;
  readonly frozen: boolean;
  readonly grounded: boolean;
}
export interface FightingMotorSlice {
  readonly from: number;
  readonly to: number;
  readonly frozen: boolean;
  /** Authored horizontal transport already mapped from the supplied motion clock. */
  readonly horizontalDelta?: Vector3;
}
export interface FightingMotorProjection extends MotorResult {
  readonly from: number;
  readonly to: number;
  readonly pieces: readonly FightingMotorPiece[];
  readonly seams: readonly {
    readonly kind: 'takeoff' | 'landing';
    readonly at: number;
    readonly supportId: string;
    readonly planeY: number;
  }[];
}
/** New-mode fixed-plane motor. Legacy stepCharacter remains a separate route. */
export function projectFightingMotor(input: {
  readonly actor: SpatialActor;
  readonly from: number;
  readonly to: number;
  readonly slices: readonly FightingMotorSlice[];
  readonly support: { readonly supportId: string; readonly planeY: number };
  readonly layout: StreetLayout;
  readonly obstacles: readonly Box[];
  readonly movement?: Vector3;
  readonly movementAllowed?: boolean;
  readonly jumpRequested?: boolean;
  readonly jumpAllowed?: boolean;
}): FightingMotorProjection {
  const { actor, from, to, slices, support, layout, obstacles } = input;
  assertFiniteMotorInterval(from, to);
  if (
    from < 0 ||
    to < from ||
    !support.supportId ||
    !Number.isFinite(support.planeY) ||
    actor.position.x < layout.bounds.min.x + 0.35 ||
    actor.position.x > layout.bounds.max.x - 0.35 ||
    actor.position.z < layout.bounds.min.z + 0.35 ||
    actor.position.z > layout.bounds.max.z - 0.35 ||
    ![
      actor.position,
      actor.velocity,
      actor.facing,
      input.movement ?? v(),
    ].every((p) => [p.x, p.y, p.z].every(Number.isFinite)) ||
    actor.position.y < support.planeY - 1e-8 ||
    // Grounded is exact installed support authority, for frozen and live slices.
    // Reject mismatching anchors rather than silently snapping or changing mode.
    (actor.grounded && actor.position.y !== support.planeY)
  )
    throw new RangeError('Invalid fighting fixed-plane state');
  let cursor = from;
  for (const slice of slices) {
    if (
      slice.from !== cursor ||
      slice.to <= slice.from ||
      slice.to > to ||
      !Number.isFinite(slice.to) ||
      (slice.horizontalDelta &&
        (!finiteDelta(slice.horizontalDelta) || slice.horizontalDelta.y !== 0))
    )
      throw new RangeError('Invalid fighting motor clock coverage');
    cursor = slice.to;
  }
  if (cursor !== to)
    throw new RangeError('Missing fighting motor clock coverage');
  let p = { ...actor.position },
    speed = { ...actor.velocity },
    grounded = actor.grounded;
  const path: PathKey[] = [{ at: from, position: p }];
  const pieces: FightingMotorPiece[] = [],
    seams: FightingMotorProjection['seams'][number][] = [];
  let jumped = false;
  const append = (key: PathKey) => {
    if (path.at(-1)?.at === key.at) path[path.length - 1] = key;
    else path.push(key);
  };
  for (const slice of slices) {
    if (slice.frozen) {
      pieces.push({
        from: slice.from,
        to: slice.to,
        position: p,
        velocity: speed,
        acceleration: v(),
        frozen: true,
        grounded,
      });
      append({ at: slice.to, position: p });
      continue;
    }
    const seconds = (slice.to - slice.from) / 1000;
    const groundSpeed = slice.horizontalDelta
      ? mul(slice.horizontalDelta, 1 / seconds)
      : mul(input.movement ?? v(), input.movementAllowed ? 4 : 0);
    if (grounded) speed = v(groundSpeed.x, 0, groundSpeed.z);
    if (!jumped && input.jumpRequested && input.jumpAllowed && grounded) {
      jumped = true;
      grounded = false;
      speed = v(speed.x, 5.5, speed.z);
      seams.push({ kind: 'takeoff', at: slice.from, ...support });
    }
    // In air the accepted takeoff velocity is the only horizontal movement owner.
    let time = slice.from;
    const apex =
      !grounded && speed.y > 0 ? time + (speed.y / 9.81) * 1000 : slice.to;
    const cuts = apex > time && apex < slice.to ? [apex, slice.to] : [slice.to];
    for (const end of cuts) {
      const wasGrounded = grounded;
      const result = slide(
        p,
        speed,
        grounded ? 0 : -9.81,
        time,
        end,
        layout,
        obstacles,
        support.planeY,
        true,
      );
      if (
        !finiteDelta(result.velocity) ||
        result.path.some((key) => !finiteDelta(key.position))
      )
        throw new RangeError('Fighting motor physical arithmetic overflow');
      for (const collision of result.collisions) {
        if (collision.surface === 'floor') {
          if (!grounded)
            seams.push({ kind: 'landing', at: collision.at, ...support });
          grounded = true;
        } else if (
          collision.normal.y > 0 &&
          collision.position.y !== support.planeY
        ) {
          throw new RangeError('Unqualified fighting support plane change');
        }
      }
      pieces.push(...result.pieces);
      for (const key of result.path.slice(1)) append(key);
      p = { ...requirePhysicalValue(result.path.at(-1)).position };
      speed = result.velocity;
      grounded =
        (wasGrounded || result.collisions.some((c) => c.surface === 'floor')) &&
        speed.y <= 0 &&
        p.y === support.planeY;
      if (grounded) {
        p = v(p.x, support.planeY, p.z);
        speed = v(speed.x, 0, speed.z);
        append({ at: end, position: p });
      }
      time = end;
    }
  }
  const resolved: SpatialActor = {
    ...actor,
    position: p,
    velocity: speed,
    grounded,
    locomotion: !grounded
      ? 'jump'
      : Math.hypot(speed.x, speed.z) < 0.01
        ? 'idle'
        : Math.hypot(speed.x, speed.z) > 2
          ? 'run'
          : 'walk',
  };
  return { from, to, actor: resolved, path, pieces, seams };
}
function finiteDelta(p: Vector3): boolean {
  return [p.x, p.y, p.z].every(Number.isFinite);
}
/** Exact state at a cut; never infer velocity from a whole-interval displacement. */
export function sampleFightingMotor(
  result: FightingMotorProjection,
  at: number,
): SpatialActor {
  if (!Number.isFinite(at) || at < result.from || at > result.to)
    throw new RangeError('Fighting motor cut outside interval');
  if (at === result.to) return result.actor;
  const piece = result.pieces.find((p) => at >= p.from && at < p.to);
  if (!piece) throw new RangeError('Missing fighting motor piece');
  const dt = piece.frozen ? 0 : (at - piece.from) / 1000;
  const position = add(
    piece.position,
    add(mul(piece.velocity, dt), mul(piece.acceleration, (dt * dt) / 2)),
  );
  const velocity = add(piece.velocity, mul(piece.acceleration, dt));
  return {
    ...result.actor,
    position,
    velocity,
    grounded: piece.grounded,
    locomotion: piece.grounded
      ? result.actor.locomotion === 'jump'
        ? 'idle'
        : result.actor.locomotion
      : 'jump',
  };
}

/** Checked physical invariant, not a compile-only non-null assertion. */
export function requirePhysicalValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Missing fighting physical invariant');
  return value;
}
