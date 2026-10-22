import {
  type ActorId,
  type CoreOutput,
  durationMs,
  type MotionCatalogPort,
  type MovementBasisSnapshot,
  type RunId,
  type SpatialActor,
  type SpatialSnapshot,
  type SpatialStepRequest,
  type SpatialStepResult,
  type Vector3,
} from '../contracts';
import { faceToward, stepCharacter, toBox } from './character-motor';
import {
  type ActorTrajectory,
  combatContacts,
  streetContacts,
} from './contact-candidates';
import { add, dot, finite, length, mul, sub, unit, v } from './math';
import type { StreetLayout } from './street-layout';
import { createVehicleSystem } from './vehicle-system';
export function createSpatialEngine(run: RunId, layout: StreetLayout) {
  const vehicles = createVehicleSystem(run, layout);
  const poses = new Map<ActorId, SpatialActor>();
  const attacks = new Map<ActorId, string>();
  const bases = new Map<string, MovementBasisSnapshot>();
  const usedSessions = new Set<string>();
  let revision = 0,
    lastTick = -1,
    lastTime = 0,
    disposed = false;
  function alive() {
    if (disposed) throw new Error('Spatial engine disposed');
  }
  function sync(output: CoreOutput) {
    alive();
    if (output.snapshot.runId !== run) throw new Error('Stale spatial run');
    if (lastTick < 0) {
      lastTick = output.snapshot.clocks.tick;
      lastTime = output.snapshot.clocks.gameTimeMs;
    }
    for (const state of output.snapshot.actors)
      if (!poses.has(state.actorId))
        poses.set(state.actorId, {
          actorId: state.actorId,
          position: { ...layout.actorSpawns[state.color] },
          facing: v(0, 0, state.color === 'white' ? 1 : -1),
          velocity: v(),
          grounded: true,
          locomotion: 'idle',
        });
    for (const state of output.snapshot.actors) {
      if (
        state.defeated ||
        (state.color !== 'white' &&
          state.actorId !== output.snapshot.currentOpponentId)
      ) {
        const pose = poses.get(state.actorId);
        if (pose)
          poses.set(state.actorId, {
            ...pose,
            velocity: v(),
            locomotion: pose.grounded ? 'idle' : 'jump',
          });
      }
    }
  }
  function snapshot(tick: SpatialSnapshot['tick']): SpatialSnapshot {
    return {
      runId: run,
      tick,
      actors: [...poses.values()].map((a) => ({
        ...a,
        position: { ...a.position },
        facing: { ...a.facing },
        velocity: { ...a.velocity },
      })),
      vehicles: vehicles.read(),
    };
  }
  return {
    commit(output: CoreOutput): SpatialSnapshot {
      sync(output);
      vehicles.commit(output, poses);
      return snapshot(output.snapshot.clocks.tick);
    },
    begin(
      sessionId: string,
      right: Vector3,
      depth: Vector3,
    ): MovementBasisSnapshot {
      alive();
      if (
        !finite(right) ||
        !finite(depth) ||
        Math.abs(right.y) > 1e-9 ||
        Math.abs(depth.y) > 1e-9 ||
        Math.abs(length(right) - 1) > 1e-8 ||
        Math.abs(length(depth) - 1) > 1e-8 ||
        Math.abs(dot(right, depth)) > 1e-8
      )
        throw new RangeError('Movement basis must be horizontal orthonormal');
      if (usedSessions.has(sessionId))
        throw new Error('Movement session cannot be reused');
      usedSessions.add(sessionId);
      const basis = Object.freeze({
        runId: run,
        sessionId,
        revision: ++revision,
        right: Object.freeze({ ...right }),
        depth: Object.freeze({ ...depth }),
      });
      bases.set(sessionId, basis);
      return basis;
    },
    end(sessionId: string) {
      bases.delete(sessionId);
    },
    dispose() {
      vehicles.dispose();
      disposed = true;
      poses.clear();
      bases.clear();
      attacks.clear();
      usedSessions.clear();
    },
    step(
      request: SpatialStepRequest,
      catalog: MotionCatalogPort,
    ): SpatialStepResult {
      const state = request.snapshot;
      alive();
      if (state.runId !== run) throw new Error('Stale spatial run');
      if (lastTick >= 0 && state.clocks.tick !== lastTick + 1)
        throw new Error('Duplicate or stale spatial tick');
      if (
        !Number.isFinite(request.step.durationMs) ||
        request.step.durationMs <= 0
      )
        throw new RangeError('Invalid spatial step');
      if (
        state.phase === 'running' &&
        Math.abs(state.clocks.gameTimeMs - request.step.durationMs - lastTime) >
          1e-7
      )
        throw new Error('Noncontiguous spatial interval');
      sync({ snapshot: state, events: [] });
      lastTick = state.clocks.tick;
      lastTime = state.clocks.gameTimeMs;
      if (
        state.phase !== 'running' ||
        state.result ||
        state.pauseReasons.length
      )
        return { snapshot: snapshot(state.clocks.tick), candidates: [] };
      const to = state.clocks.gameTimeMs,
        from = to - request.step.durationMs;
      if (from < 0) throw new RangeError('Invalid spatial time interval');
      const player = state.actors.find((a) => a.color === 'white');
      const active = state.actors.filter(
        (a) =>
          !a.defeated &&
          (a.actorId === player?.actorId ||
            a.actorId === state.currentOpponentId),
      );
      const trajectories: ActorTrajectory[] = [];
      const previousPoses = new Map(poses);
      const obstacles = [
        ...layout.objects.map((o) => toBox(o.position, o.halfExtents)),
        ...vehicles.read().map((p) => {
          const item = layout.vehicles.find(
            (v) => v.vehicleId === p.vehicleId,
          )!;
          return toBox(
            add(p.position, v(0, item.halfExtents.y, 0)),
            item.halfExtents,
          );
        }),
      ];
      for (const actor of active) {
        let old = poses.get(actor.actorId)!;
        const target = active.find((a) => a.actorId !== actor.actorId);
        const targetPose = target
          ? previousPoses.get(target.actorId)
          : undefined;
        if (
          targetPose &&
          (!actor.attack ||
            attacks.get(actor.actorId) !== actor.attack.activationId)
        )
          old = {
            ...old,
            facing: actor.attack
              ? unit(
                  v(
                    targetPose.position.x - old.position.x,
                    0,
                    targetPose.position.z - old.position.z,
                  ),
                  old.facing,
                )
              : faceToward(
                  old.facing,
                  sub(targetPose.position, old.position),
                  (8 * request.step.durationMs) / 1000,
                ),
          };
        if (actor.attack) attacks.set(actor.actorId, actor.attack.activationId);
        else attacks.delete(actor.actorId);
        let movement = v(),
          jump = false;
        for (const intent of request.intents) {
          if (intent.runId !== run || intent.actorId !== actor.actorId)
            continue;
          if (intent.type === 'MoveRequested') {
            const basis = bases.get(intent.movementSessionId);
            if (
              basis?.revision === intent.basisRevision &&
              Number.isFinite(intent.x) &&
              Number.isFinite(intent.z) &&
              Math.hypot(intent.x, intent.z) <= 1 + 1e-9
            )
              movement = add(
                mul(basis.right, intent.x),
                mul(basis.depth, intent.z),
              );
          }
          if (intent.type === 'JumpRequested') jump = true;
        }
        const attack = actor.attack,
          definition = attack ? catalog.get(attack.clipId) : undefined;
        if (attack && !definition)
          throw new Error('Active attack clip missing');
        const sample =
          attack && definition
            ? catalog.sampleMotion(
                attack.clipId,
                durationMs(
                  Math.min(
                    definition.durationMs,
                    Math.max(0, from - attack.startedAt),
                  ),
                ),
                durationMs(
                  Math.min(
                    definition.durationMs,
                    Math.max(0, to - attack.startedAt),
                  ),
                ),
              )
            : undefined;
        const result = stepCharacter(
          old,
          actor,
          from,
          to,
          movement,
          jump,
          sample,
          attack?.startedAt ?? 0,
          layout,
          obstacles,
        );
        poses.set(actor.actorId, result.actor);
        trajectories.push({
          state: actor,
          actor: result.actor,
          path: result.path,
          sample,
        });
      }
      const candidates = [
        ...combatContacts(run, trajectories),
        ...streetContacts(run, state, trajectories, layout.objects),
        ...vehicles.step(state, from, to, trajectories),
      ].sort(
        (a, b) =>
          a.at - b.at ||
          (a.contactId < b.contactId ? -1 : a.contactId > b.contactId ? 1 : 0),
      );
      return { snapshot: snapshot(state.clocks.tick), candidates };
    },
  };
}
