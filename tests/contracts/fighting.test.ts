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
