import {
  type ActorId,
  type StartupBasis,
  type StartupPoseEpoch,
  type StartupTimelinePolicy,
  captureStartupTimelinePolicy,
  createStartupPoseEpoch,
  startupSource,
  type ActorPoseStamp,
  type ActorState,
  type CoreOutput,
  captureRecoveryTimelinePolicy,
  createDefeatPoseStamp,
  createLivingPoseStamp,
  createRecoveryPoseEpoch,
  type DefeatPoseStamp,
  type GameSnapshot,
  type GameTimeMs,
  gameTimeMs,
  type LivingPoseMode,
  type LivingPoseStamp,
  type MotionCatalogPort,
  type PoseCatalogBindings,
  type PoseClipBinding,
  type PoseEpoch,
  type RecoveryPoseEpoch,
  type RecoveryTimelinePolicy,
  type RunId,
  type SpatialStepRequest,
} from '../contracts';

type Mode = Exclude<LivingPoseMode, 'attack'>;
const NO_STARTUPS = Object.freeze([]);
interface Resident {
  readonly activationAt: GameTimeMs;
  readonly mode: Mode;
  readonly at: GameTimeMs;
  readonly recoveries: readonly Readonly<{
    readonly epoch: RecoveryPoseEpoch;
    /** Exact immutable selection installed by natural completion, not value equality. */
    readonly selection: LivingPoseStamp;
  }>[];
  readonly startups: readonly Readonly<{
    epoch: StartupPoseEpoch;
    selection: LivingPoseStamp;
    prior: LivingPoseStamp;
  }>[];
  readonly unqualified?: LivingPoseStamp | undefined;
  readonly selections: readonly LivingPoseStamp[];
  readonly defeat?: DefeatPoseStamp;
  readonly step?:
    | {
        readonly from: GameTimeMs;
        readonly to: GameTimeMs;
        readonly held: Mode;
      }
    | undefined;
}
/** One run's simulation authority. No rig, renderer, clock or geometry is owned here. */
export function createPoseTimeline(
  run: RunId,
  diagnostic?: RecoveryTimelinePolicy,
  startupDiagnostic?: StartupTimelinePolicy,
) {
  const recoveryPolicy = diagnostic
    ? captureRecoveryTimelinePolicy(diagnostic)
    : undefined;
  const startupPolicy = startupDiagnostic
    ? captureStartupTimelinePolicy(startupDiagnostic)
    : undefined;
  const retired = new Set<ActorId>();
  let generation = 0;
  let residents = new Map<ActorId, Resident>();
  let bindings: PoseCatalogBindings | undefined;
  let provider: PoseCatalogBindings | undefined;
  let providerValue: string | undefined;
  let disposed = false;
  const alive = () => {
    if (disposed) throw new Error('Pose timeline disposed');
  };
  function stamp(mode: Mode, startedAt: GameTimeMs, source = bindings!) {
    const binding = source.clips.find(
      (b) => b.clipId === source.locomotion[mode],
    );
    if (!binding) throw new Error(`Missing ${mode} pose locomotion binding`);
    return createLivingPoseStamp({
      version: 1,
      binding,
      mode,
      startedAt,
      playback: mode === 'crouch' ? 'hold' : mode === 'jump' ? 'clamp' : 'loop',
      activationId: null,
    });
  }
  function select(resident: Resident, selection: LivingPoseStamp): Resident {
    return {
      ...resident,
      selections: [
        ...resident.selections.filter((s) => s.startedAt < selection.startedAt),
        selection,
      ],
    };
  }
  function attackSelection(
    resident: Resident,
    actor: ActorState,
    at: GameTimeMs,
    bases?: ReadonlyMap<ActorId, StartupBasis>,
  ): Resident {
    const attack = actor.attack;
    if (attack) {
      const binding = bindings!.clips.find((b) => b.clipId === attack.clipId);
      if (!binding) throw new Error('Missing attack pose binding');
      if (attack.startedAt > at) throw new Error('Future attack pose');
      const existing = resident.selections.find(
        (s) => s.activationId === attack.activationId,
      );
      if (
        existing &&
        (existing.startedAt !== attack.startedAt ||
          existing.binding.clipId !== attack.clipId)
      )
        throw new Error('Conflicting attack activation');
      if (!existing) {
        const prior =
          startupPolicy && startupSource(attack.clipId)
            ? entryAt(resident, attack.startedAt, 'left')
            : undefined;
        const selection = createLivingPoseStamp({
          version: 1,
          binding,
          mode: 'attack',
          startedAt: attack.startedAt,
          playback: 'clamp',
          activationId: attack.activationId,
        });
        resident = select(resident, selection);
        if (startupPolicy && startupSource(attack.clipId)) {
          const basis = bases?.get(actor.actorId);
          if (
            prior &&
            !('kind' in prior) &&
            prior.mode === 'idle' &&
            prior.binding.clipId === 'Idle' &&
            basis
          ) {
            const epoch = createStartupPoseEpoch({
              runId: run,
              actorId: actor.actorId,
              outgoing: prior,
              destination: selection,
              basis,
              policy: startupPolicy,
            });
            resident = {
              ...resident,
              startups: [
                ...resident.startups.filter(
                  (r) => r.epoch.startMs < epoch.startMs,
                ),
                Object.freeze({ epoch, selection, prior }),
              ],
              unqualified: undefined,
            };
          } else resident = { ...resident, unqualified: selection };
        }
      }
    }
    const current = resident.selections.at(-1);
    if (
      current?.mode === 'attack' &&
      current.startedAt + current.binding.durationMs <= at
    ) {
      const destination = stamp(
        resident.mode,
        gameTimeMs(current.startedAt + current.binding.durationMs),
      );
      resident = select(resident, destination);
      if (
        recoveryPolicy &&
        current.binding.clipId === 'KungFuStraight' &&
        destination.mode === 'idle' &&
        destination.binding.clipId === 'Idle'
      ) {
        const epoch = createRecoveryPoseEpoch({
          runId: run,
          actorId: actor.actorId,
          outgoing: current,
          destination,
        });
        resident = {
          ...resident,
          recoveries: [
            ...resident.recoveries.filter(
              (r) => r.epoch.startMs < epoch.startMs,
            ),
            Object.freeze({ epoch, selection: destination }),
          ],
        };
      }
    }
    return resident;
  }
  function seed(output: CoreOutput, activationAt: GameTimeMs) {
    alive();
    gameTimeMs(activationAt);
    const state = output.snapshot;
    if (state.runId !== run) throw new Error('Stale pose run');
    if (!bindings && state.phase !== 'loading')
      throw new Error('Pose catalog not bound');
    const ids = state.residentActorIds ?? state.actors.map((a) => a.actorId);
    if (
      ids.some((id) => retired.has(id)) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !state.actors.some((a) => a.actorId === id))
    )
      throw new Error('Invalid pose residency');
    const next = new Map<ActorId, Resident>();
    for (const id of ids) {
      let resident = residents.get(id);
      if (!resident) {
        const event = output.events.find(
          (e) => e.type === 'OpponentChanged' && e.currentActorId === id,
        );
        if (event && event.at !== activationAt)
          throw new Error('Conflicting resident activation time');
        resident = {
          activationAt,
          mode: 'idle',
          at: activationAt,
          recoveries: [],
          startups: NO_STARTUPS,
          selections: bindings ? [stamp('idle', activationAt)] : [],
        };
      }
      next.set(id, resident);
    }
    return next;
  }
  function entryAt(
    resident: Resident,
    at: GameTimeMs,
    side: 'left' | 'right',
  ): PoseEpoch | undefined {
    const selected = resident.selections
      .filter((s) => (side === 'left' ? s.startedAt < at : s.startedAt <= at))
      .at(-1);
    if (!selected) return undefined;
    // At activation's strict-left limit, preserve the prior pose AND its old basis
    // under the newly admitted physical basis. This descriptor is not a new source claim.
    const startup =
      startupPolicy &&
      resident.startups.find(
        (r) =>
          (selected === r.selection ||
            (side === 'left' &&
              at === r.epoch.startMs &&
              selected === r.prior)) &&
          at >= r.epoch.startMs &&
          (side === 'left' ? at <= r.epoch.endMs : at < r.epoch.endMs),
      );
    if (startup) return startup.epoch;
    return (
      resident.recoveries.find(
        (r) =>
          selected === r.selection &&
          at >= r.epoch.startMs &&
          (side === 'left' ? at <= r.epoch.endMs : at < r.epoch.endMs),
      )?.epoch ?? selected
    );
  }
  function installer(next: Map<ActorId, Resident>) {
    const preparedGeneration = generation;
    return () => {
      alive();
      if (preparedGeneration !== generation)
        throw Error('Stale pose preparation');
      for (const id of residents.keys()) if (!next.has(id)) retired.add(id);
      residents = next;
      generation++;
    };
  }
  return {
    recoveryCapability: recoveryPolicy,
    startupCapability: startupPolicy,
    bindPreparedCatalog(input: PoseCatalogBindings) {
      alive();
      if (provider) {
        if (provider !== input || providerValue !== JSON.stringify(input))
          throw new Error('Different pose catalog rebinding');
        return;
      }
      if (input.version !== 1 || !input.bindingSetId?.trim())
        throw new Error('Invalid pose catalog');
      const ids = new Set<string>();
      const clips: PoseClipBinding[] = input.clips.map((binding) => {
        if (ids.has(binding.clipId)) throw new Error('Duplicate pose clip');
        ids.add(binding.clipId);
        return createLivingPoseStamp({
          version: 1,
          binding,
          mode: 'idle',
          startedAt: gameTimeMs(0),
          playback: 'loop',
          activationId: null,
        }).binding;
      });
      for (const mode of ['idle', 'walk', 'run', 'jump'] as const)
        if (!ids.has(input.locomotion[mode]))
          throw new Error('Missing locomotion binding');
      if (
        'crouch' in input.locomotion &&
        (typeof input.locomotion.crouch !== 'string' ||
          !ids.has(input.locomotion.crouch))
      )
        throw new Error('Missing crouch locomotion binding');
      const captured: PoseCatalogBindings = Object.freeze({
        version: 1,
        bindingSetId: input.bindingSetId,
        clips: Object.freeze(clips),
        locomotion: Object.freeze({ ...input.locomotion }),
      });
      const next = new Map<ActorId, Resident>();
      for (const [id, resident] of residents)
        next.set(id, {
          ...resident,
          selections: [stamp(resident.mode, resident.activationAt, captured)],
          recoveries: [],
          startups: NO_STARTUPS,
        });
      // Every descriptor and pending resident is valid before installation.
      const value = JSON.stringify(input);
      bindings = captured;
      provider = input;
      providerValue = value;
      residents = next;
      generation++;
    },
    validateAttackCatalog(
      snapshot: GameSnapshot,
      catalog: MotionCatalogPort,
      stanceEnabled = false,
    ) {
      alive();
      for (const actor of snapshot.actors) {
        if (!actor.attack) continue;
        const binding = bindings?.clips.find(
          (b) => b.clipId === actor.attack!.clipId,
        );
        const definition = catalog.get(actor.attack.clipId);
        const pin =
          (startupPolicy || stanceEnabled) &&
          startupSource(actor.attack.clipId);
        if (
          pin &&
          (!binding ||
            binding.sourceBindingId !== pin.binding.sourceBindingId ||
            binding.durationMs !== pin.binding.durationMs ||
            (startupPolicy &&
              (!definition?.impacts.length ||
                Math.min(...definition.impacts.map((i) => i.startMs)) !==
                  pin.firstActiveMs)))
        )
          throw Error('Startup source binding/window mismatch');
        if (
          !binding ||
          !definition ||
          binding.durationMs !== definition.durationMs
        )
          throw new Error('Attack pose timing mismatch');
      }
    },
    prepareCommit(
      output: CoreOutput,
      activationAt: GameTimeMs,
      locomotionOverrides?: ReadonlyMap<ActorId, Mode>,
    ) {
      const next = seed(output, activationAt);
      const state = output.snapshot,
        now = state.clocks.gameTimeMs;
      for (const event of output.events)
        if (
          event.runId !== run ||
          !Number.isFinite(event.at) ||
          event.at < 0 ||
          event.at > now
        )
          throw new Error('Invalid pose event');
      const deaths = output.events.filter((e) => e.type === 'ActorDefeated');
      for (const event of output.events) {
        if (
          event.type === 'OpponentChanged' &&
          event.currentActorId &&
          next.get(event.currentActorId)?.activationAt !== event.at
        )
          throw new Error('Conflicting resident activation event');
      }
      const deathTimes = new Map<ActorId, GameTimeMs>();
      for (const event of deaths) {
        if (
          !next.has(event.actorId) ||
          !state.actors.find((a) => a.actorId === event.actorId)?.defeated
        )
          throw new Error('Unknown or living death event target');
        if (
          deathTimes.has(event.actorId) &&
          deathTimes.get(event.actorId) !== event.at
        )
          throw new Error('Conflicting death events');
        deathTimes.set(event.actorId, event.at);
      }

      if (bindings)
        for (const actor of state.actors) {
          let resident = next.get(actor.actorId);
          if (!resident) continue;
          // Core can finalize at a contact strictly inside the admitted step.
          // The motor result stays unchanged, but future pose selections do not
          // become authority. Restore the mode held inside that interval.
          if (resident.step && now < resident.step.to) {
            resident = {
              ...resident,
              mode: resident.step.held,
              selections: resident.selections.filter((s) => s.startedAt <= now),
              recoveries: resident.recoveries.filter(
                (r) => r.epoch.startMs <= now,
              ),
              startups: startupPolicy
                ? resident.startups.filter((r) => r.epoch.startMs <= now)
                : NO_STARTUPS,
            };
          }
          const event = deaths.find((e) => e.actorId === actor.actorId);
          if (actor.defeated) {
            if (!actor.defeatPresentation)
              throw new Error('Missing defeat presentation');
            if (resident.defeat) {
              if (
                resident.defeat.defeatStartedAt !==
                  actor.defeatPresentation.startedAt ||
                (event && event.at !== resident.defeat.entryAt)
              )
                throw new Error('Conflicting death provenance');
            } else {
              if (!event) throw new Error('Missing authoritative death event');
              const entry = entryAt(resident, event.at, 'left');
              if (!entry) throw new Error('No living left-limit entry');
              const defeat = createDefeatPoseStamp({
                kind: 'defeat',
                entry,
                entryAt: event.at,
                defeatStartedAt: actor.defeatPresentation.startedAt,
              });
              resident = {
                ...resident,
                defeat,
                selections: ['kind' in entry ? entry.destination : entry],
                recoveries: [],
                startups: NO_STARTUPS,
                step: undefined,
              };
            }
          } else {
            if (resident.defeat || event)
              throw new Error('Conflicting living authority');
            const override = locomotionOverrides?.get(actor.actorId);
            if (override !== undefined)
              resident = {
                ...resident,
                mode: override,
                selections: [stamp(override, now)],
                recoveries: [],
                startups: NO_STARTUPS,
                unqualified: undefined,
                step: undefined,
              };
            // Encounter outcomes cancel any surviving activation at the batch time.
            const cancellation = deaths
              .map((e) => e.at)
              .sort((a, b) => a - b)
              .find(
                (at) =>
                  resident!.selections.some(
                    (s) =>
                      s.mode === 'attack' &&
                      s.startedAt <= at &&
                      s.startedAt + s.binding.durationMs > at,
                  ) ||
                  resident!.recoveries.some(
                    (r) =>
                      r.epoch.startMs <= at &&
                      at < r.epoch.endMs &&
                      entryAt(resident!, at, 'right') === r.epoch,
                  ),
              );
            if (cancellation !== undefined) {
              if (actor.attack)
                throw new Error('Attack survived authoritative cancellation');
              const mode = resident.step?.held ?? resident.mode;
              // A new canonical selection invalidates the recovery on the right,
              // even when its values equal the natural destination at the seam.
              // Keep the old selection/record for a same-time strict-left death.
              resident = select(resident, stamp(mode, cancellation));
              if (
                resident.step &&
                resident.step.to >= cancellation &&
                resident.step.to <= now &&
                resident.mode !== mode
              )
                resident = select(
                  resident,
                  stamp(resident.mode, resident.step.to),
                );
            } else resident = attackSelection(resident, actor, now);
            if (!actor.attack && resident.selections.at(-1)?.mode === 'attack')
              throw new Error('Unexplained attack cancellation');
            resident = {
              ...resident,
              selections: resident.selections.slice(-2),
              startups: startupPolicy
                ? resident.startups.filter(
                    (r) =>
                      r.epoch.endMs >= now &&
                      (entryAt(resident!, now, 'right') === r.epoch ||
                        entryAt(resident!, now, 'left') === r.epoch),
                  )
                : NO_STARTUPS,
              unqualified:
                resident.selections.at(-1) === resident.unqualified
                  ? resident.unqualified
                  : undefined,
              recoveries: resident.recoveries.filter(
                (r) =>
                  r.epoch.endMs >= now &&
                  (entryAt(resident!, now, 'right') === r.epoch ||
                    entryAt(resident!, now, 'left') === r.epoch),
              ),
              step: undefined,
            };
          }
          next.set(actor.actorId, { ...resident, at: now });
        }
      return installer(next);
    },
    prepareStep(
      request: SpatialStepRequest,
      motorEnds: ReadonlyMap<ActorId, Mode>,
      startupBases?: ReadonlyMap<ActorId, StartupBasis>,
    ) {
      const now = request.snapshot.clocks.gameTimeMs;
      const from = gameTimeMs(now - request.step.durationMs);
      const next = seed({ snapshot: request.snapshot, events: [] }, from);
      for (const actor of request.snapshot.actors) {
        let resident = next.get(actor.actorId);
        if (!resident || resident.defeat) continue;
        const before = resident.selections
          .filter((s) => s.startedAt < from)
          .at(-1);
        resident = {
          ...resident,
          selections: [
            ...(before ? [before] : []),
            ...resident.selections.filter((s) => s.startedAt >= from),
          ],
          step: { from, to: now, held: resident.mode },
          recoveries: resident.recoveries.filter((r) => r.epoch.endMs >= from),
          startups: startupPolicy
            ? resident.startups.filter((r) => r.epoch.endMs >= from)
            : NO_STARTUPS,
        };
        // Crouch is an already-admitted Core posture at the left boundary,
        // not a motor-end blend from the prior standing capsule/pose.
        const motorMode = motorEnds.get(actor.actorId);
        const posture =
          actor.crouching === true && !actor.attack && motorMode === 'crouch'
            ? 'crouch'
            : resident.mode === 'crouch'
              ? motorMode === 'jump'
                ? 'jump'
                : 'idle'
              : undefined;
        if (posture !== undefined && posture !== resident.mode) {
          // Interior truncation/cancellation must retain this admitted posture,
          // not the prior interval's mode. The older selection still owns the
          // strict-left boundary used by a same-time death.
          resident = {
            ...resident,
            mode: posture,
            step: { from, to: now, held: posture },
          };
          resident = select(resident, stamp(posture, from));
        }
        resident = attackSelection(resident, actor, now, startupBases);
        const mode = motorEnds.get(actor.actorId) ?? resident.mode;
        const current = resident.selections.at(-1)!;
        if (current.mode !== 'attack' && current.mode !== mode)
          resident = select(resident, stamp(mode, now));
        next.set(actor.actorId, { ...resident, mode, at: now });
      }
      return installer(next);
    },
    read(id: ActorId): ActorPoseStamp | undefined {
      alive();
      const resident = residents.get(id);
      if (resident?.defeat) return resident.defeat;
      const epoch = resident && entryAt(resident, resident.at, 'right');
      if (!epoch) return undefined;
      return 'kind' in epoch
        ? epoch.kind === 'startup'
          ? Object.freeze({ kind: 'startup', epoch })
          : Object.freeze({ kind: 'recovery', epoch })
        : Object.freeze({
            kind: 'living',
            living: epoch,
            ...(resident!.unqualified === epoch
              ? {
                  startupQualification:
                    'unqualified-outgoing-or-basis' as const,
                }
              : {}),
          });
    },
    dispose() {
      residents.clear();
      retired.clear();
      generation++;
      bindings = undefined;
      provider = undefined;
      disposed = true;
    },
  };
}
