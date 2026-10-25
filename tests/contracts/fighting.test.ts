import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  activeRealTimeMs,
  presentationTimeMs,
  actorId,
  attackActivationId,
  clipId,
  commandId,
  contactId,
  durationMs,
  gameTimeMs,
  impactId,
  runId,
  tick,
  type ActorState,
  type AttackState,
  type DomainEvent,
  type FightingGameplayCommand,
  type GameplayCommand,
  type GameplayInputBatch,
  type SpatialStepRequest,
  type SpatialStepResult,
} from '../../src/contracts';
import {
  FIGHTING_MOVE_SPECS,
  FIGHTING_GROUND_ROUTES,
  FIGHTING_ENTRIES,
  FIGHTING_CANCEL_EDGES,
  FIGHTING_DAMAGE_SCALES,
  FIGHTING_MAX_STAGE,
  FIGHTING_BUFFER_MAX_AGE_TICKS,
  FIGHTING_HZ,
  captureFightingMoveDefinition,
  captureFightingPolicy,
  captureFightingInputEdge,
  captureNormalizedFightingInputs,
  captureFightingCombatantState,
  captureFightingTransition,
  captureFightingDamage,
  captureFightingAttackDescriptor,
  captureLegacyImpactProfile,
  captureFightingContactDecision,
  captureFightingAttackState,
  captureFightingClockSlice,
  captureFightingClock,
  fightingClockSliceAt,
  captureFightingTakeoffWitness,
  captureFightingLandingWitness,
  captureFightingContactWitness,
  captureFightingSpatialStepResult,
  isFightingSpatialStepResult,
  type FightingCombatantState,
  type FightingClock,
  type FightingClockSlice,
  type FightingSpatialStepResult,
  type FightingTakeoffWitness,
} from '../../src/contracts/fighting';
import { captureGuardRequested } from '../../src/contracts/commands';
import {
  createFightingPoseStamp,
  captureFightingPoseBindings,
  createLivingPoseStamp,
  type LivingPoseMode,
} from '../../src/contracts/pose';

const run = runId('run');
const actor = actorId('player');
const target = actorId('enemy');
const clip = clipId('authored-p-short');
const activation = attackActivationId('run:activation:1');
const vector = { x: 0, y: 0, z: 1 };
const edge = () => ({
  runId: run,
  actorId: actor,
  commandId: commandId('original'),
  sequence: 7,
  button: 'P' as const,
});
const policy = () => ({
  version: 3 as const,
  hpPerNormalizedPoint: 5,
  guardFrontDotMin: 0,
  hitstunPosture: 'retain-contact-posture' as const,
});
const state = (): FightingCombatantState => ({
  tick: 0,
  phase: 'neutral',
  posture: 'standing',
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
const slice = (): FightingClockSlice => ({
  actorId: actor,
  epochId: 'epoch-1',
  clipId: clip,
  activationId: activation,
  fromGameMs: gameTimeMs(100.25),
  toGameMs: gameTimeMs(110.75),
  fromMotionMs: durationMs(3.5),
  toMotionMs: durationMs(14),
  frozen: false,
});
const clock = (): FightingClock => ({
  stepTick: tick(8),
  activeEpochId: 'epoch-1',
  slices: [slice()],
});
const clockContext = () => ({
  actorId: actor,
  stepTick: tick(8),
  fromGameMs: gameTimeMs(100.25),
  toGameMs: gameTimeMs(110.75),
});
const contact = () => ({
  contactId: contactId('actual-contact'),
  atGameMs: gameTimeMs(105.125),
  sourceActorId: actor,
  targetActorId: target,
  sourcePosition: { ...vector },
  targetPosition: { x: 0, y: 0, z: 0 },
  sourceFacing: { x: 0, y: 0, z: -1 },
  targetFacing: { ...vector },
});
const landing = () => ({
  actorId: actor,
  atGameMs: gameTimeMs(108.5),
  position: { ...vector },
  supportId: 'street-ground',
  airborneActivationId: activation,
});
const spatialActor = (id = actor) => ({
  actorId: id,
  position: { ...vector },
  facing: { ...vector },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle' as const,
});
const result = (): FightingSpatialStepResult => ({
  snapshot: {
    runId: run,
    tick: tick(8),
    actors: [spatialActor(), spatialActor(target)],
    vehicles: [],
  },
  candidates: [
    {
      kind: 'body-hit',
      runId: run,
      contactId: contactId('actual-contact'),
      at: gameTimeMs(105.125),
      interval: { from: gameTimeMs(100.25), to: gameTimeMs(110.75) },
      point: { ...vector },
      evidence: 'swept-shape',
      source: {
        actorId: actor,
        activationId: activation,
        impactId: impactId('runtime-impact'),
      },
      targetActorId: target,
    },
  ],
  fighting: {
    stepTick: tick(8),
    takeoffs: [],
    landings: [landing()],
    contacts: [contact()],
  },
});
const actorSnapshot = (id = actor): ActorState => ({
  actorId: id,
  color: id === actor ? 'white' : 'blue',
  hp: 500,
  maxHp: 500,
  heat: { amount: 0, capacity: 7, lockedUntil: null },
  attack: null,
  defeated: false,
  actions: {
    punch: { allowed: true, reason: null },
    kick: { allowed: true, reason: null },
    jump: { allowed: true, reason: null },
    move: { allowed: true, reason: null },
  },
});
// The existing request snapshot is the step endpoint, not its start.
const request = (): SpatialStepRequest => ({
  snapshot: {
    revision: 1,
    contractVersion: 1,
    runId: run,
    phase: 'running',
    seed: 1,
    pauseReasons: [],
    quality: 'standard',
    clocks: {
      tick: tick(8),
      gameTimeMs: gameTimeMs(110.75),
      activeRealTimeMs: activeRealTimeMs(110.75),
      presentationTimeMs: presentationTimeMs(110.75),
    },
    actors: [actorSnapshot(), actorSnapshot(target)],
    currentOpponentId: target,
    result: null,
    presentation: { kind: 'none' },
    world: { vehicles: [], objects: [] },
  },
  step: { durationMs: durationMs(10.5) },
  intents: [],
});

describe('adopted fighting inventory', () => {
  it('keeps the 10 role definitions and their adopted 60Hz units separate from clip identity', () => {
    expect(FIGHTING_HZ).toBe(60);
    expect(
      Object.values(FIGHTING_MOVE_SPECS).map((m) => [
        m.id,
        m.startupTicks,
        m.activeTicks,
        m.recoveryTicks,
        m.hitstunTicks,
        m.hitstopTicks,
        m.damageNormalized,
        m.blockstunTicks,
        m.blockstopTicks,
        m.level,
      ]),
    ).toEqual([
      ['p_short', 5, 2, 14, 18, 6, 10, 10, 4, 'high'],
      ['p_body', 7, 2, 16, 20, 6, 12, 12, 4, 'mid'],
      ['p_finish', 9, 2, 22, 16, 8, 18, 12, 6, 'mid'],
      ['k_front', 10, 3, 20, 22, 7, 16, 14, 5, 'mid'],
      ['k_low', 11, 3, 22, 24, 7, 18, 14, 5, 'low'],
      ['k_turn', 13, 3, 27, 18, 9, 24, 16, 6, 'mid'],
      ['p_entry', 12, 2, 24, 20, 8, 20, 14, 5, 'mid'],
      ['c_body', 7, 2, 14, 15, 6, 10, 10, 4, 'mid'],
      ['a_palm', 8, 3, 14, 12, 5, 10, 10, 4, 'mid'],
      ['a_kick', 11, 4, 18, 14, 7, 16, 12, 5, 'mid'],
    ]);
    expect(Object.isFrozen(FIGHTING_MOVE_SPECS.p_short)).toBe(true);
    expect(
      captureFightingMoveDefinition({
        ...FIGHTING_MOVE_SPECS.p_short,
        clipId: clip,
      }).clipId,
    ).toBe('authored-p-short');
  });
  it('exposes exactly 9 routes, 11 posture entries, 7 hit-only edges and no fourth stage', () => {
    expect(FIGHTING_GROUND_ROUTES).toEqual({
      P: 'p_short',
      PP: 'p_body',
      PPP: 'p_finish',
      PK: 'k_low',
      PPK: 'k_turn',
      K: 'k_front',
      KK: 'k_turn',
      KP: 'p_entry',
      KPP: 'p_finish',
    });
    expect(FIGHTING_ENTRIES.map((e) => `${e.posture}:${e.moveId}`)).toEqual([
      'standing:p_short',
      'standing:p_body',
      'standing:p_finish',
      'standing:k_front',
      'standing:k_low',
      'standing:k_turn',
      'standing:p_entry',
      'crouching:c_body',
      'crouching:k_low',
      'airborne:a_palm',
      'airborne:a_kick',
    ]);
    expect(FIGHTING_CANCEL_EDGES).toEqual([
      { from: 'P', to: 'PP', maxDelayTicks: 8 },
      { from: 'P', to: 'PK', maxDelayTicks: 3 },
      { from: 'PP', to: 'PPP', maxDelayTicks: 8 },
      { from: 'PP', to: 'PPK', maxDelayTicks: 3 },
      { from: 'K', to: 'KK', maxDelayTicks: 5 },
      { from: 'K', to: 'KP', maxDelayTicks: 7 },
      { from: 'KP', to: 'KPP', maxDelayTicks: 8 },
    ]);
    expect(FIGHTING_MAX_STAGE).toBe(3);
    expect(FIGHTING_DAMAGE_SCALES).toEqual([1, 0.8, 0.65]);
    expect(FIGHTING_BUFFER_MAX_AGE_TICKS).toBe(6);
  });
  it.each([
    'startupTicks',
    'activeTicks',
    'recoveryTicks',
    'hitstunTicks',
    'hitstopTicks',
    'blockstunTicks',
    'blockstopTicks',
  ] as const)('rejects invalid integer tick field %s', (field) => {
    for (const bad of [-1, 0.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        captureFightingMoveDefinition({
          ...FIGHTING_MOVE_SPECS.p_short,
          clipId: clip,
          [field]: bad,
        }),
      ).toThrow(RangeError);
  });
  it('rejects unknown roles, levels, empty clips and nonfinite or negative normalized damage', () => {
    const m = { ...FIGHTING_MOVE_SPECS.p_short, clipId: clip };
    for (const patch of [
      { id: 'unknown' },
      { level: 'unknown' },
      { clipId: '' },
      { damageNormalized: NaN },
      { damageNormalized: -1 },
    ])
      expect(() =>
        captureFightingMoveDefinition({ ...m, ...patch } as typeof m),
      ).toThrow(RangeError);
  });
});

describe('immutable fighting DTO boundaries', () => {
  it('requires an explicit finite positive conversion policy without changing HP units', () => {
    expect(captureFightingPolicy(policy())).toEqual(policy());
    for (const patch of [
      { version: 1 },
      { hpPerNormalizedPoint: 0 },
      { hpPerNormalizedPoint: NaN },
      { hpPerNormalizedPoint: Infinity },
      { guardFrontDotMin: 1.01 },
      { guardFrontDotMin: NaN },
      { hitstunPosture: 'guess' },
    ])
      expect(() =>
        captureFightingPolicy({ ...policy(), ...patch } as ReturnType<
          typeof policy
        >),
      ).toThrow(RangeError);
    expect(() =>
      captureFightingPolicy(undefined as unknown as ReturnType<typeof policy>),
    ).toThrow(RangeError);
  });
  it('preserves original run/actor/command/sequence and freezes independent packet copies', () => {
    const original = edge();
    const captured = captureFightingInputEdge(original);
    original.sequence = 8;
    expect(captured).toEqual({
      runId: 'run',
      actorId: 'player',
      commandId: 'original',
      sequence: 7,
      button: 'P',
    });
    expect(Object.isFrozen(captured)).toBe(true);
    for (const patch of [
      { runId: '' },
      { actorId: '' },
      { commandId: '' },
      { sequence: 0 },
      { sequence: 0.1 },
      { sequence: NaN },
      { sequence: Number.MAX_SAFE_INTEGER + 1 },
      { button: 'X' },
    ])
      expect(() =>
        captureFightingInputEdge({ ...edge(), ...patch } as ReturnType<
          typeof edge
        >),
      ).toThrow(RangeError);
  });
  it('captures normalized identity without a second history or silently sorting malformed batches', () => {
    const input = {
      edges: [edge()],
      newlySeenCommandIds: [commandId('original'), commandId('guard-identity')],
    };
    const captured = captureNormalizedFightingInputs(input);
    const first = input.edges[0];
    if (first) first.sequence = 9;
    expect(captured.edges[0]?.sequence).toBe(7);
    expect(Object.isFrozen(captured.newlySeenCommandIds)).toBe(true);
    for (const edges of [
      [edge(), edge()],
      [{ ...edge(), sequence: 8 }, edge()],
      [edge(), { ...edge(), commandId: commandId('other') }],
      [
        edge(),
        {
          ...edge(),
          actorId: target,
          sequence: 8,
          commandId: commandId('other'),
        },
      ],
    ])
      expect(() =>
        captureNormalizedFightingInputs({
          edges,
          newlySeenCommandIds: [commandId('original'), commandId('other')],
        }),
      ).toThrow(RangeError);
    expect(() =>
      captureNormalizedFightingInputs({
        edges: [edge()],
        newlySeenCommandIds: [],
      }),
    ).toThrow(RangeError);
  });
  it('captures nested reservation identity and does not extend its accepted age beyond 6 ticks', () => {
    const input = { ...state(), buffer: { edge: edge(), ageTicks: 6 } };
    const captured = captureFightingCombatantState(input);
    input.buffer.edge.sequence = 9;
    expect(captured.buffer?.edge.sequence).toBe(7);
    expect(Object.isFrozen(captured.buffer)).toBe(true);
    for (const patch of [
      { tick: 0.5 },
      { moveAgeTicks: NaN },
      { stopTicksRemaining: -1 },
      { stunTicksRemaining: Infinity },
      { landingTicksRemaining: 0.5 },
      { contactAgeTicks: -1 },
      { stage: 4 },
      { phase: 'unknown' },
      { posture: 'unknown' },
      { moveId: 'unknown' },
      { route: 'PPPP' },
      { buffer: { edge: edge(), ageTicks: 7 } },
      { guardHeld: 1 },
    ])
      expect(() =>
        captureFightingCombatantState({
          ...state(),
          ...patch,
        } as FightingCombatantState),
      ).toThrow(RangeError);
  });
  it('captures only the declared transition variants with finite landing seam evidence', () => {
    for (const input of [
      { type: 'hit-confirmed', contactAgeTicks: 0 },
      { type: 'received-hit', stunTicks: 18, stopTicks: 6 },
      {
        type: 'received-block',
        stunTicks: 10,
        stopTicks: 4,
        height: 'standing',
      },
      {
        type: 'landed',
        atGameMs: gameTimeMs(108.5),
        motionElapsedMs: durationMs(14.5),
      },
      { type: 'reset', reason: 'pause' },
      { type: 'guard-begin' },
    ] as const)
      expect(Object.isFrozen(captureFightingTransition(input))).toBe(true);
    for (const input of [
      { type: 'unknown' },
      { type: 'received-hit', stunTicks: 0.5, stopTicks: 6 },
      {
        type: 'received-block',
        stunTicks: 1,
        stopTicks: 1,
        height: 'airborne',
      },
      { type: 'reset', reason: 'other' },
      { type: 'landed', atGameMs: NaN, motionElapsedMs: 0 },
    ])
      expect(() =>
        captureFightingTransition(
          input as Parameters<typeof captureFightingTransition>[0],
        ),
      ).toThrow(RangeError);
  });
  it('retains normalized versus already-calculated legacy HP damage variants without converting either', () => {
    expect(captureFightingDamage({ kind: 'v3-normalized', value: 10 })).toEqual(
      { kind: 'v3-normalized', value: 10 },
    );
    expect(captureFightingDamage({ kind: 'legacy-hp', value: 42.75 })).toEqual({
      kind: 'legacy-hp',
      value: 42.75,
    });
    for (const input of [
      { kind: 'unknown', value: 1 },
      { kind: 'legacy-hp', value: -1 },
      { kind: 'v3-normalized', value: NaN },
    ])
      expect(() =>
        captureFightingDamage(
          input as Parameters<typeof captureFightingDamage>[0],
        ),
      ).toThrow(RangeError);
  });
  it('keeps v3 and legacy descriptors correlated and rejects cross-unit trusted damage', () => {
    const common = {
      level: 'mid' as const,
      hitstunTicks: 18,
      hitstopTicks: 6,
      blockstunTicks: 10,
      blockstopTicks: 4,
    };
    const v3 = {
      ...common,
      kind: 'v3' as const,
      moveId: 'p_short' as const,
      stage: 1 as const,
      damage: { kind: 'v3-normalized' as const, value: 10 },
    };
    const legacy = {
      ...common,
      kind: 'legacy' as const,
      clipId: clipId('OriginalClip'),
      impactIndex: 2,
      damage: { kind: 'legacy-hp' as const, value: 72.5 },
    };
    expect(captureFightingAttackDescriptor(legacy)).toEqual(legacy);
    expect(captureFightingAttackDescriptor(v3)).toEqual(v3);
    for (const input of [
      { ...v3, damage: legacy.damage },
      { ...legacy, damage: v3.damage },
      { ...v3, stage: 4 },
      { ...legacy, impactIndex: 0.5 },
    ])
      expect(() =>
        captureFightingAttackDescriptor(
          input as Parameters<typeof captureFightingAttackDescriptor>[0],
        ),
      ).toThrow(RangeError);
    expect(
      captureLegacyImpactProfile({
        ...common,
        clipId: legacy.clipId,
        impactIndex: 2,
      }),
    ).toEqual({ ...common, clipId: legacy.clipId, impactIndex: 2 });
    expect(() =>
      captureLegacyImpactProfile({
        ...common,
        clipId: legacy.clipId,
        impactIndex: -1,
      }),
    ).toThrow(RangeError);
    expect(
      captureFightingContactDecision({
        kind: 'hit',
        damage: legacy.damage,
        hitstunTicks: 18,
        stopTicks: 6,
      }).kind,
    ).toBe('hit');
    expect(
      captureFightingContactDecision({
        kind: 'blocked',
        damageHp: 0,
        blockstunTicks: 10,
        stopTicks: 4,
      }),
    ).toEqual({
      kind: 'blocked',
      damageHp: 0,
      blockstunTicks: 10,
      stopTicks: 4,
    });
    expect(
      captureFightingContactDecision({ kind: 'ignored', reason: 'behind' }),
    ).toEqual({ kind: 'ignored', reason: 'behind' });
    expect(() =>
      captureFightingContactDecision({
        kind: 'blocked',
        damageHp: 1,
        blockstunTicks: 10,
        stopTicks: 4,
      } as unknown as Parameters<typeof captureFightingContactDecision>[0]),
    ).toThrow(RangeError);
  });
  it('captures attack timing/facing without inventing legacy move IDs', () => {
    const input = {
      kind: 'legacy' as const,
      clipId: clipId('OriginalClip'),
      elapsedTicks: 0,
      facing: { ...vector },
    };
    const captured = captureFightingAttackState(input);
    input.facing.z = -1;
    expect(captured.facing.z).toBe(1);
    expect('moveId' in captured).toBe(false);
    expect(() =>
      captureFightingAttackState({ ...input, elapsedTicks: 0.5 }),
    ).toThrow(RangeError);
    expect(() =>
      captureFightingAttackState({ ...input, facing: { x: NaN, y: 0, z: 1 } }),
    ).toThrow(RangeError);
  });
});

describe('clock epochs and physical witnesses', () => {
  it('preserves fractional continuous times and copies frozen and moving intervals', () => {
    const captured = captureFightingClock(clock(), clockContext());
    expect(captured.slices[0]).toEqual(slice());
    expect(Object.isFrozen(captured.slices[0])).toBe(true);
    const stopped = { ...slice(), frozen: true, toMotionMs: durationMs(3.5) };
    expect(captureFightingClockSlice(stopped)).toEqual(stopped);
    for (const patch of [
      { fromGameMs: NaN },
      { toGameMs: 100 },
      { fromMotionMs: -1 },
      { toMotionMs: 3 },
      { frozen: true },
      { epochId: '' },
      { actorId: '' },
    ])
      expect(() =>
        captureFightingClockSlice({
          ...slice(),
          ...patch,
        } as FightingClockSlice),
      ).toThrow(RangeError);
  });
  it('rejects step mismatch, missing coverage, gaps, overlaps, changed epoch identity or motion rewinds', () => {
    const first = {
      ...slice(),
      toGameMs: gameTimeMs(105),
      toMotionMs: durationMs(8.25),
    };
    const second = {
      ...slice(),
      fromGameMs: gameTimeMs(105),
      fromMotionMs: durationMs(8.25),
    };
    expect(
      captureFightingClock(
        { ...clock(), slices: [first, second] },
        clockContext(),
      ).slices,
    ).toHaveLength(2);
    for (const input of [
      { ...clock(), stepTick: tick(9) },
      { ...clock(), slices: [] },
      { ...clock(), activeEpochId: 'unknown' },
      {
        ...clock(),
        slices: [first, { ...second, fromGameMs: gameTimeMs(105.1) }],
      },
      {
        ...clock(),
        slices: [first, { ...second, fromGameMs: gameTimeMs(104.9) }],
      },
      {
        ...clock(),
        slices: [first, { ...second, fromMotionMs: durationMs(7) }],
      },
      { ...clock(), slices: [first, { ...second, clipId: clipId('other') }] },
      { ...clock(), slices: [first, { ...second, actorId: target }] },
    ])
      expect(() => captureFightingClock(input, clockContext())).toThrow(
        RangeError,
      );
  });
  it('requires an epoch switch at the shared cut and resets the new clip motion to zero', () => {
    const first = {
      ...slice(),
      toGameMs: gameTimeMs(105),
      toMotionMs: durationMs(8.25),
    };
    const second = {
      ...slice(),
      epochId: 'epoch-2',
      clipId: clipId('new-clip'),
      fromGameMs: gameTimeMs(105),
      fromMotionMs: durationMs(0),
      toMotionMs: durationMs(5.75),
    };
    expect(
      captureFightingClock(
        { ...clock(), activeEpochId: 'epoch-2', slices: [first, second] },
        clockContext(),
      ).activeEpochId,
    ).toBe('epoch-2');
    expect(() =>
      captureFightingClock(
        {
          ...clock(),
          activeEpochId: 'epoch-2',
          slices: [first, { ...second, fromMotionMs: durationMs(1) }],
        },
        clockContext(),
      ),
    ).toThrow(RangeError);
  });
  it('assigns a shared epoch cut only to the new slice and excludes the final endpoint', () => {
    const first = {
      ...slice(),
      toGameMs: gameTimeMs(105),
      toMotionMs: durationMs(8.25),
    };
    const second = {
      ...slice(),
      epochId: 'epoch-2',
      clipId: clipId('new-clip'),
      fromGameMs: gameTimeMs(105),
      fromMotionMs: durationMs(0),
      toMotionMs: durationMs(5.75),
    };
    const input = {
      ...clock(),
      activeEpochId: 'epoch-2',
      slices: [first, second],
    };
    expect(fightingClockSliceAt(input, gameTimeMs(104.999))?.epochId).toBe(
      'epoch-1',
    );
    expect(fightingClockSliceAt(input, gameTimeMs(105))?.epochId).toBe(
      'epoch-2',
    );
    expect(fightingClockSliceAt(input, gameTimeMs(110.75))).toBeNull();
    expect(fightingClockSliceAt(input, gameTimeMs(100))).toBeNull();
    expect(() =>
      fightingClockSliceAt(input, NaN as ReturnType<typeof gameTimeMs>),
    ).toThrow(RangeError);
  });
  it('captures physical-only witnesses as independent immutable finite vectors', () => {
    const input = contact();
    const captured = captureFightingContactWitness(input);
    input.sourcePosition.x = 5;
    expect(captured.sourcePosition.x).toBe(0);
    expect(Object.isFrozen(captured.targetFacing)).toBe(true);
    expect(captureFightingLandingWitness(landing())).toEqual(landing());
    expect(() =>
      captureFightingLandingWitness({ ...landing(), supportId: '' }),
    ).toThrow(RangeError);
    expect(() =>
      captureFightingContactWitness({ ...contact(), targetActorId: actor }),
    ).toThrow(RangeError);
    for (const patch of [
      { atGameMs: NaN },
      { sourceFacing: { x: Infinity, y: 0, z: 1 } },
      { targetPosition: { x: 0, y: NaN, z: 0 } },
    ])
      expect(() =>
        captureFightingContactWitness({ ...contact(), ...patch } as ReturnType<
          typeof contact
        >),
      ).toThrow(RangeError);
    expect('damage' in captured).toBe(false);
    expect('guarded' in captured).toBe(false);
  });
  it('requires the fighting extension even with no landings, preserving structural legacy compatibility', () => {
    const legacy: SpatialStepResult = {
      snapshot: result().snapshot,
      candidates: [],
    };
    expect(isFightingSpatialStepResult(legacy)).toBe(false);
    expect(() => captureFightingSpatialStepResult(legacy, request())).toThrow(
      RangeError,
    );
    const noContacts = {
      ...result(),
      candidates: [],
      fighting: { stepTick: tick(8), takeoffs: [], landings: [], contacts: [] },
    };
    expect(isFightingSpatialStepResult(noContacts)).toBe(true);
    expect(
      captureFightingSpatialStepResult(noContacts, request()).fighting.contacts,
    ).toEqual([]);
  });
  it('validates body-contact witness bijection, candidate identity and request tick/run/interval/actors', () => {
    expect(isFightingSpatialStepResult(result())).toBe(true);
    const captured = captureFightingSpatialStepResult(result(), request());
    expect(Object.isFrozen(captured.fighting.contacts[0]?.sourcePosition)).toBe(
      true,
    );
    for (const bad of [
      { ...result(), fighting: { ...result().fighting, stepTick: tick(9) } },
      {
        ...result(),
        snapshot: { ...result().snapshot, runId: runId('wrong') },
      },
      { ...result(), fighting: { ...result().fighting, contacts: [] } },
      {
        ...result(),
        fighting: { ...result().fighting, contacts: [contact(), contact()] },
      },
      {
        ...result(),
        fighting: {
          ...result().fighting,
          contacts: [{ ...contact(), atGameMs: gameTimeMs(106) }],
        },
      },
      {
        ...result(),
        fighting: {
          ...result().fighting,
          contacts: [
            { ...contact(), sourceActorId: target, targetActorId: actor },
          ],
        },
      },
      {
        ...result(),
        fighting: {
          ...result().fighting,
          landings: [{ ...landing(), actorId: actorId('stranger') }],
        },
      },
      {
        ...result(),
        fighting: {
          ...result().fighting,
          landings: [{ ...landing(), atGameMs: gameTimeMs(110.751) }],
        },
      },
    ])
      expect(() => captureFightingSpatialStepResult(bad, request())).toThrow(
        RangeError,
      );
    const before = {
      ...result(),
      fighting: {
        ...result().fighting,
        landings: [{ ...landing(), atGameMs: gameTimeMs(100) }],
      },
    };
    expect(() => captureFightingSpatialStepResult(before, request())).toThrow(
      RangeError,
    );
  });
});

it('rejects malformed body references as RangeError rather than accepting untrusted identity', () => {
  const good = result();
  const candidate = good.candidates[0];
  if (candidate?.kind !== 'body-hit')
    throw new Error('Missing real body fixture');
  for (const patch of [
    { source: null },
    { source: { ...candidate.source, activationId: '' } },
    { source: { ...candidate.source, impactId: '' } },
    { point: { x: NaN, y: 0, z: 0 } },
  ]) {
    const malformed = {
      ...good,
      candidates: [{ ...candidate, ...patch }],
    } as unknown as FightingSpatialStepResult;
    expect(isFightingSpatialStepResult(malformed)).toBe(false);
    expect(() =>
      captureFightingSpatialStepResult(malformed, request()),
    ).toThrow(RangeError);
  }
});

describe('legacy-compatible command, snapshot, event and pose declarations', () => {
  it('captures guard semantic intent with its original envelope and no duplicate posture source', () => {
    const input: Extract<FightingGameplayCommand, { type: 'GuardRequested' }> =
      {
        type: 'GuardRequested',
        runId: run,
        actorId: actor,
        active: true,
        input: { commandId: commandId('guard-original'), sequence: 99 },
      };
    const captured = captureGuardRequested(input);
    expect(captured).toEqual(input);
    expect(Object.isFrozen(captured.input)).toBe(true);
    for (const patch of [
      { active: 1 },
      { runId: '' },
      { input: { commandId: commandId('x'), sequence: 0.5 } },
    ])
      expect(() =>
        captureGuardRequested({ ...input, ...patch } as typeof input),
      ).toThrow(RangeError);
    expect('height' in captured).toBe(false);
  });
  it('retains captured guard identity in canonical gameplay commands and input batches', () => {
    const producer = {
      type: 'GuardRequested' as const,
      runId: run,
      actorId: actor,
      active: false,
      input: { commandId: commandId('canonical-guard-release'), sequence: 100 },
    };
    const guard: GameplayCommand = captureGuardRequested(producer);
    const batch: GameplayInputBatch = {
      runId: run,
      tick: tick(9),
      commands: [guard],
    };
    producer.input.sequence = 101;
    expect(batch.commands).toEqual([
      {
        type: 'GuardRequested',
        runId: 'run',
        actorId: 'player',
        active: false,
        input: { commandId: 'canonical-guard-release', sequence: 100 },
      },
    ]);
    expect(Object.isFrozen(batch.commands[0])).toBe(true);
    expect(Object.isFrozen(batch.commands[0]?.input)).toBe(true);
  });
  it('keeps contract version 1 and optional fighting fields absent in legacy snapshots/attacks', () => {
    const legacy = {
      actorId: actor,
      color: 'white',
      hp: 500,
      maxHp: 500,
      heat: { amount: 0, capacity: 7, lockedUntil: null },
      attack: null,
      defeated: false,
      actions: {
        punch: { allowed: true, reason: null },
        kick: { allowed: true, reason: null },
        jump: { allowed: true, reason: null },
        move: { allowed: true, reason: null },
      },
    } satisfies ActorState;
    const attack = {
      activationId: activation,
      clipId: clip,
      category: 'punch',
      startedAt: gameTimeMs(0),
      consumedImpacts: [],
      impactBindings: [],
    } satisfies AttackState;
    expect(CONTRACT_VERSION).toBe(1);
    expect('fighting' in legacy).toBe(false);
    expect('fighting' in attack).toBe(false);
    const event: DomainEvent = {
      type: 'GuardResolved',
      actorId: target,
      sourceActorId: actor,
      activationId: activation,
      impactId: impactId('runtime-impact'),
      contact: {
        contactId: contactId('actual-contact'),
        point: { ...vector },
        impacts: [],
      },
      height: 'standing',
      runId: run,
      sequence: 1,
      eventId: 'event-1' as DomainEvent['eventId'],
      at: gameTimeMs(105.125),
    };
    expect(event.type).toBe('GuardResolved');
    expect('actualHpLost' in event).toBe(false);
  });
  it('keeps old living modes and locomotion bindings separate from explicit fighting poses', () => {
    const legacyMode: LivingPoseMode = 'crouch';
    expect(
      createLivingPoseStamp({
        version: 1,
        binding: {
          clipId: clip,
          durationMs: durationMs(100),
          sourceBindingId: 'source',
        },
        mode: legacyMode,
        startedAt: gameTimeMs(0),
        playback: 'hold',
        activationId: null,
      }).mode,
    ).toBe('crouch');
    const bindings = {
      'guard-standing': clipId('guard-s'),
      'guard-crouching': clipId('guard-c'),
      'hit-standing': clipId('hit-s'),
      'hit-crouching': clipId('hit-c'),
    };
    expect(captureFightingPoseBindings(bindings)).toEqual(bindings);
    for (const mode of [
      'guard-standing',
      'guard-crouching',
      'hit-standing',
      'hit-crouching',
    ] as const) {
      const stamp = createFightingPoseStamp({
        version: 1,
        binding: {
          clipId: bindings[mode],
          durationMs: durationMs(100),
          sourceBindingId: 'source',
        },
        mode,
        startedAt: gameTimeMs(0),
        playback: mode.startsWith('guard') ? 'hold' : 'clamp',
        activationId: null,
      });
      expect(stamp.mode).toBe(mode);
      expect(Object.isFrozen(stamp.binding)).toBe(true);
    }
    expect(() =>
      captureFightingPoseBindings({
        ...bindings,
        'guard-standing': '' as ReturnType<typeof clipId>,
      }),
    ).toThrow(RangeError);
  });
});

describe('primitive fighting role and route membership', () => {
  const roleCaptures = [
    {
      name: 'move definition',
      field: 'id' as const,
      capture: (id: unknown) =>
        captureFightingMoveDefinition({
          ...FIGHTING_MOVE_SPECS.p_short,
          clipId: clip,
          id,
        } as unknown as Parameters<typeof captureFightingMoveDefinition>[0]),
    },
    {
      name: 'combatant state',
      field: 'moveId' as const,
      capture: (moveId: unknown) =>
        captureFightingCombatantState({
          ...state(),
          moveId,
        } as unknown as FightingCombatantState),
    },
    {
      name: 'v3 attack descriptor',
      field: 'moveId' as const,
      capture: (moveId: unknown) =>
        captureFightingAttackDescriptor({
          kind: 'v3',
          moveId,
          stage: 1,
          damage: { kind: 'v3-normalized', value: 10 },
          level: 'high',
          hitstunTicks: 18,
          hitstopTicks: 6,
          blockstunTicks: 10,
          blockstopTicks: 4,
        } as unknown as Parameters<typeof captureFightingAttackDescriptor>[0]),
    },
    {
      name: 'v3 attack state',
      field: 'moveId' as const,
      capture: (moveId: unknown) =>
        captureFightingAttackState({
          kind: 'v3',
          moveId,
          stage: 1,
          elapsedTicks: 0,
          facing: { ...vector },
        } as unknown as Parameters<typeof captureFightingAttackState>[0]),
    },
  ];
  const coercibleValues = [
    { name: 'array', make: (value: string): unknown => [value] },
    {
      name: 'coercible object',
      make: (value: string): unknown => ({ toString: () => value }),
    },
    { name: 'boxed string', make: (value: string): unknown => Object(value) },
  ];
  for (const { name, capture } of roleCaptures) {
    it.each(coercibleValues)(
      `${name} rejects $name role IDs before property-key coercion`,
      ({ make }) => {
        expect(() => capture(make('p_short'))).toThrow(RangeError);
        for (const invalid of [undefined, 1, Symbol('p_short'), 'unknown-role'])
          expect(() => capture(invalid)).toThrow(RangeError);
        // A neutral combatant deliberately permits moveId:null; the other DTOs do not.
        if (name !== 'combatant state')
          expect(() => capture(null)).toThrow(RangeError);
      },
    );
  }
  it.each(coercibleValues)(
    'combatant state rejects $name routes before property-key coercion',
    ({ make }) => {
      expect(() =>
        captureFightingCombatantState({
          ...state(),
          route: make('P'),
        } as unknown as FightingCombatantState),
      ).toThrow(RangeError);
      for (const invalid of [null, undefined, 1, Symbol('P')])
        expect(() =>
          captureFightingCombatantState({
            ...state(),
            route: invalid,
          } as unknown as FightingCombatantState),
        ).toThrow(RangeError);
    },
  );
  it('does not publish mutable role/route aliases that producers can later rewrite', () => {
    const roleAlias = ['p_short'];
    const routeAlias = ['P'];
    const coercible = {
      value: 'p_short',
      toString() {
        return this.value;
      },
    };
    const attempts = [
      ...roleCaptures.flatMap(({ capture }) => [
        () => capture(roleAlias),
        () => capture(coercible),
      ]),
      () =>
        captureFightingCombatantState({
          ...state(),
          route: routeAlias,
        } as unknown as FightingCombatantState),
    ];
    const published: unknown[] = [];
    for (const capture of attempts) {
      try {
        published.push(capture());
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
      }
    }
    roleAlias[0] = 'unrecognized';
    routeAlias[0] = 'PPPP';
    coercible.value = 'unrecognized';
    expect(published).toEqual([]);
  });
  it('preserves primitive string role/route captures as immutable independent DTOs', () => {
    const producer = { role: 'p_short', route: 'P' };
    const captured = roleCaptures.map(({ capture, field }) => ({
      field,
      value: capture(producer.role) as {
        readonly id?: unknown;
        readonly moveId?: unknown;
      },
    }));
    const capturedState = captureFightingCombatantState({
      ...state(),
      route: producer.route,
    });
    producer.role = 'k_low';
    producer.route = 'PP';
    for (const { field, value } of captured) {
      expect(value[field]).toBe('p_short');
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(capturedState.route).toBe('P');
    expect(Object.isFrozen(capturedState)).toBe(true);
    expect(() =>
      captureFightingCombatantState({ ...state(), route: 'PPPP' }),
    ).toThrow(RangeError);
  });
});

describe('physical fighting takeoff witness boundary', () => {
  const takeoff = (): FightingTakeoffWitness => ({
    actorId: actor,
    atGameMs: gameTimeMs(103.625),
    position: { x: -2.25, y: 0, z: 3 },
  });
  const takeoffResult = (
    takeoffs: readonly FightingTakeoffWitness[] = [takeoff()],
  ): FightingSpatialStepResult => ({
    ...result(),
    fighting: { ...result().fighting, takeoffs },
  });
  it('captures actual fractional takeoff time without sharing a mutable position', () => {
    const position = { x: -2.25, y: 0, z: 3 };
    const captured = captureFightingTakeoffWitness({ ...takeoff(), position });
    position.x = 50;
    expect(captured).toEqual({
      actorId: 'player',
      atGameMs: 103.625,
      position: { x: -2.25, y: 0, z: 3 },
    });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.position)).toBe(true);
    expect('damage' in captured).toBe(false);
    expect('guarded' in captured).toBe(false);
  });
  it.each([
    { name: 'negative time', patch: { atGameMs: -1 } },
    { name: 'NaN time', patch: { atGameMs: NaN } },
    { name: 'infinite time', patch: { atGameMs: Infinity } },
    { name: 'empty actor', patch: { actorId: '' } },
    { name: 'NaN position', patch: { position: { x: 0, y: NaN, z: 0 } } },
    {
      name: 'infinite position',
      patch: { position: { x: Infinity, y: 0, z: 0 } },
    },
  ])('rejects a takeoff witness with $name', ({ patch }) => {
    const malformed = { ...takeoff(), ...patch } as FightingTakeoffWitness;
    expect(() => captureFightingTakeoffWitness(malformed)).toThrow(RangeError);
    expect(isFightingSpatialStepResult(takeoffResult([malformed]))).toBe(false);
    expect(() =>
      captureFightingSpatialStepResult(takeoffResult([malformed]), request()),
    ).toThrow(RangeError);
  });
  it('requires the takeoff array for new-mode results but not legacy results', () => {
    const missing = {
      ...result(),
      candidates: [],
      fighting: { stepTick: tick(8), landings: [], contacts: [] },
    };
    expect(isFightingSpatialStepResult(missing)).toBe(false);
    expect(() => captureFightingSpatialStepResult(missing, request())).toThrow(
      RangeError,
    );
    const legacy: SpatialStepResult = {
      snapshot: result().snapshot,
      candidates: [],
    };
    expect(isFightingSpatialStepResult(legacy)).toBe(false);
    expect(legacy.snapshot.runId).toBe('run');
    const captured = captureFightingSpatialStepResult(
      takeoffResult([]),
      request(),
    );
    expect(captured.fighting.takeoffs).toEqual([]);
    expect(Object.isFrozen(captured.fighting.takeoffs)).toBe(true);
  });
  it('captures takeoff arrays and nested positions independently at the actual timestamp', () => {
    const input = {
      actorId: actor,
      atGameMs: gameTimeMs(103.625),
      position: { x: 0, y: 0, z: 1 },
    };
    const original = takeoffResult([input]);
    const captured = captureFightingSpatialStepResult(original, request());
    input.position.x = 99;
    expect(captured.fighting.takeoffs[0]).toEqual({
      actorId: 'player',
      atGameMs: 103.625,
      position: { x: 0, y: 0, z: 1 },
    });
    expect(Object.isFrozen(captured.fighting.takeoffs)).toBe(true);
    expect(Object.isFrozen(captured.fighting.takeoffs[0]?.position)).toBe(true);
    expect(captured.fighting.contacts).toHaveLength(1);
    expect(captured.fighting.landings).toHaveLength(1);
  });
  it('rejects takeoffs for actors absent from the spatial or requested actor set', () => {
    const witness = { ...takeoff(), actorId: actorId('stranger') };
    const unknownSpatialActor = takeoffResult([witness]);
    expect(isFightingSpatialStepResult(unknownSpatialActor)).toBe(false);
    expect(() =>
      captureFightingSpatialStepResult(unknownSpatialActor, request()),
    ).toThrow(RangeError);
    const unknownRequestedActor = {
      ...unknownSpatialActor,
      snapshot: {
        ...unknownSpatialActor.snapshot,
        actors: [
          ...unknownSpatialActor.snapshot.actors,
          spatialActor(witness.actorId),
        ],
      },
    };
    expect(isFightingSpatialStepResult(unknownRequestedActor)).toBe(true);
    expect(() =>
      captureFightingSpatialStepResult(unknownRequestedActor, request()),
    ).toThrow(RangeError);
  });
  it.each([100.249, 110.751])(
    'rejects a takeoff outside the exact request interval at %s',
    (at) => {
      expect(() =>
        captureFightingSpatialStepResult(
          takeoffResult([{ ...takeoff(), atGameMs: gameTimeMs(at) }]),
          request(),
        ),
      ).toThrow(RangeError);
    },
  );
  it.each([100.25, 110.75])(
    'retains the exact request boundary timestamp %s',
    (at) => {
      expect(
        captureFightingSpatialStepResult(
          takeoffResult([{ ...takeoff(), atGameMs: gameTimeMs(at) }]),
          request(),
        ).fighting.takeoffs[0]?.atGameMs,
      ).toBe(at);
    },
  );
  it('rejects duplicate actor/time takeoffs without merging or silently dropping evidence', () => {
    const duplicate = takeoffResult([takeoff(), takeoff()]);
    expect(isFightingSpatialStepResult(duplicate)).toBe(false);
    expect(() =>
      captureFightingSpatialStepResult(duplicate, request()),
    ).toThrow(RangeError);
    const distinct = takeoffResult([
      takeoff(),
      { ...takeoff(), atGameMs: gameTimeMs(104) },
      { ...takeoff(), actorId: target },
    ]);
    expect(
      captureFightingSpatialStepResult(distinct, request()).fighting.takeoffs,
    ).toHaveLength(3);
  });
  it('retains request run/tick validation for results containing takeoffs', () => {
    const input = takeoffResult();
    expect(() =>
      captureFightingSpatialStepResult(
        { ...input, snapshot: { ...input.snapshot, runId: runId('other') } },
        request(),
      ),
    ).toThrow(RangeError);
    const mismatchedTick: FightingSpatialStepResult = {
      ...input,
      snapshot: { ...input.snapshot, tick: tick(9) },
      fighting: { ...input.fighting, stepTick: tick(9) },
    };
    expect(() =>
      captureFightingSpatialStepResult(mismatchedTick, request()),
    ).toThrow(RangeError);
  });
});

// A1 structural fixtures deliberately do not claim asset rig/sole authenticity.
import * as transactionContracts from '../../src/contracts/fighting';
import type {
  FightingClockPoint,
  FightingRecipeEntry,
  FightingPoseContext,
  FightingProjectInput,
  FightingSpatialFrontier,
  FightingSpatialCommitReceipt,
  FightingSpatialTranscript,
} from '../../src/contracts/fighting';

const actualEntry = (atMs = 0): FightingRecipeEntry => ({
  recipeVersion: 'actual53-ik-surface-v1',
  clipId: clip,
  atMs,
  pose: Array.from({ length: 53 }, (_, i) => ({
    name: `structural-${i}`,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  })),
  support: [
    { side: 'L', planted: true, local: [0, 0, 0], worldRotation: [0, 0, 0, 1] },
    { side: 'R', planted: true, local: [0, 0, 0], worldRotation: [0, 0, 0, 1] },
  ],
});
const selectedPoint = (
  patch: Partial<FightingClockPoint> = {},
): FightingClockPoint => ({
  runId: run,
  actorId: actor,
  stepTick: tick(8),
  atGameMs: gameTimeMs(110.75),
  epochId: 'landing-epoch',
  clipId: clip,
  activationId: null,
  motionMs: durationMs(0),
  phase: 'landing',
  posture: 'standing',
  ...patch,
});
const endpointClock = (id = actor): FightingClock => ({
  ...clock(),
  activeEpochId: 'landing-epoch',
  slices: [{ ...slice(), actorId: id }],
  endpoint: selectedPoint({ actorId: id }),
});
const transactionClockContext = (
  mode: 'interval' | 'settle' | 'bootstrap' = 'interval',
) => ({
  ...clockContext(),
  runId: run,
  queryMode: mode,
  ...(mode === 'settle' ? { fromGameMs: gameTimeMs(110.75) } : {}),
});
const poseContext = (id = actor): FightingPoseContext => ({
  runId: run,
  actorId: id,
  stepTick: tick(8),
  epochId: 'landing-epoch',
  commitId: 'receipt-8',
  entryKind: 'epoch-transition',
  incoming: actualEntry(14),
  facingBasis: vector,
  acceptedRoot: { x: 0, z: 0 },
  support: { supportId: 'floor', planeY: 0, groundClearanceM: 0 },
});
const transactionQuery = (): FightingProjectInput => ({
  version: 1,
  transactionId: 'attempt-8',
  runId: run,
  stepTick: tick(8),
  fromGameMs: gameTimeMs(100.25),
  toGameMs: gameTimeMs(110.75),
  revision: 0,
  acceptedProjectionId: null,
  queryMode: 'interval',
  cursorGameMs: gameTimeMs(100.25),
  horizonGameMs: gameTimeMs(110.75),
  snapshot: {
    ...request().snapshot,
    residentActorIds: [actor, target],
    actors: [actor, target].map((id) => ({
      ...actorSnapshot(id),
      fighting: { ...state(), phase: 'hitstun', posture: 'airborne' },
      fightingClock: endpointClock(id),
    })),
  },
  selectedPoses: [actor, target].map((id) => ({
    actorId: id,
    epochId: 'epoch-1',
    phase: 'hitstun',
    posture: 'airborne',
  })),
  acceptedPrefix: [actor, target].map((id) => ({
    actor: spatialActor(id),
    endpoint: selectedPoint({
      actorId: id,
      stepTick: tick(7),
      atGameMs: gameTimeMs(100.25),
      epochId: `installed-${id}`,
      phase: 'neutral',
    }),
    pose: {
      source: {
        kind: 'query',
        transactionId: 'previous-attempt-7',
        queryRevision: 0,
        actorId: id,
        epochId: `installed-${id}`,
        clipId: clip,
        activationId: null,
        atGameMs: gameTimeMs(100.25),
        motionMs: durationMs(0),
      },
      facingBasis: vector,
      acceptedRoot: { x: 0, z: 0 },
      support: { supportId: 'floor', planeY: 0, groundClearanceM: 0 },
      sample: actualEntry(),
      incoming: actualEntry(),
      entryKind: 'continuous',
    },
  })),
  acceptedEvents: [],
  settledOccurrenceIds: [],
  settledPhysicalSeamIds: [],
});
const boundaryFrontier = (): FightingSpatialFrontier => ({
  projectionId: 'projection-0',
  revision: 0,
  atGameMs: gameTimeMs(110.75),
  kind: 'boundary',
  occurrenceIds: [],
  physicalSeamIds: [],
  result: {
    snapshot: { ...result().snapshot },
    candidates: [],
    fighting: { stepTick: tick(8), takeoffs: [], landings: [], contacts: [] },
  },
  acceptedPrefix: [actor, target].map((id) => ({
    actor: spatialActor(id),
    pose: {
      source: {
        kind: 'query',
        transactionId: 'attempt-8',
        queryRevision: 0,
        actorId: id,
        epochId: 'landing-epoch',
        clipId: clip,
        activationId: null,
        atGameMs: gameTimeMs(110.75),
        motionMs: durationMs(0),
      },
      facingBasis: vector,
      acceptedRoot: { x: 0, z: 0 },
      support: { supportId: 'floor', planeY: 0, groundClearanceM: 0 },
      sample: actualEntry(),
      incoming: actualEntry(14),
      entryKind: 'epoch-transition',
    },
  })),
});
const receiptContext = () => {
  const q = transactionQuery();
  return {
    header: q,
    acceptedProjectionId: 'projection-0',
    output: {
      snapshot: {
        ...q.snapshot,
        actors: q.snapshot.actors.map((a) => ({
          ...a,
          fighting: { ...state(), phase: 'landing' as const },
        })),
      },
      events: [],
    },
    acceptedPrefix: boundaryFrontier().acceptedPrefix.map((p) => ({
      ...p,
      endpoint: selectedPoint({ actorId: p.actor.actorId }),
    })),
  };
};
const transactionReceipt = (): FightingSpatialCommitReceipt => ({
  version: 1,
  transactionId: 'attempt-8',
  runId: run,
  stepTick: tick(8),
  fromGameMs: gameTimeMs(100.25),
  toGameMs: gameTimeMs(110.75),
  receiptId: 'receipt-8',
  acceptedProjectionId: 'projection-0',
  outputRevision: 1,
  snapshot: result().snapshot,
  endpoints: [actor, target].map((id) => selectedPoint({ actorId: id })),
  poseContexts: [actor, target].map(poseContext),
});
const frontierContext = () => ({
  query: transactionQuery(),
  request: request(),
  policy: {
    mode: 'battle-transaction-v1' as const,
    maxFrontiers: 20,
    maxSameTimeFrontiers: 5,
  },
});

describe('A1 canonical endpoint and bounded pose contracts', () => {
  it('owns E by its explicit new epoch without a synthetic interval', () => {
    const captured = transactionContracts.captureFightingTransactionalClock(
      endpointClock(),
      transactionClockContext(),
    );
    expect(captured.endpoint).toEqual(selectedPoint());
    expect(captured.slices).toHaveLength(1);
    expect(fightingClockSliceAt(captured, gameTimeMs(110.75))).toBeNull();
    expect(() =>
      transactionContracts.captureFightingTransactionalClock(
        {
          ...endpointClock(),
          endpoint: selectedPoint({ motionMs: durationMs(0.001) }),
        },
        transactionClockContext(),
      ),
    ).toThrow();
    expect(() =>
      transactionContracts.captureFightingTransactionalClock(
        clock(),
        transactionClockContext(),
      ),
    ).toThrow();
    expect(captureFightingClock(clock()).activeEpochId).toBe('epoch-1');
  });
  it('requires exact contextual zero-time coverage and supports endpoint-only lookup', () => {
    const zero = { ...endpointClock(), slices: [] };
    const admitted = transactionContracts.captureFightingTransactionalClock(
      zero,
      transactionClockContext('settle'),
    );
    expect(fightingClockSliceAt(admitted, gameTimeMs(110.75))).toBeNull();
    expect(() => captureFightingClock(zero)).toThrow();
    expect(() =>
      transactionContracts.captureFightingTransactionalClock(
        zero,
        transactionClockContext(),
      ),
    ).toThrow();
    expect(() =>
      transactionContracts.captureFightingTransactionalClock(
        endpointClock(),
        transactionClockContext('settle'),
      ),
    ).toThrow();
  });
  it('rejects same-epoch endpoint drift and foreign point identity', () => {
    const endpoint = selectedPoint({
      epochId: 'epoch-1',
      activationId: activation,
      motionMs: durationMs(14),
    });
    const same = { ...clock(), endpoint };
    expect(
      transactionContracts.captureFightingTransactionalClock(
        same,
        transactionClockContext(),
      ).endpoint,
    ).toEqual(endpoint);
    for (const patch of [
      { motionMs: durationMs(13) },
      { activationId: null },
      { clipId: clipId('foreign') },
      { stepTick: tick(7) },
      { runId: runId('other') },
      { actorId: target },
      { atGameMs: gameTimeMs(110) },
    ]) {
      expect(() =>
        transactionContracts.captureFightingTransactionalClock(
          { ...same, endpoint: { ...endpoint, ...patch } },
          transactionClockContext(),
        ),
      ).toThrow();
    }
  });
  it('rejects coercion, accessors and nonprimitive identifiers without executing getters', () => {
    for (const invalid of ['110.75', Object(110.75), NaN, Infinity, -1]) {
      const p = selectedPoint();
      Reflect.set(p, 'atGameMs', invalid);
      expect(() => transactionContracts.captureFightingClockPoint(p)).toThrow();
    }
    let reads = 0;
    const p = selectedPoint();
    Object.defineProperty(p, 'epochId', {
      get() {
        reads++;
        return 'forged';
      },
    });
    expect(() => transactionContracts.captureFightingClockPoint(p)).toThrow();
    expect(reads).toBe(0);
    Reflect.set(p, 'runId', { trim: () => 'run' });
    expect(() => transactionContracts.captureFightingClockPoint(p)).toThrow();
  });
  it('detaches all 53 TRS and two feet without freezing the producer', () => {
    const input = actualEntry(),
      captured = transactionContracts.captureFightingRecipeEntry(input);
    const before = JSON.stringify(captured);
    const last = input.pose.at(-1),
      foot = input.support.at(-1);
    if (!last || !foot) throw new Error('fixture cardinality');
    Reflect.set(last.position, '1', 99);
    Reflect.set(foot.local, '0', 99);
    expect(JSON.stringify(captured)).toBe(before);
    expect(Object.isFrozen(captured.pose.at(-1)?.quaternion)).toBe(true);
    expect(Object.isFrozen(captured.support.at(-1))).toBe(true);
    expect(Object.isFrozen(input.pose)).toBe(false);
  });
  it('rejects late invalid transforms, sparse tuples, duplicates, recursive history and wrong booleans', () => {
    const mutations: ((entry: FightingRecipeEntry) => void)[] = [
      (e) => Reflect.set(e, 'pose', e.pose.slice(1)),
      (e) => Reflect.set(e.pose.at(-1) ?? {}, 'quaternion', [0, 0, 0, 0]),
      (e) => Reflect.set(e.pose.at(-1) ?? {}, 'scale', [1, 0, 1]),
      (e) => {
        const sparse = [0, 0, 0];
        Reflect.deleteProperty(sparse, '1');
        Reflect.set(e.pose.at(-1) ?? {}, 'position', sparse);
      },
      (e) => Reflect.set(e.pose.at(-1) ?? {}, 'name', 'structural-0'),
      (e) => Reflect.set(e.support.at(-1) ?? {}, 'side', 'L'),
      (e) => Reflect.set(e.support.at(-1) ?? {}, 'planted', 'true'),
      (e) => Reflect.set(e, 'incoming', actualEntry()),
    ];
    for (const mutate of mutations) {
      const e = actualEntry();
      mutate(e);
      expect(() =>
        transactionContracts.captureFightingRecipeEntry(e),
      ).toThrow();
      expect(Object.isFrozen(e)).toBe(false);
    }
  });
  it('keeps historical incoming bounded and forbids a second timer or root Y', () => {
    const c = transactionContracts.captureFightingPoseContext(poseContext());
    expect(c.incoming?.atMs).toBe(14);
    for (const [key, value] of [
      ['incoming', undefined],
      ['motionMs', 10],
      ['acceptedRoot', { x: 0, y: 1, z: 0 }],
    ]) {
      const bad = poseContext();
      Reflect.set(bad, String(key), value);
      expect(() =>
        transactionContracts.captureFightingPoseContext(bad),
      ).toThrow();
    }
    expect(() =>
      transactionContracts.captureFightingSupportContext({
        supportId: 'floor',
        planeY: 2,
        groundClearanceM: -0.01,
      }),
    ).toThrow();
  });
  it('captures holds without turning their silhouette into defense or changing logical blockstun', () => {
    const hold = transactionContracts.captureFightingPoseHold({
      reason: 'inputs-released',
      displayEpochId: 'landing-epoch',
    });
    expect(hold).toEqual({
      reason: 'inputs-released',
      displayEpochId: 'landing-epoch',
    });
    const bad = { ...hold };
    Reflect.set(bad, 'reason', 'guard-authority');
    expect(() => transactionContracts.captureFightingPoseHold(bad)).toThrow();
    expect(
      captureFightingCombatantState({
        ...state(),
        phase: 'blockstun',
        guardHeld: false,
        guardHeight: 'crouching',
        posture: 'crouching',
        stunTicksRemaining: 2,
      }).guardHeight,
    ).toBe('crouching');
  });
});

describe('A1 projection roles, frontier evidence and receipts', () => {
  it('accepts prior tick7 physical prefix and current tick8 selected airborne hitstun suffix', () => {
    const q = transactionContracts.captureFightingProjectInput(
      transactionQuery(),
    );
    expect(q.acceptedPrefix[0]?.endpoint.stepTick).toBe(7);
    expect(q.selectedPoses[0]?.posture).toBe('airborne');
    expect(q.snapshot.actors[0]?.fightingClock?.endpoint?.phase).toBe(
      'landing',
    );
    expect(Object.isFrozen(q.snapshot.actors)).toBe(true);
  });
  it('rejects prefix/suffix role confusion, missing classification and mixed world scope', () => {
    const mutations: ((q: FightingProjectInput) => void)[] = [
      (q) =>
        Reflect.set(q.acceptedPrefix[0]?.endpoint ?? {}, 'stepTick', tick(9)),
      (q) =>
        Reflect.set(
          q.acceptedPrefix[0]?.endpoint ?? {},
          'atGameMs',
          gameTimeMs(110.75),
        ),
      (q) => Reflect.set(q, 'selectedPoses', q.selectedPoses.slice(1)),
      (q) => Reflect.set(q.selectedPoses[0] ?? {}, 'epochId', 'landing-epoch'),
      (q) =>
        Reflect.set(q, 'acceptedPrefix', [
          q.acceptedPrefix[0],
          q.acceptedPrefix[0],
        ]),
      (q) => Reflect.set(q.snapshot.world, 'objects', [{}]),
      (q) => Reflect.set(q, 'acceptedProjectionId', 'unacknowledged'),
      (q) => Reflect.set(q, 'settledOccurrenceIds', ['same', 'same']),
    ];
    for (const mutate of mutations) {
      const q = transactionQuery();
      mutate(q);
      expect(() =>
        transactionContracts.captureFightingProjectInput(q),
      ).toThrow();
    }
  });
  it('captures a complete frontier without requiring D to author a post-reaction clock', () => {
    const f = transactionContracts.captureFightingSpatialFrontier(
      boundaryFrontier(),
      frontierContext(),
    );
    expect(Object.hasOwn(f.acceptedPrefix[0] ?? {}, 'endpoint')).toBe(false);
    expect(f.result.snapshot.tick).toBe(8);
    expect(Object.isFrozen(f.acceptedPrefix[0]?.pose.sample.pose)).toBe(true);
  });
  it('rejects stale source references, retrograde cuts, no-progress boundaries and actor substitution', () => {
    const mutations: ((f: FightingSpatialFrontier) => void)[] = [
      (f) => Reflect.set(f, 'revision', 1),
      (f) => Reflect.set(f, 'atGameMs', gameTimeMs(100)),
      (f) => Reflect.set(f, 'atGameMs', gameTimeMs(100.25)),
      (f) =>
        Reflect.set(
          f.acceptedPrefix[0]?.pose.source ?? {},
          'epochId',
          'invented-reaction',
        ),
      (f) =>
        Reflect.set(f.acceptedPrefix[0]?.pose.source ?? {}, 'queryRevision', 1),
      (f) => Reflect.set(f.acceptedPrefix[0]?.actor.position ?? {}, 'y', 3),
    ];
    for (const mutate of mutations) {
      const f = boundaryFrontier();
      mutate(f);
      expect(() =>
        transactionContracts.captureFightingSpatialFrontier(
          f,
          frontierContext(),
        ),
      ).toThrow();
    }
  });
  it('rejects exact-end body contacts and reused occurrence identities', () => {
    const f = boundaryFrontier();
    Reflect.set(f, 'kind', 'contacts');
    Reflect.set(f, 'occurrenceIds', ['occurrence']);
    Reflect.set(f, 'result', {
      ...result(),
      candidates: result().candidates.map((c) => ({
        ...c,
        at: gameTimeMs(110.75),
      })),
      fighting: {
        ...result().fighting,
        landings: [],
        contacts: [{ ...contact(), atGameMs: gameTimeMs(110.75) }],
      },
    });
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(f, frontierContext()),
    ).toThrow();
  });
  it('binds final receipt to current tick, original full E, exact physical prefix and commit ID', () => {
    const c = transactionContracts.captureFightingSpatialCommitReceipt(
      transactionReceipt(),
      receiptContext(),
    );
    expect(c.poseContexts.every((p) => p.commitId === c.receiptId)).toBe(true);

    const mutations: ((r: FightingSpatialCommitReceipt) => void)[] = [
      (r) => Reflect.set(r.endpoints[0] ?? {}, 'stepTick', tick(7)),
      (r) => Reflect.set(r.poseContexts[0] ?? {}, 'commitId', 'old-receipt'),
      (r) =>
        Reflect.set(r.poseContexts[0] ?? {}, 'epochId', 'unsettled-old-epoch'),
      (r) => Reflect.set(r, 'transactionId', 'other-attempt'),
      (r) => Reflect.set(r, 'outputRevision', 2),
      (r) => Reflect.set(r, 'poseContexts', r.poseContexts.slice(1)),
      (r) => Reflect.set(r.snapshot.actors[0]?.position ?? {}, 'x', 99),
    ];
    for (const mutate of mutations) {
      const r = transactionReceipt();
      mutate(r);
      expect(() =>
        transactionContracts.captureFightingSpatialCommitReceipt(
          r,
          receiptContext(),
        ),
      ).toThrow();
    }
  });
});

describe('A1 bootstrap, explicit NON-DTO envelope and pure transcript', () => {
  const descriptor = () => ({
    version: 1 as const,
    bindingSetId: 'authenticated-pack',
    clipId: clip,
    supportPlane: { supportId: 'floor', planeY: 0 },
    surfaceToleranceM: 0.0001,
    actors: [actor, target].map((id) => ({
      actorId: id,
      position: { x: 0, y: 0, z: 0 },
      facingBasis: vector,
    })),
  });
  it('admits zero-time actor-bound bootstrap and rejects forged ordinary omissions', () => {
    const bootstrap = {
      residentActorIds: [actor, target],
      runId: run,
      descriptor: descriptor(),
      endpoints: [actor, target].map((id) =>
        selectedPoint({
          actorId: id,
          stepTick: tick(0),
          atGameMs: gameTimeMs(0),
          phase: 'neutral',
        }),
      ),
      poseContexts: [actor, target].map((id) => ({
        runId: run,
        actorId: id,
        stepTick: tick(0),
        epochId: 'landing-epoch',
        commitId: `bootstrap-${id}`,
        entryKind: 'initial-ready' as const,
        facingBasis: vector,
        acceptedRoot: { x: 0, z: 0 },
        support: { supportId: 'floor', planeY: 0, groundClearanceM: 0 },
      })),
    };
    expect(
      transactionContracts.captureFightingBootstrap(bootstrap).endpoints,
    ).toHaveLength(2);
    Reflect.set(bootstrap.poseContexts[1] ?? {}, 'actorId', actor);
    expect(() =>
      transactionContracts.captureFightingBootstrap(bootstrap),
    ).toThrow();
    expect(() =>
      transactionContracts.captureFightingReadyDescriptor({
        ...descriptor(),
        surfaceToleranceM: -1,
      }),
    ).toThrow();
    expect(() =>
      transactionContracts.captureFightingSpatialTransactionPolicy({
        mode: 'battle-transaction-v1',
        maxFrontiers: 0,
        maxSameTimeFrontiers: 1,
      }),
    ).toThrow();
  });
  it('guards explicit resource binding without invoking methods', () => {
    let calls = 0;
    const capability = {
      version: 1,
      mode: 'battle-transaction-v1',
      bindPrepared() {
        calls++;
      },
    };
    expect(
      transactionContracts.isFightingPreparedSpatialCapability(capability),
    ).toBe(true);
    expect(
      transactionContracts.isFightingPreparedSpatialCapability({
        ...capability,
        version: 2,
      }),
    ).toBe(false);
    const getter = { version: 1, mode: 'battle-transaction-v1' };
    Object.defineProperty(getter, 'bindPrepared', {
      get() {
        calls++;
        return () => {};
      },
    });
    expect(
      transactionContracts.isFightingPreparedSpatialCapability(getter),
    ).toBe(false);
    expect(calls).toBe(0);
  });
  it('snapshots transaction method references separately from its pure proposal', () => {
    let calls = 0;
    const port = {
      ...transactionReceipt(),
      project: () => boundaryFrontier(),
      finish: () => transactionReceipt(),
      abort() {
        calls++;
      },
    };
    const envelope = {
      ...result(),
      kind: 'fighting-spatial-transaction-v1' as const,
      initialPrefix: installedInitialPrefix(),
      transaction: port,
    };
    const captured =
      transactionContracts.captureFightingSpatialTransactionResult(
        envelope,
        request(),
      );
    expect(calls).toBe(0);
    Reflect.set(port, 'abort', () => {
      calls += 100;
    });
    captured.transaction.abort();
    expect(calls).toBe(1);
    const malformedEnvelope = {
      ...envelope,
      transaction: { ...port, finish: null },
    };
    expect(
      transactionContracts.isFightingSpatialTransactionResult(
        malformedEnvelope,
      ),
    ).toBe(false);
    expect(() =>
      captureFightingSpatialStepResult(envelope, request()),
    ).toThrow();
    expect(Object.isFrozen(port)).toBe(false);
  });
  it('keeps a detached ordered pure tape, including returned-invalid receipt followed by abort', () => {
    const transcript: FightingSpatialTranscript = {
      initialPrefix: installedInitialPrefix(),
      header: transactionQuery(),
      proposal: { snapshot: result().snapshot, candidates: [] },
      interactions: [
        {
          kind: 'project',
          input: transactionQuery(),
          outcome: { kind: 'returned', value: boundaryFrontier() },
        },
        {
          kind: 'finish',
          input: {
            acceptedProjectionId: 'projection-0',
            output: receiptContext().output,
          },
          outcome: {
            kind: 'returned',
            value: {
              ...transactionReceipt(),
              receiptId: 'returned-but-rejected',
            },
          },
        },
        {
          kind: 'abort',
          outcome: {
            kind: 'threw',
            diagnostic: { name: 'Error', message: 'cleanup failed' },
          },
        },
      ],
      terminal: {
        kind: 'aborted',
        diagnostic: { name: 'RangeError', message: 'receipt rejected' },
      },
    };
    const c = transactionContracts.captureFightingSpatialTranscript(transcript);
    expect(c.interactions.map((i) => i.kind)).toEqual([
      'project',
      'finish',
      'abort',
    ]);
    expect(Object.isFrozen(c.interactions[1])).toBe(true);
    Reflect.set(
      transcript.terminal,
      'diagnostic',
      new Error('not a diagnostic'),
    );
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(transcript),
    ).toThrow();
    Reflect.set(transcript, 'callback', () => {});
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(transcript),
    ).toThrow();
  });
});

describe('A1 exact frontier and frozen-tail regressions', () => {
  const contactFrontier = (): FightingSpatialFrontier => {
    const f = boundaryFrontier(),
      at = gameTimeMs(105.125),
      motion = durationMs(8.375);
    return {
      ...f,
      kind: 'contacts',
      atGameMs: at,
      occurrenceIds: ['occurrence-1'],
      result: {
        ...result(),
        fighting: {
          ...result().fighting,
          landings: [],
          contacts: [
            {
              ...contact(),
              targetPosition: { ...vector },
              sourceFacing: { ...vector },
            },
          ],
        },
      },
      acceptedPrefix: f.acceptedPrefix.map((p) => ({
        ...p,
        pose: {
          ...p.pose,
          source: {
            ...p.pose.source,
            epochId: 'epoch-1',
            activationId: activation,
            atGameMs: at,
            motionMs: motion,
          },
          sample: actualEntry(motion),
        },
      })),
    };
  };
  it('accepts an exact-time body batch and rejects reuse after acknowledgement', () => {
    const f = contactFrontier();
    expect(
      transactionContracts.captureFightingSpatialFrontier(f, frontierContext())
        .result.candidates,
    ).toHaveLength(1);
    const context = frontierContext();
    Reflect.set(context.query, 'settledOccurrenceIds', ['occurrence-1']);
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(f, context),
    ).toThrow();
  });
  it('requires contact position/facing witnesses to equal the physical cut', () => {
    const f = contactFrontier();
    Reflect.set(f.result.fighting.contacts[0]?.sourcePosition ?? {}, 'x', 20);
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(f, frontierContext()),
    ).toThrow();
  });
  it('retains takeoff then landing even when final grounded state is unchanged', () => {
    const f = contactFrontier(),
      at = f.atGameMs;
    const physical: FightingSpatialFrontier = {
      ...f,
      kind: 'physical',
      occurrenceIds: [],
      physicalSeamIds: ['takeoff', 'landing'],
      result: {
        snapshot: f.result.snapshot,
        candidates: [],
        fighting: {
          stepTick: tick(8),
          contacts: [],
          takeoffs: [{ actorId: actor, atGameMs: at, position: vector }],
          landings: [
            {
              actorId: actor,
              atGameMs: at,
              position: vector,
              supportId: 'floor',
              airborneActivationId: activation,
            },
          ],
        },
      },
    };
    expect(
      transactionContracts.captureFightingSpatialFrontier(
        physical,
        frontierContext(),
      ).result.fighting.takeoffs,
    ).toHaveLength(1);
  });
  it('captures zero-time reclassification without integrating or inferring posture from a clip', () => {
    const q = transactionQuery();
    const settle: FightingProjectInput = {
      ...q,
      revision: 1,
      acceptedProjectionId: 'projection-0',
      queryMode: 'settle',
      cursorGameMs: gameTimeMs(110.75),
      horizonGameMs: gameTimeMs(110.75),
      acceptedPrefix: receiptContext().acceptedPrefix,
      selectedPoses: q.selectedPoses.map((p) => ({
        ...p,
        epochId: 'landing-epoch',
        phase: 'landing',
        posture: 'standing',
      })),
      snapshot: {
        ...receiptContext().output.snapshot,
        actors: receiptContext().output.snapshot.actors.map((a) => ({
          ...a,
          fightingClock: { ...endpointClock(a.actorId), slices: [] },
        })),
      },
    };
    expect(
      transactionContracts.captureFightingProjectInput(settle).queryMode,
    ).toBe('settle');
    const f = {
      ...boundaryFrontier(),
      revision: 1,
      projectionId: 'settled',
      acceptedPrefix: boundaryFrontier().acceptedPrefix.map((p) => ({
        ...p,
        pose: { ...p.pose, source: nextQuerySource(p.pose.source, 1) },
      })),
    };
    expect(
      transactionContracts.captureFightingSpatialFrontier(f, {
        ...frontierContext(),
        query: settle,
      }).atGameMs,
    ).toBe(110.75);
    Reflect.set(f.acceptedPrefix[0]?.actor.velocity ?? {}, 'x', 1);
    Reflect.set(f.result.snapshot.actors[0]?.velocity ?? {}, 'x', 1);
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(f, {
        ...frontierContext(),
        query: settle,
      }),
    ).toThrow();
  });
  it('rejects a finite but inconsistent support clearance instead of silently clamping it', () => {
    const q = transactionQuery();
    Reflect.set(
      q.acceptedPrefix[0]?.pose.support ?? {},
      'groundClearanceM',
      0.001,
    );
    expect(() => transactionContracts.captureFightingProjectInput(q)).toThrow();
  });
  it('requires an explicit frozen tail through original E when terminal public time is earlier', () => {
    const r = transactionReceipt(),
      context = receiptContext();
    Reflect.set(
      context.output.snapshot.clocks,
      'gameTimeMs',
      gameTimeMs(105.125),
    );
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(r, context),
    ).toThrow();
    const cut = gameTimeMs(105.125),
      motion = durationMs(8.375);
    const points = [actor, target].map((id) =>
      selectedPoint({
        actorId: id,
        epochId: 'epoch-1',
        activationId: activation,
        motionMs: motion,
        phase: 'defeated',
        posture: 'airborne',
      }),
    );
    const poses = [actor, target].map((id) => ({
      ...poseContext(id),
      epochId: 'epoch-1',
      defeatEntry: actualEntry(motion),
    }));
    const frozenReceipt = { ...r, endpoints: points, poseContexts: poses };
    const output = {
      ...context.output,
      snapshot: {
        ...context.output.snapshot,
        actors: context.output.snapshot.actors.map((a) => ({
          ...a,
          defeated: true,
          fighting: {
            ...state(),
            phase: 'defeated' as const,
            posture: 'airborne' as const,
          },
          fightingClock: {
            stepTick: tick(8),
            activeEpochId: 'epoch-1',
            endpoint: selectedPoint({
              actorId: a.actorId,
              epochId: 'epoch-1',
              activationId: activation,
              motionMs: motion,
              phase: 'defeated',
              posture: 'airborne',
            }),
            slices: [
              {
                ...slice(),
                actorId: a.actorId,
                toGameMs: cut,
                toMotionMs: motion,
              },
              {
                ...slice(),
                actorId: a.actorId,
                fromGameMs: cut,
                fromMotionMs: motion,
                toMotionMs: motion,
                frozen: true,
              },
            ],
          },
        })),
      },
    };
    const acceptedPrefix = context.acceptedPrefix.map((p) => ({
      ...p,
      endpoint: selectedPoint({
        actorId: p.actor.actorId,
        epochId: 'epoch-1',
        activationId: activation,
        motionMs: motion,
        phase: 'defeated',
        posture: 'airborne',
      }),
      pose: {
        ...p.pose,
        source: {
          ...p.pose.source,
          epochId: 'epoch-1',
          activationId: activation,
          motionMs: motion,
        },
        sample: actualEntry(motion),
        defeatEntry: actualEntry(motion),
      },
    }));
    expect(
      transactionContracts.captureFightingSpatialCommitReceipt(frozenReceipt, {
        ...context,
        output,
        acceptedPrefix,
      }).toGameMs,
    ).toBe(110.75);
  });
});

describe('A1 structural guard and selected-state validation', () => {
  it('does not call an envelope valid when its proposal is null or has foreign run/tick', () => {
    const envelope = {
      kind: 'fighting-spatial-transaction-v1',
      initialPrefix: installedInitialPrefix(),
      snapshot: result().snapshot,
      candidates: [],
      transaction: {
        ...transactionReceipt(),
        project: () => boundaryFrontier(),
        finish: () => transactionReceipt(),
        abort() {},
      },
    };
    expect(
      transactionContracts.isFightingSpatialTransactionResult(envelope),
    ).toBe(true);
    Reflect.set(envelope, 'snapshot', null);
    expect(
      transactionContracts.isFightingSpatialTransactionResult(envelope),
    ).toBe(false);
    Reflect.set(envelope, 'snapshot', { ...result().snapshot, tick: tick(7) });
    expect(
      transactionContracts.isFightingSpatialTransactionResult(envelope),
    ).toBe(false);
  });
  it('rejects far-end phase/posture substituted for the selected interval state', () => {
    const q = transactionQuery();
    Reflect.set(q.selectedPoses[0] ?? {}, 'phase', 'landing');
    Reflect.set(q.selectedPoses[0] ?? {}, 'posture', 'standing');
    expect(() => transactionContracts.captureFightingProjectInput(q)).toThrow();
  });
  it('rejects replayed first-query events and foreign accepted event provenance', () => {
    const q = transactionQuery();
    Reflect.set(q, 'acceptedEvents', [
      {
        type: 'ProgressChanged',
        runId: 'foreign',
        eventId: 'event-1',
        sequence: 1,
        at: 100.25,
        phase: 'running',
        pauseReasons: [],
      },
    ]);
    expect(() => transactionContracts.captureFightingProjectInput(q)).toThrow();
  });
});

describe('A1 independent review fix round 1', () => {
  it('I1: an accepted settlement and receipt feed the next step without relabeling source revision', () => {
    const q = transactionQuery(),
      baseContext = receiptContext();
    const settle: FightingProjectInput = {
      ...q,
      revision: 1,
      acceptedProjectionId: 'projection-0',
      queryMode: 'settle',
      cursorGameMs: gameTimeMs(110.75),
      horizonGameMs: gameTimeMs(110.75),
      acceptedPrefix: baseContext.acceptedPrefix,
      selectedPoses: q.selectedPoses.map((p) => ({
        ...p,
        epochId: 'landing-epoch',
        phase: 'landing',
        posture: 'standing',
      })),
      snapshot: {
        ...baseContext.output.snapshot,
        actors: baseContext.output.snapshot.actors.map((a) => ({
          ...a,
          fightingClock: { ...endpointClock(a.actorId), slices: [] },
        })),
      },
    };
    const f = transactionContracts.captureFightingSpatialFrontier(
      {
        ...boundaryFrontier(),
        revision: 1,
        projectionId: 'settled',
        acceptedPrefix: boundaryFrontier().acceptedPrefix.map((p) => ({
          ...p,
          pose: { ...p.pose, source: nextQuerySource(p.pose.source, 1) },
        })),
      },
      { ...frontierContext(), query: settle },
    );
    const acceptedPrefix = f.acceptedPrefix.map((p) => ({
      ...p,
      endpoint: selectedPoint({ actorId: p.actor.actorId }),
    }));
    const receipt = transactionContracts.captureFightingSpatialCommitReceipt(
      { ...transactionReceipt(), acceptedProjectionId: 'settled' },
      { ...baseContext, acceptedProjectionId: 'settled', acceptedPrefix },
    );
    expect(receipt.stepTick).toBe(8);
    const next: FightingProjectInput = {
      ...q,
      transactionId: 'attempt-9',
      stepTick: tick(9),
      fromGameMs: gameTimeMs(110.75),
      toGameMs: gameTimeMs(121.25),
      cursorGameMs: gameTimeMs(110.75),
      horizonGameMs: gameTimeMs(121.25),
      acceptedPrefix,
      selectedPoses: settle.selectedPoses,
      snapshot: {
        ...baseContext.output.snapshot,
        clocks: {
          ...q.snapshot.clocks,
          tick: tick(9),
          gameTimeMs: gameTimeMs(121.25),
        },
        actors: baseContext.output.snapshot.actors.map((a) => ({
          ...a,
          fightingClock: {
            stepTick: tick(9),
            activeEpochId: 'landing-epoch',
            slices: [
              {
                ...slice(),
                actorId: a.actorId,
                epochId: 'landing-epoch',
                activationId: null,
                fromGameMs: gameTimeMs(110.75),
                toGameMs: gameTimeMs(121.25),
                fromMotionMs: durationMs(0),
                toMotionMs: durationMs(10.5),
              },
            ],
            endpoint: selectedPoint({
              actorId: a.actorId,
              stepTick: tick(9),
              atGameMs: gameTimeMs(121.25),
              motionMs: durationMs(10.5),
            }),
          },
        })),
      },
    };
    const captured = transactionContracts.captureFightingProjectInput(next);
    expect(captured.acceptedPrefix[0]?.pose.source.queryRevision).toBe(1);
    expect(captured.revision).toBe(0);
    expect(captured.acceptedPrefix[0]?.endpoint.stepTick).toBe(8);
    expect(captured.stepTick).toBe(9);
    // This exception is only for the installed first prefix, not current-attempt acknowledgements.
    expect(() =>
      transactionContracts.captureFightingProjectInput({
        ...next,
        revision: 1,
        acceptedProjectionId: 'current-attempt-frontier',
      }),
    ).toThrow();
  });

  it('I2: rejects bootstrap-only and unproved reset omissions in ordinary step receipts', () => {
    const receipt = transactionReceipt(),
      context = receiptContext();
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        receipt,
        context,
      ),
    ).not.toThrow();
    for (const pose of receipt.poseContexts) {
      Reflect.set(pose, 'entryKind', 'initial-ready');
      Reflect.deleteProperty(pose, 'incoming');
    }
    for (const prefix of context.acceptedPrefix) {
      Reflect.set(prefix.pose, 'entryKind', 'initial-ready');
      Reflect.deleteProperty(prefix.pose, 'incoming');
    }
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        receipt,
        context,
      ),
    ).toThrow();
    for (const pose of receipt.poseContexts)
      Reflect.set(pose, 'entryKind', 'encounter-reset');
    for (const prefix of context.acceptedPrefix)
      Reflect.set(prefix.pose, 'entryKind', 'encounter-reset');
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        receipt,
        context,
      ),
    ).toThrow();
  });
  for (const key of ['query', 'request', 'policy'] as const) {
    it(`I3: rejects outer frontier context ${key} getter before invocation`, () => {
      const context = frontierContext(),
        value = context[key];
      let calls = 0;
      Object.defineProperty(context, key, {
        enumerable: true,
        get() {
          calls++;
          return value;
        },
      });
      expect(() =>
        transactionContracts.captureFightingSpatialFrontier(
          boundaryFrontier(),
          context,
        ),
      ).toThrow();
      expect(calls).toBe(0);
      expect(Object.isFrozen(context)).toBe(false);
    });
  }
  it('I3: rejects custom array prototypes before inherited iterator invocation', () => {
    const entry = actualEntry();
    let calls = 0;
    const prototype = {
      [Symbol.iterator]() {
        calls++;
        return [][Symbol.iterator]();
      },
    };
    Object.setPrototypeOf(prototype, Array.prototype);
    Object.setPrototypeOf(entry.pose, prototype);
    expect(() =>
      transactionContracts.captureFightingRecipeEntry(entry),
    ).toThrow();
    expect(calls).toBe(0);
    expect(Object.isFrozen(entry.pose)).toBe(false);
    expect(Object.getPrototypeOf(entry.pose)).toBe(prototype);
    expect(
      transactionContracts.captureFightingRecipeEntry(actualEntry()).pose,
    ).toHaveLength(53);
  });
  it('M1: validates every supplied optional defeat entry instead of erasing falsy values', () => {
    for (const invalid of [false, null, 0, '']) {
      const pose = poseContext();
      Reflect.set(pose, 'defeatEntry', invalid);
      expect(() =>
        transactionContracts.captureFightingPoseContext(pose),
      ).toThrow();
    }
    expect(
      transactionContracts.captureFightingPoseContext(poseContext())
        .defeatEntry,
    ).toBeUndefined();
    expect(
      transactionContracts.captureFightingPoseContext({
        ...poseContext(),
        defeatEntry: actualEntry(14),
      }).defeatEntry?.atMs,
    ).toBe(14);
  });
});

describe('A1 review optional-authority audit', () => {
  it('rejects malformed optional actor fighting/physical pose/hold rather than skipping them', () => {
    const query = transactionQuery();
    Reflect.set(query.snapshot.actors[0] ?? {}, 'fighting', false);
    expect(() =>
      transactionContracts.captureFightingProjectInput(query),
    ).toThrow();
    const physical = transactionQuery();
    Reflect.set(physical.acceptedPrefix[0]?.actor ?? {}, 'pose', false);
    expect(() =>
      transactionContracts.captureFightingProjectInput(physical),
    ).toThrow();
    const context = receiptContext();
    Reflect.set(
      context.output.snapshot.actors[0] ?? {},
      'fightingPoseHold',
      false,
    );
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        transactionReceipt(),
        context,
      ),
    ).toThrow();
  });
  it('rejects falsy optional diagnostics rather than treating them as absent', () => {
    const tape: FightingSpatialTranscript = {
      initialPrefix: installedInitialPrefix(),
      header: transactionQuery(),
      proposal: { snapshot: result().snapshot, candidates: [] },
      interactions: [],
      terminal: { kind: 'aborted' },
    };
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(tape),
    ).not.toThrow();
    Reflect.set(tape.terminal, 'diagnostic', false);
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(tape),
    ).toThrow();
  });
});

// Shared seam: real producer-owned initial sample and declared unswept residency reset.
import type {
  FightingInitialPrefix,
  FightingEncounterReset,
  FightingBootstrap,
} from '../../src/contracts/fighting';
const nextResident = actorId('next-enemy');
const readyRegistry = () => ({
  version: 1 as const,
  bindingSetId: 'admitted-full-registry',
  clipId: clip,
  supportPlane: { supportId: 'floor', planeY: 0 },
  surfaceToleranceM: 0.0001,
  actors: [actor, target, nextResident].map((id, index) => ({
    actorId: id,
    position: { x: index * 3, y: 0, z: 0 },
    facingBasis: { ...vector },
  })),
});
const initialBootstrap = (): FightingBootstrap => ({
  runId: run,
  descriptor: readyRegistry(),
  residentActorIds: [actor, target],
  endpoints: [actor, target].map((id) =>
    selectedPoint({
      actorId: id,
      stepTick: tick(0),
      atGameMs: gameTimeMs(0),
      epochId: `ready-${id}`,
      phase: 'neutral',
    }),
  ),
  poseContexts: [actor, target].map((id) => ({
    runId: run,
    actorId: id,
    stepTick: tick(0),
    epochId: `ready-${id}`,
    commitId: `bootstrap-${id}`,
    entryKind: 'initial-ready',
    facingBasis: { ...vector },
    acceptedRoot: { x: 0, z: 0 },
    support: { supportId: 'floor', planeY: 0, groundClearanceM: 0 },
  })),
});
const bootstrapInitialPrefix = (): FightingInitialPrefix => {
  const bootstrap = initialBootstrap();
  return {
    runId: run,
    bindingSetId: bootstrap.descriptor.bindingSetId,
    actors: bootstrap.endpoints.map((endpoint) => {
      const poseContext = bootstrap.poseContexts.find(
        (p) => p.actorId === endpoint.actorId,
      );
      const spawn = bootstrap.descriptor.actors.find(
        (p) => p.actorId === endpoint.actorId,
      );
      if (!poseContext || !spawn) throw new Error('bootstrap fixture');
      return {
        endpoint,
        poseContext,
        actor: { ...spatialActor(endpoint.actorId), position: spawn.position },
        pose: {
          source: {
            kind: 'bootstrap',
            commitId: poseContext.commitId,
            actorId: endpoint.actorId,
            epochId: endpoint.epochId,
            clipId: endpoint.clipId,
            activationId: endpoint.activationId,
            atGameMs: endpoint.atGameMs,
            motionMs: endpoint.motionMs,
          },
          facingBasis: poseContext.facingBasis,
          acceptedRoot: poseContext.acceptedRoot,
          support: poseContext.support,
          sample: actualEntry(),
          entryKind: 'initial-ready',
        },
      };
    }),
  };
};
const firstStrictRequest = (): SpatialStepRequest => ({
  ...request(),
  snapshot: {
    ...request().snapshot,
    residentActorIds: [actor, target],
    clocks: {
      ...request().snapshot.clocks,
      tick: tick(1),
      gameTimeMs: gameTimeMs(10.5),
    },
    actors: initialBootstrap().endpoints.map((endpoint) => ({
      ...actorSnapshot(endpoint.actorId),
      fighting: state(),
      fightingClock: {
        stepTick: tick(1),
        activeEpochId: endpoint.epochId,
        slices: [
          {
            ...slice(),
            actorId: endpoint.actorId,
            epochId: endpoint.epochId,
            activationId: null,
            fromGameMs: gameTimeMs(0),
            toGameMs: gameTimeMs(10.5),
            fromMotionMs: durationMs(0),
            toMotionMs: durationMs(10.5),
          },
        ],
        endpoint: {
          ...endpoint,
          stepTick: tick(1),
          atGameMs: gameTimeMs(10.5),
          motionMs: durationMs(10.5),
        },
      },
    })),
  },
});
const firstStrictEnvelope = () => ({
  kind: 'fighting-spatial-transaction-v1' as const,
  initialPrefix: bootstrapInitialPrefix(),
  snapshot: { ...result().snapshot, tick: tick(1) },
  candidates: [],
  transaction: {
    version: 1 as const,
    transactionId: 'first-attempt',
    runId: run,
    stepTick: tick(1),
    fromGameMs: gameTimeMs(0),
    toGameMs: gameTimeMs(10.5),
    project: () => boundaryFrontier(),
    finish: () => transactionReceipt(),
    abort() {},
  },
});
const resetQuery = (at = 110.75): FightingProjectInput => {
  const q = transactionQuery(),
    resetEndpoints = [actor, nextResident].map((id) =>
      selectedPoint({
        actorId: id,
        atGameMs: gameTimeMs(at),
        epochId: `reset-${id}`,
        phase: 'neutral',
      }),
    );
  const encounterReset: FightingEncounterReset = {
    resetId: `reset-at-${at}`,
    atGameMs: gameTimeMs(at),
    readyDescriptor: readyRegistry(),
    outgoingActorIds: [actor, target],
    residentActorIds: [actor, nextResident],
    endpoints: resetEndpoints,
  };
  return {
    ...q,
    revision: at === 100.25 ? 0 : 1,
    acceptedProjectionId: at === 100.25 ? null : 'before-reset',
    queryMode: 'settle',
    cursorGameMs: gameTimeMs(at),
    horizonGameMs: gameTimeMs(at),
    encounterReset,
    acceptedPrefix: q.acceptedPrefix.map((p) => ({
      ...p,
      endpoint: {
        ...p.endpoint,
        stepTick: at === 100.25 ? tick(7) : tick(8),
        atGameMs: gameTimeMs(at),
      },
      pose: {
        ...p.pose,
        source: {
          ...(at === 100.25
            ? p.pose.source
            : nextQuerySource(p.pose.source, 0)),
          atGameMs: gameTimeMs(at),
        },
      },
    })),
    snapshot: {
      ...q.snapshot,
      residentActorIds: [actor, nextResident],
      actors: resetEndpoints.map((endpoint) => ({
        ...actorSnapshot(endpoint.actorId),
        fighting: state(),
        fightingClock: {
          stepTick: tick(8),
          activeEpochId: endpoint.epochId,
          slices: [],
          endpoint,
        },
      })),
    },
    selectedPoses: resetEndpoints.map((p) => ({
      actorId: p.actorId,
      epochId: p.epochId,
      phase: p.phase,
      posture: p.posture,
    })),
  };
};
const resetFrontier = (q = resetQuery()): FightingSpatialFrontier => {
  const reset = q.encounterReset;
  if (!reset) throw new Error('reset fixture');
  const acceptedPrefix = reset.endpoints.map((point) => {
    const spawn = reset.readyDescriptor.actors.find(
      (p) => p.actorId === point.actorId,
    );
    if (!spawn) throw new Error('spawn fixture');
    return {
      actor: {
        ...spatialActor(point.actorId),
        position: spawn.position,
        facing: spawn.facingBasis,
      },
      pose: {
        source: {
          kind: 'query' as const,
          transactionId: q.transactionId,
          queryRevision: q.revision,
          actorId: point.actorId,
          epochId: point.epochId,
          clipId: point.clipId,
          activationId: point.activationId,
          atGameMs: point.atGameMs,
          motionMs: point.motionMs,
        },
        facingBasis: spawn.facingBasis,
        acceptedRoot: { x: 0, z: 0 },
        support: { supportId: 'floor', planeY: 0, groundClearanceM: 0 },
        sample: actualEntry(),
        entryKind: 'encounter-reset' as const,
      },
    };
  });
  return {
    projectionId: 'reset-frontier',
    revision: q.revision,
    atGameMs: reset.atGameMs,
    kind: 'boundary',
    occurrenceIds: [],
    physicalSeamIds: [],
    acceptedPrefix,
    result: {
      snapshot: {
        runId: run,
        tick: tick(8),
        actors: acceptedPrefix.map((p) => p.actor),
        vehicles: [],
      },
      candidates: [],
      fighting: { stepTick: tick(8), takeoffs: [], landings: [], contacts: [] },
    },
  };
};
const resetReceiptFixture = (at = 110.75) => {
  const q = resetQuery(at),
    reset = q.encounterReset;
  if (!reset) throw new Error('reset fixture');
  const frontier = resetFrontier(q),
    remaining = 110.75 - at;
  const endpoints = reset.endpoints.map((p) => ({
    ...p,
    atGameMs: gameTimeMs(110.75),
    motionMs: durationMs(remaining),
  }));
  const prefixes = frontier.acceptedPrefix.map((p) => {
    const endpoint = endpoints.find((e) => e.actorId === p.actor.actorId);
    if (!endpoint) throw new Error('endpoint fixture');
    return {
      ...p,
      endpoint,
      pose: {
        ...p.pose,
        source: {
          ...p.pose.source,
          atGameMs: endpoint.atGameMs,
          motionMs: endpoint.motionMs,
        },
        sample: actualEntry(remaining),
      },
    };
  });
  const output = {
    snapshot: {
      ...q.snapshot,
      actors: q.snapshot.actors.map((a) => {
        const endpoint = endpoints.find((p) => p.actorId === a.actorId);
        if (!endpoint) throw new Error('actor endpoint fixture');
        const before =
          a.actorId === actor && at > 100.25
            ? [
                {
                  ...slice(),
                  actorId: a.actorId,
                  toGameMs: gameTimeMs(at),
                  toMotionMs: durationMs(at - 100.25 + 3.5),
                },
              ]
            : [];
        const after =
          at < 110.75
            ? [
                {
                  ...slice(),
                  actorId: a.actorId,
                  epochId: endpoint.epochId,
                  activationId: null,
                  fromGameMs: gameTimeMs(at),
                  fromMotionMs: durationMs(0),
                  toMotionMs: durationMs(remaining),
                },
              ]
            : [];
        return {
          ...a,
          fightingClock: {
            stepTick: tick(8),
            activeEpochId: endpoint.epochId,
            endpoint,
            slices: [...before, ...after],
          },
        };
      }),
    },
    events: [],
  };
  const residency = { initialActorIds: [actor, target], resets: [reset] };
  const receipt: FightingSpatialCommitReceipt = {
    ...transactionReceipt(),
    acceptedProjectionId: 'reset-frontier',
    residency,
    snapshot: frontier.result.snapshot,
    endpoints,
    poseContexts: prefixes.map((p) => ({
      runId: run,
      actorId: p.actor.actorId,
      stepTick: tick(8),
      epochId: p.endpoint.epochId,
      commitId: 'receipt-8',
      facingBasis: p.pose.facingBasis,
      acceptedRoot: p.pose.acceptedRoot,
      support: p.pose.support,
      entryKind: 'encounter-reset',
    })),
  };
  return {
    receipt,
    context: {
      header: q,
      acceptedProjectionId: 'reset-frontier',
      output,
      acceptedPrefix: prefixes,
      residency,
    },
  };
};

describe('canonical bootstrap sample and unswept encounter-reset seam', () => {
  it('captures only explicitly selected bootstrap residents from a complete future-ready registry', () => {
    const captured = transactionContracts.captureFightingBootstrap(
      initialBootstrap(),
    );
    expect(captured.descriptor.actors).toHaveLength(3);
    expect(captured.residentActorIds).toEqual([actor, target]);
    expect(captured.endpoints).toHaveLength(2);
  });
  it('delivers the actual bootstrap sample through the explicit envelope into the first strict query', () => {
    const envelope =
      transactionContracts.captureFightingSpatialTransactionResult(
        firstStrictEnvelope(),
        firstStrictRequest(),
      );
    expect(envelope.initialPrefix.actors[0]?.pose.sample.pose).toHaveLength(53);
    expect(envelope.initialPrefix.actors[0]?.pose.source.kind).toBe(
      'bootstrap',
    );
    expect(
      Object.hasOwn(
        envelope.initialPrefix.actors[0]?.pose.source ?? {},
        'queryRevision',
      ),
    ).toBe(false);
    const query: FightingProjectInput = {
      ...transactionQuery(),
      transactionId: 'first-attempt',
      stepTick: tick(1),
      fromGameMs: gameTimeMs(0),
      toGameMs: gameTimeMs(10.5),
      revision: 0,
      acceptedProjectionId: null,
      cursorGameMs: gameTimeMs(0),
      horizonGameMs: gameTimeMs(10.5),
      snapshot: firstStrictRequest().snapshot,
      acceptedPrefix: envelope.initialPrefix.actors,
      selectedPoses: envelope.initialPrefix.actors.map((p) => ({
        actorId: p.actor.actorId,
        epochId: p.endpoint.epochId,
        phase: p.endpoint.phase,
        posture: p.endpoint.posture,
      })),
    };
    expect(
      transactionContracts.captureFightingProjectInput(query).acceptedPrefix[0]
        ?.pose.source.kind,
    ).toBe('bootstrap');
  });
  it('rejects missing, forged, future or nonresident installed/bootstrap sample provenance', () => {
    const cases: ((value: ReturnType<typeof firstStrictEnvelope>) => void)[] = [
      (e) => Reflect.deleteProperty(e, 'initialPrefix'),
      (e) => Reflect.set(e.initialPrefix, 'runId', runId('foreign')),
      (e) =>
        Reflect.set(
          e.initialPrefix.actors[0]?.pose.source ?? {},
          'commitId',
          'forged',
        ),
      (e) =>
        Reflect.set(
          e.initialPrefix.actors[0]?.pose.source ?? {},
          'queryRevision',
          0,
        ),
      (e) =>
        Reflect.set(
          e.initialPrefix.actors[0]?.endpoint ?? {},
          'atGameMs',
          gameTimeMs(10.5),
        ),
      (e) =>
        Reflect.set(
          e.initialPrefix.actors[0]?.actor ?? {},
          'actorId',
          nextResident,
        ),
    ];
    for (const mutate of cases) {
      const envelope = firstStrictEnvelope();
      mutate(envelope);
      expect(() =>
        transactionContracts.captureFightingSpatialTransactionResult(
          envelope,
          firstStrictRequest(),
        ),
      ).toThrow();
    }
  });
  for (const at of [100.25, 105.125, 110.75]) {
    it(`settles the declared reset roster at exact ${at} with no sweep or original intents`, () => {
      const q = transactionContracts.captureFightingProjectInput(
        resetQuery(at),
      );
      expect(q.acceptedPrefix.map((p) => p.actor.actorId)).toEqual([
        actor,
        target,
      ]);
      const f = transactionContracts.captureFightingSpatialFrontier(
        resetFrontier(q),
        { ...frontierContext(), query: q },
      );
      expect(f.result.snapshot.actors.map((a) => a.actorId)).toEqual([
        actor,
        nextResident,
      ]);
      expect(
        f.result.snapshot.actors.every(
          (a) => a.velocity.x === 0 && a.velocity.y === 0 && a.velocity.z === 0,
        ),
      ).toBe(true);
      expect(f.result.candidates).toEqual([]);
    });
    it(`retains full clocks for retained residents and only true new-resident coverage after ${at}`, () => {
      const { receipt, context } = resetReceiptFixture(at);
      expect(
        transactionContracts.captureFightingSpatialCommitReceipt(
          receipt,
          context,
        ).residency?.resets,
      ).toHaveLength(1);
    });
  }
  it('rejects ordinary roster swaps, positive-time resets and mismatched ready/reset evidence', () => {
    const q = resetQuery();
    Reflect.deleteProperty(q, 'encounterReset');
    expect(() => transactionContracts.captureFightingProjectInput(q)).toThrow();
    const positive = resetQuery(100.25);
    Reflect.set(positive, 'queryMode', 'interval');
    Reflect.set(positive, 'horizonGameMs', gameTimeMs(110.75));
    expect(() =>
      transactionContracts.captureFightingProjectInput(positive),
    ).toThrow();
    const wrong = resetQuery();
    Reflect.set(wrong.encounterReset ?? {}, 'residentActorIds', [
      actor,
      target,
    ]);
    expect(() =>
      transactionContracts.captureFightingProjectInput(wrong),
    ).toThrow();
    const frame = resetFrontier();
    Reflect.set(frame.result.snapshot.actors[0]?.velocity ?? {}, 'x', 1);
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(frame, {
        ...frontierContext(),
        query: resetQuery(),
      }),
    ).toThrow();
    const contacts = resetFrontier();
    Reflect.set(contacts.result, 'candidates', result().candidates);
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(contacts, {
        ...frontierContext(),
        query: resetQuery(),
      }),
    ).toThrow();
  });
  it('rejects reset-only empty coverage without matching accepted residency provenance', () => {
    const { receipt, context } = resetReceiptFixture();
    Reflect.deleteProperty(receipt, 'residency');
    Reflect.deleteProperty(context, 'residency');
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        receipt,
        context,
      ),
    ).toThrow();
    const bad = resetReceiptFixture();
    Reflect.set(bad.receipt.residency ?? {}, 'resets', [
      bad.context.residency.resets[0],
      bad.context.residency.resets[0],
    ]);
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        bad.receipt,
        bad.context,
      ),
    ).toThrow();
    const mismatched = resetReceiptFixture();
    Reflect.set(mismatched.context.residency, 'initialActorIds', [
      actor,
      nextResident,
    ]);
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        mismatched.receipt,
        mismatched.context,
      ),
    ).toThrow();
  });
  it('records unrecordable-return rejection distinctly from an original port throw and without its value', () => {
    const tape: FightingSpatialTranscript = {
      header: transactionQuery(),
      initialPrefix: installedInitialPrefix(),
      proposal: { snapshot: result().snapshot, candidates: [] },
      interactions: [
        {
          kind: 'project',
          input: { ...transactionQuery() },
          outcome: {
            kind: 'unrecordable-return',
            diagnostic: { name: 'TypeError', message: 'non-data return' },
          },
        },
      ],
      terminal: {
        kind: 'aborted',
        diagnostic: { name: 'TypeError', message: 'non-data return' },
      },
    };
    // Use this attempt's pure header/query, never the port methods.
    Reflect.set(tape, 'header', {
      version: 1,
      transactionId: 'attempt-8',
      runId: run,
      stepTick: tick(8),
      fromGameMs: gameTimeMs(100.25),
      toGameMs: gameTimeMs(110.75),
    });
    expect(
      transactionContracts.captureFightingSpatialTranscript(tape)
        .interactions[0]?.outcome.kind,
    ).toBe('unrecordable-return');
    Reflect.set(tape.interactions[0]?.outcome ?? {}, 'value', () => {});
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(tape),
    ).toThrow();
  });
});

function nextQuerySource(
  source: transactionContracts.FightingPoseSampleReference,
  revision: number,
): transactionContracts.FightingPoseSampleReference {
  return {
    kind: 'query',
    transactionId: 'attempt-8',
    queryRevision: revision,
    actorId: source.actorId,
    epochId: source.epochId,
    clipId: source.clipId,
    activationId: source.activationId,
    atGameMs: source.atGameMs,
    motionMs: source.motionMs,
  };
}
function installedInitialPrefix(): FightingInitialPrefix {
  const query = transactionQuery();
  return {
    runId: run,
    bindingSetId: 'admitted-full-registry',
    actors: query.acceptedPrefix.map((prefix) => {
      const point = prefix.endpoint,
        commitId = 'installed-receipt-7';
      const poseContext: FightingPoseContext = {
        runId: run,
        actorId: point.actorId,
        stepTick: point.stepTick,
        epochId: point.epochId,
        commitId,
        entryKind: 'continuous',
        incoming: actualEntry(),
        facingBasis: prefix.pose.facingBasis,
        acceptedRoot: prefix.pose.acceptedRoot,
        support: prefix.pose.support,
      };
      return {
        ...prefix,
        poseContext,
        pose: {
          ...prefix.pose,
          source: {
            kind: 'installed',
            commitId,
            actorId: point.actorId,
            epochId: point.epochId,
            clipId: point.clipId,
            activationId: point.activationId,
            atGameMs: point.atGameMs,
            motionMs: point.motionMs,
          },
        },
      };
    }),
  };
}

describe('bootstrap/reset provenance and history rejection controls', () => {
  it('does not accept current-attempt query evidence before the first query or installed evidence in a continuation', () => {
    const first = transactionQuery();
    for (const p of first.acceptedPrefix)
      Reflect.set(p.pose.source, 'transactionId', first.transactionId);
    expect(() =>
      transactionContracts.captureFightingProjectInput(first),
    ).toThrow();
    const continued = resetQuery();
    Reflect.set(
      continued,
      'acceptedPrefix',
      installedInitialPrefix().actors.map((p) => ({
        ...p,
        endpoint: { ...p.endpoint, atGameMs: continued.cursorGameMs },
        pose: {
          ...p.pose,
          source: { ...p.pose.source, atGameMs: continued.cursorGameMs },
        },
      })),
    );
    expect(() =>
      transactionContracts.captureFightingProjectInput(continued),
    ).toThrow();
  });
  it('requires current pending tick on a current-query accepted prefix', () => {
    const q = resetQuery();
    for (const p of q.acceptedPrefix)
      Reflect.set(p.endpoint, 'stepTick', tick(7));
    expect(() => transactionContracts.captureFightingProjectInput(q)).toThrow();
  });
  it('rejects out-of-order reset history and retiring/resurrecting actor identity', () => {
    const fixture = resetReceiptFixture(105.125),
      first = fixture.context.residency.resets[0];
    const second = resetQuery(104).encounterReset;
    if (!first || !second) throw new Error('reset history fixture');
    const outOfOrder = {
      ...second,
      resetId: 'second-reset',
      outgoingActorIds: [actor, nextResident],
    };
    Reflect.set(fixture.context.residency, 'resets', [first, outOfOrder]);
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        fixture.receipt,
        fixture.context,
      ),
    ).toThrow('out of order');
    const resurrection = resetReceiptFixture(105.125),
      later = resetQuery().encounterReset;
    if (!later) throw new Error('later reset');
    const endpoints = later.endpoints.map((p) =>
      p.actorId === nextResident ? { ...p, actorId: target } : p,
    );
    Reflect.set(resurrection.context.residency, 'resets', [
      first,
      {
        ...later,
        resetId: 'resurrection',
        outgoingActorIds: [actor, nextResident],
        residentActorIds: [actor, target],
        endpoints,
      },
    ]);
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        resurrection.receipt,
        resurrection.context,
      ),
    ).toThrow('retired');
  });
  it('never grants a retained resident shortened coverage through reset provenance', () => {
    const { receipt, context } = resetReceiptFixture();
    const retained = context.output.snapshot.actors.find(
      (a) => a.actorId === actor,
    );
    if (!retained?.fightingClock) throw new Error('retained fixture');
    Reflect.set(retained.fightingClock, 'slices', []);
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        receipt,
        context,
      ),
    ).toThrow();
  });
  it('requires receipt reset history to equal independently supplied accepted history', () => {
    const { receipt, context } = resetReceiptFixture();
    const authoritative = {
      ...context,
      residency: structuredClone(context.residency),
    };
    Reflect.set(
      receipt.residency?.resets[0] ?? {},
      'resetId',
      'different-reset',
    );
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        receipt,
        authoritative,
      ),
    ).toThrow('accepted B history');
  });
  it('rejects any raw value attached to an unrecordable-return diagnostic', () => {
    const tape: FightingSpatialTranscript = {
      header: transactionQuery(),
      initialPrefix: installedInitialPrefix(),
      proposal: { snapshot: result().snapshot, candidates: [] },
      interactions: [
        {
          kind: 'abort',
          outcome: {
            kind: 'unrecordable-return',
            diagnostic: { name: 'TypeError', message: 'recorder rejection' },
          },
        },
      ],
      terminal: { kind: 'aborted' },
    };
    expect(
      transactionContracts.captureFightingSpatialTranscript(tape)
        .interactions[0]?.outcome.kind,
    ).toBe('unrecordable-return');
    Reflect.set(tape.interactions[0]?.outcome ?? {}, 'value', 42);
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(tape),
    ).toThrow();
  });
});

function carriedResetFixture() {
  const prior = resetReceiptFixture(105.125);
  const accepted = transactionContracts.captureFightingSpatialCommitReceipt(
    prior.receipt,
    prior.context,
  );
  const header = {
    version: 1 as const,
    transactionId: 'attempt-9',
    runId: run,
    stepTick: tick(9),
    fromGameMs: gameTimeMs(110.75),
    toGameMs: gameTimeMs(121.25),
  };
  const actors = prior.context.acceptedPrefix.map((p) => {
    const poseContext = accepted.poseContexts.find(
      (c) => c.actorId === p.actor.actorId,
    );
    if (!poseContext) throw new Error('carried reset context');
    const point = p.endpoint;
    return {
      ...p,
      poseContext,
      pose: {
        ...p.pose,
        source: {
          kind: 'installed' as const,
          commitId: accepted.receiptId,
          actorId: point.actorId,
          epochId: point.epochId,
          clipId: point.clipId,
          activationId: point.activationId,
          atGameMs: point.atGameMs,
          motionMs: point.motionMs,
        },
      },
    };
  });
  const installed = transactionContracts.captureFightingInitialPrefix(
    { runId: run, bindingSetId: 'admitted-full-registry', actors },
    header,
    actors.map((p) => p.actor.actorId),
  );
  const endpoints = installed.actors.map((p) => ({
    ...p.endpoint,
    stepTick: tick(9),
    atGameMs: header.toGameMs,
    motionMs: durationMs(p.endpoint.motionMs + 10.5),
  }));
  const snapshot = {
    ...prior.context.output.snapshot,
    clocks: {
      ...prior.context.output.snapshot.clocks,
      tick: tick(9),
      gameTimeMs: header.toGameMs,
    },
    actors: prior.context.output.snapshot.actors.map((a) => {
      const point = endpoints.find((p) => p.actorId === a.actorId),
        from = installed.actors.find(
          (p) => p.actor.actorId === a.actorId,
        )?.endpoint;
      if (!point || !from) throw new Error('carried reset clock');
      return {
        ...a,
        fightingClock: {
          stepTick: tick(9),
          activeEpochId: point.epochId,
          endpoint: point,
          slices: [
            {
              actorId: a.actorId,
              epochId: point.epochId,
              clipId: point.clipId,
              activationId: null,
              fromGameMs: header.fromGameMs,
              toGameMs: header.toGameMs,
              fromMotionMs: from.motionMs,
              toMotionMs: point.motionMs,
              frozen: false,
            },
          ],
        },
      };
    }),
  };
  const query: FightingProjectInput = {
    ...transactionQuery(),
    ...header,
    snapshot,
    acceptedPrefix: installed.actors,
    cursorGameMs: header.fromGameMs,
    horizonGameMs: header.toGameMs,
    selectedPoses: endpoints.map((p) => ({
      actorId: p.actorId,
      epochId: p.epochId,
      phase: p.phase,
      posture: p.posture,
    })),
  };
  const prefix = installed.actors.map((p) => {
    const point = endpoints.find((e) => e.actorId === p.actor.actorId);
    if (!point) throw new Error('carried reset point');
    return {
      actor: p.actor,
      pose: {
        ...p.pose,
        sample: actualEntry(point.motionMs),
        source: {
          kind: 'query' as const,
          transactionId: header.transactionId,
          queryRevision: 0,
          actorId: point.actorId,
          epochId: point.epochId,
          clipId: point.clipId,
          activationId: point.activationId,
          atGameMs: point.atGameMs,
          motionMs: point.motionMs,
        },
      },
    };
  });
  const frontier: FightingSpatialFrontier = {
    projectionId: 'carried-reset',
    revision: 0,
    atGameMs: header.toGameMs,
    kind: 'boundary',
    occurrenceIds: [],
    physicalSeamIds: [],
    acceptedPrefix: prefix,
    result: {
      snapshot: {
        runId: run,
        tick: tick(9),
        actors: prefix.map((p) => p.actor),
        vehicles: [],
      },
      candidates: [],
      fighting: { stepTick: tick(9), contacts: [], takeoffs: [], landings: [] },
    },
  };
  const original = {
    ...request(),
    snapshot,
    step: { durationMs: durationMs(10.5) },
  };
  const captured = transactionContracts.captureFightingSpatialFrontier(
    frontier,
    { query, request: original, policy: frontierContext().policy },
  );
  const receipt: FightingSpatialCommitReceipt = {
    ...header,
    receiptId: 'receipt-9',
    acceptedProjectionId: captured.projectionId,
    outputRevision: snapshot.revision,
    snapshot: captured.result.snapshot,
    endpoints,
    poseContexts: installed.actors.map((p) => ({
      ...p.poseContext,
      stepTick: tick(9),
      commitId: 'receipt-9',
    })),
  };
  const context: transactionContracts.FightingReceiptValidationContext = {
    header,
    initialPrefix: installed,
    acceptedProjectionId: captured.projectionId,
    output: { snapshot, events: [] },
    acceptedPrefix: captured.acceptedPrefix.map((p) => {
      const endpoint = endpoints.find((e) => e.actorId === p.actor.actorId);
      if (!endpoint) throw new Error('final carried point');
      return { ...p, endpoint };
    }),
  };
  return { installed, query, frontier: captured, receipt, context };
}

describe('shared seam review round 1 reset-origin and diagnostic bounds', () => {
  it('rejects an ordinary frontier minting reset provenance and discarding actual incoming', () => {
    const frame = boundaryFrontier();
    for (const p of frame.acceptedPrefix) {
      Reflect.set(p.pose, 'entryKind', 'encounter-reset');
      Reflect.deleteProperty(p.pose, 'incoming');
    }
    expect(() =>
      transactionContracts.captureFightingSpatialFrontier(
        frame,
        frontierContext(),
      ),
    ).toThrow();
  });
  it('preserves a real reset receipt through installed prefix into the next ordinary frontier and receipt', () => {
    const chain = carriedResetFixture();
    expect(chain.query.encounterReset).toBeUndefined();
    expect(chain.receipt.residency).toBeUndefined();
    expect(
      transactionContracts
        .captureFightingSpatialCommitReceipt(chain.receipt, chain.context)
        .poseContexts.every((p) => p.entryKind === 'encounter-reset'),
    ).toBe(true);
  });
  it('requires the installed reset-origin anchor for a carried reset receipt without new reset history', () => {
    const chain = carriedResetFixture();
    Reflect.deleteProperty(chain.context, 'initialPrefix');
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        chain.receipt,
        chain.context,
      ),
    ).toThrow();
  });
  it('does not treat a merely installed continuous origin as proof of an omitted reset incoming', () => {
    const chain = carriedResetFixture(),
      anchor = structuredClone(chain.installed);
    for (const p of anchor.actors) {
      Reflect.set(p.pose, 'entryKind', 'continuous');
      Reflect.set(p.pose, 'incoming', actualEntry());
      Reflect.set(p.poseContext, 'entryKind', 'continuous');
      Reflect.set(p.poseContext, 'incoming', actualEntry());
    }
    Reflect.set(chain.context, 'initialPrefix', anchor);
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        chain.receipt,
        chain.context,
      ),
    ).toThrow();
  });
  const tape = (name: string, message: string): FightingSpatialTranscript => ({
    header: transactionQuery(),
    initialPrefix: installedInitialPrefix(),
    proposal: { snapshot: result().snapshot, candidates: [] },
    interactions: [
      {
        kind: 'abort',
        outcome: { kind: 'unrecordable-return', diagnostic: { name, message } },
      },
    ],
    terminal: { kind: 'aborted' },
  });
  it('rejects oversized fallback diagnostics instead of retaining or truncating their payloads', () => {
    for (const [name, message] of [
      ['X'.repeat(129), 'ok'],
      ['Error', 'Y'.repeat(4097)],
      ['X'.repeat(1024 * 1024), 'Y'.repeat(1024 * 1024)],
    ]) {
      if (name === undefined || message === undefined)
        throw new Error('diagnostic fixture');
      const original = tape(name, message);
      expect(() =>
        transactionContracts.captureFightingSpatialTranscript(original),
      ).toThrow();
      expect(original.interactions[0]?.outcome).toEqual({
        kind: 'unrecordable-return',
        diagnostic: { name, message },
      });
    }
  });
  it('documents and accepts exact UTF-16 transport bounds, including surrogate pairs', () => {
    expect(
      transactionContracts.FIGHTING_UNRECORDABLE_RETURN_NAME_MAX_CODE_UNITS,
    ).toBe(128);
    expect(
      transactionContracts.FIGHTING_UNRECORDABLE_RETURN_MESSAGE_MAX_CODE_UNITS,
    ).toBe(4096);
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(
        tape('X'.repeat(128), 'Y'.repeat(4096)),
      ),
    ).not.toThrow();
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(
        tape('😀'.repeat(64), '😀'.repeat(2048)),
      ),
    ).not.toThrow();
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(
        tape('😀'.repeat(65), 'ok'),
      ),
    ).toThrow();
    expect(() =>
      transactionContracts.captureFightingSpatialTranscript(
        tape('Error', `${'😀'.repeat(2048)}x`),
      ),
    ).toThrow();
  });
  it('does not relabel or truncate an actual port-thrown diagnostic as a recorder rejection', () => {
    const original = tape('Error', 'X'.repeat(4097));
    Reflect.set(original.interactions[0]?.outcome ?? {}, 'kind', 'threw');
    const captured =
      transactionContracts.captureFightingSpatialTranscript(original)
        .interactions[0]?.outcome;
    expect(captured?.kind).toBe('threw');
    if (captured?.kind !== 'threw')
      throw new Error('throw classification changed');
    expect(captured.diagnostic.message.length).toBe(4097);
  });
});

describe('carried reset immutable-origin preservation controls', () => {
  it('allows current accepted root/position progress and a new receipt commit without rewriting the installed origin', () => {
    const chain = carriedResetFixture(),
      receipt = structuredClone(chain.receipt),
      context = structuredClone(chain.context);
    for (const p of context.acceptedPrefix) {
      Reflect.set(p.pose.acceptedRoot, 'x', 0.5);
      Reflect.set(p.actor.position, 'x', 0.5);
    }
    for (const p of receipt.poseContexts) Reflect.set(p.acceptedRoot, 'x', 0.5);
    for (const a of receipt.snapshot.actors) Reflect.set(a.position, 'x', 0.5);
    const captured = transactionContracts.captureFightingSpatialCommitReceipt(
      receipt,
      context,
    );
    expect(captured.poseContexts[0]?.acceptedRoot.x).toBe(0.5);
    expect(context.initialPrefix?.actors[0]?.pose.acceptedRoot.x).toBe(0);
    expect(captured.receiptId).toBe('receipt-9');
    expect(context.initialPrefix?.actors[0]?.poseContext.commitId).toBe(
      'receipt-8',
    );
  });
  it('rejects a different installed epoch even if its context and source are internally consistent', () => {
    const chain = carriedResetFixture(),
      context = structuredClone(chain.context);
    for (const p of context.initialPrefix?.actors ?? []) {
      Reflect.set(p.endpoint, 'epochId', `foreign-${p.actor.actorId}`);
      Reflect.set(p.pose.source, 'epochId', `foreign-${p.actor.actorId}`);
      Reflect.set(p.poseContext, 'epochId', `foreign-${p.actor.actorId}`);
    }
    expect(() =>
      transactionContracts.captureFightingSpatialCommitReceipt(
        chain.receipt,
        context,
      ),
    ).toThrow('reset provenance');
  });
});

// Ordinary intervals keep the installed boundary exactly, even when subtraction
// cannot reconstruct it from the next endpoint and duration.
function ordinaryIntervalFixture(
  initialPrefix: FightingInitialPrefix,
  header: transactionContracts.FightingSpatialTransactionHeader,
) {
  const duration = durationMs(header.toGameMs - header.fromGameMs);
  const endpoints = initialPrefix.actors.map((p) => ({
    ...p.endpoint,
    stepTick: header.stepTick,
    atGameMs: header.toGameMs,
    motionMs: durationMs(p.endpoint.motionMs + duration),
  }));
  const snapshot = {
    ...firstStrictRequest().snapshot,
    clocks: {
      ...firstStrictRequest().snapshot.clocks,
      tick: header.stepTick,
      gameTimeMs: header.toGameMs,
    },
    actors: initialPrefix.actors.map((p, i) => {
      const endpoint = endpoints[i];
      if (!endpoint) throw new Error('interval endpoint fixture');
      return {
        ...actorSnapshot(p.actor.actorId),
        fighting: state(),
        fightingClock: {
          stepTick: header.stepTick,
          activeEpochId: endpoint.epochId,
          endpoint,
          slices: [
            {
              actorId: endpoint.actorId,
              epochId: endpoint.epochId,
              clipId: endpoint.clipId,
              activationId: endpoint.activationId,
              fromGameMs: header.fromGameMs,
              toGameMs: header.toGameMs,
              fromMotionMs: p.endpoint.motionMs,
              toMotionMs: endpoint.motionMs,
              frozen: false,
            },
          ],
        },
      };
    }),
  };
  const query: FightingProjectInput = {
    ...transactionQuery(),
    ...header,
    snapshot,
    acceptedPrefix: initialPrefix.actors,
    cursorGameMs: header.fromGameMs,
    horizonGameMs: header.toGameMs,
    selectedPoses: endpoints.map((p) => ({
      actorId: p.actorId,
      epochId: p.epochId,
      phase: p.phase,
      posture: p.posture,
    })),
  };
  const acceptedPrefix = initialPrefix.actors.map((p, i) => {
    const endpoint = endpoints[i];
    if (!endpoint) throw new Error('interval prefix fixture');
    return {
      actor: p.actor,
      endpoint,
      pose: {
        ...p.pose,
        source: {
          kind: 'query' as const,
          transactionId: header.transactionId,
          queryRevision: 0,
          actorId: endpoint.actorId,
          epochId: endpoint.epochId,
          clipId: endpoint.clipId,
          activationId: endpoint.activationId,
          atGameMs: endpoint.atGameMs,
          motionMs: endpoint.motionMs,
        },
        sample: actualEntry(endpoint.motionMs),
        entryKind: 'continuous' as const,
        incoming: p.pose.incoming ?? p.pose.sample,
      },
    };
  });
  const frontier: FightingSpatialFrontier = {
    ...boundaryFrontier(),
    projectionId: `${header.transactionId}:boundary`,
    atGameMs: header.toGameMs,
    acceptedPrefix,
    result: {
      snapshot: {
        runId: run,
        tick: header.stepTick,
        actors: acceptedPrefix.map((p) => p.actor),
        vehicles: [],
      },
      candidates: [],
      fighting: {
        stepTick: header.stepTick,
        contacts: [],
        takeoffs: [],
        landings: [],
      },
    },
  };
  const receipt: FightingSpatialCommitReceipt = {
    ...header,
    receiptId: `${header.transactionId}:receipt`,
    acceptedProjectionId: frontier.projectionId,
    outputRevision: snapshot.revision,
    snapshot: frontier.result.snapshot,
    endpoints,
    poseContexts: acceptedPrefix.map((p) => ({
      entryKind: p.pose.entryKind,
      incoming: p.pose.incoming,
      facingBasis: p.pose.facingBasis,
      acceptedRoot: p.pose.acceptedRoot,
      support: p.pose.support,
      runId: run,
      actorId: p.endpoint.actorId,
      stepTick: header.stepTick,
      epochId: p.endpoint.epochId,
      commitId: `${header.transactionId}:receipt`,
    })),
  };
  const original: SpatialStepRequest = {
    ...request(),
    snapshot,
    step: { durationMs: duration },
  };
  const context = {
    query,
    request: original,
    policy: frontierContext().policy,
  };
  const receiptContext = {
    header,
    acceptedProjectionId: frontier.projectionId,
    output: { snapshot, events: [] },
    acceptedPrefix,
  };
  const envelope = {
    ...firstStrictEnvelope(),
    initialPrefix,
    snapshot: frontier.result.snapshot,
    transaction: {
      ...header,
      project: () => frontier,
      finish: () => receipt,
      abort() {},
    },
  };
  return {
    query,
    frontier,
    original,
    context,
    receipt,
    receiptContext,
    envelope,
  };
}

describe('canonical forward interval arithmetic', () => {
  it.each([1000 / 60, 16])(
    'preserves an accepted %s boundary through the next installed prefix, query and exact-E settlement',
    (firstEnd) => {
      const first = ordinaryIntervalFixture(bootstrapInitialPrefix(), {
        version: 1,
        transactionId: 'fractional-first',
        runId: run,
        stepTick: tick(1),
        fromGameMs: gameTimeMs(0),
        toGameMs: gameTimeMs(firstEnd),
      });
      transactionContracts.captureFightingSpatialTransactionResult(
        first.envelope,
        first.original,
      );
      transactionContracts.captureFightingSpatialFrontier(
        first.frontier,
        first.context,
      );
      const receipt = transactionContracts.captureFightingSpatialCommitReceipt(
        first.receipt,
        first.receiptContext,
      );
      const initialPrefix: FightingInitialPrefix = {
        ...bootstrapInitialPrefix(),
        actors: first.receiptContext.acceptedPrefix.map((p, i) => {
          const poseContext = receipt.poseContexts[i];
          if (!poseContext) throw new Error('installed interval context');
          return {
            ...p,
            poseContext,
            pose: {
              ...p.pose,
              source: {
                kind: 'installed',
                commitId: receipt.receiptId,
                actorId: p.endpoint.actorId,
                epochId: p.endpoint.epochId,
                clipId: p.endpoint.clipId,
                activationId: p.endpoint.activationId,
                atGameMs: p.endpoint.atGameMs,
                motionMs: p.endpoint.motionMs,
              },
            },
          };
        }),
      };
      const next = ordinaryIntervalFixture(initialPrefix, {
        version: 1,
        transactionId: 'fractional-next',
        runId: run,
        stepTick: tick(2),
        fromGameMs: receipt.toGameMs,
        toGameMs: gameTimeMs(firstEnd === 1000 / 60 ? 350 : 336),
      });
      if (firstEnd === 1000 / 60) {
        expect(next.query.toGameMs).toBe(350);
        expect(next.query.toGameMs - 20 * firstEnd).toBe(16.66666666666663);
        expect(next.query.toGameMs - next.original.step.durationMs).not.toBe(
          firstEnd,
        );
        expect(receipt.toGameMs).toBe(16.666666666666668);
        // The original requested delta is not the canonical accepted length.
        expect(() =>
          transactionContracts.captureFightingSpatialTransactionResult(
            next.envelope,
            {
              ...next.original,
              step: { durationMs: durationMs(20 * firstEnd) },
            },
          ),
        ).toThrow();
      }
      const captured =
        transactionContracts.captureFightingSpatialTransactionResult(
          next.envelope,
          next.original,
        );
      expect(captured.transaction.fromGameMs).toBe(receipt.toGameMs);
      expect(captured.initialPrefix.actors[0]?.endpoint).toEqual(
        receipt.endpoints[0],
      );
      transactionContracts.captureFightingProjectInput(next.query);
      transactionContracts.captureFightingSpatialFrontier(
        next.frontier,
        next.context,
      );
      transactionContracts.captureFightingSpatialCommitReceipt(
        next.receipt,
        next.receiptContext,
      );
      const settle: FightingProjectInput = {
        ...next.query,
        revision: 1,
        acceptedProjectionId: next.frontier.projectionId,
        queryMode: 'settle',
        cursorGameMs: next.query.toGameMs,
        acceptedPrefix: next.receiptContext.acceptedPrefix,
        snapshot: {
          ...next.query.snapshot,
          actors: next.query.snapshot.actors.map((a) => {
            if (!a.fightingClock) throw new Error('settle clock fixture');
            return { ...a, fightingClock: { ...a.fightingClock, slices: [] } };
          }),
        },
      };
      const settled = transactionContracts.captureFightingSpatialFrontier(
        {
          ...next.frontier,
          revision: 1,
          projectionId: 'settled',
          acceptedPrefix: next.frontier.acceptedPrefix.map((p) => {
            if (p.pose.source.kind !== 'query')
              throw new Error('query source fixture');
            return {
              ...p,
              pose: {
                ...p.pose,
                source: { ...p.pose.source, queryRevision: 1 },
              },
            };
          }),
        },
        { ...next.context, query: settle },
      );
      expect(settled.atGameMs).toBe(next.query.toGameMs);
      expect(settled.result.fighting.contacts).toEqual([]);
      const finalClock = next.query.snapshot.actors[0]?.fightingClock;
      if (!finalClock) throw new Error('final interval clock fixture');
      expect(fightingClockSliceAt(finalClock, next.query.toGameMs)).toBeNull();
      for (const duration of [0, next.original.step.durationMs + 1e-12]) {
        const wrong = {
          ...next.original,
          step: { durationMs: durationMs(duration) },
        };
        expect(() =>
          transactionContracts.captureFightingSpatialTransactionResult(
            next.envelope,
            wrong,
          ),
        ).toThrow();
        expect(() =>
          transactionContracts.captureFightingSpatialFrontier(next.frontier, {
            ...next.context,
            request: wrong,
          }),
        ).toThrow();
      }
      const wrongEnd = {
        ...next.original,
        snapshot: {
          ...next.original.snapshot,
          clocks: {
            ...next.original.snapshot.clocks,
            gameTimeMs: gameTimeMs(next.query.toGameMs + 1e-12),
          },
        },
      };
      expect(() =>
        transactionContracts.captureFightingSpatialTransactionResult(
          next.envelope,
          wrongEnd,
        ),
      ).toThrow();
      const wrongStart = {
        ...next.envelope,
        transaction: {
          ...next.envelope.transaction,
          fromGameMs: gameTimeMs(firstEnd + 1e-12),
        },
      };
      expect(() =>
        transactionContracts.captureFightingSpatialTransactionResult(
          wrongStart,
          next.original,
        ),
      ).toThrow();
    },
  );
});
