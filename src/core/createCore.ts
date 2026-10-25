import { immutableDto } from '../app/immutableDto';
import {
  type ActorColor,
  type ActorId,
  type ActorState,
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
  const random = createRandom(context.seed);
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
  const heat = new Map(actors.map((a) => [a.actorId, initialHeat()]));
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
  const pauses = new Set<PauseReason>();
  const consumed = new Set<string>();
  const hitTargets = new Set<string>();
  const seenContacts = new Set<string>();
  const seenCommands = new Set<string>();
  let intents: GameplayCommand[] = [];
  const moves = new Map<ActorId, GameplayCommand>();
  const crouchOwners = new Map<
    ActorId,
    { sessionId: string; revision: number }
  >();
  const closedCrouchSessions = new Set<string>();
  function clearCrouch(id?: ActorId, close = false) {
    let changed = false;
    for (const [actor, owner] of crouchOwners) {
      if (id !== undefined && actor !== id) continue;
      if (close) closedCrouchSessions.add(owner.sessionId);
      crouchOwners.delete(actor);
      updateActor(actor, { crouching: false });
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
  function permissions() {
    actors = actors.map((a) => {
      let reason: ReturnType<typeof denied> | typeof allowed = allowed;
      const canonical = requireValue(heat.get(a.actorId));
      const h =
        snapshot.phase === 'terminal' || a.defeated || !participant(a.actorId)
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
      const movement = reason;
      let attack = reason;
      if (reason.allowed) {
        if (pendingOpponent) attack = denied('not-running');
        else if (a.attack) attack = denied('busy');
        else if (h.lockedUntil !== null || h.pendingLock || h.amount >= 7)
          attack = denied('cooling-lock');
        else if (
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
          actor.attack ||
          !participant(actor.actorId) ||
          spatial?.actors.find((p) => p.actorId === actor.actorId)?.grounded ===
            false)
      )
        clearCrouch(actor.actorId);
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
        processedReal,
        !!a.attack,
      );
      heat.set(a.actorId, currentHeat);
      const isGrounded =
        !(options.groundedAttacksOnly ?? true) ||
        spatial?.actors.find((p) => p.actorId === a.actorId)?.grounded !==
          false;
      const canAttack =
        !a.defeated &&
        !pendingOpponent &&
        !a.attack &&
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
        startHeat(requireValue(heat.get(a.actorId)), processedReal),
      );
      clearCrouch(a.actorId);
      updateActor(a.actorId, {
        attack: {
          activationId,
          clipId: motion.clipId,
          category: motion.category,
          startedAt: snapshot.clocks.gameTimeMs,
          consumedImpacts: [],
          impactBindings: motion.impacts.map((i) => ({
            impactIndex: i.impactIndex,
            impactId: impactId(`${activationId}:impact:${i.impactIndex}`),
          })),
        },
      });
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
    if (
      disposed ||
      command.runId !== context.runId ||
      snapshot.phase === 'error'
    )
      return;
    switch (command.type) {
      case 'AssetsReady':
        if (snapshot.phase === 'loading') {
          prepareCatalog();
          progress('ready');
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
        moves.clear();
        intents = [];
        if (clearCrouch(undefined, true)) publish();
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
    const motion = requireValue(metadata.get(attack.clipId));
    const index = motion.impacts.findIndex(
      (i) => i.impactIndex === binding?.impactIndex,
    );
    const impact = motion.impacts[index];
    if (
      !impact ||
      at < attack.startedAt + impact.startMs ||
      at >= attack.startedAt + impact.endMs
    )
      return null;
    return {
      actor,
      attack,
      motion,
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
            eventReal,
            !!actor.attack,
          ),
        );
    const fallen = actors.filter((a) => a.hp === 0 && !a.defeated);
    for (const a of fallen) {
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
          finishHeat(requireValue(heat.get(a.actorId)), eventReal),
        );
        updateActor(a.actorId, { attack: null });
      }
    if (lost || defeatedCount === 4) {
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
            hitTargets.has(key)
          )
            continue;
          seenContacts.add(c.contactId);
          hitTargets.add(key);
          use(c.source);
          add(target.actorId, a.damage, cause(c.source, 'attack'), c, [
            c.source,
          ]);
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
  function drain(): CoreOutput {
    const output = immutableDto({ snapshot, events });
    events = [];
    return output;
  }
  return {
    handle,
    read: () => snapshot,
    drain,
    handleInputBatch(input) {
      if (disposed) return;
      if (
        input.runId !== context.runId ||
        input.tick !== snapshot.clocks.tick + 1
      )
        throw new Error('Input batch does not match next tick/run');
      batch(input.commands);
    },
    beginStep(step) {
      if (disposed || inStep || snapshot.phase !== 'running')
        throw new Error('Core not ready for a fixed step');
      if (!Number.isFinite(step.durationMs) || step.durationMs <= 0)
        throw new RangeError('Step must be positive');
      advanceEncounter();
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
      publish({
        clocks: {
          ...snapshot.clocks,
          tick: tick(snapshot.clocks.tick + 1),
          gameTimeMs: gameTimeMs(end),
        },
      });
      const accepted = [...moves.values(), ...intents];
      intents = [];
      return immutableDto({
        snapshot,
        step: { durationMs: durationMs(scaled) },
        intents: accepted,
      });
    },
    completeStep(result) {
      if (
        !inStep ||
        result.snapshot.runId !== context.runId ||
        result.snapshot.tick !== snapshot.clocks.tick
      )
        throw new Error('Spatial result does not match active step/run');
      inStep = false;
      spatial = immutableDto(result.snapshot);
      processedReal = stepRealTo;
      if (
        snapshot.phase === 'running' &&
        snapshot.presentation.kind !== 'opponent-defeat'
      )
        resolve(result.candidates);
      if (snapshot.phase === 'running') completeAttacksThrough(end);
      publish();
      advancePresentation();
      advanceEncounter();
      return drain();
    },
    present(elapsed) {
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
      if (disposed) return;
      inStep = false;
      clearCrouch(undefined, true);
      progress('error');
      emit({ type: 'FoundationError', message });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      inStep = false;
      clearCrouch();
      closedCrouchSessions.clear();
      moves.clear();
      intents = [];
      progress('stopped');
      events = [];
      consumed.clear();
      hitTargets.clear();
      seenContacts.clear();
      seenCommands.clear();
      metadata.clear();
      heat.clear();
      spatial = null;
    },
  };
}
