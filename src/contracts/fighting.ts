import {
  type DurationMs,
  durationMs,
  type GameTimeMs,
  gameTimeMs,
  type Tick,
  tick,
} from './clock';
import {
  type ActorId,
  actorId,
  type AttackActivationId,
  attackActivationId,
  type ClipId,
  clipId,
  type CommandId,
  commandId,
  type ContactId,
  contactId,
  impactId,
  type RunId,
  runId,
} from './ids';
import {
  impactShapeIds,
  type HitVolume,
  type MotionImpact,
  type Vector3,
} from './motion';
import type { DomainEvent } from './events';
import type { GameSnapshot } from './snapshot';
import type {
  SpatialActor,
  SpatialSnapshot,
  SpatialCandidate,
  ImpactReference,
} from './spatial';
import type {
  CoreOutput,
  SpatialStepRequest,
  SpatialStepResult,
} from './ports';

/** Additive opt-in protocol; the legacy snapshot CONTRACT_VERSION remains 1. */
export const FIGHTING_HZ = 60 as const;
export const FIGHTING_MAX_STAGE = 3 as const;
export const FIGHTING_BUFFER_MAX_AGE_TICKS = 6 as const;
export const FIGHTING_DAMAGE_SCALES = Object.freeze([1, 0.8, 0.65] as const);
/** Historical material roles, including roles excluded from active A selection. */
export type FightingMoveId =
  | 'p_short'
  | 'p_body'
  | 'p_finish'
  | 'k_front'
  | 'k_low'
  | 'k_turn'
  | 'p_entry'
  | 'c_body'
  | 'a_palm'
  | 'a_kick';
/** Approved A selection; this does not shrink the historical material registry. */
export const FIGHTING_ACTIVE_MOVE_IDS = Object.freeze([
  'p_short',
  'p_body',
  'k_front',
  'k_low',
  'k_turn',
  'c_body',
  'a_palm',
  'a_kick',
] as const satisfies readonly FightingMoveId[]);
export type FightingActiveMoveId = (typeof FIGHTING_ACTIVE_MOVE_IDS)[number];
export type FightingPosture = 'standing' | 'crouching' | 'airborne';
export type GuardHeight = 'standing' | 'crouching';
export type HitLevel = 'high' | 'mid' | 'low';
export type FightingButton = 'P' | 'K';
export interface FightingInputEdge {
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly commandId: CommandId;
  readonly sequence: number;
  readonly button: FightingButton;
}
export interface NormalizedFightingInputs {
  readonly edges: readonly FightingInputEdge[];
  readonly newlySeenCommandIds: readonly CommandId[];
}
export interface FightingMoveDefinition {
  readonly id: FightingMoveId;
  readonly clipId: ClipId;
  readonly startupTicks: number;
  readonly activeTicks: number;
  readonly recoveryTicks: number;
  readonly hitstunTicks: number;
  readonly hitstopTicks: number;
  readonly damageNormalized: number;
  readonly blockstunTicks: number;
  readonly blockstopTicks: number;
  readonly level: HitLevel;
}
export type FightingMoveSpec = Omit<FightingMoveDefinition, 'clipId'>;
/** Role data is not an asset binding. C supplies source-backed clip IDs separately. */
/** Historical definitions remain complete; presence does not grant active selection. */
export const FIGHTING_MOVE_SPECS: Readonly<
  Record<FightingMoveId, FightingMoveSpec>
> = Object.freeze({
  p_short: spec('p_short', 5, 2, 14, 18, 6, 10, 10, 4, 'high'),
  p_body: spec('p_body', 7, 2, 16, 20, 6, 12, 12, 4, 'mid'),
  p_finish: spec('p_finish', 9, 2, 22, 16, 8, 18, 12, 6, 'mid'),
  k_front: spec('k_front', 10, 3, 20, 22, 7, 16, 14, 5, 'mid'),
  k_low: spec('k_low', 11, 3, 22, 24, 7, 18, 14, 5, 'low'),
  k_turn: spec('k_turn', 13, 3, 27, 18, 9, 24, 16, 6, 'mid'),
  p_entry: spec('p_entry', 12, 2, 24, 20, 8, 20, 14, 5, 'mid'),
  c_body: spec('c_body', 7, 2, 14, 15, 6, 10, 10, 4, 'mid'),
  a_palm: spec('a_palm', 8, 3, 14, 12, 5, 10, 10, 4, 'mid'),
  a_kick: spec('a_kick', 11, 4, 18, 14, 7, 16, 12, 5, 'mid'),
});
function spec(
  id: FightingMoveId,
  startupTicks: number,
  activeTicks: number,
  recoveryTicks: number,
  hitstunTicks: number,
  hitstopTicks: number,
  damageNormalized: number,
  blockstunTicks: number,
  blockstopTicks: number,
  level: HitLevel,
): FightingMoveSpec {
  return Object.freeze({
    id,
    startupTicks,
    activeTicks,
    recoveryTicks,
    hitstunTicks,
    hitstopTicks,
    damageNormalized,
    blockstunTicks,
    blockstopTicks,
    level,
  });
}
/** Historical routes retained for material validation and historical records. */
export const FIGHTING_GROUND_ROUTES = Object.freeze({
  P: 'p_short',
  PP: 'p_body',
  PPP: 'p_finish',
  PK: 'k_low',
  PPK: 'k_turn',
  K: 'k_front',
  KK: 'k_turn',
  KP: 'p_entry',
  KPP: 'p_finish',
} as const);
export const FIGHTING_ACTIVE_GROUND_ROUTES = Object.freeze({
  P: 'p_short',
  PP: 'p_body',
  PK: 'k_low',
  PPK: 'k_turn',
  K: 'k_front',
  KK: 'k_turn',
} as const);
export interface FightingEntry {
  readonly posture: FightingPosture;
  readonly moveId: FightingMoveId;
}
/** Exact historical backing catalog: 11 posture entries remain required for admission. */
export const FIGHTING_ENTRIES: readonly FightingEntry[] = Object.freeze([
  ...(
    [
      'p_short',
      'p_body',
      'p_finish',
      'k_front',
      'k_low',
      'k_turn',
      'p_entry',
    ] as const
  ).map((moveId) => Object.freeze({ posture: 'standing' as const, moveId })),
  Object.freeze({ posture: 'crouching', moveId: 'c_body' }),
  Object.freeze({ posture: 'crouching', moveId: 'k_low' }),
  Object.freeze({ posture: 'airborne', moveId: 'a_palm' }),
  Object.freeze({ posture: 'airborne', moveId: 'a_kick' }),
]);
/** Readonly views of the nine active entries within the unchanged backing catalog. */
export const FIGHTING_ACTIVE_ENTRIES: readonly FightingEntry[] = Object.freeze(
  FIGHTING_ENTRIES.filter(({ moveId }) =>
    FIGHTING_ACTIVE_MOVE_IDS.some((activeMoveId) => activeMoveId === moveId),
  ),
);
/** Hit-confirmed edges only; delays count unfrozen ticks after contact (minimum 1). */
/** Historical cancel records are retained, not active-selection permission. */
export const FIGHTING_CANCEL_EDGES = Object.freeze([
  Object.freeze({ from: 'P', to: 'PP', maxDelayTicks: 8 }),
  Object.freeze({ from: 'P', to: 'PK', maxDelayTicks: 3 }),
  Object.freeze({ from: 'PP', to: 'PPP', maxDelayTicks: 8 }),
  Object.freeze({ from: 'PP', to: 'PPK', maxDelayTicks: 3 }),
  Object.freeze({ from: 'K', to: 'KK', maxDelayTicks: 5 }),
  Object.freeze({ from: 'K', to: 'KP', maxDelayTicks: 7 }),
  Object.freeze({ from: 'KP', to: 'KPP', maxDelayTicks: 8 }),
] as const);
/** Active A hit-only edges; delays retain the historical unfrozen-tick units. */
export const FIGHTING_ACTIVE_CANCEL_EDGES = Object.freeze([
  Object.freeze({ from: 'P', to: 'PP', maxDelayTicks: 8 }),
  Object.freeze({ from: 'P', to: 'PK', maxDelayTicks: 3 }),
  Object.freeze({ from: 'PP', to: 'PPK', maxDelayTicks: 3 }),
  Object.freeze({ from: 'K', to: 'KK', maxDelayTicks: 5 }),
] as const);
export interface FightingCombatantState {
  readonly tick: number;
  readonly phase:
    | 'neutral'
    | 'startup'
    | 'active'
    | 'recovery'
    | 'hitstun'
    | 'blockstun'
    | 'landing'
    | 'defeated';
  readonly posture: FightingPosture;
  readonly moveId: FightingMoveId | null;
  readonly moveAgeTicks: number;
  readonly route: string;
  readonly stage: 0 | 1 | 2 | 3;
  /** First chronological edge wins; an occupied slot is never refreshed or overwritten. */
  readonly buffer: {
    readonly edge: FightingInputEdge;
    readonly ageTicks: number;
  } | null;
  readonly hitConfirmed: boolean;
  readonly contactAgeTicks: number | null;
  readonly stopTicksRemaining: number;
  readonly stunTicksRemaining: number;
  readonly guardHeld: boolean;
  readonly guardHeight: GuardHeight | null;
  readonly airAttackUsed: boolean;
  readonly landingTicksRemaining: number;
}
export interface FightingPolicy {
  readonly version: 3;
  readonly hpPerNormalizedPoint: number;
  readonly guardFrontDotMin: number;
  readonly hitstunPosture: 'retain-contact-posture' | 'force-standing';
}
export type FightingTransition =
  | { readonly type: 'hit-confirmed'; readonly contactAgeTicks: number }
  | {
      readonly type: 'received-hit';
      readonly stunTicks: number;
      readonly stopTicks: number;
    }
  | {
      readonly type: 'received-block';
      readonly stunTicks: number;
      readonly stopTicks: number;
      readonly height: GuardHeight;
    }
  | {
      readonly type: 'landed';
      readonly atGameMs: GameTimeMs;
      readonly motionElapsedMs: DurationMs;
    }
  | {
      readonly type: 'reset';
      readonly reason: 'pause' | 'KO' | 'switch' | 'retry';
    }
  | { readonly type: 'guard-begin' };
export interface FightingClockSlice {
  readonly actorId: ActorId;
  readonly epochId: string;
  readonly clipId: ClipId;
  readonly activationId: AttackActivationId | null;
  readonly fromGameMs: GameTimeMs;
  readonly toGameMs: GameTimeMs;
  readonly fromMotionMs: DurationMs;
  readonly toMotionMs: DurationMs;
  readonly frozen: boolean;
}
export interface FightingClock {
  /** Same Core runtime sampled after exact right-boundary selections. */
  readonly endpoint?: FightingClockPoint;
  readonly stepTick: Tick;
  readonly activeEpochId: string;
  readonly slices: readonly FightingClockSlice[];
}
export interface FightingClockContext {
  readonly actorId: ActorId;
  readonly stepTick: Tick;
  readonly fromGameMs: GameTimeMs;
  readonly toGameMs: GameTimeMs;
}
/** Physical ground-to-air seam (jump or lost support), not accepted input intent. */
export interface FightingTakeoffWitness {
  readonly actorId: ActorId;
  readonly atGameMs: GameTimeMs;
  readonly position: Vector3;
}
export interface FightingLandingWitness {
  readonly actorId: ActorId;
  readonly atGameMs: GameTimeMs;
  readonly position: Vector3;
  readonly supportId: string;
  readonly airborneActivationId: AttackActivationId | null;
}
export interface FightingContactWitness {
  readonly contactId: ContactId;
  readonly atGameMs: GameTimeMs;
  readonly sourceActorId: ActorId;
  readonly targetActorId: ActorId;
  readonly sourcePosition: Vector3;
  readonly targetPosition: Vector3;
  readonly sourceFacing: Vector3;
  readonly targetFacing: Vector3;
}
export interface FightingSpatialStepResult extends SpatialStepResult {
  readonly fighting: {
    readonly stepTick: Tick;
    readonly takeoffs: readonly FightingTakeoffWitness[];
    readonly landings: readonly FightingLandingWitness[];
    readonly contacts: readonly FightingContactWitness[];
  };
}
/** Only Core converts v3 once. legacy-hp already includes distance and impact share. */
export type FightingDamage =
  | { readonly kind: 'v3-normalized'; readonly value: number }
  | { readonly kind: 'legacy-hp'; readonly value: number };
export interface LegacyImpactProfile {
  readonly clipId: ClipId;
  readonly impactIndex: number;
  readonly level: HitLevel;
  readonly hitstunTicks: number;
  readonly hitstopTicks: number;
  readonly blockstunTicks: number;
  readonly blockstopTicks: number;
}
export type FightingAttackDescriptor = (
  | {
      readonly kind: 'v3';
      readonly moveId: FightingMoveId;
      readonly stage: 1 | 2 | 3;
      readonly damage: {
        readonly kind: 'v3-normalized';
        readonly value: number;
      };
    }
  | {
      readonly kind: 'legacy';
      readonly clipId: ClipId;
      readonly impactIndex: number;
      readonly damage: { readonly kind: 'legacy-hp'; readonly value: number };
    }
) & {
  readonly level: HitLevel;
  readonly hitstunTicks: number;
  readonly hitstopTicks: number;
  readonly blockstunTicks: number;
  readonly blockstopTicks: number;
};
export type FightingContactDecision =
  | {
      readonly kind: 'hit';
      readonly damage: FightingDamage;
      readonly hitstunTicks: number;
      readonly stopTicks: number;
    }
  | {
      readonly kind: 'blocked';
      readonly damageHp: 0;
      readonly blockstunTicks: number;
      readonly stopTicks: number;
    }
  | { readonly kind: 'ignored'; readonly reason: string };
export type FightingAttackState = (
  | {
      readonly kind: 'v3';
      readonly moveId: FightingMoveId;
      readonly stage: 1 | 2 | 3;
    }
  | { readonly kind: 'legacy'; readonly clipId: ClipId }
) & { readonly elapsedTicks: number; readonly facing: Vector3 };

function requireRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RangeError('Invalid fighting DTO');
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    throw new RangeError('Invalid fighting identity');
  return value;
}
function nonnegative(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError('Fighting value must be finite and nonnegative');
  return value;
}
function boolean(value: boolean): boolean {
  if (typeof value !== 'boolean')
    throw new RangeError('Invalid fighting boolean');
  return value;
}
function member<T extends string>(value: T, values: readonly string[]): T {
  if (!values.includes(value)) throw new RangeError('Unknown fighting value');
  return value;
}
function moveId(value: FightingMoveId): FightingMoveId {
  if (typeof value !== 'string' || !Object.hasOwn(FIGHTING_MOVE_SPECS, value))
    throw new RangeError('Unknown fighting move');
  return value;
}
function level(value: HitLevel): HitLevel {
  return member(value, ['high', 'mid', 'low']);
}
function height(value: GuardHeight): GuardHeight {
  return member(value, ['standing', 'crouching']);
}
function stage(value: 1 | 2 | 3): 1 | 2 | 3 {
  if (![1, 2, 3].includes(value))
    throw new RangeError('Invalid fighting stage');
  return value;
}
function vector(value: Vector3): Vector3 {
  requireRecord(value);
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new RangeError('Invalid fighting vector');
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}
function reaction(
  input: Pick<
    LegacyImpactProfile,
    | 'level'
    | 'hitstunTicks'
    | 'hitstopTicks'
    | 'blockstunTicks'
    | 'blockstopTicks'
  >,
) {
  return {
    level: level(input.level),
    hitstunTicks: tick(input.hitstunTicks),
    hitstopTicks: tick(input.hitstopTicks),
    blockstunTicks: tick(input.blockstunTicks),
    blockstopTicks: tick(input.blockstopTicks),
  };
}
export function captureFightingMoveDefinition(
  input: FightingMoveDefinition,
): FightingMoveDefinition {
  requireRecord(input);
  return Object.freeze({
    id: moveId(input.id),
    clipId: clipId(text(input.clipId)),
    startupTicks: tick(input.startupTicks),
    activeTicks: tick(input.activeTicks),
    recoveryTicks: tick(input.recoveryTicks),
    ...reaction(input),
    damageNormalized: nonnegative(input.damageNormalized),
  });
}
export function captureFightingPolicy(input: FightingPolicy): FightingPolicy {
  requireRecord(input);
  if (
    input.version !== 3 ||
    !Number.isFinite(input.hpPerNormalizedPoint) ||
    input.hpPerNormalizedPoint <= 0 ||
    !Number.isFinite(input.guardFrontDotMin) ||
    input.guardFrontDotMin < -1 ||
    input.guardFrontDotMin > 1
  )
    throw new RangeError('Invalid explicit fighting policy');
  return Object.freeze({
    version: 3,
    hpPerNormalizedPoint: input.hpPerNormalizedPoint,
    guardFrontDotMin: input.guardFrontDotMin,
    hitstunPosture: member(input.hitstunPosture, [
      'retain-contact-posture',
      'force-standing',
    ]),
  });
}
export function captureFightingInputEdge(
  input: FightingInputEdge,
): FightingInputEdge {
  requireRecord(input);
  if (tick(input.sequence) === 0)
    throw new RangeError('Input sequence must be positive');
  return Object.freeze({
    runId: runId(text(input.runId)),
    actorId: actorId(text(input.actorId)),
    commandId: commandId(text(input.commandId)),
    sequence: input.sequence,
    button: member(input.button, ['P', 'K']),
  });
}
export function captureNormalizedFightingInputs(
  input: NormalizedFightingInputs,
): NormalizedFightingInputs {
  requireRecord(input);
  if (!Array.isArray(input.edges) || !Array.isArray(input.newlySeenCommandIds))
    throw new RangeError('Invalid normalized fighting inputs');
  const edges = input.edges.map(captureFightingInputEdge);
  const ids = input.newlySeenCommandIds.map((id) => commandId(text(id)));
  const unique = new Set(ids);
  if (unique.size !== ids.length)
    throw new RangeError('Duplicate newly seen command');
  const consumed = new Set<CommandId>();
  for (const [index, edge] of edges.entries()) {
    const previous = edges[index - 1];
    if (
      !unique.has(edge.commandId) ||
      consumed.has(edge.commandId) ||
      (previous &&
        (edge.sequence <= previous.sequence ||
          edge.runId !== previous.runId ||
          edge.actorId !== previous.actorId))
    )
      throw new RangeError(
        'Inputs must retain one actor/run and strict source order',
      );
    consumed.add(edge.commandId);
  }
  return Object.freeze({
    edges: Object.freeze(edges),
    newlySeenCommandIds: Object.freeze(ids),
  });
}
export function captureFightingCombatantState(
  input: FightingCombatantState,
): FightingCombatantState {
  requireRecord(input);
  if (
    typeof input.route !== 'string' ||
    (input.route !== '' && !Object.hasOwn(FIGHTING_GROUND_ROUTES, input.route))
  )
    throw new RangeError('Unknown fighting route');
  if (![0, 1, 2, 3].includes(input.stage))
    throw new RangeError('Invalid fighting stage');
  let buffer: FightingCombatantState['buffer'] = null;
  if (input.buffer !== null) {
    requireRecord(input.buffer);
    const ageTicks = tick(input.buffer.ageTicks);
    if (ageTicks > FIGHTING_BUFFER_MAX_AGE_TICKS)
      throw new RangeError('Expired fighting buffer');
    buffer = Object.freeze({
      edge: captureFightingInputEdge(input.buffer.edge),
      ageTicks,
    });
  }
  return Object.freeze({
    tick: tick(input.tick),
    phase: member(input.phase, [
      'neutral',
      'startup',
      'active',
      'recovery',
      'hitstun',
      'blockstun',
      'landing',
      'defeated',
    ]),
    posture: member(input.posture, ['standing', 'crouching', 'airborne']),
    moveId: input.moveId === null ? null : moveId(input.moveId),
    moveAgeTicks: tick(input.moveAgeTicks),
    route: input.route,
    stage: input.stage,
    buffer,
    hitConfirmed: boolean(input.hitConfirmed),
    contactAgeTicks:
      input.contactAgeTicks === null ? null : tick(input.contactAgeTicks),
    stopTicksRemaining: tick(input.stopTicksRemaining),
    stunTicksRemaining: tick(input.stunTicksRemaining),
    guardHeld: boolean(input.guardHeld),
    guardHeight: input.guardHeight === null ? null : height(input.guardHeight),
    airAttackUsed: boolean(input.airAttackUsed),
    landingTicksRemaining: tick(input.landingTicksRemaining),
  });
}
export function captureFightingTransition(
  input: FightingTransition,
): FightingTransition {
  requireRecord(input);
  switch (input.type) {
    case 'hit-confirmed':
      return Object.freeze({
        type: input.type,
        contactAgeTicks: tick(input.contactAgeTicks),
      });
    case 'received-hit':
      return Object.freeze({
        type: input.type,
        stunTicks: tick(input.stunTicks),
        stopTicks: tick(input.stopTicks),
      });
    case 'received-block':
      return Object.freeze({
        type: input.type,
        stunTicks: tick(input.stunTicks),
        stopTicks: tick(input.stopTicks),
        height: height(input.height),
      });
    case 'landed':
      return Object.freeze({
        type: input.type,
        atGameMs: gameTimeMs(input.atGameMs),
        motionElapsedMs: durationMs(input.motionElapsedMs),
      });
    case 'reset':
      return Object.freeze({
        type: input.type,
        reason: member(input.reason, ['pause', 'KO', 'switch', 'retry']),
      });
    case 'guard-begin':
      return Object.freeze({ type: input.type });
    default:
      throw new RangeError('Unknown fighting transition');
  }
}
export function captureFightingDamage(input: FightingDamage): FightingDamage {
  requireRecord(input);
  return Object.freeze({
    kind: member(input.kind, ['v3-normalized', 'legacy-hp']),
    value: nonnegative(input.value),
  });
}
export function captureLegacyImpactProfile(
  input: LegacyImpactProfile,
): LegacyImpactProfile {
  requireRecord(input);
  return Object.freeze({
    clipId: clipId(text(input.clipId)),
    impactIndex: tick(input.impactIndex),
    ...reaction(input),
  });
}
export function captureFightingAttackDescriptor(
  input: FightingAttackDescriptor,
): FightingAttackDescriptor {
  requireRecord(input);
  const damage = captureFightingDamage(input.damage);
  if (input.kind === 'v3' && damage.kind === 'v3-normalized')
    return Object.freeze({
      kind: input.kind,
      moveId: moveId(input.moveId),
      stage: stage(input.stage),
      damage,
      ...reaction(input),
    });
  if (input.kind === 'legacy' && damage.kind === 'legacy-hp')
    return Object.freeze({
      kind: input.kind,
      clipId: clipId(text(input.clipId)),
      impactIndex: tick(input.impactIndex),
      damage,
      ...reaction(input),
    });
  throw new RangeError('Attack kind and trusted damage units must agree');
}
export function captureFightingContactDecision(
  input: FightingContactDecision,
): FightingContactDecision {
  requireRecord(input);
  if (input.kind === 'hit')
    return Object.freeze({
      kind: input.kind,
      damage: captureFightingDamage(input.damage),
      hitstunTicks: tick(input.hitstunTicks),
      stopTicks: tick(input.stopTicks),
    });
  if (input.kind === 'blocked' && input.damageHp === 0)
    return Object.freeze({
      kind: input.kind,
      damageHp: 0,
      blockstunTicks: tick(input.blockstunTicks),
      stopTicks: tick(input.stopTicks),
    });
  if (input.kind === 'ignored')
    return Object.freeze({ kind: input.kind, reason: text(input.reason) });
  throw new RangeError('Invalid fighting contact decision');
}
export function captureFightingAttackState(
  input: FightingAttackState,
): FightingAttackState {
  requireRecord(input);
  const shared = {
    elapsedTicks: tick(input.elapsedTicks),
    facing: vector(input.facing),
  };
  if (input.kind === 'v3')
    return Object.freeze({
      kind: input.kind,
      moveId: moveId(input.moveId),
      stage: stage(input.stage),
      ...shared,
    });
  if (input.kind === 'legacy')
    return Object.freeze({
      kind: input.kind,
      clipId: clipId(text(input.clipId)),
      ...shared,
    });
  throw new RangeError('Invalid fighting attack state');
}
export function captureFightingClockSlice(
  input: FightingClockSlice,
): FightingClockSlice {
  requireRecord(input);
  const fromGameMs = gameTimeMs(input.fromGameMs),
    toGameMs = gameTimeMs(input.toGameMs);
  const fromMotionMs = durationMs(input.fromMotionMs),
    toMotionMs = durationMs(input.toMotionMs);
  const frozen = boolean(input.frozen);
  if (
    toGameMs <= fromGameMs ||
    toMotionMs < fromMotionMs ||
    (frozen && toMotionMs !== fromMotionMs)
  )
    throw new RangeError('Invalid fighting clock interval');
  return Object.freeze({
    actorId: actorId(text(input.actorId)),
    epochId: text(input.epochId),
    clipId: clipId(text(input.clipId)),
    activationId:
      input.activationId === null
        ? null
        : attackActivationId(text(input.activationId)),
    fromGameMs,
    toGameMs,
    fromMotionMs,
    toMotionMs,
    frozen,
  });
}
/** Slices are half-open [from,to): an epoch cut belongs only to the new epoch. */
export function captureFightingClock(
  input: FightingClock,
  context?: FightingClockContext,
): FightingClock {
  assertPureData(input);
  if (context) assertPureData(context);
  requireRecord(input);
  const stepTick = tick(input.stepTick),
    activeEpochId = text(input.activeEpochId);
  denseArray(input.slices);
  const slices = input.slices.map(captureFightingClockSlice);
  const endpoint =
    input.endpoint === undefined
      ? undefined
      : captureFightingClockPoint(input.endpoint);
  const epochs = new Set<string>();
  for (const [index, current] of slices.entries()) {
    const previous = slices[index - 1];
    if (previous) {
      if (
        current.actorId !== previous.actorId ||
        current.fromGameMs !== previous.toGameMs
      )
        throw new RangeError('Fighting clock gap, overlap or actor mismatch');
      if (current.epochId === previous.epochId) {
        if (
          current.clipId !== previous.clipId ||
          current.activationId !== previous.activationId ||
          current.fromMotionMs !== previous.toMotionMs
        )
          throw new RangeError(
            'Conflicting fighting epoch or noncontinuous motion',
          );
      } else if (current.fromMotionMs !== 0 || epochs.has(current.epochId))
        throw new RangeError(
          'New epoch must begin at clip time zero and cannot be reused',
        );
    }
    epochs.add(current.epochId);
  }
  const first = slices[0],
    last = slices.at(-1);
  if (!first || !last) {
    if (!endpoint || !context || context.fromGameMs !== context.toGameMs)
      throw new RangeError('Missing fighting clock coverage');
  }
  if (endpoint) {
    if (endpoint.stepTick !== stepTick || endpoint.epochId !== activeEpochId)
      throw new RangeError('Active epoch must match clock endpoint');
    if (last) {
      if (
        endpoint.actorId !== last.actorId ||
        endpoint.atGameMs !== last.toGameMs
      )
        throw new RangeError('Foreign clock endpoint');
      if (endpoint.epochId === last.epochId) {
        if (
          endpoint.clipId !== last.clipId ||
          endpoint.activationId !== last.activationId ||
          endpoint.motionMs !== last.toMotionMs
        )
          throw new RangeError('Endpoint disagrees with its interval epoch');
      } else if (endpoint.motionMs !== 0 || epochs.has(endpoint.epochId))
        throw new RangeError(
          'Endpoint transition must start a fresh epoch at zero',
        );
    }
  } else if (last?.epochId !== activeEpochId)
    throw new RangeError('Active epoch must match clock endpoint');
  if (context) {
    const from = gameTimeMs(context.fromGameMs),
      to = gameTimeMs(context.toGameMs);
    const id = actorId(text(context.actorId));
    if (
      from > to ||
      stepTick !== tick(context.stepTick) ||
      (first &&
        (first.actorId !== id ||
          first.fromGameMs !== from ||
          last?.toGameMs !== to)) ||
      (endpoint && (endpoint.actorId !== id || endpoint.atGameMs !== to))
    )
      throw new RangeError(
        'Fighting clock does not cover the requested actor/step interval',
      );
  }
  return Object.freeze({
    stepTick,
    activeEpochId,
    slices: Object.freeze(slices),
    ...(endpoint ? { endpoint } : {}),
  });
}
/** Half-open lookup grants no endpoint-only coverage/transition authority. */
export function fightingClockSliceAt(
  input: FightingClock,
  at: GameTimeMs,
): FightingClockSlice | null {
  assertPureData(input);
  gameTimeMs(at);
  denseArray(input.slices);
  if (input.slices.length === 0) {
    if (!input.endpoint) throw new RangeError('Missing endpoint-only clock');
    const endpoint = captureFightingClockPoint(input.endpoint);
    captureFightingClock(input, {
      actorId: endpoint.actorId,
      stepTick: endpoint.stepTick,
      fromGameMs: endpoint.atGameMs,
      toGameMs: endpoint.atGameMs,
    });
    return null;
  }
  const clock = captureFightingClock(input);
  return (
    clock.slices.find(
      (slice) => at >= slice.fromGameMs && at < slice.toGameMs,
    ) ?? null
  );
}
export function captureFightingTakeoffWitness(
  input: FightingTakeoffWitness,
): FightingTakeoffWitness {
  requireRecord(input);
  return Object.freeze({
    actorId: actorId(text(input.actorId)),
    atGameMs: gameTimeMs(input.atGameMs),
    position: vector(input.position),
  });
}
export function captureFightingLandingWitness(
  input: FightingLandingWitness,
): FightingLandingWitness {
  requireRecord(input);
  return Object.freeze({
    actorId: actorId(text(input.actorId)),
    atGameMs: gameTimeMs(input.atGameMs),
    position: vector(input.position),
    supportId: text(input.supportId),
    airborneActivationId:
      input.airborneActivationId === null
        ? null
        : attackActivationId(text(input.airborneActivationId)),
  });
}
export function captureFightingContactWitness(
  input: FightingContactWitness,
): FightingContactWitness {
  requireRecord(input);
  const sourceActorId = actorId(text(input.sourceActorId)),
    targetActorId = actorId(text(input.targetActorId));
  if (sourceActorId === targetActorId)
    throw new RangeError('Self-contact witness');
  return Object.freeze({
    contactId: contactId(text(input.contactId)),
    atGameMs: gameTimeMs(input.atGameMs),
    sourceActorId,
    targetActorId,
    sourcePosition: vector(input.sourcePosition),
    targetPosition: vector(input.targetPosition),
    sourceFacing: vector(input.sourceFacing),
    targetFacing: vector(input.targetFacing),
  });
}
/** Structural guard includes self-consistency, never request-specific authority or damage. */
export function isFightingSpatialStepResult(
  value: SpatialStepResult,
): value is FightingSpatialStepResult {
  try {
    validateFightingSpatial(value);
    return true;
  } catch {
    return false;
  }
}
function validateFightingSpatial(
  value: SpatialStepResult,
): asserts value is FightingSpatialStepResult {
  requireRecord(value);
  requireRecord(value.snapshot);
  const extension = (value as Partial<FightingSpatialStepResult>).fighting;
  requireRecord(extension);
  if (
    tick(extension.stepTick) !== tick(value.snapshot.tick) ||
    !Array.isArray(extension.takeoffs) ||
    !Array.isArray(extension.landings) ||
    !Array.isArray(extension.contacts) ||
    !Array.isArray(value.snapshot.actors) ||
    !Array.isArray(value.candidates)
  )
    throw new RangeError('Invalid fighting spatial extension');
  runId(text(value.snapshot.runId));
  const actors = new Set<ActorId>();
  for (const actor of value.snapshot.actors) {
    requireRecord(actor);
    const id = actorId(text(actor.actorId));
    if (actors.has(id)) throw new RangeError('Duplicate spatial actor');
    actors.add(id);
  }
  const bodyHits = value.candidates.filter((candidate) => {
    requireRecord(candidate);
    return candidate.kind === 'body-hit';
  });
  const witnesses = new Map<ContactId, FightingContactWitness>();
  for (const original of extension.contacts) {
    const witness = captureFightingContactWitness(original);
    if (
      witnesses.has(witness.contactId) ||
      !actors.has(witness.sourceActorId) ||
      !actors.has(witness.targetActorId)
    )
      throw new RangeError('Duplicate or foreign fighting contact');
    witnesses.set(witness.contactId, witness);
  }
  if (witnesses.size !== bodyHits.length)
    throw new RangeError('Body contacts require a witness bijection');
  const candidateIds = new Set<ContactId>();
  for (const candidate of bodyHits) {
    requireRecord(candidate.source);
    requireRecord(candidate.interval);
    actorId(text(candidate.source.actorId));
    attackActivationId(text(candidate.source.activationId));
    impactId(text(candidate.source.impactId));
    vector(candidate.point);
    const witness = witnesses.get(candidate.contactId);
    const from = gameTimeMs(candidate.interval.from),
      to = gameTimeMs(candidate.interval.to),
      at = gameTimeMs(candidate.at);
    if (
      candidate.runId !== value.snapshot.runId ||
      from > to ||
      at < from ||
      at > to ||
      candidateIds.has(candidate.contactId) ||
      !witness ||
      witness.atGameMs !== at ||
      witness.sourceActorId !== candidate.source.actorId ||
      witness.targetActorId !== candidate.targetActorId
    )
      throw new RangeError(
        'Fighting witness and body candidate identity/interval differ',
      );
    candidateIds.add(candidate.contactId);
  }
  const takeoffTimes = new Map<ActorId, Set<GameTimeMs>>();
  for (const original of extension.takeoffs) {
    const witness = captureFightingTakeoffWitness(original);
    const times = takeoffTimes.get(witness.actorId) ?? new Set<GameTimeMs>();
    if (!actors.has(witness.actorId) || times.has(witness.atGameMs))
      throw new RangeError('Duplicate or foreign fighting takeoff');
    times.add(witness.atGameMs);
    takeoffTimes.set(witness.actorId, times);
  }
  const landingActors = new Set<ActorId>();
  for (const original of extension.landings) {
    const witness = captureFightingLandingWitness(original);
    if (!actors.has(witness.actorId) || landingActors.has(witness.actorId))
      throw new RangeError('Duplicate or foreign fighting landing');
    landingActors.add(witness.actorId);
  }
}
/** Existing beginStep snapshot is at the interval endpoint; no guessed tick-to-ms conversion. */
export function captureFightingSpatialStepResult(
  input: SpatialStepResult,
  request: SpatialStepRequest,
): FightingSpatialStepResult {
  assertPureData(input);
  if (Object.hasOwn(input, 'transaction') || Object.hasOwn(input, 'kind'))
    throw new RangeError('Transaction capability is not a fighting DTO');
  validateFightingSpatial(input);
  const endpoint = gameTimeMs(request.snapshot.clocks.gameTimeMs);
  const duration = durationMs(request.step.durationMs);
  const from = gameTimeMs(endpoint - duration);
  if (
    duration <= 0 ||
    input.snapshot.runId !== request.snapshot.runId ||
    input.snapshot.tick !== tick(request.snapshot.clocks.tick)
  )
    throw new RangeError('Fighting spatial request run/tick mismatch');
  const actors = new Set(
    request.snapshot.actors.map((actor) => actorId(text(actor.actorId))),
  );
  for (const actor of input.snapshot.actors)
    if (!actors.has(actor.actorId))
      throw new RangeError('Unexpected fighting spatial actor');
  for (const witness of input.fighting.takeoffs) {
    if (
      !actors.has(witness.actorId) ||
      witness.atGameMs < from ||
      witness.atGameMs > endpoint
    )
      throw new RangeError('Takeoff witness outside requested interval/actors');
  }
  for (const witness of input.fighting.landings) {
    if (
      !actors.has(witness.actorId) ||
      witness.atGameMs < from ||
      witness.atGameMs > endpoint
    )
      throw new RangeError('Landing witness outside requested interval/actors');
  }
  for (const witness of input.fighting.contacts) {
    if (
      !actors.has(witness.sourceActorId) ||
      !actors.has(witness.targetActorId) ||
      witness.atGameMs < from ||
      witness.atGameMs > endpoint
    )
      throw new RangeError('Contact witness outside requested interval/actors');
  }
  for (const candidate of input.candidates)
    if (
      candidate.kind === 'body-hit' &&
      (candidate.interval.from < from || candidate.interval.to > endpoint)
    )
      throw new RangeError('Body contact interval outside step');
  // Copy the legacy DTO portion too: future producer mutation cannot rewrite a captured result.
  return freezeDto({
    snapshot: input.snapshot,
    candidates: input.candidates,
    fighting: {
      stepTick: input.fighting.stepTick,
      takeoffs: input.fighting.takeoffs.map(captureFightingTakeoffWitness),
      landings: input.fighting.landings.map(captureFightingLandingWitness),
      contacts: input.fighting.contacts.map(captureFightingContactWitness),
    },
  });
}
function freezeDto<T>(input: T): T {
  if (Array.isArray(input)) return Object.freeze(input.map(freezeDto)) as T;
  if (input !== null && typeof input === 'object') {
    const copy = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, freezeDto(value)]),
    );
    return Object.freeze(copy) as T;
  }
  return input;
}

/** A1 structural wire. Runtime history/lifecycle and A2 geometry admission remain external. */
export interface FightingClockPoint {
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly stepTick: Tick;
  readonly atGameMs: GameTimeMs;
  readonly epochId: string;
  readonly clipId: ClipId;
  readonly activationId: AttackActivationId | null;
  readonly motionMs: DurationMs;
  readonly phase: FightingCombatantState['phase'];
  readonly posture: FightingPosture;
}
export interface FightingTransactionalClockContext
  extends FightingClockContext {
  readonly runId: RunId;
  readonly queryMode: 'interval' | 'settle' | 'bootstrap';
}
export type FightingTuple3 = readonly [number, number, number];
export type FightingQuaternion = readonly [number, number, number, number];
export interface FightingLocalTransform {
  readonly name: string;
  readonly position: FightingTuple3;
  readonly quaternion: FightingQuaternion;
  readonly scale: FightingTuple3;
}
export interface FightingSupportEntry {
  readonly side: 'L' | 'R';
  readonly planted: boolean;
  readonly local: FightingTuple3;
  readonly worldRotation: FightingQuaternion;
}
/** Fixed cardinalities (53,2) are enforced by capture, not a giant tuple type. */
export interface FightingRecipeEntry {
  readonly recipeVersion: 'actual53-ik-surface-v1';
  readonly clipId: ClipId;
  /** Historical source sample; NEVER the clock of the current selected pose. */
  readonly atMs: number;
  readonly pose: readonly FightingLocalTransform[];
  readonly support: readonly FightingSupportEntry[];
}
export interface FightingAcceptedRoot {
  readonly x: number;
  readonly z: number;
}
export interface FightingSupportContext {
  readonly supportId: string;
  readonly planeY: number;
  readonly groundClearanceM: number;
}
interface FightingPoseContextBase {
  readonly runId: RunId;
  readonly actorId: ActorId;
  readonly stepTick: Tick;
  readonly epochId: string;
  /** bootstrap ID or the exact step receiptId; not a clock/epoch. */
  readonly commitId: string;
  readonly facingBasis: Vector3;
  /** Epoch-local XZ in facingBasis. Deliberately no physical/render Y. */
  readonly acceptedRoot: FightingAcceptedRoot;
  readonly support: FightingSupportContext;
  readonly defeatEntry?: FightingRecipeEntry;
}
export type FightingPoseContext = FightingPoseContextBase &
  (
    | {
        readonly entryKind: 'initial-ready';
        readonly incoming?: never;
      }
    | {
        readonly entryKind: 'encounter-reset';
        readonly incoming?: never;
      }
    | {
        readonly entryKind: 'continuous' | 'epoch-transition';
        /** Same immutable actual outgoing entry retained throughout this epoch. */
        readonly incoming: FightingRecipeEntry;
      }
  );
export interface FightingPoseHold {
  readonly reason:
    | 'pause'
    | 'background'
    | 'inputs-released'
    | 'session-ended'
    | 'prestep-intent'
    | 'error';
  readonly displayEpochId: string;
}
/** The same immutable query reaches CPU shape sampling and visible pose application. */
export interface FightingRecipeQuery {
  readonly clipId: ClipId;
  readonly phase: FightingCombatantState['phase'];
  readonly posture: FightingPosture;
  readonly atMs: number;
  readonly acceptedRoot: FightingAcceptedRoot;
  readonly incoming?: FightingRecipeEntry;
  readonly groundClearanceM: number;
}
export interface FightingReadyActorDescriptor {
  readonly actorId: ActorId;
  readonly position: Vector3;
  readonly facingBasis: Vector3;
}
/** Bound to actual Core-issued IDs after prepare, before AssetsReady publication. */
export interface FightingReadyDescriptor {
  readonly version: 1;
  /** Opaque admitted exact pack/source-registry identity, authenticated by C/F. */
  readonly bindingSetId: string;
  readonly clipId: ClipId;
  readonly supportPlane: {
    readonly supportId: string;
    readonly planeY: number;
  };
  readonly actors: readonly FightingReadyActorDescriptor[];
  /** Measured/admitted geometry tolerance. No default chosen by A. */
  readonly surfaceToleranceM: number;
}
export interface FightingBootstrap {
  /** Explicit current subset; the admitted descriptor may also name future residents. */
  readonly residentActorIds: readonly ActorId[];
  readonly runId: RunId;
  readonly descriptor: FightingReadyDescriptor;
  readonly endpoints: readonly FightingClockPoint[];
  /** entryKind initial-ready, unique per run/actor bootstrap commitId. */
  readonly poseContexts: readonly FightingPoseContext[];
}
export interface FightingSpatialTransactionPolicy {
  readonly mode: 'battle-transaction-v1';
  readonly maxFrontiers: number;
  readonly maxSameTimeFrontiers: number;
}
export interface FightingSampledSupport extends FightingSupportEntry {
  readonly desiredWorld: FightingTuple3;
  readonly errorM: number;
  readonly world: FightingTuple3;
}
/** A2: current structural subset; explicit sole/hurt/multishape extension is C/D follow-on. */
export interface FightingRecipeGeometrySample extends FightingRecipeEntry {
  readonly durationMs: number;
  readonly active: boolean;
  readonly intendedRoot: Vector3;
  readonly acceptedRoot: Vector3;
  readonly support: readonly FightingSampledSupport[];
  readonly shape: HitVolume | null;
}
/** A2 point schemas describe evidence; structural capture NEVER authenticates a source. */
export interface FightingSourceVertex {
  readonly primitive: number;
  readonly vertexIndex: number;
}
export interface FightingSoleSurfaceBinding {
  readonly side: 'L' | 'R';
  readonly surfaceId: string;
  readonly sourceBindingId: string;
  readonly members: readonly FightingSourceVertex[];
}
export interface FightingSolePoint extends FightingSourceVertex {
  /** Posed skin, root-stripped actor-local metres. D applies physical root/facing once. */
  readonly local: Vector3;
}
export interface FightingSoleSurfaceSample {
  readonly side: 'L' | 'R';
  readonly surfaceId: string;
  readonly points: readonly FightingSolePoint[];
  /** Outward actor-local normal; physical alignment is D/F authority. */
  readonly normal: Vector3;
}
export interface FightingHurtProxySample {
  readonly kind: 'posture-capsule-proxy-v1';
  readonly posture: 'standing' | 'crouching';
  readonly volume: Extract<HitVolume, { readonly kind: 'capsule' }>;
}
export interface FightingHitShapeSample {
  readonly shapeId: string;
  readonly volume: HitVolume;
}
export interface FightingActualRecipeGeometrySample
  extends FightingRecipeGeometrySample {
  readonly geometryProtocol: 'actual-geometry-v1';
  readonly geometryBindingId: string;
  readonly soles: readonly FightingSoleSurfaceSample[];
  readonly hurt: FightingHurtProxySample;
  readonly hitShapes: readonly FightingHitShapeSample[];
}
/** Independent C/F preparation pins. Digest equality is NOT verification of asset bytes/proofs. */
export interface FightingGeometrySourcePin {
  readonly sourceBindingId: string;
  readonly clipId: ClipId;
  readonly durationMs: number;
  readonly rootPolicy:
    | 'full-translation'
    | 'grounded-posture-y'
    | 'in-place-posture-xyz';
  readonly provenance: {
    readonly sourceSha256: string;
    readonly evaluatorSha256: string;
    readonly calibrationSha256: string;
    readonly mappingSha256: string;
    readonly sourceClosureSha256: string;
    readonly qualificationEvidenceSha256: string;
  };
  /** Exact source-mapping order for the existing 53 transform entries. */
  readonly poseNames: readonly string[];
  readonly primitives: readonly {
    readonly primitive: number;
    readonly vertexCount: number;
  }[];
  readonly soles: readonly FightingSoleSurfaceBinding[];
  readonly shapeIds: readonly string[];
}
/** Point coverage only; no action duration, cycle counter or continuous-law qualification. */
export type FightingGeometryPointCoverage =
  | { readonly kind: 'finite'; readonly fromMs: 0; readonly toMs: number }
  | {
      readonly kind: 'prefix-tail';
      readonly prefixEndMs: number;
      readonly tail:
        | { readonly kind: 'constant' }
        | {
            readonly kind: 'periodic';
            readonly periodMs: number;
            readonly phaseOriginMs: number;
          };
    };
export interface FightingGeometryVariant {
  readonly geometryBindingId: string;
  readonly sourceBindingId: string;
  readonly clipId: ClipId;
  readonly phase: FightingCombatantState['phase'];
  readonly posture: FightingPosture;
  readonly coverage: FightingGeometryPointCoverage;
}
export interface FightingGeometryManifest {
  readonly schema: 'actual-geometry-manifest-v1';
  readonly bindingSetId: string;
  readonly sources: readonly FightingGeometrySourcePin[];
  readonly variants: readonly FightingGeometryVariant[];
}
export interface FightingGeometryPointLimits {
  readonly maxSources: number;
  readonly maxVariants: number;
  readonly maxPrimitivesPerSource: number;
  readonly maxSolePoints: number;
  readonly maxShapes: number;
  readonly maxImpacts: number;
}
export interface FightingGeometryManifestContext {
  readonly bindingSetId: string;
  /** Supplied independently by trusted preparation, never defaulted from the input manifest. */
  readonly sourcePins: readonly FightingGeometrySourcePin[];
  readonly limits: FightingGeometryPointLimits;
}
export interface FightingGeometrySampleContext {
  readonly query: FightingRecipeQuery;
  readonly manifest: FightingGeometryManifest;
  readonly manifestContext: FightingGeometryManifestContext;
  readonly selectedGeometryBindingId: string;
  readonly impacts: readonly MotionImpact[];
  /** D's existing proxy authority at actor-local origin; A owns no proxy dimensions. */
  readonly expectedHurtProxy: FightingHurtProxySample;
  /** Explicit measured/admitted unit-length representation error; no A epsilon/default. */
  readonly normalLengthTolerance: number;
}
/** NON-DTO point preparation only. Does not satisfy production interval/binder admission. */
export interface FightingActualRecipeSamplerPort
  extends FightingRecipeSamplerPort {
  readonly bindingSetId: string;
  sample(query: FightingRecipeQuery): FightingActualRecipeGeometrySample;
}
/** Same actor-private create/sample route, no interval method or readiness flag fabricated. */
export interface FightingActualRecipeSamplerFactory
  extends FightingRecipeSamplerFactory {
  readonly geometryManifest: FightingGeometryManifest;
  create(actorId: ActorId): FightingActualRecipeSamplerPort;
}

/** Created CPU-only rig lease. No display node/Three object crosses the contract. */
export interface FightingRecipeSamplerPort {
  readonly runId: RunId;
  readonly actorId: ActorId;
  sample(query: FightingRecipeQuery): FightingRecipeGeometrySample;
  dispose(): void;
}
/** Source pack ownership stays with F/C; D owns every created sampler lease. */
export interface FightingRecipeSamplerFactory {
  readonly runId: RunId;
  readonly bindingSetId: string;
  create(actorId: ActorId): FightingRecipeSamplerPort;
}
/** Explicit resource-binding packet: its factory is NON-DTO, never recorded. */
export interface FightingPreparedSpatialBinding {
  readonly readyDescriptor: FightingReadyDescriptor;
  readonly transactionPolicy: FightingSpatialTransactionPolicy;
  readonly recipeSamplerFactory: FightingRecipeSamplerFactory;
}
export interface FightingPreparedSpatialCapability {
  readonly version: 1;
  readonly mode: 'battle-transaction-v1';
  /** Once per run, after C/catalog preparation, before AssetsReady/public ready commit. */
  bindPrepared(binding: FightingPreparedSpatialBinding): void;
}
export interface FightingSpatialTransactionHeader {
  readonly version: 1;
  readonly transactionId: string;
  readonly runId: RunId;
  readonly stepTick: Tick;
  readonly fromGameMs: GameTimeMs;
  readonly toGameMs: GameTimeMs;
}
/**
 * Source-query reference, NOT an accepted Core clock. D copies/derives this only
 * from the named query's supplied clocks; B checks it before promoting evidence.
 */
interface FightingPoseSampleReferenceBase {
  readonly actorId: ActorId;
  readonly epochId: string;
  readonly clipId: ClipId;
  readonly activationId: AttackActivationId | null;
  readonly atGameMs: GameTimeMs;
  readonly motionMs: DurationMs;
}
export type FightingPoseSampleReference = FightingPoseSampleReferenceBase &
  (
    | {
        readonly kind: 'query';
        readonly transactionId: string;
        readonly queryRevision: number;
        readonly commitId?: never;
      }
    | {
        readonly kind: 'bootstrap' | 'installed';
        readonly commitId: string;
        readonly transactionId?: never;
        readonly queryRevision?: never;
      }
  );
export interface FightingPhysicalPosePrefix {
  readonly source: FightingPoseSampleReference;
  readonly facingBasis: Vector3;
  readonly acceptedRoot: FightingAcceptedRoot;
  readonly support: FightingSupportContext;
  readonly sample: FightingRecipeEntry;
  readonly incoming?: FightingRecipeEntry;
  readonly defeatEntry?: FightingRecipeEntry;
  readonly entryKind: FightingPoseContext['entryKind'];
}
/** Proposed physical evidence until B accepts the entire frontier/batch. */
export interface FightingPhysicalActorPrefix {
  readonly actor: SpatialActor;
  readonly pose: FightingPhysicalPosePrefix;
}
/** B joins its canonical accepted point to D's captured physical/sample evidence. */
export interface FightingAcceptedActorPrefix
  extends FightingPhysicalActorPrefix {
  readonly endpoint: FightingClockPoint;
}
/** Installed D evidence, not a speculative proposal or a fabricated query result. */
export interface FightingInstalledActorPrefix
  extends FightingAcceptedActorPrefix {
  readonly poseContext: FightingPoseContext;
}
export interface FightingInitialPrefix {
  readonly runId: RunId;
  readonly bindingSetId: string;
  readonly actors: readonly FightingInstalledActorPrefix[];
}
/** Sole explicit unswept roster/spawn discontinuity, only in zero-time settlement. */
export interface FightingEncounterReset {
  readonly resetId: string;
  readonly atGameMs: GameTimeMs;
  readonly readyDescriptor: FightingReadyDescriptor;
  readonly outgoingActorIds: readonly ActorId[];
  readonly residentActorIds: readonly ActorId[];
  readonly endpoints: readonly FightingClockPoint[];
}
/** Accepted reset history, repeated in receipt and B validation authority. */
export interface FightingTransactionResidency {
  readonly initialActorIds: readonly ActorId[];
  readonly resets: readonly FightingEncounterReset[];
}
/** B-selected classification of the interval epoch; deliberately no clock/time. */
export interface FightingSelectedPoseClassification {
  readonly actorId: ActorId;
  readonly epochId: string;
  readonly phase: FightingCombatantState['phase'];
  readonly posture: FightingPosture;
}
export interface FightingProjectInput extends FightingSpatialTransactionHeader {
  readonly encounterReset?: FightingEncounterReset;
  readonly revision: number;
  readonly acceptedProjectionId: string | null;
  readonly queryMode: 'interval' | 'settle';
  readonly cursorGameMs: GameTimeMs;
  readonly horizonGameMs: GameTimeMs;
  readonly acceptedPrefix: readonly FightingAcceptedActorPrefix[];
  /** One per actor; horizon cannot cross this selected classification boundary. */
  readonly selectedPoses: readonly FightingSelectedPoseClassification[];
  /** Current pending tick's accepted-runtime-derived planned suffix clocks. */
  readonly snapshot: GameSnapshot;
  /** Newly accepted previous complete batch only; original intents not replayed. */
  readonly acceptedEvents: readonly DomainEvent[];
  readonly settledOccurrenceIds: readonly string[];
  readonly settledPhysicalSeamIds: readonly string[];
}
export interface FightingSpatialFrontier {
  readonly projectionId: string;
  readonly revision: number;
  readonly atGameMs: GameTimeMs;
  readonly kind: 'physical' | 'contacts' | 'boundary';
  readonly occurrenceIds: readonly string[];
  readonly physicalSeamIds: readonly string[];
  readonly result: FightingSpatialStepResult;
  /**
   * Explicit wire concretization of §9 I2's required prefix references.
   * No accepted endpoint field here: D cannot author B's post-reaction runtime.
   */
  readonly acceptedPrefix: readonly FightingPhysicalActorPrefix[];
}
export interface FightingFinishInput {
  readonly acceptedProjectionId: string;
  /** Final B draft with accepted endpoint clocks; contexts are filled by receipt. */
  readonly output: CoreOutput;
}
export interface FightingSpatialCommitReceipt
  extends FightingSpatialTransactionHeader {
  readonly receiptId: string;
  readonly residency?: FightingTransactionResidency;
  readonly acceptedProjectionId: string;
  readonly outputRevision: number;
  readonly snapshot: SpatialSnapshot;
  readonly endpoints: readonly FightingClockPoint[];
  readonly poseContexts: readonly FightingPoseContext[];
}
export type FightingSpatialTransactionState =
  | 'open'
  | 'prepared'
  | 'installed'
  | 'aborted';
/** Explicit NON-DTO resource capability. NEVER clone/serialize it. */
export interface FightingSpatialTransactionPort
  extends FightingSpatialTransactionHeader {
  project(input: FightingProjectInput): FightingSpatialFrontier;
  finish(input: FightingFinishInput): FightingSpatialCommitReceipt;
  abort(): void;
}
/**
 * Explicit capability envelope carried unchanged through scene/frameLoop.
 * Inherited snapshot/candidates are proposal only; not accepted endpoint state.
 */
export interface FightingSpatialTransactionResult extends SpatialStepResult {
  readonly kind: 'fighting-spatial-transaction-v1';
  readonly initialPrefix: FightingInitialPrefix;
  readonly transaction: FightingSpatialTransactionPort;
}
export interface FightingFrontierValidationContext {
  readonly query: FightingProjectInput;
  /** Same independently captured original admitted begin, never a re-begin. */
  readonly request: SpatialStepRequest;
  readonly policy: FightingSpatialTransactionPolicy;
}
export interface FightingReceiptValidationContext {
  /** Captured original envelope authority, required to prove a carried reset origin. */
  readonly initialPrefix?: FightingInitialPrefix;
  readonly residency?: FightingTransactionResidency;
  readonly header: FightingSpatialTransactionHeader;
  readonly acceptedProjectionId: string;
  readonly output: CoreOutput;
  readonly acceptedPrefix: readonly FightingAcceptedActorPrefix[];
}
/** UTF-16 transport bounds for recorder-rejection fallback only, not gameplay or log limits. */
export const FIGHTING_UNRECORDABLE_RETURN_NAME_MAX_CODE_UNITS = 128 as const;
export const FIGHTING_UNRECORDABLE_RETURN_MESSAGE_MAX_CODE_UNITS =
  4096 as const;
export interface FightingDiagnostic {
  readonly name: string;
  readonly message: string;
}
export type FightingCallOutcome<T> =
  | { readonly kind: 'returned'; readonly value: T }
  | { readonly kind: 'threw'; readonly diagnostic: FightingDiagnostic }
  /** Port returned, but recorder rejected its non-data payload. No raw value retained. */
  | {
      readonly kind: 'unrecordable-return';
      readonly diagnostic: FightingDiagnostic;
    };
export type FightingSpatialTranscriptInteraction =
  | {
      readonly kind: 'project';
      readonly input: FightingProjectInput;
      readonly outcome: FightingCallOutcome<FightingSpatialFrontier>;
    }
  | {
      readonly kind: 'finish';
      readonly input: FightingFinishInput;
      readonly outcome: FightingCallOutcome<FightingSpatialCommitReceipt>;
    }
  | { readonly kind: 'abort'; readonly outcome: FightingCallOutcome<null> };
export interface FightingSpatialTranscript {
  readonly initialPrefix: FightingInitialPrefix;
  readonly header: FightingSpatialTransactionHeader;
  readonly proposal: SpatialStepResult;
  readonly interactions: readonly FightingSpatialTranscriptInteraction[];
  readonly terminal:
    | { readonly kind: 'success'; readonly receiptId: string }
    | { readonly kind: 'aborted'; readonly diagnostic?: FightingDiagnostic };
}

/** Public DTOs are plain own-data only. Reject getters without evaluating them. */
function ownData(value: unknown): asserts value is Record<string, unknown> {
  requireRecord(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new RangeError('Fighting DTO must be a plain record');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable
    )
      throw new RangeError(
        'Fighting DTO must contain only enumerable own data',
      );
  }
}
function denseArray(value: unknown): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new RangeError('Expected plain fighting array');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value'))
      throw new RangeError('Sparse/accessor fighting array');
  }
  if (Reflect.ownKeys(value).length !== value.length + 1)
    throw new RangeError('Unexpected fighting array properties');
}
function assertPureData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new RangeError('Non-data or recursive fighting DTO');
  ancestors.add(value);
  if (Array.isArray(value)) {
    denseArray(value);
    for (const item of value) assertPureData(item, ancestors);
  } else {
    ownData(value);
    for (const item of Object.values(value)) assertPureData(item, ancestors);
  }
  ancestors.delete(value);
}
function freezeDetached(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freezeDetached(item);
    Object.freeze(value);
  }
}
/** Generic snapshot/event subtrees admit plain-data extensions only, never resources. */
function detachedData<T>(input: T): T {
  assertPureData(input);
  const copy = structuredClone(input);
  freezeDetached(copy);
  return copy;
}
function exactFields(input: unknown, fields: readonly string[]): void {
  ownData(input);
  if (Object.keys(input).some((key) => !fields.includes(key)))
    throw new RangeError('Unexpected fighting authority field');
}
function finite(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new RangeError('Expected finite fighting number');
  return value;
}
function tuple3(value: FightingTuple3): FightingTuple3 {
  denseArray(value);
  if (value.length !== 3) throw new RangeError('Expected three components');
  return Object.freeze([finite(value[0]), finite(value[1]), finite(value[2])]);
}
function quaternion(value: FightingQuaternion): FightingQuaternion {
  denseArray(value);
  if (value.length !== 4)
    throw new RangeError('Expected four quaternion components');
  const result: FightingQuaternion = [
    finite(value[0]),
    finite(value[1]),
    finite(value[2]),
    finite(value[3]),
  ];
  if (Math.abs(Math.hypot(...result) - 1) > 1e-5)
    throw new RangeError('Expected unit quaternion');
  return Object.freeze(result);
}
function facing(value: Vector3): Vector3 {
  const result = vector(value);
  if (result.y !== 0 || Math.abs(Math.hypot(result.x, result.z) - 1) > 1e-5)
    throw new RangeError('Expected horizontal unit facing basis');
  return result;
}
function acceptedRoot(value: FightingAcceptedRoot): FightingAcceptedRoot {
  exactFields(value, ['x', 'z']);
  return Object.freeze({ x: finite(value.x), z: finite(value.z) });
}
function phase(
  value: FightingCombatantState['phase'],
): FightingCombatantState['phase'] {
  return member(value, [
    'neutral',
    'startup',
    'active',
    'recovery',
    'hitstun',
    'blockstun',
    'landing',
    'defeated',
  ]);
}
function posture(value: FightingPosture): FightingPosture {
  return member(value, ['standing', 'crouching', 'airborne']);
}
function uniqueIds(values: readonly string[]): readonly string[] {
  denseArray(values);
  const ids = values.map(text);
  if (new Set(ids).size !== ids.length)
    throw new RangeError('Duplicate fighting identities');
  return Object.freeze(ids);
}
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  )
    return false;
  const keys = Object.keys(a),
    other = Object.keys(b);
  if (keys.length !== other.length) return false;
  const av = Object.getOwnPropertyDescriptors(a),
    bv = Object.getOwnPropertyDescriptors(b);
  return keys.every(
    (key) => Object.hasOwn(bv, key) && sameData(av[key]?.value, bv[key]?.value),
  );
}
function requireEqual(a: unknown, b: unknown, message: string): void {
  if (!sameData(a, b)) throw new RangeError(message);
}
function bijection(ids: readonly string[], expected: readonly string[]): void {
  uniqueIds(ids);
  uniqueIds(expected);
  if (
    ids.length !== expected.length ||
    ids.some((id) => !expected.includes(id))
  )
    throw new RangeError('Fighting resident actor bijection required');
}
export function captureFightingClockPoint(
  input: FightingClockPoint,
): FightingClockPoint {
  assertPureData(input);
  ownData(input);
  return Object.freeze({
    runId: runId(text(input.runId)),
    actorId: actorId(text(input.actorId)),
    stepTick: tick(input.stepTick),
    atGameMs: gameTimeMs(input.atGameMs),
    epochId: text(input.epochId),
    clipId: clipId(text(input.clipId)),
    activationId:
      input.activationId === null
        ? null
        : attackActivationId(text(input.activationId)),
    motionMs: durationMs(input.motionMs),
    phase: phase(input.phase),
    posture: posture(input.posture),
  });
}
export function captureFightingTransactionalClock(
  input: FightingClock,
  context: FightingTransactionalClockContext,
): FightingClock & { readonly endpoint: FightingClockPoint } {
  assertPureData(context);
  ownData(context);
  runId(text(context.runId));
  member(context.queryMode, ['interval', 'settle', 'bootstrap']);
  if (
    (context.queryMode === 'interval') !==
      context.fromGameMs < context.toGameMs ||
    (context.queryMode !== 'interval' &&
      context.fromGameMs !== context.toGameMs) ||
    (context.queryMode === 'bootstrap' &&
      (context.fromGameMs !== 0 || context.stepTick !== 0))
  )
    throw new RangeError('Query mode and exact clock interval disagree');
  const clock = captureFightingClock(input, context);
  if (!clock.endpoint || clock.endpoint.runId !== context.runId)
    throw new RangeError('Missing or foreign transactional endpoint');
  return Object.freeze({ ...clock, endpoint: clock.endpoint });
}
export function captureFightingRecipeEntry(
  input: FightingRecipeEntry,
): FightingRecipeEntry {
  assertPureData(input);
  exactFields(input, ['recipeVersion', 'clipId', 'atMs', 'pose', 'support']);
  if (input.recipeVersion !== 'actual53-ik-surface-v1')
    throw new RangeError('Unknown fighting recipe version');
  denseArray(input.pose);
  denseArray(input.support);
  if (input.pose.length !== 53 || input.support.length !== 2)
    throw new RangeError('Expected exactly 53 TRS and two feet');
  const pose = input.pose.map((value) => {
    exactFields(value, ['name', 'position', 'quaternion', 'scale']);
    const scale = tuple3(value.scale);
    if (scale.some((component) => component <= 0))
      throw new RangeError('Expected positive scales');
    return Object.freeze({
      name: text(value.name),
      position: tuple3(value.position),
      quaternion: quaternion(value.quaternion),
      scale,
    });
  });
  uniqueIds(pose.map((p) => p.name));
  const support = input.support.map((value) => {
    exactFields(value, ['side', 'planted', 'local', 'worldRotation']);
    return Object.freeze({
      side: member(value.side, ['L', 'R']),
      planted: boolean(value.planted),
      local: tuple3(value.local),
      worldRotation: quaternion(value.worldRotation),
    });
  });
  bijection(
    support.map((s) => s.side),
    ['L', 'R'],
  );
  return Object.freeze({
    recipeVersion: input.recipeVersion,
    clipId: clipId(text(input.clipId)),
    atMs: nonnegative(input.atMs),
    pose: Object.freeze(pose),
    support: Object.freeze(support),
  });
}
export function captureFightingSupportContext(
  input: FightingSupportContext,
): FightingSupportContext {
  assertPureData(input);
  exactFields(input, ['supportId', 'planeY', 'groundClearanceM']);
  return Object.freeze({
    supportId: text(input.supportId),
    planeY: finite(input.planeY),
    groundClearanceM: nonnegative(input.groundClearanceM),
  });
}
function captureEntries(
  input: Pick<
    FightingPhysicalPosePrefix,
    'entryKind' | 'incoming' | 'defeatEntry'
  >,
) {
  const entryKind = member(input.entryKind, [
    'initial-ready',
    'encounter-reset',
    'continuous',
    'epoch-transition',
  ]);
  if (
    (entryKind === 'initial-ready' || entryKind === 'encounter-reset') !==
    (input.incoming === undefined)
  )
    throw new RangeError('Incoming omission is bootstrap/reset-only');
  const defeat =
    input.defeatEntry === undefined
      ? {}
      : { defeatEntry: captureFightingRecipeEntry(input.defeatEntry) };
  if (entryKind === 'initial-ready' || entryKind === 'encounter-reset')
    return { entryKind, ...defeat };
  if (!input.incoming) throw new RangeError('Actual incoming sample required');
  return {
    entryKind,
    incoming: captureFightingRecipeEntry(input.incoming),
    ...defeat,
  };
}
export function captureFightingPoseContext(
  input: FightingPoseContext,
): FightingPoseContext {
  assertPureData(input);
  exactFields(input, [
    'runId',
    'actorId',
    'stepTick',
    'epochId',
    'commitId',
    'entryKind',
    'facingBasis',
    'acceptedRoot',
    'support',
    'incoming',
    'defeatEntry',
  ]);
  return Object.freeze({
    runId: runId(text(input.runId)),
    actorId: actorId(text(input.actorId)),
    stepTick: tick(input.stepTick),
    epochId: text(input.epochId),
    commitId: text(input.commitId),
    facingBasis: facing(input.facingBasis),
    acceptedRoot: acceptedRoot(input.acceptedRoot),
    support: captureFightingSupportContext(input.support),
    ...captureEntries(input),
  });
}
export function captureFightingPoseHold(
  input: FightingPoseHold,
): FightingPoseHold {
  assertPureData(input);
  exactFields(input, ['reason', 'displayEpochId']);
  return Object.freeze({
    reason: member(input.reason, [
      'pause',
      'background',
      'inputs-released',
      'session-ended',
      'prestep-intent',
      'error',
    ]),
    displayEpochId: text(input.displayEpochId),
  });
}
export function captureFightingReadyDescriptor(
  input: FightingReadyDescriptor,
): FightingReadyDescriptor {
  assertPureData(input);
  ownData(input);
  if (input.version !== 1)
    throw new RangeError('Unknown ready descriptor version');
  ownData(input.supportPlane);
  denseArray(input.actors);
  const planeY = finite(input.supportPlane.planeY),
    tolerance = nonnegative(input.surfaceToleranceM);
  const actors = input.actors.map((a) => {
    ownData(a);
    const position = vector(a.position);
    if (Math.abs(position.y - planeY) > tolerance)
      throw new RangeError('Ready spawn must lie on admitted plane');
    return Object.freeze({
      actorId: actorId(text(a.actorId)),
      position,
      facingBasis: facing(a.facingBasis),
    });
  });
  uniqueIds(actors.map((a) => a.actorId));
  if (!actors.length) throw new RangeError('Empty ready actor set');
  return Object.freeze({
    version: 1,
    bindingSetId: text(input.bindingSetId),
    clipId: clipId(text(input.clipId)),
    supportPlane: Object.freeze({
      supportId: text(input.supportPlane.supportId),
      planeY,
    }),
    actors: Object.freeze(actors),
    surfaceToleranceM: tolerance,
  });
}
export function captureFightingBootstrap(
  input: FightingBootstrap,
): FightingBootstrap {
  assertPureData(input);
  ownData(input);
  const run = runId(text(input.runId)),
    descriptor = captureFightingReadyDescriptor(input.descriptor);
  denseArray(input.endpoints);
  denseArray(input.poseContexts);
  const endpoints = input.endpoints.map(captureFightingClockPoint),
    poseContexts = input.poseContexts.map(captureFightingPoseContext);
  const ids = captureActorIds(input.residentActorIds);
  admittedResidents(ids, descriptor);
  bijection(
    endpoints.map((p) => p.actorId),
    ids,
  );
  bijection(
    poseContexts.map((p) => p.actorId),
    ids,
  );
  uniqueIds(poseContexts.map((p) => p.commitId));
  for (const point of endpoints) {
    const context = poseContexts.find((p) => p.actorId === point.actorId),
      spawn = descriptor.actors.find((a) => a.actorId === point.actorId);
    if (
      !context ||
      !spawn ||
      point.runId !== run ||
      point.stepTick !== 0 ||
      point.atGameMs !== 0 ||
      point.motionMs !== 0 ||
      point.clipId !== descriptor.clipId ||
      point.activationId !== null ||
      point.phase !== 'neutral' ||
      point.posture !== 'standing' ||
      context.runId !== run ||
      context.stepTick !== 0 ||
      context.epochId !== point.epochId ||
      context.entryKind !== 'initial-ready' ||
      context.defeatEntry ||
      context.acceptedRoot.x !== 0 ||
      context.acceptedRoot.z !== 0 ||
      context.support.groundClearanceM !== 0 ||
      context.support.supportId !== descriptor.supportPlane.supportId ||
      context.support.planeY !== descriptor.supportPlane.planeY
    )
      throw new RangeError('Invalid initial-ready bootstrap authority');
    requireEqual(
      context.facingBasis,
      spawn.facingBasis,
      'Bootstrap basis differs',
    );
  }
  return Object.freeze({
    runId: run,
    descriptor,
    residentActorIds: ids,
    endpoints: Object.freeze(endpoints),
    poseContexts: Object.freeze(poseContexts),
  });
}
export function captureFightingSpatialTransactionPolicy(
  input: FightingSpatialTransactionPolicy,
): FightingSpatialTransactionPolicy {
  assertPureData(input);
  ownData(input);
  if (
    input.mode !== 'battle-transaction-v1' ||
    tick(input.maxFrontiers) === 0 ||
    tick(input.maxSameTimeFrontiers) === 0
  )
    throw new RangeError('Invalid explicit transaction work policy');
  return Object.freeze({
    mode: input.mode,
    maxFrontiers: input.maxFrontiers,
    maxSameTimeFrontiers: input.maxSameTimeFrontiers,
  });
}

function validateTransactionHeader(
  input: unknown,
): asserts input is FightingSpatialTransactionHeader {
  ownData(input);
  if (
    input.version !== 1 ||
    typeof input.stepTick !== 'number' ||
    typeof input.fromGameMs !== 'number' ||
    typeof input.toGameMs !== 'number'
  )
    throw new RangeError('Invalid transaction header');
  text(input.transactionId);
  text(input.runId);
  tick(input.stepTick);
  gameTimeMs(input.fromGameMs);
  gameTimeMs(input.toGameMs);
  if (input.fromGameMs >= input.toGameMs)
    throw new RangeError(
      'Transaction must retain a positive original interval',
    );
}
function captureHeader(
  input: FightingSpatialTransactionHeader,
): FightingSpatialTransactionHeader {
  validateTransactionHeader(input);
  return Object.freeze({
    version: 1,
    transactionId: text(input.transactionId),
    runId: runId(text(input.runId)),
    stepTick: tick(input.stepTick),
    fromGameMs: gameTimeMs(input.fromGameMs),
    toGameMs: gameTimeMs(input.toGameMs),
  });
}
function requestMatches(
  header: FightingSpatialTransactionHeader,
  request: SpatialStepRequest,
): void {
  assertPureData(request);
  const to = gameTimeMs(request.snapshot.clocks.gameTimeMs),
    duration = durationMs(request.step.durationMs);
  // Preserve the installed boundary; floating-point subtraction is not invertible.
  if (
    header.runId !== request.snapshot.runId ||
    header.stepTick !== request.snapshot.clocks.tick ||
    header.toGameMs !== to ||
    duration !== header.toGameMs - header.fromGameMs
  )
    throw new RangeError('Transaction differs from original admitted begin');
  residentIds(request.snapshot);
}
function residentIds(snapshot: GameSnapshot): readonly ActorId[] {
  ownData(snapshot);
  ownData(snapshot.world);
  ownData(snapshot.clocks);
  tick(snapshot.revision);
  tick(snapshot.clocks.tick);
  gameTimeMs(snapshot.clocks.gameTimeMs);
  runId(text(snapshot.runId));
  denseArray(snapshot.actors);
  denseArray(snapshot.world.vehicles);
  denseArray(snapshot.world.objects);
  if (
    snapshot.contractVersion !== 1 ||
    snapshot.world.vehicles.length ||
    snapshot.world.objects.length
  )
    throw new RangeError('Strict fighting requires an empty battle world');
  const all = snapshot.actors.map((a) => {
    ownData(a);
    return actorId(text(a.actorId));
  });
  uniqueIds(all);
  const residents = snapshot.residentActorIds ?? all;
  uniqueIds(residents);
  if (!residents.length || residents.some((id) => !all.includes(id)))
    throw new RangeError('Invalid fighting residency');
  return residents;
}
function captureSpatialActor(input: SpatialActor): SpatialActor {
  ownData(input);
  if (input.pose !== undefined) ownData(input.pose);
  return Object.freeze({
    actorId: actorId(text(input.actorId)),
    position: vector(input.position),
    facing: facing(input.facing),
    velocity: vector(input.velocity),
    grounded: boolean(input.grounded),
    locomotion: member(input.locomotion, [
      'idle',
      'walk',
      'run',
      'jump',
      'crouch',
    ]),
    ...(input.pose !== undefined ? { pose: detachedData(input.pose) } : {}),
  });
}
function captureSpatialSnapshot(
  input: SpatialSnapshot,
  header: FightingSpatialTransactionHeader,
  ids: readonly ActorId[],
): SpatialSnapshot {
  ownData(input);
  denseArray(input.actors);
  denseArray(input.vehicles);
  if (
    input.runId !== header.runId ||
    tick(input.tick) !== header.stepTick ||
    input.vehicles.length
  )
    throw new RangeError('Foreign or mixed-world physical snapshot');
  const actors = input.actors.map(captureSpatialActor);
  bijection(
    actors.map((a) => a.actorId),
    ids,
  );
  return Object.freeze({
    runId: header.runId,
    tick: header.stepTick,
    actors: Object.freeze(actors),
    vehicles: Object.freeze([]),
  });
}
function captureSampleReference(
  input: FightingPoseSampleReference,
): FightingPoseSampleReference {
  ownData(input);
  const shared = {
    actorId: actorId(text(input.actorId)),
    epochId: text(input.epochId),
    clipId: clipId(text(input.clipId)),
    activationId:
      input.activationId === null
        ? null
        : attackActivationId(text(input.activationId)),
    atGameMs: gameTimeMs(input.atGameMs),
    motionMs: durationMs(input.motionMs),
  };
  const fields = [
    'kind',
    'actorId',
    'epochId',
    'clipId',
    'activationId',
    'atGameMs',
    'motionMs',
  ];
  if (input.kind === 'query') {
    exactFields(input, [...fields, 'transactionId', 'queryRevision']);
    return Object.freeze({
      ...shared,
      kind: input.kind,
      transactionId: text(input.transactionId),
      queryRevision: tick(input.queryRevision),
    });
  }
  if (input.kind === 'bootstrap' || input.kind === 'installed') {
    exactFields(input, [...fields, 'commitId']);
    return Object.freeze({
      ...shared,
      kind: input.kind,
      commitId: text(input.commitId),
    });
  }
  throw new RangeError('Unknown physical sample provenance');
}
function capturePhysicalPrefix(
  input: FightingPhysicalActorPrefix,
): FightingPhysicalActorPrefix {
  ownData(input);
  ownData(input.pose);
  const actor = captureSpatialActor(input.actor),
    source = captureSampleReference(input.pose.source);
  const support = captureFightingSupportContext(input.pose.support),
    sample = captureFightingRecipeEntry(input.pose.sample);
  if (
    source.actorId !== actor.actorId ||
    source.clipId !== sample.clipId ||
    source.motionMs !== sample.atMs ||
    actor.position.y - support.planeY !== support.groundClearanceM
  )
    throw new RangeError('Physical/sample/support prefix mismatch');
  return Object.freeze({
    actor,
    pose: Object.freeze({
      source,
      support,
      sample,
      facingBasis: facing(input.pose.facingBasis),
      acceptedRoot: acceptedRoot(input.pose.acceptedRoot),
      ...captureEntries(input.pose),
    }),
  });
}
function sourceMatchesPoint(
  source: FightingPoseSampleReference,
  point: FightingClockPoint,
): void {
  if (
    source.actorId !== point.actorId ||
    source.epochId !== point.epochId ||
    source.clipId !== point.clipId ||
    source.activationId !== point.activationId ||
    source.atGameMs !== point.atGameMs ||
    source.motionMs !== point.motionMs
  )
    throw new RangeError(
      'Sample reference is not the accepted canonical point',
    );
}
function captureAcceptedPrefix(
  input: FightingAcceptedActorPrefix,
): FightingAcceptedActorPrefix {
  const physical = capturePhysicalPrefix(input),
    endpoint = captureFightingClockPoint(input.endpoint);
  sourceMatchesPoint(physical.pose.source, endpoint);
  return Object.freeze({ ...physical, endpoint });
}
export function captureFightingProjectInput(
  input: FightingProjectInput,
): FightingProjectInput {
  assertPureData(input);
  ownData(input);
  const header = captureHeader(input),
    revision = tick(input.revision);
  const cursor = gameTimeMs(input.cursorGameMs),
    horizon = gameTimeMs(input.horizonGameMs);
  const mode = member(input.queryMode, ['interval', 'settle']);
  if (
    cursor < header.fromGameMs ||
    horizon > header.toGameMs ||
    cursor > horizon ||
    (mode === 'interval' ? cursor === horizon : cursor !== horizon) ||
    (revision === 0
      ? input.acceptedProjectionId !== null || cursor !== header.fromGameMs
      : input.acceptedProjectionId === null)
  )
    throw new RangeError('Invalid projection revision/acknowledgement/horizon');
  const acceptedProjectionId =
    input.acceptedProjectionId === null
      ? null
      : text(input.acceptedProjectionId);
  const ids = residentIds(input.snapshot);
  if (
    input.snapshot.runId !== header.runId ||
    input.snapshot.clocks.tick !== header.stepTick
  )
    throw new RangeError('Current suffix must use pending run/tick');
  denseArray(input.acceptedPrefix);
  denseArray(input.selectedPoses);
  denseArray(input.acceptedEvents);
  if (revision === 0 && input.acceptedEvents.length)
    throw new RangeError('First query has no previously accepted batch');
  uniqueIds(input.acceptedEvents.map((event) => text(event.eventId)));
  let previousSequence = -1;
  for (const event of input.acceptedEvents) {
    ownData(event);
    if (
      event.runId !== header.runId ||
      gameTimeMs(event.at) !== cursor ||
      tick(event.sequence) <= previousSequence ||
      event.type === 'VehicleLaunchApproved' ||
      event.type === 'DestructionCounted'
    )
      throw new RangeError(
        'Foreign, replayed or mixed-world accepted event provenance',
      );
    previousSequence = event.sequence;
  }
  const prefix = input.acceptedPrefix.map(captureAcceptedPrefix);
  const encounterReset =
    input.encounterReset === undefined
      ? undefined
      : captureFightingEncounterReset(input.encounterReset, header);
  if (
    encounterReset &&
    (mode !== 'settle' ||
      cursor !== encounterReset.atGameMs ||
      horizon !== cursor)
  )
    throw new RangeError(
      'Encounter reset is an exact zero-time settlement only',
    );
  const selected = input.selectedPoses.map((p) => {
    exactFields(p, ['actorId', 'epochId', 'phase', 'posture']);
    return Object.freeze({
      actorId: actorId(text(p.actorId)),
      epochId: text(p.epochId),
      phase: phase(p.phase),
      posture: posture(p.posture),
    });
  });
  bijection(
    prefix.map((p) => p.actor.actorId),
    encounterReset?.outgoingActorIds ?? ids,
  );
  if (encounterReset) bijection(encounterReset.residentActorIds, ids);
  bijection(
    selected.map((p) => p.actorId),
    ids,
  );
  for (const p of prefix) {
    if (
      p.endpoint.runId !== header.runId ||
      p.endpoint.stepTick > header.stepTick ||
      p.endpoint.atGameMs !== cursor ||
      // Revision zero retains authenticated installed evidence from the prior transaction.
      // Its source revision must not be relabeled into the new attempt.
      (revision === 0
        ? p.endpoint.stepTick >= header.stepTick ||
          (p.pose.source.kind === 'query' &&
            p.pose.source.transactionId === header.transactionId)
        : p.endpoint.stepTick !== header.stepTick ||
          p.pose.source.kind !== 'query' ||
          p.pose.source.transactionId !== header.transactionId ||
          p.pose.source.queryRevision !== revision - 1)
    )
      throw new RangeError(
        'Prefix is not prior accepted evidence at this cursor',
      );
  }
  const actors = input.snapshot.actors.map((a) => {
    if (!ids.includes(a.actorId)) return detachedData(a);
    if (!a.fightingClock) throw new RangeError('Missing current suffix clock');
    const clock = captureFightingTransactionalClock(a.fightingClock, {
      runId: header.runId,
      actorId: a.actorId,
      stepTick: header.stepTick,
      fromGameMs: cursor,
      toGameMs: horizon,
      queryMode: mode,
    });
    if (encounterReset) {
      requireEqual(
        clock.endpoint,
        encounterReset.endpoints.find((p) => p.actorId === a.actorId),
        'Reset query clock differs from declared ready point',
      );
      const prior = prefix.find((p) => p.actor.actorId === a.actorId);
      if (prior?.endpoint.epochId === clock.endpoint.epochId)
        throw new RangeError('Reset must select a fresh ready epoch');
    }
    const classification = selected.find((p) => p.actorId === a.actorId);
    if (
      !classification ||
      (mode === 'interval'
        ? clock.slices.some((s) => s.epochId !== classification.epochId)
        : classification.epochId !== clock.endpoint.epochId ||
          classification.phase !== clock.endpoint.phase ||
          classification.posture !== clock.endpoint.posture)
    )
      throw new RangeError(
        'Selected pose classification crosses the query boundary',
      );
    if (a.fighting !== undefined) {
      const selectedState = captureFightingCombatantState(a.fighting);
      if (
        selectedState.phase !== classification.phase ||
        selectedState.posture !== classification.posture
      )
        throw new RangeError(
          'Selected interval classification differs from Core state at cursor',
        );
    }
    return { ...detachedData(a), fightingClock: clock };
  });
  return detachedData({
    ...header,
    revision,
    acceptedProjectionId,
    queryMode: mode,
    cursorGameMs: cursor,
    horizonGameMs: horizon,
    acceptedPrefix: prefix,
    ...(encounterReset ? { encounterReset } : {}),
    selectedPoses: selected,
    snapshot: { ...input.snapshot, actors },
    acceptedEvents: input.acceptedEvents,
    settledOccurrenceIds: uniqueIds(input.settledOccurrenceIds),
    settledPhysicalSeamIds: uniqueIds(input.settledPhysicalSeamIds),
  });
}
function validateImpact(input: ImpactReference, ids: readonly ActorId[]): void {
  ownData(input);
  actorId(text(input.actorId));
  attackActivationId(text(input.activationId));
  impactId(text(input.impactId));
  if (!ids.includes(input.actorId))
    throw new RangeError('Foreign fighting impact actor');
}
function validateBattleCandidate(
  candidate: SpatialCandidate,
  header: FightingSpatialTransactionHeader,
  ids: readonly ActorId[],
): void {
  ownData(candidate);
  ownData(candidate.interval);
  contactId(text(candidate.contactId));
  vector(candidate.point);
  const at = gameTimeMs(candidate.at),
    from = gameTimeMs(candidate.interval.from),
    to = gameTimeMs(candidate.interval.to);
  member(candidate.evidence, ['swept-shape', 'overlap']);
  if (
    candidate.runId !== header.runId ||
    from > at ||
    at > to ||
    from < header.fromGameMs ||
    to > header.toGameMs
  )
    throw new RangeError('Foreign fighting contact interval');
  if (candidate.kind === 'body-hit') {
    validateImpact(candidate.source, ids);
    actorId(text(candidate.targetActorId));
    if (
      !ids.includes(candidate.targetActorId) ||
      candidate.source.actorId === candidate.targetActorId
    )
      throw new RangeError('Foreign/self body contact');
  } else if (candidate.kind === 'clash') {
    validateImpact(candidate.first, ids);
    validateImpact(candidate.second, ids);
    if (candidate.first.actorId === candidate.second.actorId)
      throw new RangeError('Self clash');
  } else throw new RangeError('Unsupported mixed-world fighting candidate');
}
function sourceFromQuery(
  query: FightingProjectInput,
  id: ActorId,
  at: GameTimeMs,
): FightingPoseSampleReference {
  const clock = query.snapshot.actors.find(
    (a) => a.actorId === id,
  )?.fightingClock;
  if (!clock?.endpoint) throw new RangeError('Missing source clock');
  if (at === query.horizonGameMs)
    return Object.freeze({
      kind: 'query',
      transactionId: query.transactionId,
      queryRevision: query.revision,
      actorId: id,
      epochId: clock.endpoint.epochId,
      clipId: clock.endpoint.clipId,
      activationId: clock.endpoint.activationId,
      atGameMs: at,
      motionMs: clock.endpoint.motionMs,
    });
  const slice = clock.slices.find((s) => at >= s.fromGameMs && at < s.toGameMs);
  if (!slice) throw new RangeError('Source reference outside supplied clock');
  const motion =
    slice.fromMotionMs +
    (slice.toMotionMs - slice.fromMotionMs) *
      ((at - slice.fromGameMs) / (slice.toGameMs - slice.fromGameMs));
  return Object.freeze({
    kind: 'query',
    transactionId: query.transactionId,
    queryRevision: query.revision,
    actorId: id,
    epochId: slice.epochId,
    clipId: slice.clipId,
    activationId: slice.activationId,
    atGameMs: at,
    motionMs: durationMs(motion),
  });
}
export function captureFightingSpatialFrontier(
  input: FightingSpatialFrontier,
  context: FightingFrontierValidationContext,
): FightingSpatialFrontier {
  assertPureData(input);
  assertPureData(context);
  ownData(input);
  const q = captureFightingProjectInput(context.query);
  captureFightingSpatialTransactionPolicy(context.policy);
  requestMatches(q, context.request);
  const at = gameTimeMs(input.atGameMs),
    kind = member(input.kind, ['physical', 'contacts', 'boundary']);
  const projectionId = text(input.projectionId);
  if (
    tick(input.revision) !== q.revision ||
    projectionId === q.acceptedProjectionId ||
    at < q.cursorGameMs ||
    at > q.horizonGameMs ||
    (kind === 'boundary' && at !== q.horizonGameMs)
  )
    throw new RangeError('Stale or out-of-horizon frontier');
  const occurrences = uniqueIds(input.occurrenceIds),
    seams = uniqueIds(input.physicalSeamIds);
  if (
    occurrences.some((id) => q.settledOccurrenceIds.includes(id)) ||
    seams.some((id) => q.settledPhysicalSeamIds.includes(id))
  )
    throw new RangeError('Already settled frontier occurrence');
  validateFightingSpatial(input.result);
  const ids = residentIds(q.snapshot),
    snapshot = captureSpatialSnapshot(input.result.snapshot, q, ids);
  denseArray(input.acceptedPrefix);
  const prefix = input.acceptedPrefix.map(capturePhysicalPrefix);
  bijection(
    prefix.map((p) => p.actor.actorId),
    ids,
  );
  const takeoffs = input.result.fighting.takeoffs.map(
      captureFightingTakeoffWitness,
    ),
    landings = input.result.fighting.landings.map(
      captureFightingLandingWitness,
    );
  const contacts = input.result.fighting.contacts.map(
    captureFightingContactWitness,
  );
  uniqueIds(input.result.candidates.map((c) => c.contactId));
  for (const c of input.result.candidates) {
    validateBattleCandidate(c, q, ids);
    if (
      c.at !== at ||
      at === q.toGameMs ||
      c.interval.from < q.cursorGameMs ||
      c.interval.to > q.horizonGameMs
    )
      throw new RangeError('Contact is not owned by this exact-time query');
  }
  for (const w of [...takeoffs, ...landings, ...contacts])
    if (w.atGameMs !== at) throw new RangeError('Witness not at frontier');
  for (const contact of contacts) {
    const source = snapshot.actors.find(
      (a) => a.actorId === contact.sourceActorId,
    );
    const target = snapshot.actors.find(
      (a) => a.actorId === contact.targetActorId,
    );
    if (!source || !target)
      throw new RangeError('Missing contact physical actors');
    requireEqual(
      contact.sourcePosition,
      source.position,
      'Contact source position differs from physical cut',
    );
    requireEqual(
      contact.targetPosition,
      target.position,
      'Contact target position differs from physical cut',
    );
    requireEqual(
      contact.sourceFacing,
      source.facing,
      'Contact source facing differs from physical cut',
    );
    requireEqual(
      contact.targetFacing,
      target.facing,
      'Contact target facing differs from physical cut',
    );
  }
  if (
    (kind === 'physical' &&
      (!seams.length ||
        (!takeoffs.length && !landings.length) ||
        input.result.candidates.length ||
        occurrences.length)) ||
    (kind === 'contacts' &&
      (!occurrences.length ||
        !input.result.candidates.length ||
        takeoffs.length ||
        landings.length ||
        seams.length)) ||
    (kind === 'boundary' &&
      (seams.length ||
        occurrences.length ||
        takeoffs.length ||
        landings.length ||
        input.result.candidates.length)) ||
    (kind === 'physical' &&
      seams.length !== takeoffs.length + landings.length) ||
    (kind === 'contacts' &&
      occurrences.length !== input.result.candidates.length)
  )
    throw new RangeError('Incomplete or mixed frontier batch');
  for (const p of prefix) {
    requireEqual(
      p.actor,
      snapshot.actors.find((a) => a.actorId === p.actor.actorId),
      'Frontier physical prefix substituted',
    );
    requireEqual(
      p.pose.source,
      sourceFromQuery(q, p.actor.actorId, at),
      'Frontier source not supplied by current query',
    );
    if (q.encounterReset) {
      if (kind !== 'boundary' || at !== q.encounterReset.atGameMs)
        throw new RangeError(
          'Reset frontier cannot integrate or return contact/physical seams',
        );
      validateResetPhysical(p, q.encounterReset);
      continue;
    }
    const prior = q.acceptedPrefix.find(
      (a) => a.actor.actorId === p.actor.actorId,
    );
    if (!prior) throw new RangeError('Missing physical prefix');
    if (p.pose.entryKind === 'encounter-reset')
      requireSameResetOrigin(p.pose, prior.pose, prior.endpoint);
    let grounded = prior.actor.grounded;
    for (const w of takeoffs)
      if (w.actorId === p.actor.actorId) {
        grounded = false;
        requireEqual(w.position, p.actor.position, 'Takeoff position mismatch');
      }
    for (const w of landings)
      if (w.actorId === p.actor.actorId) {
        const source = sourceFromQuery(q, p.actor.actorId, at);
        if (
          w.airborneActivationId !== source.activationId ||
          w.supportId !== p.pose.support.supportId ||
          p.pose.support.groundClearanceM !== 0
        )
          throw new RangeError(
            'Landing not supported by current suffix/support',
          );
        grounded = true;
        requireEqual(w.position, p.actor.position, 'Landing position mismatch');
      }
    if (p.actor.grounded !== grounded)
      throw new RangeError('Grounded state lacks accepted seam history');
    if (
      p.pose.support.supportId !== prior.pose.support.supportId ||
      p.pose.support.planeY !== prior.pose.support.planeY
    )
      throw new RangeError('Changing support planes is unqualified');
    if (
      q.queryMode === 'settle' &&
      (!sameData(p.actor.position, prior.actor.position) ||
        !sameData(p.actor.velocity, prior.actor.velocity))
    )
      throw new RangeError('Settlement cannot integrate physical motion');
  }
  return detachedData({
    projectionId,
    revision: q.revision,
    atGameMs: at,
    kind,
    occurrenceIds: occurrences,
    physicalSeamIds: seams,
    acceptedPrefix: prefix,
    result: {
      snapshot,
      candidates: input.result.candidates,
      fighting: { stepTick: q.stepTick, takeoffs, landings, contacts },
    },
  });
}

export function captureFightingSpatialCommitReceipt(
  input: FightingSpatialCommitReceipt,
  context: FightingReceiptValidationContext,
): FightingSpatialCommitReceipt {
  assertPureData(input);
  assertPureData(context);
  ownData(input);
  const header = captureHeader(input);
  requireEqual(
    header,
    captureHeader(context.header),
    'Receipt belongs to another attempt',
  );
  const receiptId = text(input.receiptId),
    acceptedProjectionId = text(input.acceptedProjectionId),
    outputRevision = tick(input.outputRevision);
  const output = context.output.snapshot,
    ids = residentIds(output);
  const publicTime = gameTimeMs(output.clocks.gameTimeMs);
  if (publicTime < header.fromGameMs || publicTime > header.toGameMs)
    throw new RangeError('Final public time outside original interval');
  if (
    acceptedProjectionId !== context.acceptedProjectionId ||
    outputRevision !== output.revision ||
    output.runId !== header.runId ||
    output.clocks.tick !== header.stepTick
  )
    throw new RangeError('Receipt is not for this exact final output');
  requireEqual(
    input.residency,
    context.residency,
    'Receipt residency differs from accepted B history',
  );
  const residency =
    input.residency === undefined
      ? undefined
      : captureResidency(input.residency, header, ids);
  const initialPrefix =
    context.initialPrefix === undefined
      ? undefined
      : captureFightingInitialPrefix(
          context.initialPrefix,
          header,
          residency?.residency.initialActorIds ?? ids,
        );
  const snapshot = captureSpatialSnapshot(input.snapshot, header, ids);
  denseArray(input.endpoints);
  denseArray(input.poseContexts);
  denseArray(context.acceptedPrefix);
  const endpoints = input.endpoints.map(captureFightingClockPoint),
    contexts = input.poseContexts.map(captureFightingPoseContext);
  const prefix = context.acceptedPrefix.map(captureAcceptedPrefix);
  bijection(
    endpoints.map((p) => p.actorId),
    ids,
  );
  bijection(
    contexts.map((p) => p.actorId),
    ids,
  );
  bijection(
    prefix.map((p) => p.actor.actorId),
    ids,
  );
  for (const point of endpoints) {
    const actor = output.actors.find((a) => a.actorId === point.actorId),
      pose = contexts.find((p) => p.actorId === point.actorId);
    const accepted = prefix.find((p) => p.actor.actorId === point.actorId),
      physical = snapshot.actors.find((a) => a.actorId === point.actorId);
    if (!actor?.fightingClock || !pose || !accepted || !physical)
      throw new RangeError('Missing final accepted actor authority');
    const enteredAt =
      residency?.enteredAt.get(point.actorId) ?? header.fromGameMs;
    const admission = residency?.admission.get(point.actorId);
    if (enteredAt === header.toGameMs && !admission)
      throw new RangeError('Endpoint-only actor lacks reset admission');
    const clock = captureFightingTransactionalClock(actor.fightingClock, {
      runId: header.runId,
      actorId: point.actorId,
      stepTick: header.stepTick,
      fromGameMs: enteredAt,
      toGameMs: header.toGameMs,
      queryMode: enteredAt === header.toGameMs ? 'settle' : 'interval',
    });
    if (admission && enteredAt === header.toGameMs)
      requireEqual(
        point,
        admission,
        'Endpoint-only resident differs from its exact reset point',
      );
    if (admission && clock.slices.length && clock.slices[0]?.fromMotionMs !== 0)
      throw new RangeError(
        'New resident cannot acquire pre-admission motion history',
      );
    if (
      accepted.pose.source.kind !== 'query' ||
      accepted.pose.source.transactionId !== header.transactionId
    )
      throw new RangeError(
        'Final prefix must come from this transaction query',
      );
    if (publicTime < header.toGameMs) {
      const tail = clock.slices.filter((s) => s.toGameMs > publicTime);
      if (
        !tail.length ||
        tail.some(
          (s) =>
            !s.frozen ||
            s.epochId !== point.epochId ||
            s.toMotionMs !== point.motionMs,
        )
      )
        throw new RangeError(
          'Terminal receipt requires an explicit frozen tail through original E',
        );
    }
    requireEqual(
      point,
      clock.endpoint,
      'Receipt endpoint differs from final accepted clock',
    );
    requireEqual(
      point,
      accepted.endpoint,
      'Receipt endpoint differs from last settled prefix',
    );
    requireEqual(
      physical,
      accepted.actor,
      'Receipt substituted a speculative physical state',
    );
    if (
      pose.runId !== header.runId ||
      pose.stepTick !== header.stepTick ||
      pose.epochId !== point.epochId ||
      pose.commitId !== receiptId ||
      pose.entryKind === 'initial-ready' ||
      pose.entryKind !== accepted.pose.entryKind
    )
      throw new RangeError('Receipt pose context identity mismatch');
    if (pose.entryKind === 'encounter-reset') {
      const reset = residency?.residency.resets
        .filter((r) => r.residentActorIds.includes(point.actorId))
        .at(-1);
      if (reset) {
        const selected = reset.endpoints.find(
          (p) => p.actorId === point.actorId,
        );
        const spawn = reset.readyDescriptor.actors.find(
          (a) => a.actorId === point.actorId,
        );
        if (!selected || !spawn)
          throw new RangeError('Missing accepted reset origin');
        requireSameResetOrigin(
          accepted.pose,
          {
            entryKind: 'encounter-reset',
            facingBasis: spawn.facingBasis,
            support: reset.readyDescriptor.supportPlane,
          },
          selected,
        );
      } else {
        const installed = initialPrefix?.actors.find(
          (p) => p.actor.actorId === point.actorId,
        );
        if (installed?.pose.source.kind !== 'installed')
          throw new RangeError(
            'Reset-origin receipt requires accepted reset history or installed initial authority',
          );
        requireSameResetOrigin(
          accepted.pose,
          installed.pose,
          installed.endpoint,
        );
      }
    }
    requireEqual(
      pose.facingBasis,
      accepted.pose.facingBasis,
      'Receipt basis changed',
    );
    requireEqual(
      pose.acceptedRoot,
      accepted.pose.acceptedRoot,
      'Receipt root changed',
    );
    requireEqual(
      pose.support,
      accepted.pose.support,
      'Receipt support changed',
    );
    requireEqual(
      pose.incoming,
      accepted.pose.incoming,
      'Receipt incoming changed',
    );
    requireEqual(
      pose.defeatEntry,
      accepted.pose.defeatEntry,
      'Receipt defeat entry changed',
    );
    if (actor.fightingPoseHold !== undefined) {
      const hold = captureFightingPoseHold(actor.fightingPoseHold);
      if (hold.displayEpochId !== point.epochId)
        throw new RangeError('Held display has a different accepted epoch');
    } else if (
      actor.fighting !== undefined &&
      (actor.fighting.phase !== point.phase ||
        actor.fighting.posture !== point.posture)
    )
      throw new RangeError(
        'Logical selection differs from accepted display without a hold',
      );
  }
  return Object.freeze({
    ...header,
    receiptId,
    acceptedProjectionId,
    outputRevision,
    ...(residency ? { residency: residency.residency } : {}),
    snapshot,
    endpoints: Object.freeze(endpoints),
    poseContexts: Object.freeze(contexts),
  });
}
function validateTransactionPort(
  input: unknown,
): asserts input is FightingSpatialTransactionPort {
  validateTransactionHeader(input);
  if (
    !('project' in input) ||
    typeof input.project !== 'function' ||
    !('finish' in input) ||
    typeof input.finish !== 'function' ||
    !('abort' in input) ||
    typeof input.abort !== 'function'
  )
    throw new RangeError('Incomplete explicit transaction capability');
}
export function isFightingPreparedSpatialCapability(
  input: unknown,
): input is FightingPreparedSpatialCapability {
  try {
    ownData(input);
    return (
      input.version === 1 &&
      input.mode === 'battle-transaction-v1' &&
      typeof input.bindPrepared === 'function'
    );
  } catch {
    return false;
  }
}
export function isFightingSpatialTransactionResult(
  input: SpatialStepResult,
): input is FightingSpatialTransactionResult {
  try {
    ownData(input);
    if (input.kind !== 'fighting-spatial-transaction-v1') return false;
    validateTransactionPort(input.transaction);
    for (const [key, value] of Object.entries(input))
      if (key !== 'transaction') assertPureData(value);
    ownData(input.snapshot);
    denseArray(input.snapshot.actors);
    denseArray(input.candidates);
    const ids = input.snapshot.actors.map((a) => actorId(text(a.actorId)));
    captureSpatialSnapshot(input.snapshot, input.transaction, ids);
    if (!hasInitialPrefixShape(input.initialPrefix)) return false;
    captureFightingInitialPrefix(input.initialPrefix, input.transaction, ids);
    uniqueIds(input.candidates.map((c) => c.contactId));
    for (const candidate of input.candidates)
      validateBattleCandidate(candidate, input.transaction, ids);
    return true;
  } catch {
    return false;
  }
}
export function captureFightingSpatialTransactionResult(
  input: SpatialStepResult,
  request: SpatialStepRequest,
): FightingSpatialTransactionResult {
  if (!isFightingSpatialTransactionResult(input))
    throw new RangeError('Missing explicit fighting transaction envelope');
  const original = input.transaction,
    header = captureHeader(original);
  requestMatches(header, request);
  const ids = residentIds(request.snapshot),
    snapshot = captureSpatialSnapshot(input.snapshot, header, ids);
  denseArray(input.candidates);
  for (const candidate of input.candidates)
    validateBattleCandidate(candidate, header, ids);
  uniqueIds(input.candidates.map((c) => c.contactId));
  const project = original.project,
    finish = original.finish,
    abort = original.abort;
  // Preserve the resource's receiver while snapshotting methods against alias substitution.
  const transaction: FightingSpatialTransactionPort = Object.freeze({
    ...header,
    project: (query: FightingProjectInput) => project.call(original, query),
    finish: (query: FightingFinishInput) => finish.call(original, query),
    abort: () => abort.call(original),
  });
  return Object.freeze({
    kind: 'fighting-spatial-transaction-v1',
    initialPrefix: captureFightingInitialPrefix(
      input.initialPrefix,
      header,
      ids,
    ),
    snapshot,
    candidates: detachedData(input.candidates),
    transaction,
  });
}
function captureDiagnostic(input: FightingDiagnostic): FightingDiagnostic {
  exactFields(input, ['name', 'message']);
  if (typeof input.message !== 'string')
    throw new RangeError('Diagnostic message must be text');
  return Object.freeze({ name: text(input.name), message: input.message });
}
/**
 * The tape preserves returned-but-invalid DTOs so replay can reproduce rejection.
 * It validates data/envelopes, not the success of the recorded production operation.
 * B checks query equality, attempt history and missing/leftover calls during replay.
 */
export function captureFightingSpatialTranscript(
  input: FightingSpatialTranscript,
): FightingSpatialTranscript {
  assertPureData(input);
  exactFields(input, [
    'header',
    'initialPrefix',
    'proposal',
    'interactions',
    'terminal',
  ]);
  const header = captureHeader(input.header);
  exactFields(input.proposal, ['snapshot', 'candidates']);
  const initialPrefix = captureFightingInitialPrefix(
    input.initialPrefix,
    header,
    input.proposal.snapshot.actors.map((actor) => actor.actorId),
  );
  denseArray(input.interactions);
  ownData(input.terminal);
  let terminalOperation = false;
  for (const interaction of input.interactions) {
    ownData(interaction);
    ownData(interaction.outcome);
    if (interaction.kind === 'project') {
      if (terminalOperation)
        throw new RangeError('Project after terminal operation');
      exactFields(interaction, ['kind', 'input', 'outcome']);
      requireEqual(
        captureHeader(interaction.input),
        header,
        'Transcript project has foreign attempt',
      );
    } else if (interaction.kind === 'finish') {
      if (terminalOperation) throw new RangeError('Repeated finish');
      terminalOperation = true;
      exactFields(interaction, ['kind', 'input', 'outcome']);
      ownData(interaction.input);
      text(interaction.input.acceptedProjectionId);
    } else if (interaction.kind === 'abort') {
      terminalOperation = true;
      exactFields(interaction, ['kind', 'outcome']);
    } else throw new RangeError('Unknown transcript operation');
    if (
      interaction.outcome.kind === 'threw' ||
      interaction.outcome.kind === 'unrecordable-return'
    ) {
      exactFields(interaction.outcome, ['kind', 'diagnostic']);
      if (interaction.outcome.kind === 'unrecordable-return')
        captureUnrecordableDiagnostic(interaction.outcome.diagnostic);
      else captureDiagnostic(interaction.outcome.diagnostic);
    } else if (interaction.outcome.kind === 'returned') {
      exactFields(interaction.outcome, ['kind', 'value']);
      if (interaction.kind === 'abort' && interaction.outcome.value !== null)
        throw new RangeError('Abort transcript must return null');
    } else throw new RangeError('Unknown transcript outcome');
  }
  if (input.terminal.kind === 'success') {
    exactFields(input.terminal, ['kind', 'receiptId']);
    text(input.terminal.receiptId);
    const last = input.interactions.at(-1);
    if (
      last?.kind !== 'finish' ||
      last.outcome.kind !== 'returned' ||
      last.outcome.value.receiptId !== input.terminal.receiptId
    )
      throw new RangeError(
        'Successful tape must end with its returned receipt',
      );
  } else if (input.terminal.kind === 'aborted') {
    exactFields(input.terminal, ['kind', 'diagnostic']);
    if (input.terminal.diagnostic !== undefined)
      captureDiagnostic(input.terminal.diagnostic);
  } else throw new RangeError('Unknown transcript terminal');
  return detachedData({
    header,
    initialPrefix,
    proposal: input.proposal,
    interactions: input.interactions,
    terminal: input.terminal,
  });
}

function captureActorIds(input: readonly ActorId[]): readonly ActorId[] {
  uniqueIds(input);
  const ids = input.map((id) => actorId(text(id)));
  if (!ids.length) throw new RangeError('Empty resident roster');
  return Object.freeze(ids);
}
function admittedResidents(
  ids: readonly ActorId[],
  descriptor: FightingReadyDescriptor,
): void {
  if (
    ids.some((id) => !descriptor.actors.some((actor) => actor.actorId === id))
  )
    throw new RangeError(
      'Resident not present in authenticated ready registry',
    );
}
/** Shape narrowing only; the capture below performs all semantic validation. */
function hasInitialPrefixShape(input: unknown): input is FightingInitialPrefix {
  try {
    ownData(input);
    return (
      typeof input.runId === 'string' &&
      typeof input.bindingSetId === 'string' &&
      Array.isArray(input.actors)
    );
  } catch {
    return false;
  }
}
export function captureFightingInitialPrefix(
  input: FightingInitialPrefix,
  header: FightingSpatialTransactionHeader,
  residentActorIds: readonly ActorId[],
): FightingInitialPrefix {
  assertPureData(input);
  ownData(input);
  const identity = captureHeader(header),
    run = runId(text(input.runId)),
    bindingSetId = text(input.bindingSetId);
  if (run !== identity.runId)
    throw new RangeError('Foreign initial physical prefix');
  const ids = captureActorIds(residentActorIds);
  denseArray(input.actors);
  const actors = input.actors.map((p) => {
    const accepted = captureAcceptedPrefix(p),
      poseContext = captureFightingPoseContext(p.poseContext);
    const point = accepted.endpoint,
      source = accepted.pose.source;
    if (
      source.kind === 'query' ||
      source.commitId !== poseContext.commitId ||
      point.runId !== run ||
      point.stepTick >= identity.stepTick ||
      point.atGameMs !== identity.fromGameMs ||
      poseContext.runId !== run ||
      poseContext.actorId !== point.actorId ||
      poseContext.epochId !== point.epochId ||
      poseContext.stepTick !== point.stepTick ||
      poseContext.entryKind !== accepted.pose.entryKind
    )
      throw new RangeError(
        'Initial sample does not match installed point/context/commit',
      );
    requireEqual(
      poseContext.facingBasis,
      accepted.pose.facingBasis,
      'Initial basis mismatch',
    );
    requireEqual(
      poseContext.acceptedRoot,
      accepted.pose.acceptedRoot,
      'Initial root mismatch',
    );
    requireEqual(
      poseContext.support,
      accepted.pose.support,
      'Initial support mismatch',
    );
    requireEqual(
      poseContext.incoming,
      accepted.pose.incoming,
      'Initial incoming mismatch',
    );
    requireEqual(
      poseContext.defeatEntry,
      accepted.pose.defeatEntry,
      'Initial defeat mismatch',
    );
    if (source.kind === 'bootstrap') {
      if (
        point.stepTick !== 0 ||
        point.atGameMs !== 0 ||
        point.motionMs !== 0 ||
        point.phase !== 'neutral' ||
        point.posture !== 'standing' ||
        point.activationId !== null ||
        poseContext.entryKind !== 'initial-ready' ||
        poseContext.defeatEntry !== undefined ||
        poseContext.acceptedRoot.x !== 0 ||
        poseContext.acceptedRoot.z !== 0 ||
        poseContext.support.groundClearanceM !== 0 ||
        !accepted.actor.grounded ||
        accepted.actor.locomotion !== 'idle'
      )
        throw new RangeError('Invalid bootstrap sample provenance');
      requireEqual(
        accepted.actor.velocity,
        { x: 0, y: 0, z: 0 },
        'Bootstrap velocity must be zero',
      );
      requireEqual(
        accepted.actor.facing,
        poseContext.facingBasis,
        'Bootstrap physical facing mismatch',
      );
    } else if (poseContext.entryKind === 'initial-ready')
      throw new RangeError('Installed receipt cannot impersonate bootstrap');
    return Object.freeze({ ...accepted, poseContext });
  });
  bijection(
    actors.map((p) => p.actor.actorId),
    ids,
  );
  const first = actors[0];
  if (
    !first ||
    actors.some((p) => p.pose.source.kind !== first.pose.source.kind)
  )
    throw new RangeError('Mixed initial provenance origins');
  if (first.pose.source.kind === 'bootstrap')
    uniqueIds(actors.map((p) => p.poseContext.commitId));
  else if (
    actors.some((p) => p.poseContext.commitId !== first.poseContext.commitId)
  )
    throw new RangeError('Initial actors have different installed receipts');
  return Object.freeze({
    runId: run,
    bindingSetId,
    actors: Object.freeze(actors),
  });
}
export function captureFightingEncounterReset(
  input: FightingEncounterReset,
  header: FightingSpatialTransactionHeader,
): FightingEncounterReset {
  assertPureData(input);
  exactFields(input, [
    'resetId',
    'atGameMs',
    'readyDescriptor',
    'outgoingActorIds',
    'residentActorIds',
    'endpoints',
  ]);
  const identity = captureHeader(header),
    resetId = text(input.resetId),
    at = gameTimeMs(input.atGameMs);
  const descriptor = captureFightingReadyDescriptor(input.readyDescriptor);
  const outgoing = captureActorIds(input.outgoingActorIds),
    ids = captureActorIds(input.residentActorIds);
  admittedResidents(ids, descriptor);
  if (at < identity.fromGameMs || at > identity.toGameMs)
    throw new RangeError('Reset outside original transaction');
  denseArray(input.endpoints);
  const endpoints = input.endpoints.map(captureFightingClockPoint);
  bijection(
    endpoints.map((p) => p.actorId),
    ids,
  );
  for (const point of endpoints)
    if (
      point.runId !== identity.runId ||
      point.stepTick !== identity.stepTick ||
      point.atGameMs !== at ||
      point.clipId !== descriptor.clipId ||
      point.motionMs !== 0 ||
      point.activationId !== null ||
      point.phase !== 'neutral' ||
      point.posture !== 'standing'
    )
      throw new RangeError(
        'Reset endpoints must be the canonical ready selection',
      );
  return Object.freeze({
    resetId,
    atGameMs: at,
    readyDescriptor: descriptor,
    outgoingActorIds: outgoing,
    residentActorIds: ids,
    endpoints: Object.freeze(endpoints),
  });
}
function captureResidency(
  input: FightingTransactionResidency,
  header: FightingSpatialTransactionHeader,
  finalIds: readonly ActorId[],
): {
  readonly residency: FightingTransactionResidency;
  readonly enteredAt: ReadonlyMap<ActorId, GameTimeMs>;
  readonly admission: ReadonlyMap<ActorId, FightingClockPoint>;
} {
  assertPureData(input);
  exactFields(input, ['initialActorIds', 'resets']);
  const initialActorIds = captureActorIds(input.initialActorIds);
  denseArray(input.resets);
  if (!input.resets.length)
    throw new RangeError(
      'Residency exception requires explicit accepted reset history',
    );
  const resets = input.resets.map((reset) =>
    captureFightingEncounterReset(reset, header),
  );
  uniqueIds(resets.map((reset) => reset.resetId));
  const enteredAt = new Map(
    initialActorIds.map((id) => [id, header.fromGameMs]),
  );
  const admission = new Map<ActorId, FightingClockPoint>(),
    retired = new Set<ActorId>();
  let residents = initialActorIds,
    previous = header.fromGameMs;
  const descriptor = resets[0]?.readyDescriptor;
  for (const reset of resets) {
    if (reset.atGameMs < previous)
      throw new RangeError('Reset history is out of order');
    requireEqual(
      reset.readyDescriptor,
      descriptor,
      'Reset history changed its admitted ready registry',
    );
    bijection(reset.outgoingActorIds, residents);
    for (const id of residents)
      if (!reset.residentActorIds.includes(id)) retired.add(id);
    for (const id of reset.residentActorIds) {
      if (retired.has(id))
        throw new RangeError('Reset resurrected a retired actor identity');
      if (!residents.includes(id)) {
        enteredAt.set(id, reset.atGameMs);
        const point = reset.endpoints.find((p) => p.actorId === id);
        if (!point) throw new RangeError('Missing reset admission point');
        admission.set(id, point);
      }
    }
    residents = reset.residentActorIds;
    previous = reset.atGameMs;
  }
  bijection(residents, finalIds);
  return {
    residency: Object.freeze({
      initialActorIds,
      resets: Object.freeze(resets),
    }),
    enteredAt,
    admission,
  };
}
function validateResetPhysical(
  prefix: FightingPhysicalActorPrefix,
  reset: FightingEncounterReset,
): void {
  const spawn = reset.readyDescriptor.actors.find(
    (a) => a.actorId === prefix.actor.actorId,
  );
  if (!spawn) throw new RangeError('Reset actor has no admitted spawn');
  requireEqual(
    prefix.actor.position,
    spawn.position,
    'Reset physical position must be its declared unswept spawn',
  );
  requireEqual(
    prefix.actor.facing,
    spawn.facingBasis,
    'Reset physical facing differs',
  );
  requireEqual(
    prefix.actor.velocity,
    { x: 0, y: 0, z: 0 },
    'Reset velocity must be zero',
  );
  requireEqual(
    prefix.pose.facingBasis,
    spawn.facingBasis,
    'Reset pose facing differs',
  );
  requireEqual(
    prefix.pose.acceptedRoot,
    { x: 0, z: 0 },
    'Reset epoch root must be zero',
  );
  requireEqual(
    prefix.pose.support,
    { ...reset.readyDescriptor.supportPlane, groundClearanceM: 0 },
    'Reset support must be the declared plane',
  );
  if (
    !prefix.actor.grounded ||
    prefix.actor.locomotion !== 'idle' ||
    prefix.pose.entryKind !== 'encounter-reset' ||
    prefix.pose.incoming !== undefined ||
    prefix.pose.defeatEntry !== undefined
  )
    throw new RangeError(
      'Reset must return ready provenance without incoming ancestry',
    );
}

/** Origin identity is immutable; current motion time/root/clearance and commit ID are not the origin. */
function requireSameResetOrigin(
  current: FightingPhysicalPosePrefix,
  origin: {
    readonly entryKind: FightingPoseContext['entryKind'];
    readonly facingBasis: Vector3;
    readonly support: Pick<FightingSupportContext, 'supportId' | 'planeY'>;
  },
  identity: Pick<
    FightingClockPoint,
    'actorId' | 'epochId' | 'clipId' | 'activationId'
  >,
): void {
  if (
    origin.entryKind !== 'encounter-reset' ||
    current.source.actorId !== identity.actorId ||
    current.source.epochId !== identity.epochId ||
    current.source.clipId !== identity.clipId ||
    current.source.activationId !== identity.activationId
  )
    throw new RangeError(
      'New reset provenance requires an explicit accepted reset',
    );
  requireEqual(
    current.facingBasis,
    origin.facingBasis,
    'Reset epoch changed its immutable facing origin',
  );
  if (
    current.support.supportId !== origin.support.supportId ||
    current.support.planeY !== origin.support.planeY
  )
    throw new RangeError('Reset epoch changed its immutable support origin');
}
function captureUnrecordableDiagnostic(
  input: FightingDiagnostic,
): FightingDiagnostic {
  const diagnostic = captureDiagnostic(input);
  if (
    diagnostic.name.length > FIGHTING_UNRECORDABLE_RETURN_NAME_MAX_CODE_UNITS ||
    diagnostic.message.length >
      FIGHTING_UNRECORDABLE_RETURN_MESSAGE_MAX_CODE_UNITS
  )
    throw new RangeError(
      'Unrecordable-return diagnostic exceeds UTF-16 transport bounds',
    );
  return diagnostic;
}

/** A2 boundaries inspect each own data descriptor once, then validate/use only
 * this detached tree. No original property Get or array iterator participates.
 * The shape-preserving overload retains DTO types, not runtime trust: the
 * caller still performs every schema/context check on the returned snapshot.
 * Shared objects reuse one observation; cycles and non-data remain rejected. */
function pointSnapshot<T>(input: T): T;
function pointSnapshot(input: unknown): unknown {
  const ancestors = new Set<object>(),
    snapshots = new Map<object, unknown>();
  function copy(value: unknown): unknown {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || ancestors.has(value))
      throw new RangeError('Non-data or recursive A2 point DTO');
    if (snapshots.has(value)) return snapshots.get(value);
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new RangeError('Expected plain A2 point data');
    const descriptors = Object.getOwnPropertyDescriptors(value),
      keys = Reflect.ownKeys(descriptors);
    ancestors.add(value);
    let result: unknown;
    if (array) {
      const length = descriptors.length;
      const size: unknown = length?.value;
      if (
        !length ||
        !Object.hasOwn(length, 'value') ||
        typeof size !== 'number' ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        keys.length !== size + 1
      )
        throw new RangeError('Invalid A2 point array length/properties');
      const items: unknown[] = [];
      for (let i = 0; i < size; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value'))
          throw new RangeError('Sparse/accessor A2 point array');
        items.push(copy(descriptor.value));
      }
      result = Object.freeze(items);
    } else {
      const record: Record<string, unknown> = {};
      for (const key of keys) {
        const descriptor =
          typeof key === 'string' ? descriptors[key] : undefined;
        if (
          !descriptor ||
          !Object.hasOwn(descriptor, 'value') ||
          !descriptor.enumerable
        )
          throw new RangeError('A2 point DTO must contain enumerable own data');
        Object.defineProperty(record, key, {
          value: copy(descriptor.value),
          enumerable: true,
        });
      }
      result = Object.freeze(record);
    }
    ancestors.delete(value);
    snapshots.set(value, result);
    return result;
  }
  return copy(input);
}
/** NON-DTO resources keep their original receiver/lifetime. Only these own
 * descriptor values are inspected; live method/metadata Gets are never used. */
function pointResourceDescriptors<T extends object>(
  input: T,
  fields: readonly string[],
) {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    throw new RangeError('Expected A2 point resource record');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new RangeError('Expected plain A2 point resource');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== fields.length ||
    fields.some((key) => !Object.hasOwn(descriptors, key))
  )
    throw new RangeError('Unexpected/missing A2 point resource field');
  for (const key of keys) {
    const descriptor = typeof key === 'string' ? descriptors[key] : undefined;
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable
    )
      throw new RangeError('A2 point resource must contain own data/methods');
  }
  return descriptors;
}

function pointInteger(value: number, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    throw new RangeError('Invalid geometry cardinality/index');
  return value;
}
function pointArray<T>(values: readonly T[], maximum: number): readonly T[] {
  denseArray(values);
  if (values.length > maximum)
    throw new RangeError('Geometry preparation limit exceeded');
  return values;
}
function pointVector(input: Vector3): Vector3 {
  exactFields(input, ['x', 'y', 'z']);
  return vector(input);
}
function pointDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(text(value)))
    throw new RangeError('Invalid geometry provenance digest');
  return value;
}
function pointLimits(
  input: FightingGeometryPointLimits,
): FightingGeometryPointLimits {
  exactFields(input, [
    'maxSources',
    'maxVariants',
    'maxPrimitivesPerSource',
    'maxSolePoints',
    'maxShapes',
    'maxImpacts',
  ]);
  return Object.freeze({
    maxSources: pointInteger(input.maxSources, true),
    maxVariants: pointInteger(input.maxVariants, true),
    maxPrimitivesPerSource: pointInteger(input.maxPrimitivesPerSource, true),
    maxSolePoints: pointInteger(input.maxSolePoints, true),
    maxShapes: pointInteger(input.maxShapes),
    maxImpacts: pointInteger(input.maxImpacts),
  });
}
function pointSource(
  input: FightingGeometrySourcePin,
  limits: FightingGeometryPointLimits,
): FightingGeometrySourcePin {
  exactFields(input, [
    'sourceBindingId',
    'clipId',
    'durationMs',
    'rootPolicy',
    'provenance',
    'poseNames',
    'primitives',
    'soles',
    'shapeIds',
  ]);
  const sourceBindingId = text(input.sourceBindingId);
  exactFields(input.provenance, [
    'sourceSha256',
    'evaluatorSha256',
    'calibrationSha256',
    'mappingSha256',
    'sourceClosureSha256',
    'qualificationEvidenceSha256',
  ]);
  const provenance = Object.freeze({
    sourceSha256: pointDigest(input.provenance.sourceSha256),
    evaluatorSha256: pointDigest(input.provenance.evaluatorSha256),
    calibrationSha256: pointDigest(input.provenance.calibrationSha256),
    mappingSha256: pointDigest(input.provenance.mappingSha256),
    sourceClosureSha256: pointDigest(input.provenance.sourceClosureSha256),
    qualificationEvidenceSha256: pointDigest(
      input.provenance.qualificationEvidenceSha256,
    ),
  });
  const poseNames = uniqueIds(pointArray(input.poseNames, 53));
  if (poseNames.length !== 53)
    throw new RangeError('Expected pinned 53-transform order');
  const primitives = pointArray(
    input.primitives,
    limits.maxPrimitivesPerSource,
  ).map((p) => {
    exactFields(p, ['primitive', 'vertexCount']);
    return Object.freeze({
      primitive: pointInteger(p.primitive),
      vertexCount: pointInteger(p.vertexCount, true),
    });
  });
  if (!primitives.length)
    throw new RangeError('Missing geometry primitive bounds');
  uniqueIds(primitives.map((p) => String(p.primitive)));
  const soles = pointArray(input.soles, 2).map((sole) => {
    exactFields(sole, ['side', 'surfaceId', 'sourceBindingId', 'members']);
    if (sole.sourceBindingId !== sourceBindingId)
      throw new RangeError('Foreign sole source');
    const members = pointArray(sole.members, limits.maxSolePoints).map((m) => {
      exactFields(m, ['primitive', 'vertexIndex']);
      const primitive = pointInteger(m.primitive),
        vertexIndex = pointInteger(m.vertexIndex);
      const bound = primitives.find((p) => p.primitive === primitive);
      if (!bound || vertexIndex >= bound.vertexCount)
        throw new RangeError('Sole member outside source primitive');
      return Object.freeze({ primitive, vertexIndex });
    });
    if (!members.length) throw new RangeError('Empty sole membership');
    uniqueIds(members.map((m) => `${m.primitive}:${m.vertexIndex}`));
    return Object.freeze({
      side: member(sole.side, ['L', 'R']),
      surfaceId: text(sole.surfaceId),
      sourceBindingId,
      members: Object.freeze(members),
    });
  });
  bijection(
    soles.map((s) => s.side),
    ['L', 'R'],
  );
  uniqueIds(soles.map((s) => s.surfaceId));
  return Object.freeze({
    sourceBindingId,
    clipId: clipId(text(input.clipId)),
    durationMs: nonnegative(input.durationMs),
    rootPolicy: member(input.rootPolicy, [
      'full-translation',
      'grounded-posture-y',
      'in-place-posture-xyz',
    ]),
    provenance,
    poseNames,
    primitives: Object.freeze(primitives),
    soles: Object.freeze(soles),
    shapeIds: uniqueIds(pointArray(input.shapeIds, limits.maxShapes)),
  });
}
function pointCoverage(
  input: FightingGeometryPointCoverage,
): FightingGeometryPointCoverage {
  ownData(input);
  if (input.kind === 'finite') {
    exactFields(input, ['kind', 'fromMs', 'toMs']);
    if (input.fromMs !== 0)
      throw new RangeError('Point coverage must start at zero');
    return Object.freeze({
      kind: 'finite',
      fromMs: 0,
      toMs: nonnegative(input.toMs),
    });
  }
  if (input.kind !== 'prefix-tail')
    throw new RangeError('Unknown point coverage');
  exactFields(input, ['kind', 'prefixEndMs', 'tail']);
  const prefixEndMs = nonnegative(input.prefixEndMs);
  ownData(input.tail);
  if (input.tail.kind === 'constant') {
    exactFields(input.tail, ['kind']);
    return Object.freeze({
      kind: 'prefix-tail',
      prefixEndMs,
      tail: Object.freeze({ kind: 'constant' }),
    });
  }
  if (input.tail.kind !== 'periodic')
    throw new RangeError('Unknown point tail');
  exactFields(input.tail, ['kind', 'periodMs', 'phaseOriginMs']);
  const periodMs = nonnegative(input.tail.periodMs);
  if (periodMs === 0) throw new RangeError('Point period must be positive');
  return Object.freeze({
    kind: 'prefix-tail',
    prefixEndMs,
    tail: Object.freeze({
      kind: 'periodic',
      periodMs,
      phaseOriginMs: finite(input.tail.phaseOriginMs),
    }),
  });
}
/** Pure structural preparation capture, not source-byte authentication.
 * Independent context pins/limits are mandatory; this never derives them from input. */
export function captureFightingGeometryManifest(
  input: FightingGeometryManifest,
  context: FightingGeometryManifestContext,
): FightingGeometryManifest {
  const snapshot = pointSnapshot({ input, context });
  input = snapshot.input;
  context = snapshot.context;
  exactFields(context, ['bindingSetId', 'sourcePins', 'limits']);
  exactFields(input, ['schema', 'bindingSetId', 'sources', 'variants']);
  const limits = pointLimits(context.limits),
    bindingSetId = text(context.bindingSetId);
  if (
    input.schema !== 'actual-geometry-manifest-v1' ||
    input.bindingSetId !== bindingSetId
  )
    throw new RangeError('Unknown geometry manifest/binding');
  const pins = pointArray(context.sourcePins, limits.maxSources).map((p) =>
    pointSource(p, limits),
  );
  uniqueIds(pins.map((p) => p.sourceBindingId));
  const sources = pointArray(input.sources, limits.maxSources).map((s) => {
    const captured = pointSource(s, limits),
      pin = pins.find((p) => p.sourceBindingId === captured.sourceBindingId);
    if (!pin) throw new RangeError('Unpinned geometry source');
    requireEqual(
      captured,
      pin,
      'Geometry source differs from independent preparation pin',
    );
    return captured;
  });
  if (!sources.length) throw new RangeError('Empty point source registry');
  uniqueIds(sources.map((s) => s.sourceBindingId));
  const variants = pointArray(input.variants, limits.maxVariants).map((v) => {
    exactFields(v, [
      'geometryBindingId',
      'sourceBindingId',
      'clipId',
      'phase',
      'posture',
      'coverage',
    ]);
    const source = sources.find((s) => s.sourceBindingId === v.sourceBindingId);
    if (!source || v.clipId !== source.clipId)
      throw new RangeError('Unknown geometry variant source/clip');
    const coverage = pointCoverage(v.coverage);
    if (coverage.kind === 'finite' && coverage.toMs > source.durationMs)
      throw new RangeError(
        'Finite point coverage exceeds pinned source duration',
      );
    return Object.freeze({
      geometryBindingId: text(v.geometryBindingId),
      sourceBindingId: source.sourceBindingId,
      clipId: source.clipId,
      phase: phase(v.phase),
      posture: posture(v.posture),
      coverage,
    });
  });
  if (!variants.length) throw new RangeError('Empty point variant registry');
  uniqueIds(variants.map((v) => v.geometryBindingId));
  uniqueIds(
    variants.map((v) => JSON.stringify([v.clipId, v.phase, v.posture])),
  );
  return Object.freeze({
    schema: 'actual-geometry-manifest-v1',
    bindingSetId,
    sources: Object.freeze(sources),
    variants: Object.freeze(variants),
  });
}
function pointVolume(input: HitVolume): HitVolume {
  ownData(input);
  const radiusM = finite(input.radiusM);
  if (radiusM <= 0) throw new RangeError('Geometry radius must be positive');
  if (input.kind === 'sphere') {
    exactFields(input, ['kind', 'center', 'radiusM']);
    return Object.freeze({
      kind: 'sphere',
      center: pointVector(input.center),
      radiusM,
    });
  }
  if (input.kind !== 'capsule') throw new RangeError('Unknown geometry volume');
  exactFields(input, ['kind', 'start', 'end', 'radiusM']);
  return Object.freeze({
    kind: 'capsule',
    start: pointVector(input.start),
    end: pointVector(input.end),
    radiusM,
  });
}
function pointHurt(input: FightingHurtProxySample): FightingHurtProxySample {
  exactFields(input, ['kind', 'posture', 'volume']);
  const volume = pointVolume(input.volume);
  if (input.kind !== 'posture-capsule-proxy-v1' || volume.kind !== 'capsule')
    throw new RangeError('Expected explicit gameplay posture capsule');
  return Object.freeze({
    kind: 'posture-capsule-proxy-v1',
    posture: member(input.posture, ['standing', 'crouching']),
    volume,
  });
}
/** Point evidence capture only; no source proof, interval guarantee or production qualification. */
export function captureFightingActualRecipeGeometrySample(
  input: FightingActualRecipeGeometrySample,
  context: FightingGeometrySampleContext,
): FightingActualRecipeGeometrySample {
  const snapshot = pointSnapshot({ input, context });
  input = snapshot.input;
  context = snapshot.context;
  exactFields(context, [
    'query',
    'manifest',
    'manifestContext',
    'selectedGeometryBindingId',
    'impacts',
    'expectedHurtProxy',
    'normalLengthTolerance',
  ]);
  exactFields(input, [
    'recipeVersion',
    'clipId',
    'atMs',
    'pose',
    'support',
    'durationMs',
    'active',
    'intendedRoot',
    'acceptedRoot',
    'shape',
    'geometryProtocol',
    'geometryBindingId',
    'soles',
    'hurt',
    'hitShapes',
  ]);
  const manifest = captureFightingGeometryManifest(
    context.manifest,
    context.manifestContext,
  );
  const query = context.query;
  exactFields(query, [
    'clipId',
    'phase',
    'posture',
    'atMs',
    'acceptedRoot',
    'incoming',
    'groundClearanceM',
  ]);
  clipId(text(query.clipId));
  phase(query.phase);
  posture(query.posture);
  const atMs = nonnegative(query.atMs),
    root = acceptedRoot(query.acceptedRoot);
  nonnegative(query.groundClearanceM);
  if (Object.hasOwn(query, 'incoming')) {
    if (query.incoming === undefined)
      throw new RangeError('Missing explicit incoming entry');
    captureFightingRecipeEntry(query.incoming);
  }
  const variant = manifest.variants.find(
    (v) => v.geometryBindingId === context.selectedGeometryBindingId,
  );
  const source =
    variant &&
    manifest.sources.find((s) => s.sourceBindingId === variant.sourceBindingId);
  if (
    !variant ||
    !source ||
    variant.clipId !== query.clipId ||
    variant.phase !== query.phase ||
    variant.posture !== query.posture ||
    input.geometryBindingId !== variant.geometryBindingId ||
    input.geometryProtocol !== 'actual-geometry-v1'
  )
    throw new RangeError('Point query/variant mismatch');
  if (variant.coverage.kind === 'finite' && atMs > variant.coverage.toMs)
    throw new RangeError('Point outside finite source coverage');
  if (
    input.clipId !== query.clipId ||
    input.atMs !== atMs ||
    input.durationMs !== source.durationMs
  )
    throw new RangeError('Point sample time/clip/duration mismatch');
  const accepted = pointVector(input.acceptedRoot);
  requireEqual(
    accepted,
    { x: root.x, y: 0, z: root.z },
    'Point accepted root differs from query',
  );
  const intendedRoot = pointVector(input.intendedRoot);
  const support = pointArray(input.support, 2).map((s) => {
    exactFields(s, [
      'side',
      'planted',
      'local',
      'worldRotation',
      'desiredWorld',
      'errorM',
      'world',
    ]);
    return Object.freeze({
      side: member(s.side, ['L', 'R']),
      planted: boolean(s.planted),
      local: tuple3(s.local),
      worldRotation: quaternion(s.worldRotation),
      desiredWorld: tuple3(s.desiredWorld),
      errorM: nonnegative(s.errorM),
      world: tuple3(s.world),
    });
  });
  const entry = captureFightingRecipeEntry({
    recipeVersion: input.recipeVersion,
    clipId: input.clipId,
    atMs: input.atMs,
    pose: input.pose,
    support: support.map((s) => ({
      side: s.side,
      planted: s.planted,
      local: s.local,
      worldRotation: s.worldRotation,
    })),
  });
  requireEqual(
    entry.pose.map((p) => p.name),
    source.poseNames,
    'Point pose differs from pinned transform order',
  );
  const normalLengthTolerance = nonnegative(context.normalLengthTolerance);
  if (normalLengthTolerance >= 1)
    throw new RangeError('Normal-length error must exclude zero normals');
  const soles = pointArray(input.soles, 2).map((s) => {
    exactFields(s, ['side', 'surfaceId', 'points', 'normal']);
    const bound = source.soles.find((b) => b.side === s.side);
    if (!bound || s.surfaceId !== bound.surfaceId)
      throw new RangeError('Unknown point sole');
    const points = pointArray(
      s.points,
      context.manifestContext.limits.maxSolePoints,
    ).map((p) => {
      exactFields(p, ['primitive', 'vertexIndex', 'local']);
      return Object.freeze({
        primitive: pointInteger(p.primitive),
        vertexIndex: pointInteger(p.vertexIndex),
        local: pointVector(p.local),
      });
    });
    requireEqual(
      points.map((p) => ({
        primitive: p.primitive,
        vertexIndex: p.vertexIndex,
      })),
      bound.members,
      'Actual sole membership differs from pinned order',
    );
    const normal = pointVector(s.normal),
      length = Math.hypot(normal.x, normal.y, normal.z);
    if (
      !Number.isFinite(length) ||
      length === 0 ||
      Math.abs(length - 1) > normalLengthTolerance
    )
      throw new RangeError(
        'Sole normal outside supplied unit-length representation bound',
      );
    return Object.freeze({
      side: bound.side,
      surfaceId: bound.surfaceId,
      points: Object.freeze(points),
      normal,
    });
  });
  bijection(
    soles.map((s) => s.side),
    ['L', 'R'],
  );
  const hurt = pointHurt(input.hurt),
    expectedHurt = pointHurt(context.expectedHurtProxy);
  if (
    expectedHurt.posture !==
    (query.posture === 'crouching' ? 'crouching' : 'standing')
  )
    throw new RangeError('Expected proxy disagrees with selected posture');
  requireEqual(
    hurt,
    expectedHurt,
    'Point proxy differs from D-authority context',
  );
  const hitShapes = pointArray(
    input.hitShapes,
    context.manifestContext.limits.maxShapes,
  ).map((s) => {
    exactFields(s, ['shapeId', 'volume']);
    return Object.freeze({
      shapeId: text(s.shapeId),
      volume: pointVolume(s.volume),
    });
  });
  bijection(
    hitShapes.map((s) => s.shapeId),
    source.shapeIds,
  );
  pointArray(context.impacts, context.manifestContext.limits.maxImpacts);
  const impactIndices: string[] = [],
    referenced = new Set<string>();
  let active = false;
  for (const impact of context.impacts) {
    exactFields(impact, [
      'impactIndex',
      'startMs',
      'endMs',
      'damageShare',
      'shapeId',
      'additionalShapeIds',
    ]);
    impactIndices.push(String(pointInteger(impact.impactIndex)));
    const start = nonnegative(impact.startMs),
      end = nonnegative(impact.endMs),
      share = finite(impact.damageShare);
    if (start >= end || end > source.durationMs || share <= 0 || share > 1)
      throw new RangeError('Invalid catalog point impact');
    for (const id of impactShapeIds(impact)) referenced.add(id);
    active ||= atMs >= start && atMs < end;
  }
  uniqueIds(impactIndices);
  bijection([...referenced], source.shapeIds);
  if (boolean(input.active) !== active)
    throw new RangeError('Point activity differs from catalog half-open union');
  const shape = input.shape === null ? null : pointVolume(input.shape);
  if (shape !== null && !hitShapes.some((s) => sameData(s.volume, shape)))
    throw new RangeError('Legacy shape alias is not a declared point shape');
  return Object.freeze({
    ...entry,
    durationMs: source.durationMs,
    active,
    intendedRoot,
    acceptedRoot: accepted,
    support: Object.freeze(support),
    shape,
    geometryProtocol: 'actual-geometry-v1',
    geometryBindingId: variant.geometryBindingId,
    soles: Object.freeze(soles),
    hurt,
    hitShapes: Object.freeze(hitShapes),
  });
}

/** Structural NON-DTO point preparation only. No eager allocation, source authentication
 * or production admission. Callers own create/dispose and separately capture each lease. */
export function captureFightingActualRecipeSamplerFactory(
  input: FightingActualRecipeSamplerFactory,
  context: {
    readonly runId: RunId;
    readonly manifestContext: FightingGeometryManifestContext;
  },
): FightingActualRecipeSamplerFactory {
  const descriptors = pointResourceDescriptors(input, [
    'runId',
    'bindingSetId',
    'geometryManifest',
    'create',
  ]);
  const create = descriptors.create.value;
  const snapshot = pointSnapshot({
    context,
    runId: descriptors.runId.value,
    bindingSetId: descriptors.bindingSetId.value,
    geometryManifest: descriptors.geometryManifest.value,
  });
  context = snapshot.context;
  exactFields(context, ['runId', 'manifestContext']);
  const run = runId(text(context.runId));
  if (!snapshot.geometryManifest)
    throw new RangeError('Missing actual point geometry manifest');
  const geometryManifest = captureFightingGeometryManifest(
    snapshot.geometryManifest,
    context.manifestContext,
  );
  if (
    snapshot.runId !== run ||
    snapshot.bindingSetId !== geometryManifest.bindingSetId ||
    typeof create !== 'function'
  )
    throw new RangeError('Invalid actual point factory capability/identity');
  return Object.freeze({
    runId: run,
    bindingSetId: geometryManifest.bindingSetId,
    geometryManifest,
    create: (id: ActorId) => Reflect.apply(create, input, [actorId(text(id))]),
  });
}
/** Captures lease metadata/method references only. Returned point DTOs still require
 * captureFightingActualRecipeGeometrySample with independent contextual authority. */
export function captureFightingActualRecipeSamplerPort(
  input: FightingActualRecipeSamplerPort,
  context: {
    readonly runId: RunId;
    readonly actorId: ActorId;
    readonly bindingSetId: string;
  },
): FightingActualRecipeSamplerPort {
  const descriptors = pointResourceDescriptors(input, [
    'runId',
    'actorId',
    'bindingSetId',
    'sample',
    'dispose',
  ]);
  const sample = descriptors.sample.value,
    dispose = descriptors.dispose.value;
  const snapshot = pointSnapshot({
    context,
    runId: descriptors.runId.value,
    actorId: descriptors.actorId.value,
    bindingSetId: descriptors.bindingSetId.value,
  });
  context = snapshot.context;
  exactFields(context, ['runId', 'actorId', 'bindingSetId']);
  const run = runId(text(context.runId)),
    actor = actorId(text(context.actorId)),
    bindingSetId = text(context.bindingSetId);
  if (
    snapshot.runId !== run ||
    snapshot.actorId !== actor ||
    snapshot.bindingSetId !== bindingSetId ||
    typeof sample !== 'function' ||
    typeof dispose !== 'function'
  )
    throw new RangeError('Invalid actual point lease capability/identity');
  return Object.freeze({
    runId: run,
    actorId: actor,
    bindingSetId,
    sample: (query: FightingRecipeQuery) =>
      Reflect.apply(sample, input, [query]),
    dispose: () => Reflect.apply(dispose, input, []),
  });
}

/** Structural transport only. Valid metadata is NOT source authentication,
 * an interval capability, a prepared binding, or permission to enable production.
 * F must supply independently authenticated expected evidence; copying caller
 * metadata into that context does not authenticate it. Domain digests identify
 * external reviewed scope, not an executable geometry law. */
export interface FightingGeometryAdmissionMetadata {
  readonly schema: 'fighting-geometry-admission-metadata-v1';
  readonly bindingSetId: string;
  readonly manifestDigest: string;
  readonly sourceClosureDigest: string;
  readonly lawImplementations: readonly {
    readonly lawId: string;
    readonly implementationDigest: string;
    readonly numericBackendId: string;
    readonly numericProfileDigest: string;
  }[];
  readonly admittedDomainDigests: readonly string[];
  readonly limits: {
    readonly maxIntervalCalls: number;
    readonly maxRefinementDepth: number;
    readonly maxBranchSplits: number;
    readonly maxEvaluations: number;
  };
  readonly normalAcceptance: { readonly maxAngularErrorRad: number };
  readonly eventNumberProfile: {
    readonly precision: 53;
    readonly rounding: 'nearest-ties-even';
    readonly maxTimestampErrorMs: number;
    readonly maxWorldWitnessErrorM: number;
    readonly numericBackendId: string;
  };
  readonly qualificationEvidenceDigest: string;
}
export interface FightingGeometryAdmissionMetadataContext {
  readonly expected: FightingGeometryAdmissionMetadata;
}
/** Capture both sides once, validate both, then require exact tuple identity.
 * No automatic defaults, fuzzy equality, capability branding or new registry. */
export function captureFightingGeometryAdmissionMetadata(
  input: unknown,
  context: { readonly expected: unknown },
): FightingGeometryAdmissionMetadata {
  const captured = pointSnapshot({ input, context });
  exactFields(captured.context, ['expected']);
  const validate = (value: unknown): FightingGeometryAdmissionMetadata => {
    exactFields(value, [
      'schema',
      'bindingSetId',
      'manifestDigest',
      'sourceClosureDigest',
      'lawImplementations',
      'admittedDomainDigests',
      'limits',
      'normalAcceptance',
      'eventNumberProfile',
      'qualificationEvidenceDigest',
    ]);
    // exactFields checks own-data before this structural narrowing.
    const v = value as FightingGeometryAdmissionMetadata;
    if (v.schema !== 'fighting-geometry-admission-metadata-v1')
      throw new RangeError('Unknown geometry admission metadata schema');
    text(v.bindingSetId);
    pointDigest(v.manifestDigest);
    pointDigest(v.sourceClosureDigest);
    pointDigest(v.qualificationEvidenceDigest);
    exactFields(v.limits, [
      'maxIntervalCalls',
      'maxRefinementDepth',
      'maxBranchSplits',
      'maxEvaluations',
    ]);
    for (const key of [
      'maxIntervalCalls',
      'maxRefinementDepth',
      'maxBranchSplits',
      'maxEvaluations',
    ] as const)
      pointInteger(v.limits[key], true);
    exactFields(v.normalAcceptance, ['maxAngularErrorRad']);
    if (
      finite(v.normalAcceptance.maxAngularErrorRad) < 0 ||
      v.normalAcceptance.maxAngularErrorRad > Math.PI
    )
      throw new RangeError('Invalid measured normal angular error');
    exactFields(v.eventNumberProfile, [
      'precision',
      'rounding',
      'maxTimestampErrorMs',
      'maxWorldWitnessErrorM',
      'numericBackendId',
    ]);
    const profile = v.eventNumberProfile;
    if (profile.precision !== 53 || profile.rounding !== 'nearest-ties-even')
      throw new RangeError(
        'Only explicit binary64 p53 nearest-even metadata is supported',
      );
    text(profile.numericBackendId);
    if (
      finite(profile.maxTimestampErrorMs) < 0 ||
      finite(profile.maxWorldWitnessErrorM) < 0
    )
      throw new RangeError('Invalid measured representation error');
    denseArray(v.lawImplementations);
    if (!v.lawImplementations.length)
      throw new RangeError('Missing admitted law identity');
    uniqueIds(
      v.lawImplementations.map((law) => {
        exactFields(law, [
          'lawId',
          'implementationDigest',
          'numericBackendId',
          'numericProfileDigest',
        ]);
        pointDigest(law.implementationDigest);
        pointDigest(law.numericProfileDigest);
        if (text(law.numericBackendId) !== profile.numericBackendId)
          throw new RangeError(
            'Law and event profile use different numeric backends',
          );
        return text(law.lawId);
      }),
    );
    denseArray(v.admittedDomainDigests);
    if (!v.admittedDomainDigests.length)
      throw new RangeError('Missing admitted domain identity');
    uniqueIds(v.admittedDomainDigests.map(pointDigest));
    return v;
  };
  const expected = validate(captured.context.expected);
  const result = validate(captured.input);
  requireEqual(
    result,
    expected,
    'Admission metadata differs from independent preparation evidence',
  );
  return result;
}
