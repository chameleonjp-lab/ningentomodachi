import {
  createLivingPoseStamp,
  createDefeatPoseStamp,
  type DefeatPoseStamp,
  type SpatialStepRequest,
  type ActorState,
  type MotionCatalogPort,
  type GameSnapshot,
  gameTimeMs,
  type ActorId,
  type ActorPoseStamp,
  type CoreOutput,
  type GameTimeMs,
  type LivingPoseMode,
  type LivingPoseStamp,
  type PoseCatalogBindings,
  type PoseClipBinding,
  type RunId,
} from '../contracts';

type Mode = Exclude<LivingPoseMode, 'attack'>;
interface Resident {
  readonly activationAt: GameTimeMs;
  readonly mode: Mode;
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
export function createPoseTimeline(run: RunId) {
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
    )!;
    return createLivingPoseStamp({
      version: 1,
      binding,
      mode,
      startedAt,
      playback: mode === 'jump' ? 'clamp' : 'loop',
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
      if (!existing)
        resident = select(
          resident,
          createLivingPoseStamp({
            version: 1,
            binding,
            mode: 'attack',
            startedAt: attack.startedAt,
            playback: 'clamp',
            activationId: attack.activationId,
          }),
        );
    }
    const current = resident.selections.at(-1);
    if (
      current?.mode === 'attack' &&
      current.startedAt + current.binding.durationMs <= at
    )
      resident = select(
        resident,
        stamp(
          resident.mode,
          gameTimeMs(current.startedAt + current.binding.durationMs),
        ),
      );
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
          selections: bindings ? [stamp('idle', activationAt)] : [],
        };
      }
      next.set(id, resident);
    }
    return next;
  }
  return {
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
        });
      // Every descriptor and pending resident is valid before installation.
      const value = JSON.stringify(input);
      bindings = captured;
      provider = input;
      providerValue = value;
      residents = next;
    },
    validateAttackCatalog(snapshot: GameSnapshot, catalog: MotionCatalogPort) {
      alive();
      for (const actor of snapshot.actors) {
        if (!actor.attack) continue;
        const binding = bindings?.clips.find(
          (b) => b.clipId === actor.attack!.clipId,
        );
        const definition = catalog.get(actor.attack.clipId);
        if (
          !binding ||
          !definition ||
          binding.durationMs !== definition.durationMs
        )
          throw new Error('Attack pose timing mismatch');
      }
    },
    prepareCommit(output: CoreOutput, activationAt: GameTimeMs) {
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
              const entry = resident.selections
                .filter((s) => s.startedAt < event.at)
                .at(-1);
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
                selections: [entry],
                step: undefined,
              };
            }
          } else {
            if (resident.defeat || event)
              throw new Error('Conflicting living authority');
            // Encounter outcomes cancel any surviving activation at the batch time.
            const cancellation = deaths
              .map((e) => e.at)
              .sort((a, b) => a - b)
              .find((at) =>
                resident!.selections.some(
                  (s) =>
                    s.mode === 'attack' &&
                    s.startedAt <= at &&
                    s.startedAt + s.binding.durationMs > at,
                ),
              );
            if (cancellation !== undefined) {
              if (actor.attack)
                throw new Error('Attack survived authoritative cancellation');
              const mode = resident.step?.held ?? resident.mode;
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
              step: undefined,
            };
          }
          next.set(actor.actorId, resident);
        }
      return () => {
        alive();
        residents = next;
      };
    },
    prepareStep(
      request: SpatialStepRequest,
      motorEnds: ReadonlyMap<ActorId, Mode>,
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
        };
        resident = attackSelection(resident, actor, now);
        const mode = motorEnds.get(actor.actorId) ?? resident.mode;
        const current = resident.selections.at(-1)!;
        if (current.mode !== 'attack' && current.mode !== mode)
          resident = select(resident, stamp(mode, now));
        next.set(actor.actorId, { ...resident, mode });
      }
      return () => {
        alive();
        residents = next;
      };
    },
    read(id: ActorId): ActorPoseStamp | undefined {
      const resident = residents.get(id);
      if (resident?.defeat) return resident.defeat;
      const living = resident?.selections.at(-1);
      return living ? Object.freeze({ kind: 'living', living }) : undefined;
    },
    dispose() {
      residents.clear();
      bindings = undefined;
      provider = undefined;
      disposed = true;
    },
  };
}
