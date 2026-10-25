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
