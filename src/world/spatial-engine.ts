import {
  type ActorId,
  type CoreOutput,
  capturePoseRunPolicy,
  durationMs,
  type GameSnapshot,
  type MotionCatalogPort,
  type MovementBasisSnapshot,
  type PoseRunPolicy,
  type RecoveryTimelinePolicy,
  type RunId,
  type SpatialActor,
  type SpatialSnapshot,
  type SpatialStepRequest,
  type SpatialStepResult,
  type Vector3,
} from '../contracts';
import {
  assertFiniteMotorInterval,
  faceToward,
  stepCharacter,
  toBox,
} from './character-motor';
import {
  type ActorTrajectory,
  combatContacts,
  streetContacts,
} from './contact-candidates';
import { add, dot, finite, length, mul, sub, unit, v } from './math';
import { createPoseTimeline } from './pose-timeline';
import type { StreetLayout } from './street-layout';
import { createVehicleSystem } from './vehicle-system';
export function createSpatialEngine(
  run: RunId,
  layout: StreetLayout,
  policy?: PoseRunPolicy,
  recoveryDiagnostic?: RecoveryTimelinePolicy,
) {
  const mode = capturePoseRunPolicy(policy);
  const recovery = recoveryDiagnostic ?? mode.recovery;
  if (
    recoveryDiagnostic &&
    mode.recovery &&
    JSON.stringify(recoveryDiagnostic) !== JSON.stringify(mode.recovery)
  )
    throw Error('Conflicting recovery policy');
  if (recovery && mode.mode !== 'deterministic-pose-v1')
    throw Error('Recovery requires explicit deterministic diagnostic mode');
  const timeline =
    mode.mode === 'deterministic-pose-v1'
      ? createPoseTimeline(run, recovery)
      : undefined;
  const vehicles = createVehicleSystem(run, layout);
  const poses = new Map<ActorId, SpatialActor>();
  const attacks = new Map<ActorId, string>();
  // Identity-only tombstones never retain poses, nodes, clips or actor resources.
  const retired = new Set<ActorId>();
  let explicitResidency = false;
  let latestAuthority:
    | { revision: number; tick: number; residents: ReadonlySet<ActorId> }
    | undefined;
  function assertReplayAllowed(snapshot: GameSnapshot) {
    if (explicitResidency && snapshot.residentActorIds === undefined)
      throw new Error('Explicit residency cannot downgrade to legacy');
    const ids =
      snapshot.residentActorIds ?? snapshot.actors.map((a) => a.actorId);
    if (ids.some((id) => retired.has(id)))
      throw new Error('Retired actor cannot be recreated or visually replayed');
  }
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
    assertReplayAllowed(output.snapshot);
    const residents = new Set(
      output.snapshot.residentActorIds ??
        output.snapshot.actors.map((a) => a.actorId),
    );
    if (
      output.snapshot.residentActorIds &&
      residents.size !== output.snapshot.residentActorIds.length
    )
      throw new Error('Duplicate resident actor');
    for (const id of residents)
      if (!output.snapshot.actors.some((a) => a.actorId === id))
        throw new Error('Unknown resident actor');
    const priorAuthority = latestAuthority;
    if (
      priorAuthority &&
      (output.snapshot.revision < priorAuthority.revision ||
        output.snapshot.clocks.tick < priorAuthority.tick ||
        (output.snapshot.revision === priorAuthority.revision &&
          output.snapshot.residentActorIds !== undefined &&
          (residents.size !== priorAuthority.residents.size ||
            [...residents].some((id) => !priorAuthority.residents.has(id)))))
    )
      throw new Error('Stale or conflicting residency authority');
    // All rejection guards precede retirement. Presentation can advance at the
    // same game tick; revision, not a second presentation clock, orders authority.
    explicitResidency ||= output.snapshot.residentActorIds !== undefined;
    latestAuthority = {
      revision: output.snapshot.revision,
      tick: output.snapshot.clocks.tick,
      residents,
    };
    for (const id of poses.keys())
      if (!residents.has(id)) {
        poses.delete(id);
        attacks.delete(id);
        retired.add(id);
      }
    if (lastTick < 0) {
      lastTick = output.snapshot.clocks.tick;
      lastTime = output.snapshot.clocks.gameTimeMs;
    }
    for (const state of output.snapshot.actors)
      if (residents.has(state.actorId) && !poses.has(state.actorId))
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
        ...(timeline?.read(a.actorId)
          ? { pose: timeline.read(a.actorId)! }
          : {}),
        position: { ...a.position },
        facing: { ...a.facing },
        velocity: { ...a.velocity },
      })),
      vehicles: vehicles.read(),
    };
  }
  return {
    poseProtocol: timeline
      ? Object.freeze({
          version: 1 as const,
          protocol: 'deterministic-pose-v1' as const,
          ...(timeline.recoveryCapability
            ? { recovery: timeline.recoveryCapability }
            : {}),
          bindPreparedCatalog: timeline.bindPreparedCatalog,
        })
      : undefined,
    isRetired: (id: ActorId) => retired.has(id),
    assertReplayAllowed,
    commit(output: CoreOutput): SpatialSnapshot {
      const applyPose = timeline?.prepareCommit(
        output,
        output.snapshot.clocks.gameTimeMs,
      );
      sync(output);
      vehicles.commit(output, poses);
      applyPose?.();
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
      timeline?.dispose();
      vehicles.dispose();
      disposed = true;
      poses.clear();
      bases.clear();
      attacks.clear();
      retired.clear();
      latestAuthority = undefined;
      explicitResidency = false;
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
      const to = state.clocks.gameTimeMs,
        from = to - request.step.durationMs;
      assertFiniteMotorInterval(from, to);
      if (
        state.phase === 'running' &&
        Math.abs(state.clocks.gameTimeMs - request.step.durationMs - lastTime) >
          1e-7
      )
        throw new Error('Noncontiguous spatial interval');
      // Validate descriptor/authority before any live motor or residency changes.
      timeline?.prepareStep(request, new Map());
      timeline?.validateAttackCatalog(state, catalog);
      const checkpoint = timeline
        ? {
            poses: new Map(poses),
            attacks: new Map(attacks),
            retired: new Set(retired),
            explicitResidency,
            latestAuthority,
            lastTick,
            lastTime,
          }
        : undefined;
      try {
        sync({ snapshot: state, events: [] });
        lastTick = state.clocks.tick;
        lastTime = state.clocks.gameTimeMs;
        if (
          state.phase !== 'running' ||
          state.result ||
          state.pauseReasons.length
        )
          return { snapshot: snapshot(state.clocks.tick), candidates: [] };

        if (from < 0) throw new RangeError('Invalid spatial time interval');
        const player = state.actors.find((a) => a.color === 'white');
        const active = state.actors.filter(
          (a) =>
            !a.defeated &&
            poses.has(a.actorId) &&
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
          if (actor.attack)
            attacks.set(actor.actorId, actor.attack.activationId);
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
        const applyPose = timeline?.prepareStep(
          request,
          new Map([...poses].map(([id, pose]) => [id, pose.locomotion])),
        );
        const candidates = [
          ...combatContacts(run, trajectories),
          ...streetContacts(run, state, trajectories, layout.objects),
          ...vehicles.step(state, from, to, trajectories),
        ].sort(
          (a, b) =>
            a.at - b.at ||
            (a.contactId < b.contactId
              ? -1
              : a.contactId > b.contactId
                ? 1
                : 0),
        );
        applyPose?.();
        return { snapshot: snapshot(state.clocks.tick), candidates };
      } catch (error) {
        if (checkpoint) {
          poses.clear();
          for (const [id, pose] of checkpoint.poses) poses.set(id, pose);
          attacks.clear();
          for (const [id, attack] of checkpoint.attacks)
            attacks.set(id, attack);
          retired.clear();
          for (const id of checkpoint.retired) retired.add(id);
          explicitResidency = checkpoint.explicitResidency;
          latestAuthority = checkpoint.latestAuthority;
          lastTick = checkpoint.lastTick;
          lastTime = checkpoint.lastTime;
        }
        throw error;
      }
    },
  };
}
