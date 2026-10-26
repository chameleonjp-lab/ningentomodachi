import { immutableDto } from '../app/immutableDto';
import {
  type ActorColor,
  type ActorId,
  type ActorState,
  type ClipId,
  type CommandId,
  type SpatialStepRequest,
  activeRealTimeMs,
  actorId,
  attackActivationId,
  batchId,
  type CoreCommand,
  createLivingPoseStamp,
  type CoreOutput,
  type CorePort,
  type DamageCause,
  type DomainEvent,
  domainEventId,
  durationMs,
  type GameplayCommand,
  type GameSnapshot,
  gameTimeMs,
  type ImpactReference,
  impactId,
  type MotionCatalogPort,
  type MotionDefinition,
  type MoveSet,
  type PauseReason,
  type PresentationState,
  presentationTimeMs,
  type RunContext,
  type SpatialCandidate,
  type SpatialSnapshot,
  tick,
  validateMotionDefinition,
} from '../contracts';
import { requireValue } from './invariant';
import {
  FIGHTING_ENTRIES,
  FIGHTING_MOVE_SPECS,
  FIGHTING_ACTIVE_CANCEL_EDGES,
  captureFightingCombatantState,
  captureFightingClock,
  captureFightingPolicy,
  captureFightingSpatialTransactionPolicy,
  captureFightingReadyDescriptor,
  captureFightingBootstrap,
  captureFightingSpatialTransactionResult,
  captureFightingProjectInput,
  captureFightingSpatialFrontier,
  captureFightingSpatialCommitReceipt,
  captureFightingEncounterReset,
  type FightingAcceptedActorPrefix,
  type FightingEncounterReset,
  type FightingSpatialTransactionPort,
  type FightingRecipeEntry,
  captureFightingTransactionalClock,
  captureFightingClockPoint,
  type FightingClockPoint,
  type FightingPoseHold,
  type FightingSpatialTransactionPolicy,
  type FightingReadyDescriptor,
  captureLegacyImpactProfile,
  captureFightingSpatialStepResult,
  type FightingPolicy,
  type FightingEntry,
  type FightingCombatantState,
  type FightingClockSlice,
  type FightingInputEdge,
  type FightingAttackDescriptor,
  type FightingSpatialStepResult,
  type FightingContactWitness,
  type LegacyImpactProfile,
} from '../contracts/fighting';
import {
  createFightingCombatant,
  applyFightingTransition,
  receiveFightingInputs,
  fightingHeatCost,
} from './fightingState';
import {
  normalizeFightingInputs,
  resolveFightingContact,
  fightingDamageHp,
} from './fightingRules';
import {
  createFightingClockSlice,
  projectFightingHeatTime,
} from './fightingClock';

export type FightingPoseKey =
  | 'standing'
  | 'crouching'
  | 'airborne'
  | 'landing'
  | 'guard-standing'
  | 'guard-crouching'
  | 'hit-standing'
  | 'hit-crouching';
/** Explicit Core-only admission. Real assets, spatial paths and public readiness are F/C/D gates. */
interface CoreFightingCommonOptions {
  readonly policy: FightingPolicy;
  readonly entries: readonly (FightingEntry & { readonly clipId: ClipId })[];
  readonly catalog: Pick<MotionCatalogPort, 'get' | 'list'>;
  readonly legacyImpactProfiles: readonly LegacyImpactProfile[];
  readonly poseClips: Readonly<Record<FightingPoseKey, ClipId>>;
}
export type CoreFightingOptions = CoreFightingCommonOptions &
  (
    | { readonly mode: 'core-evidence-only' }
    | {
        readonly mode: 'battle-transaction-v1';
        readonly transactionPolicy: FightingSpatialTransactionPolicy;
        readonly ready: () => FightingReadyDescriptor;
      }
  );
const FIGHTING_TICK_MS = 1000 / 60;
// Normalize only binary arithmetic roundoff (8 ULP), never a gameplay epsilon or TOI tick bucket.
const sameClockPoint = (a: number, b: number) =>
  Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;
const reached = (value: number, boundary: number) =>
  value >= boundary || sameClockPoint(value, boundary);
const clockTicks = (ms: number) => {
  const ticks = ms / FIGHTING_TICK_MS,
    nearest = Math.round(ticks);
  return sameClockPoint(ticks, nearest) ? nearest : ticks;
};
const clockFloor = (ms: number) => Math.floor(clockTicks(ms));
const clockRemaining = (ms: number) => Math.max(0, Math.ceil(clockTicks(ms)));
/** Normalize cancellation roundoff using the original absolute operands, not a smaller difference. */
const actionElapsed = (now: number, origin: number) => {
  const elapsed = now - origin,
    nearest = Math.round(elapsed / FIGHTING_TICK_MS);
  return sameClockPoint(now, origin + nearest * FIGHTING_TICK_MS)
    ? nearest * FIGHTING_TICK_MS
    : elapsed;
};
// Captured finite components may still overflow products, lengths or subtraction.
function horizontalUnit(x: number, z: number) {
  const scale = Math.max(Math.abs(x), Math.abs(z));
  if (scale === 0) return null;
  const sx = x / scale,
    sz = z / scale,
    length = Math.hypot(sx, sz);
  return { x: sx / length, z: sz / length };
}
function fightingFrontDot(witness: FightingContactWitness) {
  const source = witness.sourcePosition,
    target = witness.targetPosition;
  let dx = source.x - target.x,
    dz = source.z - target.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
    // Only rescale before subtraction when required: shared large coordinates
    // must not erase an otherwise representable tiny displacement on the other axis.
    const scale = Math.max(
      Math.abs(source.x),
      Math.abs(source.z),
      Math.abs(target.x),
      Math.abs(target.z),
    );
    dx = source.x / scale - target.x / scale;
    dz = source.z / scale - target.z / scale;
  }
  const direction = horizontalUnit(dx, dz),
    facing = horizontalUnit(witness.targetFacing.x, witness.targetFacing.z);
  if (!direction || !facing) return -1;
  // Clamp only unit-vector dot roundoff, never witness components or world bounds.
  return Math.max(
    -1,
    Math.min(1, direction.x * facing.x + direction.z * facing.z),
  );
}
interface FightingRuntime {
  airborne: boolean;
  actionMs: number;
  heatMs: number;
  stopUntil: number;
  moveStart: number;
  contactAt: number | null;
  stunUntil: number;
  landingUntil: number;
  bufferAt: number | null;
  epochId: string;
  clipId: ClipId;
  activationId: import('../contracts').AttackActivationId | null;
  motionMs: number;
  poseKey: string;
}

import {
  advanceHeat,
  calculateScore,
  createRandom,
  damageForRange,
  distributeDamage,
  finishHeat,
  initialHeat,
  PROVISIONAL_TUNING,
  startHeat,
} from './rules';
import { createWorldLedger, type WorldSeed } from './worldLedger';
export interface CoreOptions {
  readonly fighting?: CoreFightingOptions;
  readonly catalog: Pick<MotionCatalogPort, 'get' | 'list'> &
    Partial<Pick<MotionCatalogPort, 'pose'>>;
  readonly moves: Readonly<Record<ActorColor, MoveSet>>;
  readonly world?: WorldSeed;
  /** Production composition supplies an AI intent provider with real C movement sessions. */
  readonly enemyAi?:
    | false
    | ((
        snapshot: GameSnapshot,
        spatial: SpatialSnapshot | null,
      ) => readonly GameplayCommand[]);
  /** Provisional v6 prototype policy, not a confirmed restriction. No action buffering. */
  readonly groundedAttacksOnly?: boolean;
}
type EventData = DomainEvent extends infer E
  ? E extends DomainEvent
    ? Omit<E, 'eventId' | 'sequence' | 'runId' | 'at'>
    : never
  : never;
const colors: readonly ActorColor[] = [
  'white',
  'blue',
  'green',
  'yellow',
  'black',
];
const denied = (
  reason: 'not-running' | 'busy' | 'cooling-lock' | 'defeated' | 'unavailable',
) => ({ allowed: false as const, reason });
const allowed = Object.freeze({ allowed: true as const, reason: null });
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Sole rules authority. Synthetic or real catalogs use exactly the same public DTO boundary. */
export function createCore(
  context: RunContext,
  options: CoreOptions,
): CorePort {
  if (
    options.fighting &&
    options.fighting.mode !== 'core-evidence-only' &&
    options.fighting.mode !== 'battle-transaction-v1'
  )
    throw new RangeError('Fighting requires an explicit supported Core mode');
  if (options.fighting?.mode === 'battle-transaction-v1') {
    captureFightingSpatialTransactionPolicy(options.fighting.transactionPolicy);
    if (options.world?.vehicles.length || options.world?.objects.length)
      throw new RangeError('Strict fighting requires an empty battle world');
  }
  let random = createRandom(context.seed);
  const fighting = options.fighting
    ? {
        ...options.fighting,
        ...(options.fighting.mode === 'battle-transaction-v1'
          ? {
              transactionPolicy: captureFightingSpatialTransactionPolicy(
                options.fighting.transactionPolicy,
              ),
            }
          : {}),
        policy: captureFightingPolicy(options.fighting.policy),
        entries: immutableDto(options.fighting.entries),
        poseClips: immutableDto(options.fighting.poseClips),
        legacyImpactProfiles: options.fighting.legacyImpactProfiles.map(
          captureLegacyImpactProfile,
        ),
      }
    : null;
  const strictMode = fighting?.mode === 'battle-transaction-v1';
  const usedTransactions = new Set<string>();
  const usedReceipts = new Set<string>();
  let selecting = false;
  let resolving = false;
  let callbackRead: GameSnapshot | null = null;
  let holdReason: FightingPoseHold['reason'] = 'prestep-intent';
  let readyDescriptor: FightingReadyDescriptor | null = null;
  let pending: {
    request: SpatialStepRequest;
    state: ReturnType<typeof checkpoint>;
    read: GameSnapshot;
  } | null = null;
  let fightingMetadata = new Map<ClipId, MotionDefinition>();
  let profiles = new Map<string, LegacyImpactProfile>();
  let fightingRuntime = new Map<ActorId, FightingRuntime>();
  let epochSerial = 0;
  let fightingCursor = 0;
  let fightingRequest: SpatialStepRequest | null = null;
  let fightingResult: FightingSpatialStepResult | null = null;
  let acceptedSlices = new Map<ActorId, FightingClockSlice[]>();

  const world = createWorldLedger(
    context.runId,
    options.world ?? { vehicles: [], objects: [] },
  );
  const sets = immutableDto(options.moves);
  let metadata = new Map<MotionDefinition['clipId'], MotionDefinition>();
  let crouchAvailable = false;
  function prepareCatalog() {
    // Capture capability only after preparation. A partial/generic catalog
    // never turns an input-selected posture into physics authority.
    const pose = options.catalog.pose;
    const binding = pose?.clips.find(
      (b) => b.clipId === pose.locomotion.crouch,
    );
    crouchAvailable = false;
    if (pose?.version === 1 && pose.bindingSetId?.trim() && binding) {
      try {
        createLivingPoseStamp({
          version: 1,
          binding,
          mode: 'crouch',
          startedAt: gameTimeMs(0),
          playback: 'hold',
          activationId: null,
        });
        crouchAvailable = true;
      } catch {
        // Optional support is absent when its descriptor is invalid.
      }
    }
    const catalogItems = options.catalog.list();
    if (new Set(catalogItems.map((m) => m.clipId)).size !== catalogItems.length)
      throw new Error('Catalog clip IDs must be unique');
    metadata = new Map(catalogItems.map((m) => [m.clipId, immutableDto(m)]));
    for (const motion of metadata.values()) {
      const validation = validateMotionDefinition(motion);
      if (!validation.valid)
        throw new Error(
          `Invalid motion ${motion.clipId}: ${validation.errors.join(',')}`,
        );
    }
    if (fighting) {
      if (
        Object.values(FIGHTING_MOVE_SPECS).some(
          (spec) =>
            !Number.isFinite(
              spec.damageNormalized * fighting.policy.hpPerNormalizedPoint,
            ),
        )
      )
        throw new RangeError('Normalized fighting HP scale overflows');
      const player = fighting.catalog.list();
      if (new Set(player.map((m) => m.clipId)).size !== player.length)
        throw new Error('Duplicate fighting clip');
      for (const motion of player) {
        if (
          metadata.has(motion.clipId) ||
          !validateMotionDefinition(motion).valid
        )
          throw new Error(
            'Fighting repertoire must be valid and separate from legacy inventory',
          );
        fightingMetadata.set(motion.clipId, immutableDto(motion));
      }
      if (
        fighting.entries.length !== FIGHTING_ENTRIES.length ||
        player.length !== FIGHTING_ENTRIES.length
      )
        throw new Error(
          'Fighting requires all eleven separately bound entries',
        );
      for (const entry of FIGHTING_ENTRIES) {
        const matches = fighting.entries.filter(
          (e) => e.posture === entry.posture && e.moveId === entry.moveId,
        );
        const bound = matches[0];
        const motion = bound ? fightingMetadata.get(bound.clipId) : null;
        const spec = FIGHTING_MOVE_SPECS[entry.moveId];
        const expectedCategory =
          entry.moveId.startsWith('k_') || entry.moveId === 'a_kick'
            ? 'kick'
            : 'punch';
        if (
          matches.length !== 1 ||
          !motion ||
          motion.category !== expectedCategory ||
          Math.abs(
            motion.durationMs -
              (spec.startupTicks + spec.activeTicks + spec.recoveryTicks) *
                FIGHTING_TICK_MS,
          ) > 1e-7 ||
          motion.impacts.length !== 1 ||
          !motion.impacts.every(
            (i) =>
              Math.abs(i.startMs - spec.startupTicks * FIGHTING_TICK_MS) <
                1e-7 &&
              Math.abs(
                i.endMs -
                  (spec.startupTicks + spec.activeTicks) * FIGHTING_TICK_MS,
              ) < 1e-7,
          )
        )
          throw new Error('Fighting entry timing/category mismatch');
      }
      if (
        new Set(fighting.entries.map((e) => e.clipId)).size !==
        fighting.entries.length
      )
        throw new Error('Fighting entries require separate clip bindings');
      for (const key of [
        'standing',
        'crouching',
        'airborne',
        'landing',
        'guard-standing',
        'guard-crouching',
        'hit-standing',
        'hit-crouching',
      ] as const)
        if (!fighting.poseClips[key]?.trim())
          throw new Error('Missing explicit fighting pose clip');
      for (const profile of fighting.legacyImpactProfiles) {
        const key = `${profile.clipId}:${profile.impactIndex}`;
        if (
          profiles.has(key) ||
          !metadata
            .get(profile.clipId)
            ?.impacts.some((i) => i.impactIndex === profile.impactIndex)
        )
          throw new Error('Duplicate or foreign legacy impact profile');
        profiles.set(key, profile);
      }
      for (const motion of metadata.values())
        for (const impact of motion.impacts)
          if (!profiles.has(`${motion.clipId}:${impact.impactIndex}`))
            throw new Error('Unclassified legacy impact');
      for (const actor of actors) {
        updateActor(actor.actorId, { fighting: createFightingCombatant() });
        fightingRuntime.set(actor.actorId, {
          airborne: false,
          actionMs: 0,
          heatMs: 0,
          stopUntil: 0,
          moveStart: 0,
          contactAt: null,
          stunUntil: 0,
          landingUntil: 0,
          bufferAt: null,
          epochId: `${context.runId}:epoch:${++epochSerial}`,
          clipId: fighting.poseClips.standing,
          activationId: null,
          motionMs: 0,
          poseKey: 'standing',
        });
      }
    }
    for (const color of colors) {
      const set = sets[color];
      if (!set) throw new Error(`Missing ${color} move set`);
      for (const category of ['punch', 'kick'] as const) {
        const ids = category === 'punch' ? set.punches : set.kicks;
        if (new Set(ids).size !== ids.length)
          throw new Error('Move sets cannot contain duplicates');
        for (const id of ids)
          if (metadata.get(id)?.category !== category)
            throw new Error('Move category/catalog mismatch');
      }
      if (
        color === 'black' &&
        (set.punches.length !== 0 ||
          set.kicks.length !== 19 ||
          metadata.size === 0 ||
          [...metadata.values()]
            .filter((m) => m.category === 'kick')
            .some((m) => !set.kicks.includes(m.clipId)))
      )
        throw new Error('Black requires all 19 kicks and no punches');
      if (
        color !== 'white' &&
        color !== 'black' &&
        (set.punches.length !== 4 || set.kicks.length !== 4)
      )
        throw new Error('Normal enemies require 4+4 moves');
      if (color === 'white' && (!set.punches.length || set.kicks.length !== 19))
        throw new Error('White requires punches and all 19 kicks');
    }
  }
  let actors: ActorState[] = colors.map((color) => ({
    actorId: actorId(`${context.runId}:actor:${color}`),
    color,
    hp: color === 'black' ? 700 : 500,
    maxHp: color === 'black' ? 700 : 500,
    heat: initialHeat(),
    attack: null,
    defeated: false,
    crouching: false,
    actions: {
      punch: denied('not-running'),
      kick: denied('not-running'),
      jump: denied('not-running'),
      move: denied('not-running'),
    },
  }));
  let heat = new Map(actors.map((a) => [a.actorId, initialHeat()]));
  let snapshot: GameSnapshot = immutableDto({
    contractVersion: 1,
    revision: 0,
    ...context,
    phase: 'loading',
    clocks: {
      tick: tick(0),
      gameTimeMs: gameTimeMs(0),
      activeRealTimeMs: activeRealTimeMs(0),
      presentationTimeMs: presentationTimeMs(0),
    },
    pauseReasons: [],
    quality: 'standard',
    actors,
    residentActorIds: actors.slice(0, 2).map((actor) => actor.actorId),
    currentOpponentId: null,
    result: null,
    presentation: { kind: 'none' },
    world: world.read(),
  });
  let events: DomainEvent[] = [];
  let sequence = 0;
  let activation = 0;
  let batchSerial = 0;
  let disposed = false;
  let inStep = false;
  // Accepted active-real time is separate from how much fixed-step backlog has been processed.
  // Heat authority advances on this cursor; read-only projection may show later accepted real time.
  let processedReal = 0;
  let stepRealFrom = 0;
  let stepRealTo = 0;
  let from = 0;
  let end = 0;
  let defeatedCount = 0;
  let nextOpponent = 1;
  let slowWindow: {
    from: number;
    to: number;
  } | null = null;
  let pendingOpponent = false;
  let opponentTransitionEndsAt: number | null = null;
  let acceptedRealSum = 0,
    realCompensation = 0,
    presentationSum = 0,
    presentationCompensation = 0;
  let spatial: SpatialSnapshot | null = null;
  let pauses = new Set<PauseReason>();
  let consumed = new Set<string>();
  let hitTargets = new Set<string>();
  let seenContacts = new Set<string>();
  let seenCommands = new Set<CommandId>();
  let seenActorSequences = new Map<string, CommandId>();
  let intents: GameplayCommand[] = [];
  let moves = new Map<ActorId, GameplayCommand>();
  let crouchOwners = new Map<
    ActorId,
    { sessionId: string; revision: number }
  >();
  let closedCrouchSessions = new Set<string>();
  function clearCrouch(id?: ActorId, close = false) {
    let changed = false;
    for (const [actor, owner] of crouchOwners) {
      if (id !== undefined && actor !== id) continue;
      if (close) closedCrouchSessions.add(owner.sessionId);
      crouchOwners.delete(actor);
      const current = actors.find((a) => a.actorId === actor);
      if (fighting && current?.fighting) {
        if (current.fighting.phase === 'neutral')
          setFighting(actor, {
            ...current.fighting,
            posture: runtime(actor).airborne ? 'airborne' : 'standing',
            guardHeight: null,
          });
      } else updateActor(actor, { crouching: false });
      changed = true;
    }
    return changed;
  }
  let phaseBeforePause: GameSnapshot['phase'] = 'running';
  const participant = (id: ActorId) =>
    id === requireValue(actors[0]).actorId || id === snapshot.currentOpponentId;
  function updateActor(id: ActorId, change: Partial<ActorState>) {
    actors = actors.map((a) => (a.actorId === id ? { ...a, ...change } : a));
  }
  function emit(data: EventData, at: number = snapshot.clocks.gameTimeMs) {
    events.push({
      ...data,
      eventId: domainEventId(`${context.runId}:event:${++sequence}`),
      sequence,
      runId: context.runId,
      at: gameTimeMs(at),
    } as DomainEvent);
  }
  const motionFor = (id: ClipId) =>
    requireValue(fightingMetadata.get(id) ?? metadata.get(id));
  const combatant = (id: ActorId) =>
    requireValue(actors.find((a) => a.actorId === id));
  const runtime = (id: ActorId) => requireValue(fightingRuntime.get(id));
  const stateOf = (id: ActorId) => requireValue(combatant(id).fighting);
  let invalidPathAfter = new Map<ActorId, number>();
  let appliedPhysical = new Set<string>();
  /** Fully enumerated private draft. Epoch high-water marks remain reserved on failure. */
  function checkpoint() {
    return {
      actors,
      snapshot,
      events: [...events],
      sequence,
      activation,
      batchSerial,
      disposed,
      inStep,
      processedReal,
      stepRealFrom,
      stepRealTo,
      from,
      end,
      defeatedCount,
      nextOpponent,
      slowWindow,
      pendingOpponent,
      opponentTransitionEndsAt,
      acceptedRealSum,
      realCompensation,
      presentationSum,
      presentationCompensation,
      spatial,
      phaseBeforePause,
      fightingCursor,
      fightingRequest,
      fightingResult,
      crouchAvailable,
      readyDescriptor,
      heat: new Map(heat),
      pauses: new Set(pauses),
      consumed: new Set(consumed),
      hitTargets: new Set(hitTargets),
      seenContacts: new Set(seenContacts),
      seenCommands: new Set(seenCommands),
      seenActorSequences: new Map(seenActorSequences),
      moves: new Map(moves),
      crouchOwners: new Map(crouchOwners),
      closedCrouchSessions: new Set(closedCrouchSessions),
      invalidPathAfter: new Map(invalidPathAfter),
      appliedPhysical: new Set(appliedPhysical),
      metadata: new Map(metadata),
      fightingMetadata: new Map(fightingMetadata),
      profiles: new Map(profiles),
      fightingRuntime: new Map(
        [...fightingRuntime].map(([id, value]) => [id, { ...value }]),
      ),
      acceptedSlices: new Map(
        [...acceptedSlices].map(([id, value]) => [id, [...value]]),
      ),
      intents: [...intents],
      random: createRandom(random.read()),
    };
  }
  function restoreState(state: ReturnType<typeof checkpoint>) {
    ({
      actors,
      snapshot,
      events,
      sequence,
      activation,
      batchSerial,
      disposed,
      inStep,
      processedReal,
      stepRealFrom,
      stepRealTo,
      from,
      end,
      defeatedCount,
      nextOpponent,
      slowWindow,
      pendingOpponent,
      opponentTransitionEndsAt,
      acceptedRealSum,
      realCompensation,
      presentationSum,
      presentationCompensation,
      spatial,
      phaseBeforePause,
      fightingCursor,
      fightingRequest,
      fightingResult,
      crouchAvailable,
      readyDescriptor,
      heat,
      pauses,
      consumed,
      hitTargets,
      seenContacts,
      seenCommands,
      seenActorSequences,
      moves,
      crouchOwners,
      closedCrouchSessions,
      invalidPathAfter,
      appliedPhysical,
      metadata,
      fightingMetadata,
      profiles,
      fightingRuntime,
      acceptedSlices,
      intents,
      random,
    } = state);
  }
  function guardMutation(cancel = false) {
    if (resolving) throw new Error('Core busy resolving or preparing');
    if (strictMode && pending && !cancel)
      throw new Error('Core has a pending fighting transaction');
  }
  function point(id: ActorId, at: number): FightingClockPoint {
    const r = runtime(id),
      s = stateOf(id);
    return captureFightingClockPoint({
      runId: context.runId,
      actorId: id,
      stepTick: snapshot.clocks.tick,
      atGameMs: gameTimeMs(at),
      epochId: r.epochId,
      clipId: r.clipId,
      activationId: r.activationId,
      motionMs: durationMs(r.motionMs),
      phase: s.phase,
      posture: s.posture,
    });
  }
  function prepareReady() {
    if (fighting?.mode !== 'battle-transaction-v1') return;
    const descriptor = captureFightingReadyDescriptor(fighting.ready());
    if (disposed || snapshot.phase !== 'loading')
      throw new Error('Stale fighting preparation');
    if (
      descriptor.clipId !== fighting.poseClips.standing ||
      descriptor.actors.some(
        (a) => !actors.some((b) => b.actorId === a.actorId),
      ) ||
      !snapshot.residentActorIds?.every((id) =>
        descriptor.actors.some((a) => a.actorId === id),
      )
    )
      throw new RangeError(
        'Ready descriptor does not match the admitted Core roster/clip',
      );
    readyDescriptor = descriptor;
    const ids = requireValue(snapshot.residentActorIds);
    const bootstrap = captureFightingBootstrap({
      runId: context.runId,
      descriptor,
      residentActorIds: ids,
      endpoints: ids.map((id) => point(id, 0)),
      poseContexts: ids.map((id) => ({
        runId: context.runId,
        actorId: id,
        stepTick: tick(0),
        epochId: runtime(id).epochId,
        commitId: `${context.runId}:bootstrap:${id}:${runtime(id).epochId}`,
        entryKind: 'initial-ready' as const,
        facingBasis: requireValue(
          descriptor.actors.find((a) => a.actorId === id),
        ).facingBasis,
        acceptedRoot: { x: 0, z: 0 },
        support: { ...descriptor.supportPlane, groundClearanceM: 0 },
      })),
    });
    for (const endpoint of bootstrap.endpoints)
      updateActor(endpoint.actorId, {
        fightingClock: captureFightingTransactionalClock(
          {
            stepTick: tick(0),
            activeEpochId: endpoint.epochId,
            slices: [],
            endpoint,
          },
          {
            runId: context.runId,
            actorId: endpoint.actorId,
            stepTick: tick(0),
            fromGameMs: gameTimeMs(0),
            toGameMs: gameTimeMs(0),
            queryMode: 'bootstrap',
          },
        ),
        fightingPose: requireValue(
          bootstrap.poseContexts.find((p) => p.actorId === endpoint.actorId),
        ),
      });
    spatial = immutableDto({
      runId: context.runId,
      tick: tick(0),
      vehicles: [],
      actors: descriptor.actors
        .filter((a) => ids.includes(a.actorId))
        .map((a) => ({
          actorId: a.actorId,
          position: a.position,
          facing: a.facingBasis,
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          locomotion: 'idle' as const,
        })),
    });
  }
  function poseKey(a: ActorState): FightingPoseKey | 'attack' {
    const s = requireValue(a.fighting);
    if (a.attack) return 'attack';
    if (s.phase === 'hitstun')
      return s.posture === 'crouching' ? 'hit-crouching' : 'hit-standing';
    if (s.guardHeight)
      return s.guardHeight === 'crouching'
        ? 'guard-crouching'
        : 'guard-standing';
    if (s.phase === 'landing') return 'landing';
    return s.posture;
  }
  function syncEpoch(id: ActorId) {
    if (!fighting || (strictMode && !selecting)) return;
    const a = combatant(id),
      r = runtime(id);
    if (
      a.fighting?.phase === 'defeated' ||
      (strictMode && snapshot.phase === 'terminal')
    )
      return;
    const key = poseKey(a);
    const clip =
      key === 'attack'
        ? requireValue(a.attack).clipId
        : fighting.poseClips[key];
    const activationId = a.attack?.activationId ?? null;
    if (
      r.poseKey === key &&
      r.clipId === clip &&
      r.activationId === activationId
    )
      return;
    r.poseKey = key;
    r.clipId = clip;
    r.activationId = activationId;
    r.epochId = `${context.runId}:epoch:${++epochSerial}`;
    r.motionMs = 0;
  }
  function setFighting(id: ActorId, state: FightingCombatantState) {
    updateActor(id, {
      fighting: captureFightingCombatantState(state),
      crouching:
        (state.phase === 'blockstun' ? state.guardHeight : state.posture) ===
        'crouching',
    });
    if (strictMode && !selecting && combatant(id).fightingClock?.endpoint)
      updateActor(id, {
        fightingPoseHold: {
          reason: holdReason,
          displayEpochId: requireValue(combatant(id).fightingClock?.endpoint)
            .epochId,
        },
      });
    syncEpoch(id);
  }
  function heldPosture(id: ActorId): FightingCombatantState['posture'] {
    if (runtime(id).airborne) return 'airborne';
    return crouchOwners.has(id) ? 'crouching' : 'standing';
  }
  function finishFightingAttack(id: ActorId) {
    const a = combatant(id),
      r = runtime(id);
    if (a.attack) {
      heat.set(id, finishHeat(requireValue(heat.get(id)), r.heatMs));
      updateActor(id, { attack: null });
    }
  }
  function resetFighting(reason: 'pause' | 'KO' | 'switch', id?: ActorId) {
    if (!fighting) return;
    for (const actor of actors) {
      if (
        (id !== undefined && id !== actor.actorId) ||
        !fightingRuntime.has(actor.actorId)
      )
        continue;
      const r = runtime(actor.actorId);
      if (reason !== 'pause') {
        finishFightingAttack(actor.actorId);
        r.stopUntil = 0;
        r.stunUntil = r.actionMs;
        r.landingUntil = r.actionMs;
        r.contactAt = null;
      }
      r.bufferAt = null;
      setFighting(
        actor.actorId,
        applyFightingTransition(stateOf(actor.actorId), {
          type: 'reset',
          reason: actor.defeated ? 'KO' : reason,
        }),
      );
    }
  }
  /** Scalar counters are a projection, never a second advancing clock. Deadlines retain TOI fractions. */
  function syncFighting(id: ActorId, at: number) {
    const a = combatant(id),
      r = runtime(id),
      before = stateOf(id);
    if (before.phase === 'defeated') return;
    let s = { ...before };
    const age = actionElapsed(r.actionMs, r.moveStart);
    s.tick = clockFloor(r.actionMs);
    s.stopTicksRemaining = clockRemaining(r.stopUntil - at);
    s.stunTicksRemaining = reached(r.actionMs, r.stunUntil)
      ? 0
      : clockRemaining(r.stunUntil - r.actionMs);
    s.landingTicksRemaining = reached(r.actionMs, r.landingUntil)
      ? 0
      : clockRemaining(r.landingUntil - r.actionMs);
    if (s.buffer && r.bufferAt !== null) {
      const ageTicks = clockFloor(actionElapsed(r.actionMs, r.bufferAt));
      s.buffer = ageTicks > 6 ? null : { ...s.buffer, ageTicks };
      if (!s.buffer) r.bufferAt = null;
    }
    if (
      s.phase === 'hitstun' ||
      s.phase === 'blockstun' ||
      s.phase === 'landing'
    ) {
      if (
        s.stunTicksRemaining === 0 &&
        (s.phase === 'hitstun' || s.phase === 'blockstun')
      )
        s.phase = s.landingTicksRemaining > 0 ? 'landing' : 'neutral';
      if (s.phase === 'landing' && s.landingTicksRemaining === 0)
        s.phase = 'neutral';
    } else if (a.attack) {
      const motion = motionFor(a.attack.clipId);
      if (reached(age, motion.durationMs)) {
        finishFightingAttack(id);
        s = {
          ...s,
          phase: 'neutral',
          moveId: null,
          moveAgeTicks: 0,
          stage: 0,
          route: '',
          hitConfirmed: false,
          contactAgeTicks: null,
        };
        r.contactAt = null;
      } else {
        s.moveAgeTicks = s.moveId ? clockFloor(age) : 0;
        const first = requireValue(motion.impacts[0]);
        const last = requireValue(motion.impacts.at(-1));
        s.phase = !reached(age, first.startMs)
          ? 'startup'
          : !reached(age, last.endMs)
            ? 'active'
            : 'recovery';
        if (a.attack.fighting)
          updateActor(id, {
            attack: {
              ...a.attack,
              fighting: { ...a.attack.fighting, elapsedTicks: clockFloor(age) },
            },
          });
      }
    }
    if (s.phase === 'neutral') {
      s.posture = heldPosture(id);
      s.guardHeight =
        s.guardHeld && s.posture !== 'airborne' ? s.posture : null;
    } else if (s.phase !== 'blockstun') s.guardHeight = null;
    setFighting(id, s);
  }
  function nextFightingBoundary(
    id: ActorId,
    cursor: number,
    limit: number,
  ): number {
    const a = combatant(id),
      r = runtime(id),
      s = stateOf(id);
    if (!reached(cursor, r.stopUntil)) return Math.min(limit, r.stopUntil);
    const actionDeadlines = [r.stunUntil, r.landingUntil];
    if (a.attack) {
      const motion = motionFor(a.attack.clipId);
      actionDeadlines.push(r.moveStart + motion.durationMs);
      if (strictMode)
        for (const impact of motion.impacts)
          actionDeadlines.push(
            r.moveStart + impact.startMs,
            r.moveStart + impact.endMs,
          );
    }
    if (strictMode && s.buffer && s.hitConfirmed && r.contactAt !== null)
      actionDeadlines.push(r.contactAt + FIGHTING_TICK_MS);
    if (s.buffer && r.bufferAt !== null)
      actionDeadlines.push(r.bufferAt + 7 * FIGHTING_TICK_MS);
    for (const deadline of actionDeadlines)
      if (!reached(r.actionMs, deadline))
        limit = Math.min(limit, cursor + deadline - r.actionMs);
    return limit;
  }
  function appendFightingSlice(
    id: ActorId,
    a: number,
    b: number,
    frozen: boolean,
  ) {
    if (!(b > a)) return;
    const r = runtime(id);
    const slice = createFightingClockSlice({
      actorId: id,
      epochId: r.epochId,
      clipId: r.clipId,
      activationId: r.activationId,
      fromGameMs: gameTimeMs(a),
      toGameMs: gameTimeMs(b),
      fromMotionMs: durationMs(r.motionMs),
      frozen,
    });
    requireValue(acceptedSlices.get(id)).push(slice);
    r.motionMs = slice.toMotionMs;
  }
  function advanceFightingThrough(at: number) {
    if (!fighting) return;
    for (const actor of actors) {
      if (strictMode && !snapshot.residentActorIds?.includes(actor.actorId))
        continue;
      const id = actor.actorId,
        r = runtime(id);
      let cursor = fightingCursor;
      while (cursor < at) {
        const boundary = nextFightingBoundary(id, cursor, at);
        const frozen =
          snapshot.phase === 'terminal' ||
          !reached(cursor, r.stopUntil) ||
          actor.defeated;
        appendFightingSlice(id, cursor, boundary, frozen);
        const realElapsed = Math.max(0, realAt(boundary) - realAt(cursor));
        r.heatMs = projectFightingHeatTime(
          activeRealTimeMs(r.heatMs),
          durationMs(realElapsed),
          durationMs(frozen ? realElapsed : 0),
        );
        if (!frozen) r.actionMs += boundary - cursor;
        heat.set(
          id,
          advanceHeat(
            requireValue(heat.get(id)),
            r.heatMs,
            !!combatant(id).attack,
          ),
        );
        syncFighting(id, boundary);
        cursor = boundary;
      }
    }
    fightingCursor = at;
  }
  function neutralFightingFacing(id: ActorId) {
    const a = combatant(id),
      source = spatial?.actors.find((p) => p.actorId === id);
    const targetId =
      a.color === 'white'
        ? snapshot.currentOpponentId
        : requireValue(actors[0]).actorId;
    const target = spatial?.actors.find((p) => p.actorId === targetId);
    if (source && target) {
      const x = target.position.x - source.position.x,
        z = target.position.z - source.position.z;
      const size = Math.hypot(x, z);
      if (size > 0) return { x: x / size, y: 0, z: z / size };
    }
    return source?.facing ?? { x: 0, y: 0, z: a.color === 'white' ? 1 : -1 };
  }
  function startFightingMove(
    id: ActorId,
    before: FightingCombatantState,
    after: FightingCombatantState,
    at: number,
  ) {
    if (!fighting || !fightingHeatCost(before, after)) return;
    const a = combatant(id),
      r = runtime(id),
      move = requireValue(after.moveId);
    const entry = requireValue(
      fighting.entries.find(
        (e) => e.moveId === move && e.posture === after.posture,
      ),
    );
    const motion = motionFor(entry.clipId);
    const facing = a.attack?.fighting?.facing ?? neutralFightingFacing(id);
    const activationId = attackActivationId(
      `${context.runId}:attack:${++activation}`,
    );
    heat.set(id, startHeat(requireValue(heat.get(id)), r.heatMs));
    r.moveStart = r.actionMs;
    r.contactAt = null;
    r.bufferAt = null;
    updateActor(id, {
      attack: {
        activationId,
        clipId: motion.clipId,
        category: motion.category,
        startedAt: gameTimeMs(at),
        consumedImpacts: [],
        impactBindings: motion.impacts.map((i) => ({
          impactIndex: i.impactIndex,
          impactId: impactId(`${activationId}:impact:${i.impactIndex}`),
        })),
        fighting: {
          kind: 'v3',
          moveId: move,
          stage: after.stage === 0 ? 1 : after.stage,
          elapsedTicks: 0,
          facing,
        },
      },
    });
    emit(
      {
        type: 'AttackAccepted',
        actorId: id,
        activationId,
        clipId: motion.clipId,
      },
      at,
    );
  }
  function receiveFighting(
    id: ActorId,
    edges: readonly FightingInputEdge[],
    at: number,
  ) {
    const a = combatant(id);
    if (
      !participant(id) ||
      snapshot.phase !== 'running' ||
      pendingOpponent ||
      a.defeated ||
      !a.fighting
    )
      return;
    const r = runtime(id),
      before = stateOf(id);
    const h = requireValue(heat.get(id));
    let allowStart = h.lockedUntil === null && !h.pendingLock && h.amount < 7;
    if (before.moveId && before.hitConfirmed && r.contactAt !== null) {
      const edge = before.buffer?.edge ?? edges[0];
      const cancel = FIGHTING_ACTIVE_CANCEL_EDGES.find(
        (c) => c.from === before.route && c.to === before.route + edge?.button,
      );
      allowStart &&=
        !!cancel &&
        reached(r.actionMs, r.contactAt + FIGHTING_TICK_MS) &&
        (r.actionMs <= r.contactAt + cancel.maxDelayTicks * FIGHTING_TICK_MS ||
          sameClockPoint(
            r.actionMs,
            r.contactAt + cancel.maxDelayTicks * FIGHTING_TICK_MS,
          ));
    }
    const after = receiveFightingInputs(
      before,
      edges,
      before.guardHeld,
      allowStart,
    );
    if (!before.buffer && after.buffer) r.bufferAt = r.actionMs;
    if (!after.buffer) r.bufferAt = null;
    startFightingMove(id, before, after, at);
    setFighting(id, after);
  }
  function fightingDescriptor(
    a: NonNullable<ReturnType<typeof reference>>,
  ): FightingAttackDescriptor {
    const attack = a.attack.fighting;
    if (attack?.kind === 'v3') {
      const spec = FIGHTING_MOVE_SPECS[attack.moveId];
      return {
        ...spec,
        kind: 'v3',
        moveId: attack.moveId,
        stage: attack.stage,
        damage: { kind: 'v3-normalized', value: spec.damageNormalized },
      };
    }
    const profile = requireValue(
      profiles.get(`${a.motion.clipId}:${a.impactIndex}`),
    );
    return {
      ...profile,
      kind: 'legacy',
      damage: { kind: 'legacy-hp', value: a.damage },
    };
  }
  function stopFighting(id: ActorId, at: number, count: number) {
    const r = runtime(id);
    r.stopUntil = Math.max(r.stopUntil, at + count * FIGHTING_TICK_MS);
    if (!strictMode)
      invalidPathAfter.set(
        id,
        Math.min(invalidPathAfter.get(id) ?? Infinity, at),
      );
    setFighting(id, {
      ...stateOf(id),
      stopTicksRemaining: clockRemaining(r.stopUntil - at),
    });
  }
  function applyLanding(
    witness: FightingSpatialStepResult['fighting']['landings'][number],
  ) {
    const id = witness.actorId,
      r = runtime(id),
      s = stateOf(id),
      attack = combatant(id).attack;
    r.airborne = false;
    const elapsed = attack
      ? actionElapsed(r.actionMs, r.moveStart)
      : r.motionMs;
    const remaining = attack
      ? motionFor(attack.clipId).durationMs - elapsed
      : 0;
    const landingDuration = s.airAttackUsed
      ? Math.max(8 * FIGHTING_TICK_MS, remaining)
      : 3 * FIGHTING_TICK_MS;
    const next = applyFightingTransition(s, {
      type: 'landed',
      atGameMs: witness.atGameMs,
      motionElapsedMs: durationMs(elapsed),
    });
    finishFightingAttack(id);
    r.landingUntil = r.actionMs + landingDuration;
    r.bufferAt = null;
    r.contactAt = null;
    setFighting(id, {
      ...next,
      landingTicksRemaining: clockRemaining(landingDuration),
    });
  }
  function physicalTransitions(result: FightingSpatialStepResult) {
    return [
      ...result.fighting.takeoffs.map((witness) => ({
        kind: 'takeoff' as const,
        witness,
      })),
      ...result.fighting.landings.map((witness) => ({
        kind: 'landing' as const,
        witness,
      })),
    ].sort(
      (a, b) =>
        a.witness.atGameMs - b.witness.atGameMs ||
        (a.kind === b.kind
          ? compare(a.witness.actorId, b.witness.actorId)
          : a.kind === 'takeoff'
            ? -1
            : 1),
    );
  }
  function validateFightingResult(
    input: import('../contracts').SpatialStepResult,
  ) {
    const result = captureFightingSpatialStepResult(
      input,
      requireValue(fightingRequest),
    );
    for (const actor of result.snapshot.actors) {
      if (
        ![actor.position, actor.facing, actor.velocity].every(
          (v) => v && [v.x, v.y, v.z].every(Number.isFinite),
        ) ||
        typeof actor.grounded !== 'boolean'
      )
        throw new RangeError('Invalid fighting physical actor');
    }
    const validVector = (v: import('../contracts').Vector3) =>
      v && [v.x, v.y, v.z].every(Number.isFinite);
    const validReference = (ref: ImpactReference) =>
      actors.some((a) => a.actorId === ref.actorId) &&
      typeof ref.activationId === 'string' &&
      !!ref.activationId.trim() &&
      typeof ref.impactId === 'string' &&
      !!ref.impactId.trim();
    for (const candidate of result.candidates) {
      if (
        candidate.runId !== context.runId ||
        !Number.isFinite(candidate.at) ||
        candidate.at < from ||
        candidate.at > end ||
        !Number.isFinite(candidate.interval.from) ||
        !Number.isFinite(candidate.interval.to) ||
        candidate.interval.from < from ||
        candidate.interval.to > end ||
        candidate.interval.from > candidate.at ||
        candidate.interval.to < candidate.at ||
        !validVector(candidate.point) ||
        typeof candidate.contactId !== 'string' ||
        !candidate.contactId.trim() ||
        (candidate.evidence !== 'swept-shape' &&
          candidate.evidence !== 'overlap')
      )
        throw new RangeError('Invalid fighting candidate envelope');
      switch (candidate.kind) {
        case 'body-hit':
          if (
            !validReference(candidate.source) ||
            !actors.some((a) => a.actorId === candidate.targetActorId)
          )
            throw new RangeError('Invalid body identities');
          break;
        case 'clash':
          if (
            !validReference(candidate.first) ||
            !validReference(candidate.second)
          )
            throw new RangeError('Invalid clash identities');
          break;
        case 'vehicle-launch':
          if (!validReference(candidate.source))
            throw new RangeError('Invalid launch source');
          break;
        case 'vehicle-contact':
          if (!actors.some((a) => a.actorId === candidate.targetActorId))
            throw new RangeError('Invalid vehicle target');
          break;
        case 'destruction':
          if (
            !actors.some((a) => a.actorId === candidate.sourceActorId) ||
            (candidate.source && !validReference(candidate.source)) ||
            !Number.isFinite(candidate.contactSpeedMps) ||
            candidate.contactSpeedMps < 0
          )
            throw new RangeError('Invalid destruction source/speed');
          break;
        default:
          throw new RangeError('Unknown fighting candidate kind');
      }
    }
    const vehicles = new Set<string>();
    for (const vehicle of result.snapshot.vehicles) {
      if (
        vehicles.has(vehicle.vehicleId) ||
        !world.read().vehicles.some((v) => v.vehicleId === vehicle.vehicleId) ||
        !validVector(vehicle.position) ||
        !validVector(vehicle.velocity) ||
        typeof vehicle.grounded !== 'boolean'
      )
        throw new RangeError('Invalid fighting physical vehicle');
      vehicles.add(vehicle.vehicleId);
    }
    const airborne = new Map(
      actors.map((a) => [a.actorId, runtime(a.actorId).airborne]),
    );
    for (const event of physicalTransitions(result)) {
      const witness = event.witness,
        a = combatant(witness.actorId);
      if (!participant(a.actorId))
        throw new RangeError('Foreign physical fighting transition');
      if (event.kind === 'takeoff') {
        if (airborne.get(a.actorId))
          throw new RangeError('Takeoff requires actual grounded state');
        airborne.set(a.actorId, true);
      } else {
        if (!airborne.get(a.actorId))
          throw new RangeError('Landing requires actual airborne state');
        const clock = requireValue(
          fightingRequest?.snapshot.actors.find((p) => p.actorId === a.actorId)
            ?.fightingClock,
        );
        const slice =
          clock.slices.find(
            (s) =>
              event.witness.atGameMs >= s.fromGameMs &&
              event.witness.atGameMs < s.toGameMs,
          ) ?? clock.slices.at(-1);
        let activationId = slice?.activationId ?? null;
        if (
          slice &&
          event.witness.atGameMs === slice.toGameMs &&
          a.attack &&
          reached(slice.toMotionMs, motionFor(a.attack.clipId).durationMs)
        )
          activationId = null;
        if (event.witness.airborneActivationId !== activationId)
          throw new RangeError(
            'Landing activation differs from the planned airborne path',
          );
        airborne.set(a.actorId, false);
      }
    }
    for (const a of actors.filter((a) => participant(a.actorId))) {
      const physical = result.snapshot.actors.find(
        (p) => p.actorId === a.actorId,
      );
      if (!physical || physical.grounded === airborne.get(a.actorId))
        throw new RangeError(
          'Physical grounded state requires complete takeoff/landing witnesses',
        );
    }
    return result;
  }
  /** Planned coverage is a disposable simulation of known clock transitions, never accepted authority. */
  function planFightingClocks() {
    const saved = checkpoint();
    let clocks: Map<ActorId, import('../contracts').FightingClock>;
    try {
      for (const a of actors) acceptedSlices.set(a.actorId, []);
      fightingCursor = from;
      if (strictMode)
        for (const id of requireValue(snapshot.residentActorIds)) syncEpoch(id);
      advanceFightingThrough(end);
      clocks = new Map(
        actors
          .filter(
            (a) =>
              !strictMode || snapshot.residentActorIds?.includes(a.actorId),
          )
          .map((a) => {
            const slices = requireValue(acceptedSlices.get(a.actorId));
            const endpoint = strictMode ? point(a.actorId, end) : undefined;
            return [
              a.actorId,
              captureFightingClock({
                stepTick: snapshot.clocks.tick,
                activeEpochId:
                  endpoint?.epochId ?? requireValue(slices.at(-1)).epochId,
                slices,
                ...(endpoint ? { endpoint } : {}),
              }),
            ];
          }),
      );
    } finally {
      restoreState(saved);
    }
    for (const a of actors) {
      acceptedSlices.set(a.actorId, []);
      const clock = clocks.get(a.actorId);
      if (clock) updateActor(a.actorId, { fightingClock: clock });
    }
    fightingCursor = from;
  }

  function permissions() {
    actors = actors.map((a) => {
      let reason: ReturnType<typeof denied> | typeof allowed = allowed;
      const canonical = requireValue(heat.get(a.actorId));
      const h =
        fighting ||
        snapshot.phase === 'terminal' ||
        a.defeated ||
        !participant(a.actorId)
          ? canonical
          : advanceHeat(
              canonical,
              Math.max(canonical.observedAt, snapshot.clocks.activeRealTimeMs),
              !!a.attack,
            );
      if (a.defeated) reason = denied('defeated');
      else if (
        snapshot.phase !== 'running' ||
        !participant(a.actorId) ||
        (pendingOpponent &&
          (snapshot.presentation.kind !== 'opponent-defeat-finish' ||
            !slowWindow ||
            processedReal + 1e-7 < slowWindow.to)) ||
        snapshot.presentation.kind === 'opponent-defeat'
      )
        reason = denied('not-running');
      if (
        reason.allowed &&
        fighting &&
        a.fighting &&
        (a.fighting.phase !== 'neutral' || a.fighting.stopTicksRemaining > 0)
      )
        reason = denied('busy');
      const movement = reason;
      let attack = reason;
      if (reason.allowed) {
        if (pendingOpponent) attack = denied('not-running');
        else if (a.attack || (fighting && a.fighting?.guardHeld))
          attack = denied('busy');
        else if (h.lockedUntil !== null || h.pendingLock || h.amount >= 7)
          attack = denied('cooling-lock');
        else if (
          !fighting &&
          (options.groundedAttacksOnly ?? true) &&
          spatial?.actors.find((p) => p.actorId === a.actorId)?.grounded ===
            false
        )
          attack = denied('unavailable');
      }
      return {
        ...a,
        heat: { amount: h.amount, capacity: 7, lockedUntil: h.lockedUntil },
        actions: {
          punch: a.color === 'black' ? denied('unavailable') : attack,
          kick: attack,
          jump: a.attack ? denied('busy') : movement,
          move: a.attack ? denied('busy') : movement,
        },
      };
    });
  }
  function publish(change: Partial<GameSnapshot> = {}) {
    const previous = snapshot;
    snapshot = { ...snapshot, ...change };
    for (const actor of actors)
      if (
        actor.crouching &&
        (snapshot.phase !== 'running' ||
          pendingOpponent ||
          actor.defeated ||
          (!fighting && actor.attack) ||
          !participant(actor.actorId) ||
          spatial?.actors.find((p) => p.actorId === actor.actorId)?.grounded ===
            false)
      )
        if (!fighting) clearCrouch(actor.actorId);
    permissions();
    snapshot = immutableDto({
      ...snapshot,
      actors,
      residentActorIds: [
        requireValue(actors[0]).actorId,
        ...(snapshot.currentOpponentId
          ? [snapshot.currentOpponentId]
          : snapshot.presentation.kind === 'opponent-defeat' ||
              snapshot.presentation.kind === 'opponent-defeat-finish'
            ? snapshot.presentation.actorId
              ? [snapshot.presentation.actorId]
              : []
            : (snapshot.residentActorIds ?? []).filter(
                (id) => id !== requireValue(actors[0]).actorId,
              )),
      ],
      world: world.read(),
      revision: snapshot.revision + 1,
    });
    for (const actor of snapshot.actors) {
      const before = previous.actors.find(
        (a) => a.actorId === actor.actorId,
      )?.heat;
      if (
        before &&
        (before.amount !== actor.heat.amount ||
          before.lockedUntil !== actor.heat.lockedUntil)
      )
        emit({ type: 'HeatChanged', actorId: actor.actorId, heat: actor.heat });
    }
  }
  function progress(phase: GameSnapshot['phase']) {
    publish({ phase, pauseReasons: [...pauses].sort() });
    emit({
      type: 'ProgressChanged',
      phase,
      pauseReasons: snapshot.pauseReasons,
    });
  }
  function opponent(id: ActorId | null, change: Partial<GameSnapshot> = {}) {
    const previousActorId = snapshot.currentOpponentId;
    publish({ ...change, currentOpponentId: id });
    if (previousActorId !== id)
      emit({ type: 'OpponentChanged', previousActorId, currentActorId: id });
  }
  function reject(
    command: Extract<
      GameplayCommand,
      {
        type: 'AttackRequested';
      }
    >,
    reason: 'not-running' | 'locked' | 'invalid-command',
  ) {
    emit({ type: 'AttackRejected', actorId: command.actorId, reason });
  }
  function accept(command: GameplayCommand) {
    if (command.runId !== context.runId) return;
    const a = actors.find((a) => a.actorId === command.actorId);
    if (command.type === 'GuardRequested') {
      if (!fighting || !a?.fighting || typeof command.active !== 'boolean')
        return;
      const s = stateOf(a.actorId);
      if (
        command.active &&
        (!participant(a.actorId) ||
          snapshot.phase !== 'running' ||
          a.defeated ||
          a.attack ||
          s.phase === 'hitstun' ||
          s.phase === 'landing')
      )
        return;
      const next = command.active
        ? applyFightingTransition(s, { type: 'guard-begin' })
        : {
            ...s,
            guardHeld: false,
            guardHeight: s.phase === 'blockstun' ? s.guardHeight : null,
          };
      if (command.active) runtime(a.actorId).bufferAt = null;
      setFighting(a.actorId, next);
      publish();
      return;
    }
    if (fighting && command.type === 'CrouchRequested') {
      if (
        !a?.fighting ||
        typeof command.active !== 'boolean' ||
        !command.movementSessionId?.trim() ||
        !Number.isSafeInteger(command.basisRevision) ||
        command.basisRevision < 0
      )
        return;
      const owner = crouchOwners.get(a.actorId),
        s = stateOf(a.actorId);
      if (!command.active) {
        if (
          owner?.sessionId !== command.movementSessionId ||
          owner.revision !== command.basisRevision
        )
          return;
        crouchOwners.delete(a.actorId);
      } else {
        if (
          !participant(a.actorId) ||
          snapshot.phase !== 'running' ||
          a.defeated ||
          closedCrouchSessions.has(command.movementSessionId) ||
          s.posture === 'airborne'
        )
          return;
        crouchOwners.set(a.actorId, {
          sessionId: command.movementSessionId,
          revision: command.basisRevision,
        });
      }
      if (s.phase === 'neutral' || s.phase === 'blockstun') {
        const posture = command.active ? 'crouching' : 'standing';
        setFighting(a.actorId, {
          ...s,
          posture: strictMode && s.phase === 'blockstun' ? s.posture : posture,
          guardHeight:
            s.phase === 'blockstun'
              ? s.guardHeight
              : s.guardHeld
                ? posture
                : null,
        });
      }
      publish();
      return;
    }
    if (command.type === 'CrouchRequested') {
      if (
        !a ||
        typeof command.active !== 'boolean' ||
        !command.movementSessionId?.trim() ||
        !Number.isSafeInteger(command.basisRevision) ||
        command.basisRevision < 0
      )
        return;
      const owner = crouchOwners.get(a.actorId);
      // Release bypasses attack/phase locks, but cannot release another hold.
      if (!command.active) {
        if (
          owner?.sessionId === command.movementSessionId &&
          owner.revision === command.basisRevision
        ) {
          clearCrouch(a.actorId);
          publish();
        }
        return;
      }
      if (
        !crouchAvailable ||
        closedCrouchSessions.has(command.movementSessionId) ||
        !participant(a.actorId) ||
        snapshot.phase !== 'running' ||
        pendingOpponent ||
        a.defeated ||
        a.attack ||
        !a.actions.move.allowed ||
        spatial?.actors.find((p) => p.actorId === a.actorId)?.grounded === false
      )
        return;
      crouchOwners.set(a.actorId, {
        sessionId: command.movementSessionId,
        revision: command.basisRevision,
      });
      updateActor(a.actorId, { crouching: true });
      publish();
      return;
    }
    if (!a || !participant(a.actorId) || snapshot.phase !== 'running') {
      if (command.type === 'AttackRequested') reject(command, 'not-running');
      return;
    }
    if (command.type === 'AttackRequested') {
      const currentHeat = advanceHeat(
        requireValue(heat.get(a.actorId)),
        fighting ? runtime(a.actorId).heatMs : processedReal,
        !!a.attack,
      );
      heat.set(a.actorId, currentHeat);
      const isGrounded =
        !!fighting ||
        !(options.groundedAttacksOnly ?? true) ||
        spatial?.actors.find((p) => p.actorId === a.actorId)?.grounded !==
          false;
      const canAttack =
        !a.defeated &&
        !pendingOpponent &&
        !a.attack &&
        (!fighting ||
          (stateOf(a.actorId).phase === 'neutral' &&
            stateOf(a.actorId).stopTicksRemaining === 0 &&
            !stateOf(a.actorId).guardHeld)) &&
        snapshot.presentation.kind !== 'opponent-defeat' &&
        isGrounded &&
        currentHeat.lockedUntil === null &&
        !currentHeat.pendingLock &&
        currentHeat.amount < 7 &&
        (command.category !== 'punch' || a.color !== 'black');
      if (!canAttack) {
        reject(
          command,
          a.actions[command.category]?.reason === 'not-running'
            ? 'not-running'
            : 'locked',
        );
        return;
      }
      const pool =
        command.category === 'punch'
          ? sets[a.color].punches
          : sets[a.color].kicks;
      if (!pool.length) {
        reject(command, 'invalid-command');
        return;
      }
      const motion = requireValue(metadata.get(random.pick(pool)));
      const activationId = attackActivationId(
        `${context.runId}:attack:${++activation}`,
      );
      heat.set(
        a.actorId,
        startHeat(
          requireValue(heat.get(a.actorId)),
          fighting ? runtime(a.actorId).heatMs : processedReal,
        ),
      );
      if (!fighting) clearCrouch(a.actorId);
      updateActor(a.actorId, {
        attack: {
          activationId,
          clipId: motion.clipId,
          category: motion.category,
          startedAt: snapshot.clocks.gameTimeMs,
          ...(fighting
            ? {
                fighting: {
                  kind: 'legacy' as const,
                  clipId: motion.clipId,
                  elapsedTicks: 0,
                  facing: neutralFightingFacing(a.actorId),
                },
              }
            : {}),
          consumedImpacts: [],
          impactBindings: motion.impacts.map((i) => ({
            impactIndex: i.impactIndex,
            impactId: impactId(`${activationId}:impact:${i.impactIndex}`),
          })),
        },
      });
      if (fighting) {
        const r = runtime(a.actorId);
        r.moveStart = r.actionMs;
        setFighting(a.actorId, {
          ...stateOf(a.actorId),
          phase: motion.impacts[0]?.startMs === 0 ? 'active' : 'startup',
          buffer: null,
          guardHeight: null,
        });
      }
      // Held direction is intent, not free movement; C gates its application during attacks.
      emit({
        type: 'AttackAccepted',
        actorId: a.actorId,
        activationId,
        clipId: motion.clipId,
      });
      publish();
      return;
    }
    if (command.type === 'JumpRequested') {
      if (a.actions.jump.allowed) {
        if (
          spatial?.actors.find((p) => p.actorId === a.actorId)?.grounded !==
            false &&
          clearCrouch(a.actorId)
        )
          publish();
        intents.push(command);
      }
      return;
    }
    if (command.type !== 'MoveRequested') return;
    if (
      !a.defeated &&
      (!pendingOpponent ||
        snapshot.presentation.kind === 'opponent-defeat-finish') &&
      snapshot.presentation.kind !== 'opponent-defeat' &&
      (a.actions.move.allowed || a.attack !== null) &&
      Number.isFinite(command.x) &&
      Number.isFinite(command.z) &&
      Math.hypot(command.x, command.z) <= 1 + 1e-9 &&
      Number.isSafeInteger(command.basisRevision) &&
      command.basisRevision >= 0 &&
      command.movementSessionId
    )
      moves.set(a.actorId, immutableDto(command));
  }
  function batch(commands: readonly GameplayCommand[]) {
    if (fighting) {
      if (inStep)
        throw new Error(
          'Fighting inputs cannot mutate an active spatial request',
        );
      const packetKey = (command: GameplayCommand) =>
        JSON.stringify(
          Object.entries({
            ...command,
            input: [command.input.commandId, command.input.sequence],
          }).sort(([a], [b]) => compare(a, b)),
        );
      const unique = new Map<CommandId, GameplayCommand>();
      for (const c of commands) {
        if (
          c.runId !== context.runId ||
          !actors.some((a) => a.actorId === c.actorId) ||
          seenCommands.has(c.input.commandId)
        )
          continue;
        const sequenceKey = `${c.actorId}:${c.input.sequence}`;
        const seenSequence = seenActorSequences.get(sequenceKey);
        if (seenSequence !== undefined && seenSequence !== c.input.commandId)
          throw new RangeError('Conflicting actor sequence');
        const prior = unique.get(c.input.commandId);
        if (prior && packetKey(prior) !== packetKey(c))
          throw new RangeError('Conflicting command identity');
        unique.set(c.input.commandId, c);
      }
      const normalized = new Map<
        ActorId,
        ReturnType<typeof normalizeFightingInputs>
      >();
      for (const a of actors) {
        const group = [...unique.values()].filter(
          (c) => c.actorId === a.actorId,
        );
        if (group.length)
          normalized.set(
            a.actorId,
            normalizeFightingInputs(
              context.runId,
              a.actorId,
              group,
              seenCommands,
            ),
          );
      }
      for (const n of normalized.values())
        for (const id of n.newlySeenCommandIds) seenCommands.add(id);
      for (const c of unique.values())
        seenActorSequences.set(
          `${c.actorId}:${c.input.sequence}`,
          c.input.commandId,
        );
      const ordered = [...unique.values()].sort(
        (a, b) =>
          a.input.sequence - b.input.sequence ||
          compare(a.input.commandId, b.input.commandId),
      );
      for (const c of ordered) {
        if (
          c.type === 'AttackRequested' &&
          combatant(c.actorId).color === 'white'
        ) {
          const edge = requireValue(
            normalized
              .get(c.actorId)
              ?.edges.find((e) => e.commandId === c.input.commandId),
          );
          receiveFighting(c.actorId, [edge], snapshot.clocks.gameTimeMs);
          publish();
        } else accept(c);
      }
      return;
    }

    const unique = commands
      .filter((c) => {
        if (
          c.runId !== context.runId ||
          seenCommands.has(c.input.commandId) ||
          !Number.isSafeInteger(c.input.sequence) ||
          c.input.sequence <= 0
        )
          return false;
        seenCommands.add(c.input.commandId);
        return true;
      })
      .sort(
        (a, b) =>
          a.input.sequence - b.input.sequence ||
          compare(a.input.commandId, b.input.commandId),
      );
    // Provisional arbitration: first chronological attack beats jumps in the same actor/tick; no buffer.
    const attacking = new Set<ActorId>();
    for (const c of unique)
      if (c.type === 'AttackRequested') {
        accept(c);
        if (actors.find((a) => a.actorId === c.actorId)?.attack)
          attacking.add(c.actorId);
      }
    const jumping = new Set<ActorId>();
    for (const c of unique)
      if (c.type === 'JumpRequested' && !attacking.has(c.actorId)) {
        const actor = actors.find((a) => a.actorId === c.actorId);
        if (
          actor?.actions.jump.allowed &&
          spatial?.actors.find((p) => p.actorId === c.actorId)?.grounded !==
            false
        )
          jumping.add(c.actorId);
        accept(c);
      }
    for (const c of unique)
      if (
        c.type === 'MoveRequested' ||
        (c.type === 'CrouchRequested' &&
          (!c.active || (!attacking.has(c.actorId) && !jumping.has(c.actorId))))
      )
        accept(c);
  }
  function handle(command: CoreCommand) {
    guardMutation();
    holdReason =
      command.type === 'PauseRequested'
        ? 'pause'
        : command.type === 'Backgrounded'
          ? 'background'
          : command.type === 'InputsReleased'
            ? 'inputs-released'
            : command.type === 'MovementSessionEnded'
              ? 'session-ended'
              : 'prestep-intent';
    if (
      disposed ||
      command.runId !== context.runId ||
      snapshot.phase === 'error'
    )
      return;
    switch (command.type) {
      case 'AssetsReady':
        if (snapshot.phase === 'loading') {
          const saved = checkpoint();
          resolving = true;
          callbackRead = snapshot;
          try {
            prepareCatalog();
            prepareReady();
            progress('ready');
          } catch (error) {
            restoreState(saved);
            throw error;
          } finally {
            resolving = false;
            callbackRead = null;
          }
        }
        break;
      case 'StartRequested':
        if (snapshot.phase === 'ready') {
          opponent(requireValue(actors[1]).actorId);
          phaseBeforePause = 'running';
          progress(pauses.size ? 'paused' : 'running');
        }
        break;
      case 'PauseRequested':
        if (['running', 'paused', 'terminal'].includes(snapshot.phase)) {
          if (snapshot.phase !== 'paused') phaseBeforePause = snapshot.phase;
          pauses.add(command.reason);
          resetFighting('pause');
          clearCrouch(undefined, true);
          moves.clear();
          intents = [];
          progress(snapshot.phase === 'terminal' ? 'terminal' : 'paused');
        }
        break;
      case 'Backgrounded':
        if (snapshot.phase !== 'paused') phaseBeforePause = snapshot.phase;
        pauses.add('background');
        pauses.add('interruption');
        resetFighting('pause');
        clearCrouch(undefined, true);
        moves.clear();
        intents = [];
        progress(snapshot.phase === 'running' ? 'paused' : snapshot.phase);
        break;
      case 'Foregrounded':
        pauses.delete('background');
        progress(snapshot.phase);
        break;
      case 'ResumeRequested':
        if (command.reason !== 'background') {
          pauses.delete(command.reason);
          progress(
            snapshot.phase === 'paused' && !pauses.size
              ? phaseBeforePause
              : snapshot.phase,
          );
        }
        break;
      case 'QualityChanged':
        publish({ quality: command.quality });
        break;
      case 'InputsReleased':
        resetFighting('pause');
        moves.clear();
        intents = [];
        if (clearCrouch(undefined, true) || fighting) publish();
        break;
      case 'MovementSessionEnded': {
        closedCrouchSessions.add(command.sessionId);
        let releasedCrouch = false;
        for (const [id, owner] of crouchOwners)
          if (owner.sessionId === command.sessionId)
            releasedCrouch = clearCrouch(id) || releasedCrouch;
        for (const [id, c] of moves)
          if (
            c.type === 'MoveRequested' &&
            c.movementSessionId === command.sessionId
          )
            moves.delete(id);
        if (releasedCrouch) publish();
        break;
      }
      case 'AttackRequested':
      case 'MoveRequested':
      case 'CrouchRequested':
      case 'JumpRequested':
      case 'GuardRequested':
        batch([command]);
        break;
      case 'RetryRequested':
        break;
    }
  }
  function reference(ref: ImpactReference, at: number) {
    const actor = actors.find((a) => a.actorId === ref.actorId);
    const attack = actor?.attack;
    if (
      !actor ||
      actor.defeated ||
      !participant(actor.actorId) ||
      !attack ||
      attack.activationId !== ref.activationId
    )
      return null;
    const binding = attack.impactBindings.find(
      (i) => i.impactId === ref.impactId,
    );
    const motion = motionFor(attack.clipId);
    const index = motion.impacts.findIndex(
      (i) => i.impactIndex === binding?.impactIndex,
    );
    const impact = motion.impacts[index];
    const elapsed = fighting
      ? actionElapsed(
          runtime(actor.actorId).actionMs,
          runtime(actor.actorId).moveStart,
        )
      : at - attack.startedAt;
    if (
      !impact ||
      (fighting &&
        !strictMode &&
        at > (invalidPathAfter.get(actor.actorId) ?? Infinity)) ||
      (fighting
        ? !reached(elapsed, impact.startMs)
        : elapsed < impact.startMs) ||
      (fighting ? reached(elapsed, impact.endMs) : elapsed >= impact.endMs)
    )
      return null;
    return {
      actor,
      attack,
      motion,
      impactIndex: requireValue(impact).impactIndex,
      damage: requireValue(
        distributeDamage(
          damageForRange(motion.effectiveRangeM),
          motion.impacts.map((i) => i.damageShare),
        )[index],
      ),
    };
  }
  function use(ref: ImpactReference) {
    consumed.add(ref.impactId);
    const a = requireValue(actors.find((a) => a.actorId === ref.actorId));
    if (a.attack && !a.attack.consumedImpacts.includes(ref.impactId))
      updateActor(a.actorId, {
        attack: {
          ...a.attack,
          consumedImpacts: [...a.attack.consumedImpacts, ref.impactId],
        },
      });
  }
  function cause(ref: ImpactReference, kind: 'attack' | 'clash'): DamageCause {
    return {
      kind,
      ...ref,
      category: requireValue(
        requireValue(actors.find((a) => a.actorId === ref.actorId)).attack,
      ).category,
    };
  }
  function realAt(at: number) {
    return (
      stepRealFrom +
      (end === from
        ? 0
        : ((at - from) / (end - from)) * (stepRealTo - stepRealFrom))
    );
  }
  /** Settle attack ends before observing any later contact time. Contacts are half-open. */
  function completeAttacksThrough(at: number) {
    if (fighting) {
      for (const event of fightingResult
        ? physicalTransitions(fightingResult)
        : []) {
        const witness = event.witness,
          key = `${event.kind}:${witness.actorId}:${witness.atGameMs}`;
        if (witness.atGameMs > at || appliedPhysical.has(key)) continue;
        advanceFightingThrough(witness.atGameMs);
        if (event.kind === 'takeoff') {
          runtime(witness.actorId).airborne = true;
          runtime(witness.actorId).bufferAt = null;
          setFighting(witness.actorId, {
            ...stateOf(witness.actorId),
            posture: 'airborne',
            guardHeight: null,
            buffer: null,
          });
        } else applyLanding(event.witness);
        appliedPhysical.add(key);
      }
      advanceFightingThrough(at);
      return;
    }
    for (const actor of actors) {
      if (!actor.attack || actor.defeated) continue;
      const attackEnd =
        actor.attack.startedAt +
        requireValue(metadata.get(actor.attack.clipId)).durationMs;
      if (attackEnd > at) continue;
      heat.set(
        actor.actorId,
        finishHeat(requireValue(heat.get(actor.actorId)), realAt(attackEnd)),
      );
      updateActor(actor.actorId, { attack: null });
    }
  }
  function finalize(
    at: number,
    batch: ReturnType<typeof batchId>,
    lastCauses: Map<ActorId, DamageCause>,
  ) {
    const livingEpochs = strictMode
      ? new Map([...fightingRuntime].map(([id, r]) => [id, { ...r }]))
      : null;
    const eventReal = realAt(at);
    const eventPresentation = presentationTimeMs(
      snapshot.clocks.presentationTimeMs -
        snapshot.clocks.activeRealTimeMs +
        eventReal,
    );
    for (const actor of actors)
      if (!actor.defeated && participant(actor.actorId))
        heat.set(
          actor.actorId,
          advanceHeat(
            requireValue(heat.get(actor.actorId)),
            fighting ? runtime(actor.actorId).heatMs : eventReal,
            !!actor.attack,
          ),
        );
    const fallen = actors.filter((a) => a.hp === 0 && !a.defeated);
    for (const a of fallen) {
      if (fighting) resetFighting('KO', a.actorId);
      const source = lastCauses.get(a.actorId);
      const category =
        source?.kind === 'vehicle' ? 'kick' : (source?.category ?? 'kick');
      updateActor(a.actorId, {
        defeated: true,
        attack: null,
        defeatPresentation: {
          category,
          startedAt: eventPresentation,
          slowDurationMs: durationMs(a.color === 'white' ? 2000 : 1500),
          playbackRate: 0.25,
        },
      });
      emit({ type: 'ActorDefeated', actorId: a.actorId, batchId: batch }, at);
      if (a.color !== 'white') defeatedCount++;
    }
    const white = requireValue(actors[0]);
    const lost = white.hp === 0;
    const enemyFell = fallen.some((a) => a.color !== 'white');
    if (!lost && !enemyFell) return;
    resetFighting('switch');
    if (!lost && enemyFell) {
      const hp = Math.min(500, white.hp + 100);
      updateActor(white.actorId, { hp });
      if (hp > white.hp)
        emit(
          {
            type: 'Healed',
            actorId: white.actorId,
            beforeHp: white.hp,
            afterHp: hp,
            actualHpGained: hp - white.hp,
            maxHp: 500,
            batchId: batch,
          },
          at,
        );
    }
    clearCrouch(undefined, true);
    moves.clear();
    intents = [];
    for (const a of actors)
      if (a.attack) {
        heat.set(
          a.actorId,
          finishHeat(
            requireValue(heat.get(a.actorId)),
            fighting ? runtime(a.actorId).heatMs : eventReal,
          ),
        );
        updateActor(a.actorId, { attack: null });
      }
    if (lost || defeatedCount === 4) {
      if (livingEpochs)
        for (const [id, before] of livingEpochs) {
          const r = runtime(id);
          r.epochId = before.epochId;
          r.clipId = before.clipId;
          r.activationId = before.activationId;
          r.motionMs = before.motionMs;
          r.poseKey = before.poseKey;
        }
      const result = {
        outcome: lost ? ('defeat' as const) : ('clear' as const),
        finalizedAt: gameTimeMs(at),
        score: calculateScore({
          survivalMs: at,
          defeatedEnemies: defeatedCount,
          remainingHp: requireValue(actors[0]).hp,
          ...world.rates(),
          clear: !lost,
        }),
      };
      publish({
        result,
        clocks: { ...snapshot.clocks, gameTimeMs: gameTimeMs(at) },
        phase: 'terminal',
        presentation: {
          kind: lost ? 'defeat-slow' : 'clear-slow',
          actorId: lost ? white.actorId : snapshot.currentOpponentId,
          startedAt: eventPresentation,
          endsAt: presentationTimeMs(eventPresentation + (lost ? 2000 : 1500)),
        },
      });
      emit({ type: 'ResultFinalized', result }, at);
      emit(
        {
          type: 'ProgressChanged',
          phase: 'terminal',
          pauseReasons: snapshot.pauseReasons,
        },
        at,
      );
    } else {
      const defeatedId = snapshot.currentOpponentId;
      nextOpponent++;
      slowWindow = { from: eventReal, to: eventReal + 1500 };
      pendingOpponent = true;
      opponentTransitionEndsAt = eventReal + 1625;
      opponent(null, {
        presentation: {
          kind: 'opponent-defeat',
          actorId: defeatedId,
          startedAt: eventPresentation,
          endsAt: presentationTimeMs(eventPresentation + 1500),
        },
      });
    }
  }
  function resolve(candidates: readonly SpatialCandidate[]) {
    const valid = candidates
      .filter(
        (c) =>
          c.runId === context.runId &&
          Number.isFinite(c.at) &&
          c.at >= from &&
          c.at < end &&
          c.interval.from <= c.at &&
          c.interval.to >= c.at &&
          Number.isFinite(c.interval.from) &&
          Number.isFinite(c.interval.to) &&
          [c.point.x, c.point.y, c.point.z].every(Number.isFinite),
      )
      .sort((a, b) => a.at - b.at || compare(a.contactId, b.contactId));
    for (let i = 0; i < valid.length && snapshot.phase === 'running'; ) {
      const at = requireValue(valid[i]).at;
      completeAttacksThrough(at);
      const same: SpatialCandidate[] = [];
      while (i < valid.length && requireValue(valid[i]).at === at)
        same.push(requireValue(valid[i++]));
      const batch = batchId(`${context.runId}:batch:${++batchSerial}`);
      const losses: {
        target: ActorId;
        amount: number;
        cause: DamageCause;
        candidate: SpatialCandidate;
        impacts: ImpactReference[];
      }[] = [];
      const reactions: {
        source: ActorId;
        target: ActorId;
        contactId: string;
        descriptor: FightingAttackDescriptor;
        decision: Exclude<
          ReturnType<typeof resolveFightingContact>,
          { kind: 'ignored' }
        >;
      }[] = [];
      const damagedContacts = new Set<string>();
      const lastCauses = new Map<ActorId, DamageCause>();
      const add = (
        target: ActorId,
        amount: number,
        damageCause: DamageCause,
        candidate: SpatialCandidate,
        impacts: ImpactReference[],
      ) => {
        if (amount > 0)
          losses.push({
            target,
            amount,
            cause: damageCause,
            candidate,
            impacts,
          });
      };
      const clashKey = (
        c: Extract<
          SpatialCandidate,
          {
            kind: 'clash';
          }
        >,
      ) => [c.first.impactId, c.second.impactId].sort(compare).join('|');
      const clashes = same
        .filter(
          (
            c,
          ): c is Extract<
            SpatialCandidate,
            {
              kind: 'clash';
            }
          > => c.kind === 'clash',
        )
        .sort(
          (a, b) =>
            compare(clashKey(a), clashKey(b)) ||
            compare(a.contactId, b.contactId),
        );
      for (const c of clashes) {
        if (seenContacts.has(c.contactId)) continue;
        seenContacts.add(c.contactId);
        const a = reference(c.first, at),
          b = reference(c.second, at);
        if (
          !a ||
          !b ||
          a.actor.actorId === b.actor.actorId ||
          consumed.has(c.first.impactId) ||
          consumed.has(c.second.impactId)
        )
          continue;
        use(c.first);
        use(c.second);
        const difference = a.damage - b.damage;
        emit(
          {
            type: 'ClashResolved',
            firstActorId: a.actor.actorId,
            secondActorId: b.actor.actorId,
            difference: Math.abs(difference),
            batchId: batch,
            contact: {
              contactId: c.contactId,
              point: c.point,
              impacts: [c.first, c.second],
            },
          },
          at,
        );
        if (difference > 0)
          add(b.actor.actorId, difference, cause(c.first, 'clash'), c, [
            c.first,
            c.second,
          ]);
        else if (difference < 0)
          add(a.actor.actorId, -difference, cause(c.second, 'clash'), c, [
            c.first,
            c.second,
          ]);
      }
      // Provisional exact-time policy: clash, body, then car/world, using authoritative IDs.
      const identityKey = (c: SpatialCandidate): string =>
        c.kind === 'body-hit'
          ? `${c.source.actorId}|${c.source.impactId}|${c.targetActorId}`
          : c.kind === 'vehicle-launch'
            ? `${c.source.actorId}|${c.source.impactId}|${c.vehicleId}`
            : c.kind === 'destruction'
              ? `${c.sourceActorId}|${c.source?.impactId ?? c.launchId ?? ''}|${c.targetId}`
              : c.kind === 'vehicle-contact'
                ? `${c.launchId}|${c.targetActorId}`
                : '';
      const priority = (c: SpatialCandidate) =>
        c.kind === 'body-hit'
          ? 0
          : c.kind === 'vehicle-launch'
            ? 1
            : c.kind === 'destruction'
              ? 2
              : 3;
      // Body witnesses with the same damage identity share a canonical point.
      // Finite points and containing intervals were checked above; evidence and
      // interval do not change HP, cause, or consumption for this same identity.
      // This adds no evidence/limb priority and does not order other candidate kinds.
      const bodyEvidenceKey = (c: SpatialCandidate): string | undefined =>
        c.kind === 'body-hit'
          ? JSON.stringify([
              c.runId,
              c.at,
              c.contactId,
              c.source.actorId,
              c.source.activationId,
              c.source.impactId,
              c.targetActorId,
            ])
          : undefined;
      const bodySlots = new Map<string, number[]>();
      same.forEach((c, index) => {
        const key = bodyEvidenceKey(c);
        if (key === undefined) return;
        const slots = bodySlots.get(key) ?? [];
        slots.push(index);
        bodySlots.set(key, slots);
      });
      const canonical = [...same];
      for (const slots of bodySlots.values()) {
        if (slots.length < 2) continue;
        // Sort within this group's original slots, never across another group.
        // A conditional pairwise comparator would violate strict weak ordering.
        const zero = (n: number) => (n === 0 ? 0 : n);
        const ordered = slots
          .map((index) => {
            const c = requireValue(same[index]);
            return {
              ...c,
              point: {
                x: zero(c.point.x),
                y: zero(c.point.y),
                z: zero(c.point.z),
              },
            };
          })
          .sort(
            (a, b) =>
              a.point.x - b.point.x ||
              a.point.y - b.point.y ||
              a.point.z - b.point.z,
          );
        slots.forEach((slot, index) => {
          canonical[slot] = requireValue(ordered[index]);
        });
      }
      for (const c of canonical.sort(
        (a, b) =>
          priority(a) - priority(b) ||
          compare(identityKey(a), identityKey(b)) ||
          compare(a.contactId, b.contactId),
      )) {
        if (c.kind === 'clash' || seenContacts.has(c.contactId)) continue;
        // A rejected body witness must not suppress another valid witness.
        // Other candidate kinds retain their existing deduplication timing.
        if (c.kind !== 'body-hit') seenContacts.add(c.contactId);
        if (c.kind === 'body-hit') {
          const a = reference(c.source, at),
            target = actors.find((a) => a.actorId === c.targetActorId);
          const key = JSON.stringify([c.source.impactId, c.targetActorId]);
          if (
            !a ||
            !target ||
            target.defeated ||
            target.actorId === a.actor.actorId ||
            !participant(target.actorId) ||
            consumed.has(c.source.impactId) ||
            hitTargets.has(key) ||
            (fighting &&
              !strictMode &&
              at > (invalidPathAfter.get(target.actorId) ?? Infinity))
          )
            continue;
          let amount = a.damage;
          if (fighting) {
            const witness = requireValue(
              fightingResult?.fighting.contacts.find(
                (w) => w.contactId === c.contactId,
              ),
            );
            const frontDot = fightingFrontDot(witness);
            const descriptor = fightingDescriptor(a);
            const decision = resolveFightingContact(
              descriptor,
              stateOf(target.actorId),
              frontDot,
              fighting.policy,
            );
            if (decision.kind === 'ignored') continue;
            reactions.push({
              source: a.actor.actorId,
              target: target.actorId,
              contactId: c.contactId,
              descriptor,
              decision,
            });
            amount =
              decision.kind === 'blocked'
                ? 0
                : fightingDamageHp(
                    decision.damage,
                    descriptor.kind === 'v3' ? descriptor.stage : 1,
                    fighting.policy,
                  );
            if (decision.kind === 'blocked') {
              const defender = stateOf(target.actorId);
              emit(
                {
                  type: 'GuardResolved',
                  actorId: target.actorId,
                  sourceActorId: a.actor.actorId,
                  activationId: c.source.activationId,
                  impactId: c.source.impactId,
                  contact: {
                    contactId: c.contactId,
                    point: c.point,
                    impacts: [c.source],
                  },
                  height:
                    defender.guardHeight ??
                    (defender.posture === 'crouching'
                      ? 'crouching'
                      : 'standing'),
                },
                at,
              );
            }
          }
          seenContacts.add(c.contactId);
          hitTargets.add(key);
          use(c.source);
          add(target.actorId, amount, cause(c.source, 'attack'), c, [c.source]);
        } else if (c.kind === 'vehicle-launch') {
          const a = reference(c.source, at);
          if (
            a?.actor.color !== 'white' ||
            a.attack.category !== 'kick' ||
            consumed.has(c.source.impactId)
          )
            continue;
          const launched = world.launch(
            c.vehicleId,
            a.attack.activationId,
            a.actor.actorId,
          );
          if (launched) {
            use(c.source);
            emit(
              {
                type: 'VehicleLaunchApproved',
                actorId: a.actor.actorId,
                vehicleId: c.vehicleId,
                launchId: launched.launchId,
                contact: {
                  contactId: c.contactId,
                  point: c.point,
                  impacts: [c.source],
                },
              },
              at,
            );
            if (launched.actualLoss)
              emit(
                {
                  type: 'DestructionCounted',
                  targetId: c.vehicleId,
                  actualLoss: launched.actualLoss,
                },
                at,
              );
          }
        } else if (c.kind === 'vehicle-contact') {
          const source = world.source(c.launchId, c.vehicleId);
          if (
            !source ||
            c.targetActorId !== snapshot.currentOpponentId ||
            !world.once(['hit', c.launchId, c.targetActorId])
          )
            continue;
          add(
            c.targetActorId,
            50,
            {
              kind: 'vehicle',
              actorId: source.actorId,
              vehicleId: c.vehicleId,
              launchId: c.launchId,
            },
            c,
            [],
          );
        } else if (c.kind === 'destruction') {
          // Reject nonexistent targets before touching either the strike or contact ledger.
          if (!world.hasTarget(c.targetId)) continue;
          if (
            !participant(c.sourceActorId) ||
            !Number.isFinite(c.contactSpeedMps) ||
            c.contactSpeedMps < 0
          )
            continue;
          let amount = 0;
          if (c.launchId) {
            const source = world.source(c.launchId);
            if (
              !source ||
              source.actorId !== c.sourceActorId ||
              !world.once(['destruction', c.launchId, c.targetId])
            )
              continue;
            amount = PROVISIONAL_TUNING.collisionObjectLoss;
          } else if (c.source) {
            const source = reference(c.source, at);
            if (
              !source ||
              source.actor.actorId !== c.sourceActorId ||
              consumed.has(c.source.impactId) ||
              !world.once(['strike', c.source.impactId, c.targetId])
            )
              continue;
            // White kick/car is exclusively launch path; no duplicate durability loss or extra benefit.
            if (
              source.actor.color === 'white' &&
              source.attack.category === 'kick' &&
              world.read().vehicles.some((v) => v.vehicleId === c.targetId)
            )
              continue;
            amount = source.damage;
            use(c.source);
          }
          const loss = world.damage(
            c.targetId,
            amount,
            c.sourceActorId === requireValue(actors[0]).actorId,
          );
          if (loss)
            emit(
              {
                type: 'DestructionCounted',
                targetId: c.targetId,
                actualLoss: loss,
              },
              at,
            );
        }
      }
      for (const loss of losses) {
        const a = requireValue(actors.find((a) => a.actorId === loss.target));
        const afterHp = Math.max(0, a.hp - loss.amount);
        if (afterHp === a.hp) continue;
        updateActor(a.actorId, { hp: afterHp });
        damagedContacts.add(loss.candidate.contactId);
        lastCauses.set(a.actorId, loss.cause);
        emit(
          {
            type: 'HpChanged',
            actorId: a.actorId,
            cause: loss.cause,
            maxHp: a.maxHp,
            beforeHp: a.hp,
            afterHp,
            actualHpLost: a.hp - afterHp,
            batchId: batch,
            contact: {
              contactId: loss.candidate.contactId,
              point: loss.candidate.point,
              impacts: loss.impacts,
            },
          },
          at,
        );
      }
      if (fighting) {
        // Resolve simultaneous bodies before reaction invalidation, preserving mutual hits/KO.
        const accepted = reactions.filter(
          (r) =>
            r.decision.kind === 'blocked' || damagedContacts.has(r.contactId),
        );
        for (const reaction of accepted) {
          const { source, decision } = reaction;
          const s = stateOf(source),
            r = runtime(source);
          if (decision.kind === 'hit' && s.moveId && !s.hitConfirmed) {
            setFighting(
              source,
              applyFightingTransition(s, {
                type: 'hit-confirmed',
                contactAgeTicks: clockFloor(
                  actionElapsed(r.actionMs, r.moveStart),
                ),
              }),
            );
            r.contactAt = r.actionMs;
          } else if (decision.kind === 'blocked') {
            setFighting(source, { ...s, buffer: null });
            r.bufferAt = null;
          }
          stopFighting(source, at, decision.stopTicks);
        }
        const reactedTargets = new Set<ActorId>();
        for (const reaction of accepted) {
          const { target, decision } = reaction,
            r = runtime(target);
          const state = stateOf(target);
          const retained =
            decision.kind === 'hit' &&
            fighting.policy.hitstunPosture === 'force-standing' &&
            state.posture !== 'airborne'
              ? { ...state, posture: 'standing' as const, guardHeight: null }
              : state;
          const stunTicks =
            decision.kind === 'hit'
              ? decision.hitstunTicks
              : decision.blockstunTicks;
          const next = applyFightingTransition(
            retained,
            decision.kind === 'hit'
              ? {
                  type: 'received-hit',
                  stunTicks,
                  stopTicks: decision.stopTicks,
                }
              : {
                  type: 'received-block',
                  stunTicks,
                  stopTicks: decision.stopTicks,
                  height:
                    state.guardHeight ??
                    (state.posture === 'crouching' ? 'crouching' : 'standing'),
                },
          );
          finishFightingAttack(target);
          r.stunUntil = r.actionMs + stunTicks * FIGHTING_TICK_MS;
          r.contactAt = null;
          r.bufferAt = null;
          setFighting(target, next);
          if (
            strictMode &&
            decision.kind === 'blocked' &&
            !reactedTargets.has(target)
          ) {
            r.epochId = `${context.runId}:epoch:${++epochSerial}`;
            r.motionMs = 0;
          }
          reactedTargets.add(target);
          stopFighting(target, at, decision.stopTicks);
        }
      }
      finalize(at, batch, lastCauses);
    }
  }
  function advanceEncounter() {
    if (
      snapshot.phase === 'running' &&
      pendingOpponent &&
      opponentTransitionEndsAt !== null &&
      processedReal + 1e-7 >= opponentTransitionEndsAt
    ) {
      resetFighting('switch');
      pendingOpponent = false;
      opponentTransitionEndsAt = null;
      opponent(actors[nextOpponent]?.actorId ?? null, {
        presentation: { kind: 'none' },
      });
    }
  }
  function advancePresentation() {
    const now = snapshot.clocks.presentationTimeMs;
    let stage: PresentationState = snapshot.presentation;
    if ('endsAt' in stage && now >= stage.endsAt) {
      if (stage.kind === 'opponent-defeat') {
        publish({
          presentation: {
            ...stage,
            kind: 'opponent-defeat-finish',
            endsAt: presentationTimeMs(stage.startedAt + 1625),
          },
        });
      } else if (stage.kind === 'opponent-defeat-finish') {
        // Retirement waits for processed simulation to reach the same transition deadline.
        // Accepted presentation time may lead fixed-step backlog; never activate early.
      } else if (stage.kind === 'defeat-slow') {
        stage = {
          kind: 'fade',
          actorId: stage.actorId,
          startedAt: stage.endsAt,
          endsAt: presentationTimeMs(stage.endsAt + 400),
        };
        publish({ presentation: stage });
      } else publish({ presentation: { kind: 'results' } });
      if (stage.kind === 'fade' && now >= stage.endsAt)
        publish({ presentation: { kind: 'results' } });
    }
  }
  function equalData(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
      return false;
    if (Array.isArray(a) || Array.isArray(b))
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => equalData(v, b[i]))
      );
    const aa = Object.entries(a).sort(([x], [y]) => compare(x, y)),
      bb = Object.entries(b).sort(([x], [y]) => compare(x, y));
    return (
      aa.length === bb.length &&
      aa.every(
        ([key, value], i) => key === bb[i]?.[0] && equalData(value, bb[i]?.[1]),
      )
    );
  }
  function completeTransaction(
    input: import('../contracts').SpatialStepResult,
  ): CoreOutput {
    if (!pending || !fighting || fighting.mode !== 'battle-transaction-v1')
      throw new Error('No pending fighting transaction');
    const admitted = pending,
      committed = checkpoint();
    let port: FightingSpatialTransactionPort | null = null;
    resolving = true;
    callbackRead = admitted.read;
    selecting = true;
    try {
      const envelope = captureFightingSpatialTransactionResult(
        input,
        admitted.request,
      );
      if (usedTransactions.has(envelope.transaction.transactionId))
        throw new Error('Fighting transaction was already attempted');
      usedTransactions.add(envelope.transaction.transactionId);
      port = envelope.transaction;
      const descriptor = requireValue(readyDescriptor);
      if (envelope.initialPrefix.bindingSetId !== descriptor.bindingSetId)
        throw new RangeError('Foreign installed fighting binding');
      for (const p of envelope.initialPrefix.actors) {
        const a = requireValue(
          admitted.read.actors.find((a) => a.actorId === p.actor.actorId),
        );
        if (
          !equalData(p.endpoint, a.fightingClock?.endpoint) ||
          !equalData(p.poseContext, a.fightingPose)
        )
          throw new RangeError(
            'Initial prefix differs from accepted Core authority',
          );
        const prior = spatial?.actors.find(
          (a) => a.actorId === p.actor.actorId,
        );
        if (!prior || !equalData(prior, p.actor))
          throw new RangeError(
            'Initial physical prefix differs from accepted state',
          );
      }
      restoreState(admitted.state);
      restoreState(checkpoint()); // clone the pending baseline before any mutation
      for (const a of actors) acceptedSlices.set(a.actorId, []);
      fightingCursor = from;
      snapshot = {
        ...snapshot,
        clocks: { ...snapshot.clocks, gameTimeMs: gameTimeMs(from) },
      };
      let prefix: readonly FightingAcceptedActorPrefix[] =
        envelope.initialPrefix.actors;
      let revision = 0,
        acceptedProjectionId: string | null = null,
        settle = true;
      let sameTimeCount = 0,
        previousAt = from,
        previousEvents: readonly DomainEvent[] = [];
      const occurrences = new Set<string>(),
        seams = new Set<string>(),
        projections = new Set<string>();
      const resets: FightingEncounterReset[] = [];
      const defeatSamples = new Map<ActorId, FightingRecipeEntry>();
      for (const p of prefix)
        if (p.pose.defeatEntry)
          defeatSamples.set(p.actor.actorId, p.pose.defeatEntry);
      const initialActorIds = requireValue(
        admitted.request.snapshot.residentActorIds,
      );
      let reset: FightingEncounterReset | undefined;
      const residents = () => requireValue(snapshot.residentActorIds);
      const settleRuntime = () => {
        for (const id of residents()) {
          syncFighting(id, fightingCursor);
          syncEpoch(id);
        }
        receiveFighting(requireValue(actors[0]).actorId, [], fightingCursor);
        for (const id of residents()) syncEpoch(id);
      };
      const dueReset = () => {
        processedReal = realAt(fightingCursor);
        const outgoingActorIds = [...residents()],
          previous = snapshot.currentOpponentId;
        advanceEncounter();
        if (snapshot.currentOpponentId === previous) return;
        const ids = residents();
        for (const id of ids) {
          const r = runtime(id);
          r.airborne = false;
          r.stopUntil = fightingCursor;
          r.stunUntil = r.actionMs;
          r.landingUntil = r.actionMs;
          r.epochId = `${context.runId}:epoch:${++epochSerial}`;
          r.clipId = descriptor.clipId;
          r.activationId = null;
          r.motionMs = 0;
          r.poseKey = 'standing';
          setFighting(id, {
            ...createFightingCombatant(),
            tick: clockFloor(r.actionMs),
          });
          if (!outgoingActorIds.includes(id)) acceptedSlices.set(id, []);
        }
        reset = captureFightingEncounterReset(
          {
            resetId: `${port?.transactionId}:reset:${resets.length}`,
            atGameMs: gameTimeMs(fightingCursor),
            readyDescriptor: descriptor,
            outgoingActorIds,
            residentActorIds: ids,
            endpoints: ids.map((id) => point(id, fightingCursor)),
          },
          {
            version: 1,
            transactionId: requireValue(port).transactionId,
            runId: context.runId,
            stepTick: snapshot.clocks.tick,
            fromGameMs: gameTimeMs(from),
            toGameMs: gameTimeMs(end),
          },
        );
        resets.push(reset);
        settle = true;
      };
      while (true) {
        dueReset();
        settleRuntime();
        if (revision >= fighting.transactionPolicy.maxFrontiers)
          throw new RangeError('Fighting frontier budget exhausted');
        let horizon = end;
        if (settle) horizon = fightingCursor;
        else {
          for (const id of residents())
            horizon = nextFightingBoundary(id, fightingCursor, horizon);
          if (
            pendingOpponent &&
            opponentTransitionEndsAt !== null &&
            stepRealTo > stepRealFrom
          ) {
            const encounterAt =
              from +
              ((opponentTransitionEndsAt - stepRealFrom) * (end - from)) /
                (stepRealTo - stepRealFrom);
            if (encounterAt > fightingCursor)
              horizon = Math.min(horizon, encounterAt);
          }
        }
        const selectedPoses = residents().map((id) => {
          const p = point(id, fightingCursor);
          return {
            actorId: id,
            epochId: p.epochId,
            phase: p.phase,
            posture: p.posture,
          };
        });
        const queryActors = actors.map((a) => {
          if (!residents().includes(a.actorId)) return a;
          const r = runtime(a.actorId),
            frozen =
              snapshot.phase === 'terminal' ||
              a.defeated ||
              !reached(fightingCursor, r.stopUntil);
          const slices =
            horizon > fightingCursor
              ? [
                  createFightingClockSlice({
                    actorId: a.actorId,
                    epochId: r.epochId,
                    clipId: r.clipId,
                    activationId: r.activationId,
                    fromGameMs: gameTimeMs(fightingCursor),
                    toGameMs: gameTimeMs(horizon),
                    fromMotionMs: durationMs(r.motionMs),
                    frozen,
                  }),
                ]
              : [];
          const endpoint = {
            ...point(a.actorId, horizon),
            motionMs: durationMs(
              r.motionMs + (frozen ? 0 : horizon - fightingCursor),
            ),
          };
          const { fightingPoseHold: _hold, ...rest } = a;
          return {
            ...rest,
            fightingClock: captureFightingTransactionalClock(
              {
                stepTick: snapshot.clocks.tick,
                activeEpochId: r.epochId,
                slices,
                endpoint,
              },
              {
                runId: context.runId,
                actorId: a.actorId,
                stepTick: snapshot.clocks.tick,
                fromGameMs: gameTimeMs(fightingCursor),
                toGameMs: gameTimeMs(horizon),
                queryMode: settle ? 'settle' : 'interval',
              },
            ),
          };
        });
        const query = captureFightingProjectInput({
          version: 1,
          transactionId: port.transactionId,
          runId: port.runId,
          stepTick: port.stepTick,
          fromGameMs: port.fromGameMs,
          toGameMs: port.toGameMs,
          revision,
          acceptedProjectionId,
          queryMode: settle ? 'settle' : 'interval',
          cursorGameMs: gameTimeMs(fightingCursor),
          horizonGameMs: gameTimeMs(horizon),
          acceptedPrefix: prefix,
          selectedPoses,
          snapshot: { ...snapshot, actors: queryActors },
          acceptedEvents: revision === 0 ? [] : previousEvents,
          settledOccurrenceIds: [...occurrences],
          settledPhysicalSeamIds: [...seams],
          ...(reset ? { encounterReset: reset } : {}),
        });
        const frontier = captureFightingSpatialFrontier(port.project(query), {
          query,
          request: admitted.request,
          policy: fighting.transactionPolicy,
        });
        if (projections.has(frontier.projectionId))
          throw new RangeError('Repeated fighting projection');
        projections.add(frontier.projectionId);
        sameTimeCount =
          frontier.atGameMs === previousAt ? sameTimeCount + 1 : 1;
        if (sameTimeCount > fighting.transactionPolicy.maxSameTimeFrontiers)
          throw new RangeError('Fighting same-time frontier budget exhausted');
        previousAt = frontier.atGameMs;
        for (const p of frontier.acceptedPrefix) {
          const prior = prefix.find((a) => a.actor.actorId === p.actor.actorId);
          if (!reset && p.pose.entryKind === 'initial-ready')
            throw new RangeError(
              'Step frontier cannot mint bootstrap authority',
            );
          if (
            !reset &&
            prior &&
            p.pose.source.epochId !== prior.endpoint.epochId &&
            !equalData(p.pose.incoming, prior.pose.sample)
          )
            throw new RangeError(
              'Epoch transition must retain its actual outgoing sample',
            );
          if (
            !reset &&
            prior &&
            p.pose.source.epochId === prior.endpoint.epochId &&
            p.pose.entryKind !== 'encounter-reset' &&
            !equalData(
              p.pose.incoming,
              prior.pose.incoming ?? prior.pose.sample,
            )
          )
            throw new RangeError('Epoch incoming changed during continuation');
          if (
            !reset &&
            prior &&
            p.pose.source.epochId === prior.endpoint.epochId &&
            !equalData(p.pose.facingBasis, prior.pose.facingBasis)
          )
            throw new RangeError('Accepted epoch facing basis changed');
          const defeat = defeatSamples.get(p.actor.actorId);
          if (!defeat && p.pose.defeatEntry !== undefined)
            throw new RangeError('Unaccepted defeat provenance');
          if (defeat && !equalData(defeat, p.pose.defeatEntry))
            throw new RangeError(
              'Defeat entry changed from actual living sample',
            );
        }
        const eventStart = events.length;
        if (snapshot.phase !== 'terminal')
          snapshot = {
            ...snapshot,
            clocks: { ...snapshot.clocks, gameTimeMs: frontier.atGameMs },
          };
        fightingResult = frontier.result;
        appliedPhysical.clear();
        // Validate physical state transitions against current accepted runtime, not original plan.
        const airborne = new Map(
          residents().map((id) => [id, runtime(id).airborne]),
        );
        for (const physical of physicalTransitions(frontier.result)) {
          const id = physical.witness.actorId;
          if (
            !airborne.has(id) ||
            (physical.kind === 'takeoff' ? airborne.get(id) : !airborne.get(id))
          )
            throw new RangeError('Invalid current physical seam history');
          airborne.set(id, physical.kind === 'takeoff');
        }
        completeAttacksThrough(frontier.atGameMs);
        if (
          frontier.kind === 'contacts' &&
          query.selectedPoses.some((selected) => {
            const current = point(selected.actorId, fightingCursor);
            return (
              selected.epochId !== current.epochId ||
              selected.phase !== current.phase ||
              selected.posture !== current.posture
            );
          })
        )
          throw new RangeError(
            'Contact at a changed selection boundary requires resampling',
          );
        spatial = frontier.result.snapshot;
        prefix = frontier.acceptedPrefix.map((p) => {
          const classification = requireValue(
            query.selectedPoses.find((s) => s.actorId === p.actor.actorId),
          );
          return {
            ...p,
            endpoint: captureFightingClockPoint({
              runId: context.runId,
              actorId: p.actor.actorId,
              stepTick: snapshot.clocks.tick,
              atGameMs: frontier.atGameMs,
              epochId: p.pose.source.epochId,
              clipId: p.pose.source.clipId,
              activationId: p.pose.source.activationId,
              motionMs: p.pose.source.motionMs,
              phase: classification.phase,
              posture: classification.posture,
            }),
          };
        });
        if (
          frontier.kind === 'contacts' &&
          snapshot.phase === 'running' &&
          snapshot.presentation.kind !== 'opponent-defeat'
        )
          resolve(frontier.result.candidates);
        for (const p of prefix)
          if (
            combatant(p.actor.actorId).defeated &&
            !defeatSamples.has(p.actor.actorId)
          )
            defeatSamples.set(p.actor.actorId, p.pose.sample);
        for (const id of frontier.occurrenceIds) occurrences.add(id);
        for (const id of frontier.physicalSeamIds) seams.add(id);
        settleRuntime();
        acceptedProjectionId = frontier.projectionId;
        revision++;
        previousEvents = events
          .slice(eventStart)
          .filter((e) => e.at === frontier.atGameMs);
        const changed = prefix.some(
          (p) => !equalData(p.endpoint, point(p.actor.actorId, fightingCursor)),
        );
        const wasReset = reset !== undefined;
        reset = undefined;
        if (
          frontier.kind === 'boundary' &&
          query.queryMode === 'settle' &&
          !changed
        ) {
          settle = false;
          if (fightingCursor === end) break;
        } else
          settle =
            changed ||
            frontier.kind !== 'boundary' ||
            query.queryMode === 'interval' ||
            wasReset;
      }
      processedReal = stepRealTo;
      fightingResult = null;
      fightingRequest = null;
      for (const id of residents()) {
        const endpoint = point(id, end),
          slices = requireValue(acceptedSlices.get(id));
        const a = combatant(id),
          { fightingPoseHold: _hold, fightingPose: _old, ...rest } = a;
        actors = actors.map((a) =>
          a.actorId === id
            ? {
                ...rest,
                fightingClock: captureFightingClock(
                  {
                    stepTick: snapshot.clocks.tick,
                    activeEpochId: endpoint.epochId,
                    slices,
                    endpoint,
                  },
                  {
                    actorId: id,
                    stepTick: snapshot.clocks.tick,
                    fromGameMs: slices[0]?.fromGameMs ?? gameTimeMs(end),
                    toGameMs: gameTimeMs(end),
                  },
                ),
              }
            : a,
        );
      }
      // Retired contexts must not remain reusable current pose authority.
      actors = actors.map((a) => {
        if (residents().includes(a.actorId)) return a;
        const {
          fightingPose: _pose,
          fightingPoseHold: _hold,
          fightingClock: _clock,
          ...rest
        } = a;
        return rest;
      });
      publish();
      advancePresentation();
      const finishOutput = immutableDto({ snapshot, events });
      const rawReceipt = port.finish({
        acceptedProjectionId: requireValue(acceptedProjectionId),
        output: finishOutput,
      });
      const receiptIdentity = Object.getOwnPropertyDescriptor(
        rawReceipt,
        'receiptId',
      );
      if (
        receiptIdentity &&
        Object.hasOwn(receiptIdentity, 'value') &&
        typeof receiptIdentity.value === 'string'
      ) {
        if (usedReceipts.has(receiptIdentity.value))
          throw new RangeError('Fighting receipt ID already issued');
        usedReceipts.add(receiptIdentity.value);
      }
      const receipt = captureFightingSpatialCommitReceipt(rawReceipt, {
        header: {
          version: 1,
          transactionId: port.transactionId,
          runId: port.runId,
          stepTick: port.stepTick,
          fromGameMs: port.fromGameMs,
          toGameMs: port.toGameMs,
        },
        acceptedProjectionId: requireValue(acceptedProjectionId),
        output: finishOutput,
        acceptedPrefix: prefix,
        initialPrefix: envelope.initialPrefix,
        ...(resets.length ? { residency: { initialActorIds, resets } } : {}),
      });
      for (const pose of receipt.poseContexts)
        updateActor(pose.actorId, { fightingPose: pose });
      spatial = receipt.snapshot;
      snapshot = immutableDto({ ...snapshot, actors });
      const output = immutableDto({ snapshot, events });
      events = [];
      inStep = false;
      pending = null;
      return output;
    } catch (error) {
      let abortError: unknown;
      try {
        port?.abort();
      } catch (failure) {
        abortError = failure;
      } finally {
        restoreState(committed);
      }
      if (abortError !== undefined)
        throw new AggregateError(
          [error, abortError],
          error instanceof Error
            ? error.message
            : 'Fighting transaction failed; abort also failed',
        );
      throw error;
    } finally {
      resolving = false;
      callbackRead = null;
      selecting = false;
    }
  }
  function drain(): CoreOutput {
    guardMutation();
    const output = immutableDto({ snapshot, events });
    events = [];
    return output;
  }
  return {
    handle,
    read: () => callbackRead ?? pending?.read ?? snapshot,
    drain,
    handleInputBatch(input) {
      guardMutation();
      holdReason = 'prestep-intent';
      if (disposed) return;
      if (
        input.runId !== context.runId ||
        input.tick !== snapshot.clocks.tick + 1
      )
        throw new Error('Input batch does not match next tick/run');
      batch(input.commands);
    },
    beginStep(step) {
      guardMutation();
      if (disposed || inStep || snapshot.phase !== 'running')
        throw new Error('Core not ready for a fixed step');
      if (!Number.isFinite(step.durationMs) || step.durationMs <= 0)
        throw new RangeError('Step must be positive');
      const saved = strictMode ? checkpoint() : null;
      if (strictMode) {
        resolving = true;
        callbackRead = snapshot;
        selecting = true;
      }
      try {
        if (!strictMode) advanceEncounter();
        if (options.enemyAi) batch(options.enemyAi(snapshot, spatial));
        inStep = true;
        stepRealFrom = processedReal;
        const proposedReal = processedReal + step.durationMs;
        stepRealTo =
          proposedReal <= snapshot.clocks.activeRealTimeMs + 1e-7
            ? proposedReal
            : snapshot.clocks.activeRealTimeMs;
        from = snapshot.clocks.gameTimeMs;
        const slowOverlap = slowWindow
          ? Math.max(
              0,
              Math.min(stepRealTo, slowWindow.to) -
                Math.max(stepRealFrom, slowWindow.from),
            )
          : 0;
        const scaled = step.durationMs - slowOverlap * 0.75;
        end = from + scaled;
        if (fighting && !strictMode) from = end - scaled;
        publish({
          clocks: {
            ...snapshot.clocks,
            tick: tick(snapshot.clocks.tick + 1),
            gameTimeMs: gameTimeMs(end),
          },
        });
        if (fighting) {
          invalidPathAfter.clear();
          appliedPhysical.clear();
          planFightingClocks();
          publish();
        }
        const accepted = [...moves.values(), ...intents];
        intents = [];
        const request = immutableDto({
          snapshot,
          step: { durationMs: durationMs(strictMode ? end - from : scaled) },
          intents: accepted,
        });
        if (fighting) fightingRequest = request;
        if (strictMode && saved) {
          pending = { request, state: checkpoint(), read: saved.snapshot };
          restoreState(saved);
        }
        return request;
      } catch (error) {
        if (saved) restoreState(saved);
        throw error;
      } finally {
        if (strictMode) {
          resolving = false;
          callbackRead = null;
          selecting = false;
        }
      }
    },
    completeStep(result) {
      if (resolving) throw new Error('Core busy resolving');
      if (strictMode) return completeTransaction(result);
      if (
        !inStep ||
        result.snapshot.runId !== context.runId ||
        result.snapshot.tick !== snapshot.clocks.tick
      )
        throw new Error('Spatial result does not match active step/run');
      if (fighting) fightingResult = validateFightingResult(result);
      inStep = false;
      if (!fighting) spatial = immutableDto(result.snapshot);
      processedReal = stepRealTo;
      if (
        snapshot.phase === 'running' &&
        snapshot.presentation.kind !== 'opponent-defeat'
      )
        resolve(result.candidates);
      if (snapshot.phase === 'running') completeAttacksThrough(end);
      if (fighting) {
        // Terminal time stays at the accepted KO. The unprocessed remainder is
        // an accepted frozen tail, not the moving plan (including a KO at from).
        if (snapshot.phase === 'terminal') advanceFightingThrough(end);
        spatial = immutableDto(result.snapshot);
        for (const actor of actors) {
          const slices = requireValue(acceptedSlices.get(actor.actorId));
          if (slices.length)
            updateActor(actor.actorId, {
              fightingClock: captureFightingClock({
                stepTick: snapshot.clocks.tick,
                activeEpochId: requireValue(slices.at(-1)).epochId,
                slices,
              }),
            });
          syncFighting(actor.actorId, end);
        }
        receiveFighting(requireValue(actors[0]).actorId, [], end);
        fightingRequest = null;
        fightingResult = null;
      }
      publish();
      advancePresentation();
      advanceEncounter();
      return drain();
    },
    present(elapsed) {
      guardMutation();
      durationMs(elapsed);
      if (
        disposed ||
        elapsed === 0 ||
        pauses.size ||
        !['ready', 'running', 'terminal'].includes(snapshot.phase)
      )
        return;
      // Compensated accumulation, normalized only at DTO publication to nanosecond precision.
      const py = elapsed - presentationCompensation,
        pt = presentationSum + py;
      presentationCompensation = pt - presentationSum - py;
      presentationSum = pt;
      if (snapshot.phase === 'running') {
        const ry = elapsed - realCompensation,
          rt = acceptedRealSum + ry;
        realCompensation = rt - acceptedRealSum - ry;
        acceptedRealSum = rt;
      }
      const now = Math.round(presentationSum * 1e9) / 1e9;
      const real = Math.round(acceptedRealSum * 1e9) / 1e9;
      publish({
        clocks: {
          ...snapshot.clocks,
          activeRealTimeMs: activeRealTimeMs(real),
          presentationTimeMs: presentationTimeMs(now),
        },
      });
      advancePresentation();
    },
    fail(message) {
      guardMutation(true);
      pending = null;
      holdReason = 'error';
      if (disposed) return;
      inStep = false;
      resetFighting('switch');
      fightingRequest = null;
      fightingResult = null;
      clearCrouch(undefined, true);
      progress('error');
      emit({ type: 'FoundationError', message });
    },
    dispose() {
      guardMutation(true);
      pending = null;
      if (disposed) return;
      resetFighting('switch');
      disposed = true;
      inStep = false;
      clearCrouch();
      closedCrouchSessions.clear();
      moves.clear();
      intents = [];
      if (strictMode)
        actors = actors.map((a) => {
          const {
            fightingPose: _pose,
            fightingPoseHold: _hold,
            fightingClock: _clock,
            ...rest
          } = a;
          return rest;
        });
      progress('stopped');
      events = [];
      consumed.clear();
      hitTargets.clear();
      seenContacts.clear();
      seenCommands.clear();
      seenActorSequences.clear();
      fightingRequest = null;
      fightingResult = null;
      fightingRuntime.clear();
      fightingMetadata.clear();
      profiles.clear();
      acceptedSlices.clear();
      invalidPathAfter.clear();
      appliedPhysical.clear();
      metadata.clear();
      heat.clear();
      spatial = null;
    },
  };
}
