import {
  type ActorId,
  type StartupBasis,
  type CoreOutput,
  capturePoseRunPolicy,
  captureFightingReadyDescriptor,
  captureFightingSpatialTransactionPolicy,
  type FightingPreparedSpatialBinding,
  durationMs,
  type GameSnapshot,
  type MotionCatalogPort,
  type MovementBasisSnapshot,
  type LivingPoseMode,
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
  sampleFightingMotor,
  toBox,
} from './character-motor';
import {
  type ActorTrajectory,
  combatContacts,
  streetContacts,
} from './contact-candidates';
import { add, dot, finite, length, mul, sub, unit, v } from './math';
import { fightingHurtProxy } from './combat-hurt';
import { resolveAttackStartStance, stanceBinding } from './attack-start-stance';
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
  const stanceEnabled = mode.attackStartStance === 'selected-side-kicks-v1';
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
      ? createPoseTimeline(run, recovery, mode.startup)
      : undefined;
  const vehicles = createVehicleSystem(run, layout);
  const poses = new Map<ActorId, SpatialActor>();
  const attacks = new Map<ActorId, string>();
  // Identity-only tombstones never retain poses, nodes, clips or actor resources.
  const retired = new Set<ActorId>();
  let explicitResidency = false;
  let activatedOpponentId: ActorId | undefined;
  let latestAuthority:
    | { revision: number; tick: number; residents: ReadonlySet<ActorId> }
    | undefined;
  function assertReplayAllowed(snapshot: GameSnapshot) {
    assertNoUnqualifiedFightingAuthority(snapshot);
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
  let bindingBusy = false;
  function alive() {
    if (bindingBusy)
      throw new Error('Reentrant spatial operation during fighting binding');
    if (disposed) throw new Error('Spatial engine disposed');
  }
  function assertNoUnqualifiedFightingAuthority(state: GameSnapshot) {
    if (
      state.actors.some(
        (actor) =>
          actor.fightingClock?.endpoint !== undefined ||
          actor.fightingPose !== undefined ||
          actor.fightingPoseHold !== undefined,
      )
    )
      throw new Error(
        'A2 actual geometry and qualified interval capability are required for fighting spatial projection',
      );
  }
  /** A1 has no authenticated sole/multishape/continuous geometry authority. Keep
   * this production-only capability closed instead of treating toy point samples
   * as qualified ready poses. A2 positive bootstrap/project remains a dependency. */
  function bindFightingPrepared(binding: FightingPreparedSpatialBinding): void {
    alive();
    bindingBusy = true;
    try {
      const own = (value: object, key: string) => {
        const field = Object.getOwnPropertyDescriptor(value, key);
        if (!field || !('value' in field))
          throw new RangeError('Fighting binding requires own data fields');
        return field.value;
      };
      const ready = captureFightingReadyDescriptor(
        own(binding, 'readyDescriptor'),
      );
      captureFightingSpatialTransactionPolicy(
        own(binding, 'transactionPolicy'),
      );
      const factory = own(binding, 'recipeSamplerFactory');
      if (
        !factory ||
        typeof factory !== 'object' ||
        own(factory, 'runId') !== run ||
        own(factory, 'bindingSetId') !== ready.bindingSetId ||
        typeof own(factory, 'create') !== 'function'
      )
        throw new RangeError(
          'Mismatched fighting sampler run/binding authority',
        );
      if (
        layout.battleStage?.mode !== 'four-battle' ||
        layout.objects.length ||
        layout.vehicles.length ||
        layout.bounds.min.x !== -2 ||
        layout.bounds.max.x !== 2 ||
        layout.bounds.min.z !== -5 ||
        layout.bounds.max.z !== 5 ||
        ready.supportPlane.planeY !== 0
      )
        throw new RangeError(
          'Fighting projection requires the admitted empty battle layout',
        );
      if (
        lastTick >= 0 ||
        poses.size ||
        attacks.size ||
        retired.size ||
        latestAuthority ||
        activatedOpponentId !== undefined
      )
        throw new Error(
          'Fighting bootstrap requires pristine physical state; loading must stay host-only',
        );
      for (const actor of ready.actors)
        if (
          actor.position.x < layout.bounds.min.x + 0.35 ||
          actor.position.x > layout.bounds.max.x - 0.35 ||
          actor.position.z < layout.bounds.min.z + 0.35 ||
          actor.position.z > layout.bounds.max.z - 0.35
        )
          throw new RangeError('Fighting ready anchor outside battle bounds');
      // No sampler leases or legacy sync/timeline/world mutation before this gate.
      throw new Error(
        'A2 actual geometry and qualified interval capability are required for fighting spatial projection',
      );
    } finally {
      bindingBusy = false;
    }
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
      const pose = poses.get(state.actorId);
      if (pose && !state.defeated) {
        const crouching =
          state.crouching === true &&
          pose.grounded &&
          !state.attack &&
          output.snapshot.phase === 'running';
        if (crouching || pose.locomotion === 'crouch')
          poses.set(state.actorId, {
            ...pose,
            velocity: v(0, pose.velocity.y, 0),
            locomotion: crouching ? 'crouch' : pose.grounded ? 'idle' : 'jump',
          });
      }
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
  // Plan without side effects. sync's authority guards must succeed before
  // either the pair reset or its once-only marker becomes live.
  function planEncounterReset(state: GameSnapshot) {
    const opponentId = state.currentOpponentId;
    if (
      !layout.battleStage ||
      !opponentId ||
      opponentId === activatedOpponentId
    )
      return undefined;
    const residents =
      state.residentActorIds ?? state.actors.map((a) => a.actorId);
    const player = state.actors.find(
      (a) =>
        a.color === 'white' && !a.defeated && residents.includes(a.actorId),
    );
    const opponent = state.actors.find(
      (a) =>
        a.actorId === opponentId &&
        a.color !== 'white' &&
        !a.defeated &&
        residents.includes(a.actorId),
    );
    return player && opponent
      ? { opponentId, actors: [player, opponent] }
      : undefined;
  }
  function resetEncounter(plan: ReturnType<typeof planEncounterReset>) {
    if (!plan) return;
    for (const actor of plan.actors) {
      poses.set(actor.actorId, {
        actorId: actor.actorId,
        position: { ...layout.actorSpawns[actor.color] },
        facing: v(0, 0, actor.color === 'white' ? 1 : -1),
        velocity: v(),
        grounded: true,
        locomotion: 'idle',
      });
      attacks.delete(actor.actorId);
    }
    activatedOpponentId = plan.opponentId;
  }
  function captureCheckpoint() {
    return {
      poses: new Map(poses),
      attacks: new Map(attacks),
      retired: new Set(retired),
      explicitResidency,
      latestAuthority,
      lastTick,
      lastTime,
      activatedOpponentId,
    };
  }
  function restoreCheckpoint(checkpoint: ReturnType<typeof captureCheckpoint>) {
    poses.clear();
    for (const [id, pose] of checkpoint.poses) poses.set(id, pose);
    attacks.clear();
    for (const [id, attack] of checkpoint.attacks) attacks.set(id, attack);
    retired.clear();
    for (const id of checkpoint.retired) retired.add(id);
    explicitResidency = checkpoint.explicitResidency;
    latestAuthority = checkpoint.latestAuthority;
    lastTick = checkpoint.lastTick;
    lastTime = checkpoint.lastTime;
    activatedOpponentId = checkpoint.activatedOpponentId;
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
          ...(timeline.startupCapability
            ? { startup: timeline.startupCapability }
            : {}),
          bindPreparedCatalog: (
            catalog: Parameters<typeof timeline.bindPreparedCatalog>[0],
          ) => {
            alive();
            timeline.bindPreparedCatalog(catalog);
          },
          fighting: Object.freeze({
            version: 1 as const,
            mode: 'battle-transaction-v1' as const,
            bindPrepared: bindFightingPrepared,
          }),
        })
      : undefined,
    isRetired: (id: ActorId) => retired.has(id),
    assertReplayAllowed,
    commit(output: CoreOutput): SpatialSnapshot {
      alive();
      assertNoUnqualifiedFightingAuthority(output.snapshot);
      const reset = planEncounterReset(output.snapshot);
      const postureChanges = output.snapshot.actors.flatMap((actor) => {
        const pose = poses.get(actor.actorId);
        if (!pose || actor.defeated) return [];
        const crouching =
          actor.crouching === true &&
          pose.grounded &&
          !actor.attack &&
          output.snapshot.phase === 'running';
        const mode = crouching
          ? ('crouch' as const)
          : pose.grounded
            ? ('idle' as const)
            : ('jump' as const);
        return (crouching || pose.locomotion === 'crouch') &&
          pose.locomotion !== mode
          ? [[actor.actorId, mode] as const]
          : [];
      });
      const overrides = reset
        ? new Map<ActorId, Exclude<LivingPoseMode, 'attack'>>(
            reset.actors.map((actor) => [actor.actorId, 'idle']),
          )
        : postureChanges.length
          ? new Map(postureChanges)
          : undefined;
      const applyPose = timeline?.prepareCommit(
        output,
        output.snapshot.clocks.gameTimeMs,
        overrides,
      );
      const checkpoint = layout.battleStage ? captureCheckpoint() : undefined;
      try {
        sync(output);
        resetEncounter(reset);
        vehicles.commit(output, poses);
        applyPose?.();
        return snapshot(output.snapshot.clocks.tick);
      } catch (error) {
        if (checkpoint) restoreCheckpoint(checkpoint);
        throw error;
      }
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
      alive();
      bases.delete(sessionId);
    },
    dispose() {
      if (bindingBusy)
        throw new Error('Reentrant spatial dispose during fighting binding');
      timeline?.dispose();
      vehicles.dispose();
      disposed = true;
      poses.clear();
      bases.clear();
      attacks.clear();
      retired.clear();
      latestAuthority = undefined;
      explicitResidency = false;
      activatedOpponentId = undefined;
      usedSessions.clear();
    },
    step(
      request: SpatialStepRequest,
      catalog: MotionCatalogPort,
    ): SpatialStepResult {
      alive();
      const state = request.snapshot;
      assertNoUnqualifiedFightingAuthority(state);
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
      timeline?.validateAttackCatalog(state, catalog, stanceEnabled);
      const reset = planEncounterReset(state);
      const inactive =
        state.phase !== 'running' ||
        state.result !== null ||
        state.pauseReasons.length > 0;
      // An inactive step skips the motor, but an admitted encounter reset must
      // still install its prevalidated pose in the same transaction.
      const applyInactiveReset =
        reset && inactive
          ? timeline?.prepareCommit(
              { snapshot: state, events: [] },
              state.clocks.gameTimeMs,
              new Map<ActorId, Exclude<LivingPoseMode, 'attack'>>(
                reset.actors.map((actor) => [actor.actorId, 'idle']),
              ),
            )
          : undefined;
      const checkpoint =
        timeline || layout.battleStage ? captureCheckpoint() : undefined;
      try {
        sync({ snapshot: state, events: [] });
        resetEncounter(reset);
        lastTick = state.clocks.tick;
        lastTime = state.clocks.gameTimeMs;
        if (inactive) {
          applyInactiveReset?.();
          return { snapshot: snapshot(state.clocks.tick), candidates: [] };
        }

        if (from < 0) throw new RangeError('Invalid spatial time interval');
        const player = state.actors.find((a) => a.color === 'white');
        const active = state.actors.filter(
          (a) =>
            !a.defeated &&
            (!layout.battleStage || state.currentOpponentId !== null) &&
            poses.has(a.actorId) &&
            (a.actorId === player?.actorId ||
              a.actorId === state.currentOpponentId),
        );
        const trajectories: ActorTrajectory[] = [];
        const previousPoses = new Map(poses);
        const startupBases = stanceEnabled
          ? new Map<ActorId, StartupBasis>()
          : undefined;
        const stanceStarts = stanceEnabled
          ? new Map<ActorId, ReturnType<typeof resolveAttackStartStance>>()
          : undefined;
        if (stanceStarts && startupBases)
          for (const actor of active) {
            const attack = actor.attack;
            if (
              !attack ||
              attacks.get(actor.actorId) === attack.activationId ||
              !stanceBinding(attack.clipId)
            )
              continue;
            const old = previousPoses.get(actor.actorId)!;
            const target = active.find((a) => a.actorId !== actor.actorId);
            const resolution = resolveAttackStartStance(
              attack.clipId,
              old.position,
              old.facing,
              target ? previousPoses.get(target.actorId)?.position : undefined,
            );
            stanceStarts.set(actor.actorId, resolution);
            if (resolution.disposition === 'aligned')
              startupBases.set(
                actor.actorId,
                Object.freeze({
                  authority: 'activation-stance-v1',
                  oldYaw: Math.atan2(old.facing.x, old.facing.z),
                  admittedYaw: Math.atan2(
                    resolution.facing.x,
                    resolution.facing.z,
                  ),
                }),
              );
          }
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
          const stance = stanceStarts?.get(actor.actorId);
          if (stance) old = { ...old, facing: stance.facing };
          else if (
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
          const crouching =
            actor.crouching === true && old.grounded && !actor.attack && !jump;
          if (crouching) movement = v();
          // Outside combat, grounded travel supplies facing. Keep attack,
          // takeoff, and airborne orientation under their existing owners.
          if (
            !targetPose &&
            !actor.attack &&
            old.grounded &&
            !jump &&
            actor.actions.move.allowed &&
            Math.hypot(movement.x, movement.z) > 1e-8
          )
            old = {
              ...old,
              facing: faceToward(
                old.facing,
                movement,
                (8 * request.step.durationMs) / 1000,
              ),
            };
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
          const resolved =
            crouching && result.actor.grounded
              ? {
                  ...result.actor,
                  velocity: v(),
                  locomotion: 'crouch' as const,
                }
              : result.actor;
          poses.set(actor.actorId, resolved);
          trajectories.push({
            state: actor,
            actor: resolved,
            path: result.path,
            sample,
          });
        }
        const applyPose = timeline?.prepareStep(
          request,
          new Map([...poses].map(([id, pose]) => [id, pose.locomotion])),
          startupBases,
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
        if (checkpoint) restoreCheckpoint(checkpoint);
        throw error;
      }
    },
  };
}

/** D-only preparation from an already resolved physical piece. Coefficients use
 * the SAME u=(gameTime-from)/(to-from) for every coordinate. This is neither a
 * source geometry certificate nor an interval capability; production stays gated.
 * The caller retains its fixed support/basis and B slice identity. A closed
 * piece endpoint must equal the installed motor position exactly. A left-limit
 * polynomial with a rounded landing/bounds snap is not silently promoted to
 * that endpoint: it needs a separately qualified endpoint policy. */
export function captureFightingMotorGeometryPath(
  projection: import('./character-motor').FightingMotorProjection,
  from: number,
  to: number,
  planeY: number,
  posture: import('../contracts').FightingPosture,
) {
  if (
    ![from, to, planeY].every(Number.isFinite) ||
    from < projection.from ||
    to > projection.to ||
    from >= to
  )
    throw new RangeError('Invalid fighting geometry path interval');
  const piece = projection.pieces.find(
    (p) => from >= p.from && from < p.to && to <= p.to,
  );
  if (!piece)
    throw new RangeError('Fighting geometry path must not cross a motor seam');
  if (
    ![piece.position, piece.velocity, piece.acceleration].every((point) =>
      [point.x, point.y, point.z].every(Number.isFinite),
    )
  )
    throw new RangeError('Nonfinite fighting motor coefficients');
  const offset = piece.frozen ? 0 : (from - piece.from) / 1000;
  const span = piece.frozen ? 0 : (to - from) / 1000;
  const coefficient = (axis: 'x' | 'y' | 'z', origin = 0) => {
    const a = piece.acceleration[axis];
    const result = [
      piece.position[axis] +
        piece.velocity[axis] * offset +
        (a * offset * offset) / 2 -
        origin,
      piece.frozen ? 0 : (piece.velocity[axis] + a * offset) * span,
      piece.frozen ? 0 : (a * span * span) / 2,
    ] as const;
    if (!result.every(Number.isFinite))
      throw new RangeError('Nonfinite fighting motor coefficients');
    return Object.freeze(result);
  };
  const position = Object.freeze({
    x: coefficient('x'),
    y: coefficient('y'),
    z: coefficient('z'),
  });
  if (to === piece.to) {
    const installed = sampleFightingMotor(projection, to).position;
    for (const axis of ['x', 'y', 'z'] as const) {
      const c = position[axis];
      if (c[0] + c[1] + c[2] !== installed[axis])
        throw new RangeError(
          'Fighting motor endpoint requires separate qualification',
        );
    }
  }
  const expectedHurtProxy = fightingHurtProxy(v(), posture);
  Object.freeze(expectedHurtProxy.volume.start);
  Object.freeze(expectedHurtProxy.volume.end);
  Object.freeze(expectedHurtProxy.volume);
  Object.freeze(expectedHurtProxy);
  return Object.freeze({
    from,
    to,
    position,
    groundClearanceM: coefficient('y', planeY),
    expectedHurtProxy,
  });
}
