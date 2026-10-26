import {
  FIGHTING_HZ,
  FIGHTING_BUFFER_MAX_AGE_TICKS,
  FIGHTING_ACTIVE_CANCEL_EDGES,
  FIGHTING_MAX_STAGE,
  FIGHTING_MOVE_SPECS,
  captureFightingCombatantState,
  captureFightingTransition,
  captureNormalizedFightingInputs,
  type FightingCombatantState,
  type FightingInputEdge,
  type FightingPosture,
  type FightingTransition,
} from '../contracts/fighting';
import { resolveFightingMove } from './fightingRules';

type MutableState = {
  -readonly [Key in keyof FightingCombatantState]: FightingCombatantState[Key];
};

export function createFightingCombatant(
  posture: FightingPosture = 'standing',
): FightingCombatantState {
  return captureFightingCombatantState({
    tick: 0,
    phase: 'neutral',
    posture,
    moveId: null,
    moveAgeTicks: 0,
    route: '',
    stage: 0,
    buffer: null,
    hitConfirmed: false,
    contactAgeTicks: null,
    stopTicksRemaining: 0,
    stunTicksRemaining: 0,
    guardHeld: false,
    guardHeight: null,
    airAttackUsed: false,
    landingTicksRemaining: 0,
  });
}

function clearAttack(state: MutableState): void {
  state.moveId = null;
  state.moveAgeTicks = 0;
  state.route = '';
  state.stage = 0;
  state.hitConfirmed = false;
  state.contactAgeTicks = null;
}
function currentGuard(state: MutableState): void {
  if (state.phase !== 'blockstun')
    state.guardHeight =
      state.phase === 'neutral' &&
      state.guardHeld &&
      state.posture !== 'airborne'
        ? state.posture
        : null;
}
function canReceiveInput(
  state: FightingCombatantState,
  heldGuard: boolean,
): boolean {
  return (
    !heldGuard &&
    (state.phase === 'neutral' ||
      state.phase === 'startup' ||
      state.phase === 'active' ||
      state.phase === 'recovery')
  );
}
function canStart(
  state: FightingCombatantState,
  edge: FightingInputEdge,
): boolean {
  if (state.phase === 'neutral')
    return !(state.posture === 'airborne' && state.airAttackUsed);
  if (
    state.posture !== 'standing' ||
    !state.moveId ||
    !state.hitConfirmed ||
    state.contactAgeTicks === null ||
    state.stage >= FIGHTING_MAX_STAGE
  )
    return false;
  const cancel = FIGHTING_ACTIVE_CANCEL_EDGES.find(
    (candidate) =>
      candidate.from === state.route &&
      candidate.to === state.route + edge.button,
  );
  const delay = state.moveAgeTicks - state.contactAgeTicks;
  return cancel !== undefined && delay >= 1 && delay <= cancel.maxDelayTicks;
}
function startMove(state: MutableState, edge: FightingInputEdge): void {
  const neutral = state.phase === 'neutral';
  const route = neutral ? '' : state.route;
  const moveId = resolveFightingMove(state.posture, route, edge.button);
  if (!moveId) return;
  state.moveId = moveId;
  state.moveAgeTicks = 0;
  state.route = route + edge.button;
  state.stage = (neutral ? 1 : state.stage + 1) as 1 | 2 | 3;
  state.phase = 'startup';
  state.buffer = null;
  state.hitConfirmed = false;
  state.contactAgeTicks = null;
  state.guardHeight = null;
  if (state.posture === 'airborne') state.airAttackUsed = true;
}

/** Accept a boundary edge without inventing elapsed time. Core owns continuous TOI time. */
export function receiveFightingInputs(
  inputState: FightingCombatantState,
  input: readonly FightingInputEdge[],
  heldGuard: boolean,
  allowStart = true,
): FightingCombatantState {
  const state = captureFightingCombatantState(inputState);
  const edges = captureNormalizedFightingInputs({
    edges: input,
    newlySeenCommandIds: input.map((edge) => edge.commandId),
  }).edges;
  if (typeof heldGuard !== 'boolean' || typeof allowStart !== 'boolean')
    throw new RangeError('Invalid fighting input control');
  if (state.phase === 'defeated') return state;
  const next: MutableState = { ...state, guardHeld: heldGuard };
  if (!canReceiveInput(state, heldGuard)) next.buffer = null;
  else {
    if (!next.buffer && edges[0]) next.buffer = { edge: edges[0], ageTicks: 0 };
    if (
      allowStart &&
      state.stopTicksRemaining === 0 &&
      next.buffer &&
      canStart(next, next.buffer.edge)
    )
      startMove(next, next.buffer.edge);
  }
  currentGuard(next);
  if (
    next.phase === 'neutral' &&
    next.posture === 'airborne' &&
    next.airAttackUsed
  )
    next.buffer = null;
  return captureFightingCombatantState(next);
}

/**
 * One unfrozen actor interval, followed by its boundary input. Existing attacks and
 * reservations age once; a newly started move/reservation is age zero. state.tick is
 * actor-action time, NOT Core's global fixed-step index. A stopped call records input
 * and decrements only stopTicksRemaining. contactAgeTicks is the move-age contact stamp.
 * Core normalizes/deduplicates across batches; this function rejects malformed batches.
 */
export function advanceFightingTick(
  inputState: FightingCombatantState,
  input: readonly FightingInputEdge[],
  heldGuard: boolean,
): FightingCombatantState {
  const original = captureFightingCombatantState(inputState);
  const edges = captureNormalizedFightingInputs({
    edges: input,
    newlySeenCommandIds: input.map((edge) => edge.commandId),
  }).edges;
  if (typeof heldGuard !== 'boolean')
    throw new RangeError('Invalid held guard');
  if (
    original.buffer &&
    edges.some(
      (edge) =>
        edge.runId !== original.buffer?.edge.runId ||
        edge.actorId !== original.buffer?.edge.actorId,
    )
  )
    throw new RangeError(
      'Input and occupied slot must identify the same actor/run',
    );
  if (original.phase === 'defeated') return original;
  const next: MutableState = { ...original, guardHeld: heldGuard };
  const accepts = canReceiveInput(original, heldGuard);
  if (!accepts) next.buffer = null;
  if (original.stopTicksRemaining > 0) {
    if (accepts && !next.buffer && edges[0])
      next.buffer = { edge: edges[0], ageTicks: 0 };
    next.stopTicksRemaining--;
    currentGuard(next);
    return captureFightingCombatantState(next);
  }
  next.tick++;
  if (next.buffer) {
    const ageTicks = next.buffer.ageTicks + 1;
    next.buffer =
      ageTicks > FIGHTING_BUFFER_MAX_AGE_TICKS
        ? null
        : { edge: next.buffer.edge, ageTicks };
  }
  // Physical landing lock and contact stun share an unfrozen clock and overlap.
  next.landingTicksRemaining = Math.max(0, next.landingTicksRemaining - 1);
  if (original.phase === 'hitstun' || original.phase === 'blockstun') {
    next.stunTicksRemaining = Math.max(0, next.stunTicksRemaining - 1);
    if (next.stunTicksRemaining === 0)
      next.phase = next.landingTicksRemaining > 0 ? 'landing' : 'neutral';
  } else if (original.phase === 'landing') {
    if (next.landingTicksRemaining === 0) next.phase = 'neutral';
  } else if (next.moveId) {
    const move = FIGHTING_MOVE_SPECS[next.moveId];
    next.moveAgeTicks++;
    if (
      next.moveAgeTicks >=
      move.startupTicks + move.activeTicks + move.recoveryTicks
    ) {
      clearAttack(next);
      next.phase = 'neutral';
    } else {
      next.phase =
        next.moveAgeTicks < move.startupTicks
          ? 'startup'
          : next.moveAgeTicks < move.startupTicks + move.activeTicks
            ? 'active'
            : 'recovery';
    }
  }
  if (accepts && !next.buffer && edges[0])
    next.buffer = { edge: edges[0], ageTicks: 0 };
  currentGuard(next);
  if (accepts && next.buffer && canStart(next, next.buffer.edge))
    startMove(next, next.buffer.edge);
  // A second air input cannot be replayed after landing or a later epoch.
  if (
    next.phase === 'neutral' &&
    next.posture === 'airborne' &&
    next.airAttackUsed
  )
    next.buffer = null;
  return captureFightingCombatantState(next);
}

/** Apply only authoritative body-contact / physical-landing / control transitions. */
export function applyFightingTransition(
  input: FightingCombatantState,
  transition: FightingTransition,
): FightingCombatantState {
  const state = captureFightingCombatantState(input);
  const event = captureFightingTransition(transition);
  const next: MutableState = { ...state };
  if (event.type === 'reset') {
    if (event.reason === 'pause') {
      next.buffer = null;
      next.guardHeld = false;
      currentGuard(next);
      return captureFightingCombatantState(next);
    }
    return captureFightingCombatantState({
      ...createFightingCombatant(),
      tick: state.tick,
      phase: event.reason === 'KO' ? 'defeated' : 'neutral',
    });
  }
  if (state.phase === 'defeated') return state;
  switch (event.type) {
    case 'hit-confirmed': {
      // One activation may confirm only once: do not extend cancel or hitstop on repeats.
      if (state.hitConfirmed) return state;
      if (!state.moveId || state.phase !== 'active')
        throw new RangeError('Only an active fighting attack can confirm');
      const move = FIGHTING_MOVE_SPECS[state.moveId];
      if (
        event.contactAgeTicks < move.startupTicks ||
        event.contactAgeTicks >= move.startupTicks + move.activeTicks ||
        event.contactAgeTicks > state.moveAgeTicks
      )
        throw new RangeError(
          'Contact age lies outside the accepted active interval',
        );
      next.hitConfirmed = true;
      next.contactAgeTicks = event.contactAgeTicks;
      next.stopTicksRemaining = Math.max(
        state.stopTicksRemaining,
        move.hitstopTicks,
      );
      break;
    }
    case 'received-hit':
    case 'received-block':
      // Pending posture changes cannot replace the retained block-contact stance.
      if (
        event.type === 'received-hit' &&
        state.phase === 'blockstun' &&
        state.guardHeight !== null
      )
        next.posture = state.guardHeight;
      clearAttack(next);
      next.buffer = null;
      // A new contact must not erase an earlier, longer physical landing lock.
      next.stunTicksRemaining = event.stunTicks;
      next.stopTicksRemaining = Math.max(
        state.stopTicksRemaining,
        event.stopTicks,
      );
      next.phase =
        event.stunTicks === 0
          ? next.landingTicksRemaining > 0
            ? 'landing'
            : 'neutral'
          : event.type === 'received-hit'
            ? 'hitstun'
            : 'blockstun';
      next.guardHeight = event.type === 'received-block' ? event.height : null;
      currentGuard(next);
      break;
    case 'guard-begin':
      next.buffer = null;
      next.guardHeld = true;
      currentGuard(next);
      break;
    case 'landed': {
      if (state.posture !== 'airborne')
        throw new RangeError('Landing requires an airborne actor');
      const attacked =
        state.airAttackUsed ||
        state.moveId === 'a_palm' ||
        state.moveId === 'a_kick';
      const move = state.moveId ? FIGHTING_MOVE_SPECS[state.moveId] : null;
      // Absolute motion stamp, not the accumulated sum of floating render deltas.
      const remaining = move
        ? move.startupTicks +
          move.activeTicks +
          move.recoveryTicks -
          (event.motionElapsedMs * FIGHTING_HZ) / 1000
        : 0;
      const landingTicks = attacked ? Math.ceil(Math.max(8, remaining)) : 3;
      clearAttack(next);
      next.buffer = null;
      next.posture = 'standing';
      next.airAttackUsed = false;
      // Landing changes physical posture, never cancels an existing contact stun.
      const stunned = state.phase === 'hitstun' || state.phase === 'blockstun';
      next.phase = stunned ? state.phase : 'landing';
      next.stunTicksRemaining = stunned ? state.stunTicksRemaining : 0;
      next.landingTicksRemaining = landingTicks;
      next.guardHeight = state.phase === 'blockstun' ? state.guardHeight : null;
      break;
    }
  }
  return captureFightingCombatantState(next);
}

/** A signal for Core's existing capacity-seven heat owner: spend one only on a start. */
export function fightingHeatCost(
  before: FightingCombatantState,
  after: FightingCombatantState,
): 0 | 1 {
  const previous = captureFightingCombatantState(before);
  const next = captureFightingCombatantState(after);
  return next.moveId !== null &&
    next.phase === 'startup' &&
    next.moveAgeTicks === 0 &&
    (previous.moveId === null ||
      previous.moveAgeTicks !== 0 ||
      previous.stage !== next.stage ||
      previous.route !== next.route ||
      previous.moveId !== next.moveId)
    ? 1
    : 0;
}
