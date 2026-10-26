import { requirePhysicalValue } from './character-motor';
import {
  type ActorState,
  contactId,
  type GameSnapshot,
  gameTimeMs,
  type HitVolume,
  type ImpactReference,
  type MotionIntervalSample,
  type RunId,
  type SpatialActor,
  type SpatialCandidate,
  type Vector3,
} from '../contracts';
import { type PathKey, toBox } from './character-motor';
import {
  combatHurt,
  validateHurtRegions,
  type HurtRegionSegment,
} from './combat-hurt';
import { add, lerp, localToWorld } from './math';
import {
  interpolateVolume,
  type SweepHit,
  sweepBox,
  sweepVolumes,
} from './swept-shapes';
export interface ActorTrajectory {
  readonly state: ActorState;
  readonly actor: SpatialActor;
  readonly path: readonly PathKey[];
  readonly sample: MotionIntervalSample | undefined;
}
export function positionAt(path: readonly PathKey[], time: number): Vector3 {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!;
    if (time <= b.at)
      return lerp(
        a.position,
        b.position,
        Math.max(0, Math.min(1, (time - a.at) / (b.at - a.at))),
      );
  }
  const last = path.at(-1);
  if (!last) throw new Error('Empty physical trajectory');
  return last.position;
}
function worldVolume(
  volume: HitVolume,
  position: Vector3,
  facing: Vector3,
): HitVolume {
  const transform = (p: Vector3) => add(position, localToWorld(p, facing));
  return volume.kind === 'sphere'
    ? { ...volume, center: transform(volume.center) }
    : { ...volume, start: transform(volume.start), end: transform(volume.end) };
}
export interface ActiveSweep {
  readonly owner: ActorTrajectory;
  readonly source: ImpactReference;
  readonly from: number;
  readonly to: number;
  readonly start: HitVolume;
  readonly end: HitVolume;
}
export function attackSweeps(trajectory: ActorTrajectory): ActiveSweep[] {
  const attack = trajectory.state.attack;
  if (!attack) return [];
  const result: ActiveSweep[] = [];
  for (const h of trajectory.sample?.hitVolumeSegments ?? []) {
    const binding = attack.impactBindings.find(
      (b) => b.impactIndex === h.impactIndex,
    );
    if (!binding) throw new Error('Unbound runtime impact');
    if (attack.consumedImpacts.includes(binding.impactId)) continue;
    const start = Math.max(h.fromMs, h.activeWindow.startMs) + attack.startedAt;
    const end = Math.min(h.toMs, h.activeWindow.endMs) + attack.startedAt;
    if (end <= start) continue;
    const cuts = [
      start,
      ...trajectory.path.map((p) => p.at).filter((t) => t > start && t < end),
      end,
    ];
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1]!,
        to = cuts[i]!;
      const sampleAt = (t: number) =>
        interpolateVolume(
          h.from,
          h.to,
          (t - attack.startedAt - h.fromMs) / (h.toMs - h.fromMs),
        );
      result.push({
        owner: trajectory,
        source: {
          actorId: trajectory.state.actorId,
          activationId: attack.activationId,
          impactId: binding.impactId,
        },
        from,
        to,
        start: worldVolume(
          sampleAt(from),
          positionAt(trajectory.path, from),
          trajectory.actor.facing,
        ),
        end: worldVolume(
          sampleAt(to),
          positionAt(trajectory.path, to),
          trajectory.actor.facing,
        ),
      });
    }
  }
  return result;
}
export function envelope(
  runId: RunId,
  kind: string,
  keys: readonly unknown[],
  from: number,
  to: number,
  hit: SweepHit,
) {
  return {
    runId,
    contactId: contactId(JSON.stringify([kind, ...keys, from, to])),
    at: gameTimeMs(from + (to - from) * hit.fraction),
    interval: { from: gameTimeMs(from), to: gameTimeMs(to) },
    point: hit.point,
    evidence: 'swept-shape' as const,
  };
}
/** Opt-in pre-sampled qualification seam. Not wired by the spatial engine.
 * Identity guards reject detached target snapshots, not dishonest provenance.
 * sourceId/poseId are declarations only and never certify actual source anatomy.
 */
export interface CombatHurtRegions {
  readonly runId: RunId;
  readonly target: ActorTrajectory;
  readonly sourceId: string;
  readonly poseId: string;
  readonly space: 'actor-local-metres';
  readonly interpolation: 'piecewise-linear';
  readonly segments: readonly HurtRegionSegment[];
}
export function combatContacts(
  run: RunId,
  actors: readonly ActorTrajectory[],
  regions?: readonly CombatHurtRegions[],
): SpatialCandidate[] {
  const candidates: SpatialCandidate[] = [];
  const supplied = new Map<ActorTrajectory, readonly HurtRegionSegment[]>();
  if (regions !== undefined) {
    if (regions.length !== actors.length)
      throw new RangeError('Missing hurt target');
    for (const input of regions) {
      if (
        input.runId !== run ||
        !actors.includes(input.target) ||
        supplied.has(input.target) ||
        !input.sourceId ||
        !input.poseId ||
        input.space !== 'actor-local-metres' ||
        input.interpolation !== 'piecewise-linear'
      )
        throw new RangeError('Invalid hurt target provenance');
      const path = input.target.path;
      supplied.set(
        input.target,
        validateHurtRegions(
          input.segments,
          path[0]?.at ?? NaN,
          path.at(-1)?.at ?? NaN,
        ),
      );
    }
  }
  const sweeps = actors.flatMap(attackSweeps);
  for (const sweep of sweeps) {
    for (const target of actors) {
      if (target.state.actorId === sweep.source.actorId) continue;
      if (regions !== undefined) {
        const parts = supplied.get(target);
        if (!parts) throw new RangeError('Missing hurt target');
        validateHurtRegions(parts, sweep.from, sweep.to);
        const cuts = [
          ...new Set(
            [
              sweep.from,
              sweep.to,
              ...target.path.map((k) => k.at),
              ...parts.flatMap((p) => [p.from, p.to]),
            ].filter((t) => t >= sweep.from && t <= sweep.to),
          ),
        ].sort((a, b) => a - b);
        for (let i = 1; i < cuts.length; i++) {
          const from = cuts[i - 1],
            to = cuts[i];
          if (from === undefined || to === undefined)
            throw new RangeError('Missing hurt interval');
          let earliest: SweepHit | undefined;
          // Validation sorts stable part IDs; strict comparison preserves exact ties.
          for (const part of parts) {
            if (part.from > from || part.to < to) continue;
            const at = (t: number) =>
              worldVolume(
                interpolateVolume(
                  part.start,
                  part.end,
                  (t - part.from) / (part.to - part.from),
                ),
                positionAt(target.path, t),
                target.actor.facing,
              );
            const hit = sweepVolumes(
              interpolateVolume(
                sweep.start,
                sweep.end,
                (from - sweep.from) / (sweep.to - sweep.from),
              ),
              interpolateVolume(
                sweep.start,
                sweep.end,
                (to - sweep.from) / (sweep.to - sweep.from),
              ),
              at(from),
              at(to),
            );
            if (
              hit &&
              hit.fraction < 1 &&
              (!earliest || hit.fraction < earliest.fraction)
            )
              earliest = hit;
          }
          if (earliest)
            candidates.push({
              ...envelope(
                run,
                'body-hit',
                [sweep.source.impactId, target.state.actorId],
                from,
                to,
                earliest,
              ),
              kind: 'body-hit',
              source: sweep.source,
              targetActorId: target.state.actorId,
            });
        }
        continue;
      }
      // A single finalized Core stance owns this entire admitted interval.
      // Never sweep between old standing and new low capsule endpoints.
      const crouching =
        target.state.crouching === true &&
        target.actor.grounded &&
        !target.state.attack &&
        !target.state.defeated;
      const cuts = [
        sweep.from,
        ...target.path
          .map((k) => k.at)
          .filter((t) => t > sweep.from && t < sweep.to),
        sweep.to,
      ];
      for (let i = 1; i < cuts.length; i++) {
        const from = cuts[i - 1]!,
          to = cuts[i]!;
        const hit = sweepVolumes(
          interpolateVolume(
            sweep.start,
            sweep.end,
            (from - sweep.from) / (sweep.to - sweep.from),
          ),
          interpolateVolume(
            sweep.start,
            sweep.end,
            (to - sweep.from) / (sweep.to - sweep.from),
          ),
          combatHurt(positionAt(target.path, from), crouching),
          combatHurt(positionAt(target.path, to), crouching),
        );
        if (hit)
          candidates.push({
            ...envelope(
              run,
              'body-hit',
              [sweep.source.impactId, target.state.actorId],
              from,
              to,
              hit,
            ),
            kind: 'body-hit',
            source: sweep.source,
            targetActorId: target.state.actorId,
          });
      }
    }
  }
  for (let i = 0; i < sweeps.length; i++)
    for (let j = i + 1; j < sweeps.length; j++) {
      const a = sweeps[i]!,
        b = sweeps[j]!;
      if (a.source.actorId === b.source.actorId) continue;
      const from = Math.max(a.from, b.from),
        to = Math.min(a.to, b.to);
      if (to <= from) continue;
      const at = (s: ActiveSweep, t: number) =>
        interpolateVolume(s.start, s.end, (t - s.from) / (s.to - s.from));
      const hit = sweepVolumes(at(a, from), at(a, to), at(b, from), at(b, to));
      if (hit) {
        const [first, second] =
          a.source.impactId < b.source.impactId
            ? [a.source, b.source]
            : [b.source, a.source];
        candidates.push({
          ...envelope(
            run,
            'clash',
            [first.impactId, second.impactId],
            from,
            to,
            hit,
          ),
          kind: 'clash',
          first,
          second,
        });
      }
    }
  return candidates;
}

/** Direct strikes report A impact provenance, never a durability delta. */
export function streetContacts(
  run: RunId,
  state: GameSnapshot,
  actors: readonly ActorTrajectory[],
  objects: readonly {
    objectId: import('../contracts').WorldObjectId;
    position: Vector3;
    halfExtents: Vector3;
  }[],
): SpatialCandidate[] {
  const candidates: SpatialCandidate[] = [];
  for (const sweep of actors.flatMap(attackSweeps))
    for (const object of objects) {
      const authority = state.world.objects.find(
        (o) => o.objectId === object.objectId,
      );
      if (!authority || authority.destroyed) continue;
      const hit = sweepBox(
        sweep.start,
        sweep.end,
        toBox(object.position, object.halfExtents),
      );
      if (hit)
        candidates.push({
          ...envelope(
            run,
            'destruction',
            [sweep.source.impactId, object.objectId],
            sweep.from,
            sweep.to,
            hit,
          ),
          kind: 'destruction',
          source: sweep.source,
          sourceActorId: sweep.source.actorId,
          targetId: object.objectId,
          launchId: null,
          contactSpeedMps: 0,
        });
    }
  return candidates;
}

/** Point sampling has no interval qualification claim. In particular arbitrary
 * C IK samples cannot be promoted to a piecewise-linear sweep by this helper. */
export function fightingMotionAt(
  clock: import('../contracts').FightingClock,
  at: number,
): {
  readonly slice: import('../contracts').FightingClockSlice;
  readonly motionMs: number;
} | null {
  if (!Number.isFinite(at))
    throw new RangeError('Invalid fighting sample time');
  const slice = clock.slices.find((s) => at >= s.fromGameMs && at < s.toGameMs);
  if (!slice) return null;
  const duration = slice.toGameMs - slice.fromGameMs;
  if (
    duration <= 0 ||
    slice.toMotionMs < slice.fromMotionMs ||
    (slice.frozen && slice.toMotionMs !== slice.fromMotionMs)
  )
    throw new RangeError('Invalid fighting motion clock');
  return {
    slice,
    motionMs:
      slice.fromMotionMs +
      ((slice.toMotionMs - slice.fromMotionMs) * (at - slice.fromGameMs)) /
        duration,
  };
}
export function sampleFightingPoseGeometry(input: {
  readonly runId: RunId;
  readonly sampler: import('../contracts').FightingRecipeSamplerPort;
  readonly clipId: import('../contracts').ClipId;
  readonly phase: import('../contracts').FightingCombatantState['phase'];
  readonly posture: import('../contracts').FightingPosture;
  readonly motionMs: number;
  readonly actor: SpatialActor;
  readonly epochOrigin: Vector3;
  readonly groundClearanceM: number;
  readonly incoming?: import('../contracts').FightingRecipeEntry;
}) {
  const { actor, epochOrigin, sampler } = input,
    facing = actor.facing;
  if (
    sampler.runId !== input.runId ||
    sampler.actorId !== actor.actorId ||
    ![actor.position, epochOrigin, facing].every((p) =>
      [p.x, p.y, p.z].every(Number.isFinite),
    ) ||
    Math.abs(facing.y) > 1e-9 ||
    Math.abs(Math.hypot(facing.x, facing.z) - 1) > 1e-8 ||
    !Number.isFinite(input.motionMs) ||
    input.motionMs < 0 ||
    !Number.isFinite(input.groundClearanceM) ||
    input.groundClearanceM < 0
  )
    throw new RangeError('Invalid fighting geometry sample authority');
  const delta = {
    x: actor.position.x - epochOrigin.x,
    z: actor.position.z - epochOrigin.z,
  };
  const acceptedRoot = Object.freeze({
    x: delta.x * facing.z - delta.z * facing.x,
    z: delta.x * facing.x + delta.z * facing.z,
  });
  const query: import('../contracts').FightingRecipeQuery = Object.freeze({
    clipId: input.clipId,
    phase: input.phase,
    posture: input.posture,
    atMs: input.motionMs,
    acceptedRoot,
    groundClearanceM: input.groundClearanceM,
    ...(input.incoming ? { incoming: input.incoming } : {}),
  });
  const sample = sampler.sample(query);
  if (
    sample.clipId !== query.clipId ||
    sample.atMs !== query.atMs ||
    sample.acceptedRoot.x !== acceptedRoot.x ||
    sample.acceptedRoot.z !== acceptedRoot.z ||
    sample.acceptedRoot.y !== 0 ||
    ![
      sample.intendedRoot.x,
      sample.intendedRoot.y,
      sample.intendedRoot.z,
    ].every(Number.isFinite)
  )
    throw new RangeError('Mismatched fighting geometry sample');
  return {
    query,
    sample,
    worldShape: sample.shape
      ? worldVolume(sample.shape, actor.position, facing)
      : null,
  };
}

export interface FightingLinearHitShape {
  readonly shapeId: string;
  readonly keys: readonly { readonly at: number; readonly volume: HitVolume }[];
}
export interface FightingLinearImpact {
  readonly source: ImpactReference;
  readonly activeFrom: number;
  readonly activeTo: number;
  readonly shapes: readonly FightingLinearHitShape[];
}
/** Deliberately explicit D-local qualification: exact linear upright primitives.
 * This is not the A1 sampler or a claim that arbitrary C geometry obeys this law. */
export interface FightingLinearContactTrajectory {
  readonly actor: SpatialActor;
  readonly epochId: string;
  readonly posture: import('../contracts').FightingPosture;
  readonly path: readonly PathKey[];
  readonly impacts: readonly FightingLinearImpact[];
}
export interface FightingContactEpisode {
  readonly key: string;
  readonly serial: number;
  readonly onset: number;
  readonly at: number;
  readonly overlapping: boolean;
}
interface LinearUpright {
  readonly x: number;
  readonly z: number;
  readonly lo: number;
  readonly hi: number;
  readonly radius: number;
}
interface LinearWindow {
  readonly from: number;
  readonly to: number;
}
function upright(volume: HitVolume): LinearUpright {
  const a = volume.kind === 'sphere' ? volume.center : volume.start,
    b = volume.kind === 'sphere' ? volume.center : volume.end;
  if (
    ![a.x, a.y, a.z, b.x, b.y, b.z, volume.radiusM].every(Number.isFinite) ||
    volume.radiusM < 0 ||
    a.x !== b.x ||
    a.z !== b.z ||
    a.y > b.y
  )
    throw new RangeError('Unqualified fighting linear primitive law');
  return { x: a.x, z: a.z, lo: a.y, hi: b.y, radius: volume.radiusM };
}
function shapeAt(shape: FightingLinearHitShape, time: number): HitVolume {
  if (time === requirePhysicalValue(shape.keys.at(-1)).at)
    return requirePhysicalValue(shape.keys.at(-1)).volume;
  for (let i = 1; i < shape.keys.length; i++) {
    const a = requirePhysicalValue(shape.keys[i - 1]),
      b = requirePhysicalValue(shape.keys[i]);
    if (time >= a.at && time <= b.at)
      return interpolateVolume(
        a.volume,
        b.volume,
        (time - a.at) / (b.at - a.at),
      );
  }
  throw new RangeError('Missing declared fighting shape coverage');
}
/** Roots of a quadratic <=0, with exact endpoint ownership left to the caller. */
function quadraticWindows(a: number, b: number, c: number): LinearWindow[] {
  if (![a, b, c, b * b - 4 * a * c].every(Number.isFinite))
    throw new RangeError('Fighting contact quadratic arithmetic overflow');
  const cuts = [0, 1];
  if (a === 0) {
    if (b !== 0) {
      const r = -c / b;
      if (r > 0 && r < 1) cuts.push(r);
    }
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0)
      for (const r of [
        (-b - Math.sqrt(d)) / (2 * a),
        (-b + Math.sqrt(d)) / (2 * a),
      ])
        if (r > 0 && r < 1) cuts.push(r);
  }
  cuts.sort((x, y) => x - y);
  const result: LinearWindow[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const from = requirePhysicalValue(cuts[i - 1]),
      to = requirePhysicalValue(cuts[i]),
      m = (from + to) / 2;
    if (a * m * m + b * m + c <= 0) result.push({ from, to });
  }
  // Closed geometric intervals also own isolated simple roots at their cuts.
  // Original-E and active-end half-open ownership is enforced by the caller,
  // not by silently dropping an internal key or a partial horizon endpoint.
  if (c <= 0) result.push({ from: 0, to: 0 });
  if (a + b + c <= 0) result.push({ from: 1, to: 1 });
  // A true tangency is a contact even without a positive overlap interval.
  if (a > 0) {
    const d = b * b - 4 * a * c;
    if (d === 0) {
      const r = -b / (2 * a);
      if (r >= 0 && r <= 1) result.push({ from: r, to: r });
    }
  }
  return result;
}
function linearWindows(
  a0: HitVolume,
  a1: HitVolume,
  b0: HitVolume,
  b1: HitVolume,
  from: number,
  to: number,
): LinearWindow[] {
  const a = upright(a0),
    aa = upright(a1),
    b = upright(b0),
    bb = upright(b1);
  const cuts = [0, 1];
  for (const [d0, d1] of [
    [a.hi - b.lo, aa.hi - bb.lo],
    [a.lo - b.hi, aa.lo - bb.hi],
  ])
    if (d0 !== d1) {
      const r =
        -requirePhysicalValue(d0) /
        (requirePhysicalValue(d1) - requirePhysicalValue(d0));
      if (r > 0 && r < 1) cuts.push(r);
    }
  cuts.sort((x, y) => x - y);
  const result: LinearWindow[] = [];
  const mix = (
    x: LinearUpright,
    y: LinearUpright,
    u: number,
  ): LinearUpright => ({
    x: x.x + (y.x - x.x) * u,
    z: x.z + (y.z - x.z) * u,
    lo: x.lo + (y.lo - x.lo) * u,
    hi: x.hi + (y.hi - x.hi) * u,
    radius: x.radius + (y.radius - x.radius) * u,
  });
  for (let i = 1; i < cuts.length; i++) {
    const start = requirePhysicalValue(cuts[i - 1]),
      end = requirePhysicalValue(cuts[i]);
    const x = mix(a, aa, start),
      xx = mix(a, aa, end),
      y = mix(b, bb, start),
      yy = mix(b, bb, end);
    const vertical = (s: LinearUpright, t: LinearUpright) =>
      s.hi < t.lo ? s.hi - t.lo : s.lo > t.hi ? s.lo - t.hi : 0;
    const d0 = [x.x - y.x, vertical(x, y), x.z - y.z],
      d1 = [xx.x - yy.x, vertical(xx, yy), xx.z - yy.z];
    const r0 = x.radius + y.radius,
      r1 = xx.radius + yy.radius,
      dr = r1 - r0;
    const velocity = d1.map((d, k) => d - requirePhysicalValue(d0[k]));
    const qa = velocity.reduce((s, d) => s + d * d, 0) - dr * dr;
    const qb =
      2 *
      (velocity.reduce((s, d, k) => s + d * requirePhysicalValue(d0[k]), 0) -
        r0 * dr);
    const qc = d0.reduce((s, d) => s + d * d, 0) - r0 * r0;
    for (const w of quadraticWindows(qa, qb, qc))
      result.push({
        from: from + (to - from) * (start + (end - start) * w.from),
        to: from + (to - from) * (start + (end - start) * w.to),
      });
  }
  return result;
}
function mergeWindows(windows: readonly LinearWindow[]): LinearWindow[] {
  const result: LinearWindow[] = [];
  for (const w of [...windows].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = result.at(-1);
    if (last && w.from <= last.to)
      result[result.length - 1] = {
        from: last.from,
        to: Math.max(last.to, w.to),
      };
    else result.push(w);
  }
  return result;
}
/** Exact contact frontier for the explicit linear upright mechanism law above.
 * Returns all tied occurrences, stable through reprojection. Does not decide HP,
 * guard, clash priority, reaction, clock advancement or whether B accepts it. */
export function projectFightingContacts(input: {
  readonly runId: RunId;
  readonly from: number;
  readonly to: number;
  readonly originalTo: number;
  readonly trajectories: readonly FightingLinearContactTrajectory[];
  readonly episodes: readonly FightingContactEpisode[];
  readonly settledOccurrenceIds: readonly string[];
  readonly maxWork: number;
}) {
  const {
    runId: run,
    from,
    to,
    trajectories,
    episodes,
    settledOccurrenceIds,
  } = input;
  const maxWork = input.maxWork;
  if (
    ![from, to, input.originalTo].every(Number.isFinite) ||
    from > to ||
    to > input.originalTo ||
    !Number.isSafeInteger(maxWork) ||
    maxWork <= 0
  )
    throw new RangeError('Invalid fighting contact projection');
  let work = 0;
  const spend = () => {
    if (++work > maxWork)
      throw new RangeError('Fighting contact work budget exhausted');
  };
  const prior = new Map<string, FightingContactEpisode>();
  for (const e of episodes) {
    if (
      prior.has(e.key) ||
      !e.key ||
      !Number.isSafeInteger(e.serial) ||
      e.serial < 0 ||
      e.at > from ||
      e.onset > e.at
    )
      throw new RangeError('Invalid fighting contact episode prefix');
    prior.set(e.key, e);
  }
  const ids = new Set<string>();
  for (const t of trajectories) {
    if (
      ids.has(t.actor.actorId) ||
      !t.epochId ||
      t.path.length < 2 ||
      requirePhysicalValue(t.path[0]).at > from ||
      requirePhysicalValue(t.path.at(-1)).at < to
    )
      throw new RangeError('Invalid fighting contact trajectory');
    const facing = t.actor.facing;
    if (
      ![facing.x, facing.y, facing.z].every(Number.isFinite) ||
      Math.abs(facing.y) > 1e-9 ||
      Math.abs(Math.hypot(facing.x, facing.z) - 1) > 1e-8 ||
      !['standing', 'crouching', 'airborne'].includes(t.posture)
    )
      throw new RangeError('Invalid accepted fighting facing/posture');
    ids.add(t.actor.actorId);
    for (let i = 0; i < t.path.length; i++)
      if (
        ![
          requirePhysicalValue(t.path[i]).at,
          requirePhysicalValue(t.path[i]).position.x,
          requirePhysicalValue(t.path[i]).position.y,
          requirePhysicalValue(t.path[i]).position.z,
        ].every(Number.isFinite) ||
        (i &&
          requirePhysicalValue(t.path[i]).at <=
            requirePhysicalValue(t.path[i - 1]).at)
      )
        throw new RangeError('Invalid fighting contact path');
    for (const impact of t.impacts) {
      if (
        impact.source.actorId !== t.actor.actorId ||
        !impact.shapes.length ||
        !Number.isFinite(impact.activeFrom) ||
        !Number.isFinite(impact.activeTo) ||
        impact.activeTo <= impact.activeFrom
      )
        throw new RangeError('Invalid fighting impact authority');
      const shapes = new Set<string>();
      for (const shape of impact.shapes) {
        if (
          !shape.shapeId ||
          shapes.has(shape.shapeId) ||
          shape.keys.length < 2 ||
          requirePhysicalValue(shape.keys[0]).at >
            Math.max(from, impact.activeFrom) ||
          requirePhysicalValue(shape.keys.at(-1)).at <
            Math.min(to, impact.activeTo)
        )
          throw new RangeError('Invalid fighting shape coverage');
        shapes.add(shape.shapeId);
        for (let i = 0; i < shape.keys.length; i++) {
          upright(requirePhysicalValue(shape.keys[i]).volume);
          if (
            !Number.isFinite(requirePhysicalValue(shape.keys[i]).at) ||
            (i &&
              requirePhysicalValue(shape.keys[i]).at <=
                requirePhysicalValue(shape.keys[i - 1]).at)
          )
            throw new RangeError('Invalid fighting shape keys');
        }
      }
    }
  }
  interface Group {
    key: string;
    kind: 'body-hit' | 'clash';
    source: FightingLinearContactTrajectory;
    target: FightingLinearContactTrajectory;
    first: FightingLinearImpact;
    second?: FightingLinearImpact;
    windows: LinearWindow[];
    pointAt: (at: number) => Vector3;
  }
  const groups = new Map<string, Group>();
  const volume = (
    t: FightingLinearContactTrajectory,
    s: FightingLinearHitShape,
    time: number,
  ) => worldVolume(shapeAt(s, time), positionAt(t.path, time), t.actor.facing);
  const hurt = (t: FightingLinearContactTrajectory, time: number) =>
    combatHurt(positionAt(t.path, time), t.posture === 'crouching');
  const contactPoint = (a: HitVolume, b: HitVolume) => {
    const x = upright(a),
      y = upright(b);
    const ay = Math.max(
      x.lo,
      Math.min(x.hi, (Math.max(x.lo, y.lo) + Math.min(x.hi, y.hi)) / 2),
    );
    const by = Math.max(y.lo, Math.min(y.hi, ay));
    const dx = x.x - y.x,
      dy = ay - by,
      dz = x.z - y.z,
      d = Math.hypot(dx, dy, dz),
      f = d > 0 ? x.radius / d : 0;
    return { x: x.x - dx * f, y: ay - dy * f, z: x.z - dz * f };
  };
  function addGroup(
    group: Omit<Group, 'windows'>,
    a: FightingLinearHitShape,
    b?: FightingLinearHitShape,
  ) {
    const first = group.first,
      second = group.second;
    const start = Math.max(from, first.activeFrom, second?.activeFrom ?? from),
      end = Math.min(to, first.activeTo, second?.activeTo ?? to);
    if (
      start > end ||
      start >= first.activeTo ||
      (second && start >= second.activeTo)
    )
      return;
    const cuts = [
      ...new Set(
        [
          start,
          end,
          ...group.source.path.map((k) => k.at),
          ...group.target.path.map((k) => k.at),
          ...a.keys.map((k) => k.at),
          ...(b?.keys.map((k) => k.at) ?? []),
        ].filter((t) => t >= start && t <= end),
      ),
    ].sort((x, y) => x - y);
    const va = (time: number) => volume(group.source, a, time),
      vb = (time: number) =>
        b ? volume(group.target, b, time) : hurt(group.target, time);
    const windows: LinearWindow[] = [];
    if (start === end && start < input.originalTo) {
      spend();
      const w = linearWindows(
        va(start),
        va(start),
        vb(start),
        vb(start),
        start,
        end,
      );
      windows.push(...w);
    }
    for (let i = 1; i < cuts.length; i++) {
      spend();
      windows.push(
        ...linearWindows(
          va(requirePhysicalValue(cuts[i - 1])),
          va(requirePhysicalValue(cuts[i])),
          vb(requirePhysicalValue(cuts[i - 1])),
          vb(requirePhysicalValue(cuts[i])),
          requirePhysicalValue(cuts[i - 1]),
          requirePhysicalValue(cuts[i]),
        ),
      );
    }
    const filtered = windows.filter(
      (w) =>
        w.from < input.originalTo &&
        w.from < first.activeTo &&
        (!second || w.from < second.activeTo),
    );
    const existing = groups.get(group.key);
    if (existing) {
      const previousPoint = existing.pointAt;
      existing.pointAt = (t) =>
        filtered.some((w) => t >= w.from && t <= w.to)
          ? contactPoint(va(t), vb(t))
          : previousPoint(t);
      existing.windows.push(...filtered);
    } else
      groups.set(group.key, {
        ...group,
        windows: filtered,
        pointAt: (t) => contactPoint(va(t), vb(t)),
      });
  }
  for (const source of trajectories)
    for (const first of source.impacts)
      for (const target of trajectories)
        if (source !== target) {
          const key = JSON.stringify([
            'body-hit',
            first.source.impactId,
            target.actor.actorId,
            source.epochId,
            target.epochId,
          ]);
          for (const a of [...first.shapes].sort((a, b) =>
            a.shapeId < b.shapeId ? 1 : a.shapeId > b.shapeId ? -1 : 0,
          ))
            addGroup(
              {
                key,
                kind: 'body-hit',
                source,
                target,
                first,
                pointAt: () => ({ x: 0, y: 0, z: 0 }),
              },
              a,
            );
        }
  for (let i = 0; i < trajectories.length; i++)
    for (let j = i + 1; j < trajectories.length; j++)
      for (const x of requirePhysicalValue(trajectories[i]).impacts)
        for (const y of requirePhysicalValue(trajectories[j]).impacts) {
          const [source, target, first, second] =
            x.source.impactId < y.source.impactId
              ? ([
                  requirePhysicalValue(trajectories[i]),
                  requirePhysicalValue(trajectories[j]),
                  x,
                  y,
                ] as const)
              : ([
                  requirePhysicalValue(trajectories[j]),
                  requirePhysicalValue(trajectories[i]),
                  y,
                  x,
                ] as const);
          const key = JSON.stringify([
            'clash',
            first.source.impactId,
            second.source.impactId,
            source.epochId,
            target.epochId,
          ]);
          for (const a of [...first.shapes].sort((a, b) =>
            a.shapeId < b.shapeId ? 1 : a.shapeId > b.shapeId ? -1 : 0,
          ))
            for (const b of [...second.shapes].sort((a, b) =>
              a.shapeId < b.shapeId ? 1 : a.shapeId > b.shapeId ? -1 : 0,
            ))
              addGroup(
                {
                  key,
                  kind: 'clash',
                  source,
                  target,
                  first,
                  second,
                  pointAt: () => ({ x: 0, y: 0, z: 0 }),
                },
                a,
                b,
              );
        }
  const pending: {
    group: Group;
    window: LinearWindow;
    serial: number;
    onset: number;
    occurrence: string;
  }[] = [];
  const all = new Map<
    string,
    { window: LinearWindow; serial: number; onset: number }[]
  >();
  for (const group of groups.values()) {
    const windows = mergeWindows(group.windows),
      old = prior.get(group.key);
    let serial = old?.serial ?? -1;
    const states: { window: LinearWindow; serial: number; onset: number }[] =
      [];
    for (let i = 0; i < windows.length; i++) {
      const window = requirePhysicalValue(windows[i]);
      const continuous =
        i === 0 && window.from === from && old?.overlapping && old.at === from;
      if (!continuous) serial++;
      const onset = continuous ? old.onset : window.from;
      const occurrence = JSON.stringify([group.key, serial]);
      states.push({ window, serial, onset });
      if (!settledOccurrenceIds.includes(occurrence))
        pending.push({ group, window, serial, onset, occurrence });
    }
    all.set(group.key, states);
  }
  const earliest = pending.reduce((t, p) => Math.min(t, p.window.from), to);
  const batch = pending
    .filter((p) => p.window.from === earliest && earliest < input.originalTo)
    .sort((a, b) =>
      a.occurrence < b.occurrence ? -1 : a.occurrence > b.occurrence ? 1 : 0,
    );
  const candidates: SpatialCandidate[] = [],
    witnesses: import('../contracts').FightingContactWitness[] = [];
  for (const p of batch) {
    const g = p.group,
      id = contactId(p.occurrence);
    const envelope = {
      runId: run,
      contactId: id,
      at: gameTimeMs(earliest),
      interval: { from: gameTimeMs(from), to: gameTimeMs(to) },
      point: g.pointAt(earliest),
      evidence: from === to ? ('overlap' as const) : ('swept-shape' as const),
    };
    if (g.kind === 'clash')
      candidates.push({
        ...envelope,
        kind: 'clash',
        first: g.first.source,
        second: requirePhysicalValue(g.second).source,
      });
    else {
      candidates.push({
        ...envelope,
        kind: 'body-hit',
        source: g.first.source,
        targetActorId: g.target.actor.actorId,
      });
      witnesses.push({
        contactId: id,
        atGameMs: gameTimeMs(earliest),
        sourceActorId: g.source.actor.actorId,
        targetActorId: g.target.actor.actorId,
        sourcePosition: positionAt(g.source.path, earliest),
        targetPosition: positionAt(g.target.path, earliest),
        sourceFacing: g.source.actor.facing,
        targetFacing: g.target.actor.facing,
      });
    }
  }
  const next: FightingContactEpisode[] = [];
  for (const group of groups.values()) {
    const old = prior.get(group.key),
      states = requirePhysicalValue(all.get(group.key)),
      state = states.filter((s) => s.window.from <= earliest).at(-1);
    if (state)
      next.push({
        key: group.key,
        serial: state.serial,
        onset: state.onset,
        at: earliest,
        overlapping: earliest <= state.window.to,
      });
    else if (old) next.push({ ...old, at: earliest, overlapping: false });
  }
  return {
    at: earliest,
    candidates,
    witnesses,
    occurrenceIds: batch.map((p) => p.occurrence),
    episodes: next,
    work,
  };
}
