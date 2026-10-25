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
import type { Vector3 } from './motion';
import type { SpatialStepRequest, SpatialStepResult } from './ports';

/** Additive opt-in protocol; the legacy snapshot CONTRACT_VERSION remains 1. */
export const FIGHTING_HZ = 60 as const;
export const FIGHTING_MAX_STAGE = 3 as const;
export const FIGHTING_BUFFER_MAX_AGE_TICKS = 6 as const;
export const FIGHTING_DAMAGE_SCALES = Object.freeze([1, 0.8, 0.65] as const);
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
export interface FightingEntry {
  readonly posture: FightingPosture;
  readonly moveId: FightingMoveId;
}
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
/** Hit-confirmed edges only; delays count unfrozen ticks after contact (minimum 1). */
export const FIGHTING_CANCEL_EDGES = Object.freeze([
  Object.freeze({ from: 'P', to: 'PP', maxDelayTicks: 8 }),
  Object.freeze({ from: 'P', to: 'PK', maxDelayTicks: 3 }),
  Object.freeze({ from: 'PP', to: 'PPP', maxDelayTicks: 8 }),
  Object.freeze({ from: 'PP', to: 'PPK', maxDelayTicks: 3 }),
  Object.freeze({ from: 'K', to: 'KK', maxDelayTicks: 5 }),
  Object.freeze({ from: 'K', to: 'KP', maxDelayTicks: 7 }),
  Object.freeze({ from: 'KP', to: 'KPP', maxDelayTicks: 8 }),
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
  requireRecord(input);
  const stepTick = tick(input.stepTick),
    activeEpochId = text(input.activeEpochId);
  if (!Array.isArray(input.slices) || input.slices.length === 0)
    throw new RangeError('Missing fighting clock coverage');
  const slices = input.slices.map(captureFightingClockSlice);
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
    last = slices[slices.length - 1];
  if (!first || !last || last.epochId !== activeEpochId)
    throw new RangeError('Active epoch must match clock endpoint');
  if (context) {
    const from = gameTimeMs(context.fromGameMs),
      to = gameTimeMs(context.toGameMs);
    if (
      stepTick !== tick(context.stepTick) ||
      first.actorId !== actorId(text(context.actorId)) ||
      first.fromGameMs !== from ||
      last.toGameMs !== to
    )
      throw new RangeError(
        'Fighting clock does not cover the requested actor/step interval',
      );
  }
  return Object.freeze({
    stepTick,
    activeEpochId,
    slices: Object.freeze(slices),
  });
}
/** Lookup is deliberately half-open; callers must not reuse an old active endpoint. */
export function fightingClockSliceAt(
  input: FightingClock,
  at: GameTimeMs,
): FightingClockSlice | null {
  const clock = captureFightingClock(input);
  gameTimeMs(at);
  return (
    clock.slices.find(
      (slice) => at >= slice.fromGameMs && at < slice.toGameMs,
    ) ?? null
  );
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
