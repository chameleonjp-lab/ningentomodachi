import { describe, expect, test } from 'vitest';
import {
  actorId,
  worldObjectId,
  type FightingReadyDescriptor,
  type FightingRecipeEntry,
  type FightingProjectInput,
  type FightingSpatialFrontier,
  type FightingSpatialTransactionResult,
  type FightingInitialPrefix,
  type FightingEncounterReset,
  type FightingPoseContext,
  type FightingSpatialCommitReceipt,
  captureFightingInitialPrefix,
  captureFightingSpatialFrontier,
  runId,
  clipId,
  commandId,
  contactId,
  durationMs,
  gameTimeMs,
  tick,
  FIGHTING_ENTRIES,
  FIGHTING_ACTIVE_ENTRIES,
  FIGHTING_MOVE_SPECS,
  type ActorColor,
  type CorePort,
  type FightingSpatialStepResult,
  type GameplayCommand,
  type HitLevel,
  type MotionDefinition,
  type SpatialCandidate,
  type SpatialStepRequest,
} from '../../src/contracts';
import { createCore, type CoreOptions } from '../../src/core/createCore';
import {
  recordCore,
  replayCore,
  replayIntentProvider,
  recordIntentProvider,
} from '../../src/core/replay';
import { requireValue } from '../../src/core/invariant';
import { fixtureCatalog, reference, run } from './fixtures/scenarios';

const T = 1000 / 60;
const poseClips = {
  standing: clipId('synthetic:idle'),
  crouching: clipId('synthetic:crouch'),
  airborne: clipId('synthetic:air'),
  landing: clipId('synthetic:land'),
  'guard-standing': clipId('synthetic:guard-standing'),
  'guard-crouching': clipId('synthetic:guard-crouching'),
  'hit-standing': clipId('synthetic:hit-standing'),
  'hit-crouching': clipId('synthetic:hit-crouching'),
};
/** Synthetic Core authority fixture, NOT actual robot/shape/readiness evidence. */
function config(level: HitLevel = 'mid'): CoreOptions {
  const legacy = fixtureCatalog();
  const definitions = legacy.catalog.list().map((m) => ({
    ...m,
    durationMs: durationMs(2000),
    impacts: m.impacts.map((i) => ({ ...i, endMs: durationMs(1500) })),
    rootCurve: [
      requireValue(m.rootCurve[0]),
      { ...requireValue(m.rootCurve[1]), atMs: durationMs(2000) },
    ],
  }));
  const entries = FIGHTING_ENTRIES.map((entry) => ({
    ...entry,
    clipId: clipId(`synthetic:${entry.posture}:${entry.moveId}`),
  }));
  const player: MotionDefinition[] = entries.map((entry) => {
    const spec = FIGHTING_MOVE_SPECS[entry.moveId];
    const total =
      (spec.startupTicks + spec.activeTicks + spec.recoveryTicks) * T;
    return {
      ...requireValue(definitions[0]),
      clipId: entry.clipId,
      category:
        entry.moveId.startsWith('k_') || entry.moveId === 'a_kick'
          ? 'kick'
          : 'punch',
      durationMs: durationMs(total),
      impacts: [
        {
          impactIndex: 0,
          startMs: durationMs(spec.startupTicks * T),
          endMs: durationMs((spec.startupTicks + spec.activeTicks) * T),
          damageShare: 1,
          shapeId: 'synthetic',
        },
      ],
      rootCurve: [
        requireValue(requireValue(definitions[0]).rootCurve[0]),
        {
          ...requireValue(requireValue(definitions[0]).rootCurve[1]),
          atMs: durationMs(total),
        },
      ],
    };
  });
  return {
    moves: legacy.moves,
    enemyAi: false,
    catalog: {
      list: () => definitions,
      get: (id) => definitions.find((m) => m.clipId === id),
    },
    fighting: {
      mode: 'core-evidence-only',
      policy: {
        version: 3,
        hpPerNormalizedPoint: 5,
        guardFrontDotMin: 0,
        hitstunPosture: 'retain-contact-posture',
      },
      entries,
      poseClips,
      catalog: {
        list: () => player,
        get: (id) => player.find((m) => m.clipId === id),
      },
      legacyImpactProfiles: definitions.flatMap((m) =>
        m.impacts.map((i) => ({
          clipId: m.clipId,
          impactIndex: i.impactIndex,
          level,
          hitstunTicks: 18,
          hitstopTicks: 6,
          blockstunTicks: 10,
          blockstopTicks: 4,
        })),
      ),
    },
  };
}
function setup(options = config(), seed = 42) {
  const core = createCore({ runId: run, seed }, options);
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  return core;
}
const actor = (core: CorePort, color: ActorColor = 'white') =>
  requireValue(core.read().actors.find((a) => a.color === color));
let serial = 0;
function packet(
  core: CorePort,
  type: 'punch' | 'kick' | 'guard' | 'unguard' | 'crouch' | 'stand' | 'jump',
  color: ActorColor = 'white',
  sequence = ++serial,
): GameplayCommand {
  const base = {
    runId: run,
    actorId: actor(core, color).actorId,
    input: { commandId: commandId(`f:${sequence}:${color}`), sequence },
  };
  if (type === 'guard' || type === 'unguard')
    return { ...base, type: 'GuardRequested', active: type === 'guard' };
  if (type === 'jump') return { ...base, type: 'JumpRequested' };
  if (type === 'crouch' || type === 'stand')
    return {
      ...base,
      type: 'CrouchRequested',
      active: type === 'crouch',
      movementSessionId: `c:${color}`,
      basisRevision: 0,
    };
  return { ...base, type: 'AttackRequested', category: type };
}
function input(core: CorePort, commands: readonly GameplayCommand[]) {
  core.handleInputBatch({
    runId: run,
    tick: tick(core.read().clocks.tick + 1),
    commands,
  });
}
function result(
  request: SpatialStepRequest,
  candidates: readonly SpatialCandidate[] = [],
  positions: Partial<Record<ActorColor, { grounded: boolean }>> = {},
): FightingSpatialStepResult {
  return {
    snapshot: {
      runId: run,
      tick: request.snapshot.clocks.tick,
      vehicles: [],
      actors: request.snapshot.actors.map((a, i) => ({
        actorId: a.actorId,
        position: {
          x: 0,
          y: positions[a.color]?.grounded === false ? 1 : 0,
          z: i,
        },
        facing: { x: 0, y: 0, z: i === 0 ? 1 : -1 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: positions[a.color]?.grounded ?? true,
        locomotion: 'idle',
      })),
    },
    candidates,
    fighting: {
      stepTick: request.snapshot.clocks.tick,
      takeoffs: request.snapshot.actors
        .filter(
          (a) =>
            positions[a.color]?.grounded === false &&
            a.fighting?.posture !== 'airborne',
        )
        .map((a) => ({
          actorId: a.actorId,
          atGameMs: gameTimeMs(
            request.snapshot.clocks.gameTimeMs - request.step.durationMs,
          ),
          position: { x: 0, y: 0, z: 0 },
        })),
      landings: [],
      contacts: candidates.flatMap((c) =>
        c.kind === 'body-hit'
          ? [
              {
                contactId: c.contactId,
                atGameMs: c.at,
                sourceActorId: c.source.actorId,
                targetActorId: c.targetActorId,
                sourcePosition: { x: 0, y: 0, z: 1 },
                targetPosition: { x: 0, y: 0, z: 0 },
                sourceFacing: { x: 0, y: 0, z: -1 },
                targetFacing: { x: 0, y: 0, z: 1 },
              },
            ]
          : [],
      ),
    },
  };
}
function step(
  core: CorePort,
  ms = T,
  make: (r: SpatialStepRequest) => FightingSpatialStepResult = result,
) {
  core.present(durationMs(ms));
  const request = core.beginStep({ durationMs: durationMs(ms) });
  return core.completeStep(make(request));
}
function body(
  core: CorePort,
  r: SpatialStepRequest,
  source: ActorColor,
  target: ActorColor,
  offset = 0,
): Extract<SpatialCandidate, { kind: 'body-hit' }> {
  const start = r.snapshot.clocks.gameTimeMs - r.step.durationMs;
  return {
    kind: 'body-hit',
    runId: run,
    contactId: contactId(`contact:${++serial}`),
    at: gameTimeMs(start + offset),
    interval: { from: gameTimeMs(start), to: r.snapshot.clocks.gameTimeMs },
    point: { x: 0, y: 1, z: 0 },
    evidence: 'swept-shape',
    source: reference(core, source),
    targetActorId: actor(core, target).actorId,
  };
}

describe('opt-in authoritative fighting Core (synthetic witnesses)', () => {
  test('active nine-entry selection remains uniquely bound inside the required eleven-entry material pack', () => {
    const options = config();
    const fighting = requireValue(options.fighting);
    expect(fighting.entries).toHaveLength(11);
    expect(fighting.catalog.list()).toHaveLength(11);
    expect(FIGHTING_ACTIVE_ENTRIES).toHaveLength(9);
    for (const entry of FIGHTING_ACTIVE_ENTRIES) {
      const matches = fighting.entries.filter(
        (bound) =>
          bound.posture === entry.posture && bound.moveId === entry.moveId,
      );
      expect(matches).toHaveLength(1);
      expect(
        fighting.catalog.get(requireValue(matches[0]).clipId),
      ).toBeDefined();
    }
    expect(() => setup(options)).not.toThrow();
    for (const inactive of ['p_finish', 'p_entry']) {
      const entries = fighting.entries.filter(
        (entry) => entry.moveId !== inactive,
      );
      expect(() =>
        setup({ ...options, fighting: { ...fighting, entries } }),
      ).toThrow('Fighting requires all eleven separately bound entries');
    }
  });
  test('selects deterministic P without consuming the legacy enemy random draw; default remains legacy', () => {
    const first = setup();
    input(first, [packet(first, 'punch')]);
    expect(actor(first).attack?.fighting).toMatchObject({
      kind: 'v3',
      moveId: 'p_short',
      stage: 1,
    });
    expect(actor(first).heat.amount).toBe(1);
    const second = setup();
    input(first, [packet(first, 'kick', 'blue')]);
    input(second, [packet(second, 'kick', 'blue')]);
    expect(actor(first, 'blue').attack?.clipId).toBe(
      actor(second, 'blue').attack?.clipId,
    );
    const legacy = setup({ ...fixtureCatalog(), enemyAi: false });
    input(legacy, [packet(legacy, 'punch')]);
    expect(actor(legacy).attack?.fighting).toBeUndefined();
  });
  test('normalizes reverse order and deduplicates before committing seen IDs', () => {
    const core = setup();
    const p = packet(core, 'punch', 'white', 10),
      k = packet(core, 'kick', 'white', 11);
    input(core, [k, p]);
    input(core, [p, k]);
    expect(actor(core).fighting).toMatchObject({
      route: 'P',
      buffer: { edge: { button: 'K' }, ageTicks: 0 },
    });
    expect(
      core.drain().events.filter((e) => e.type === 'AttackAccepted'),
    ).toHaveLength(1);
    expect(actor(core).heat.amount).toBe(1);
  });
  test('rejects same-actor sequence conflict atomically but accepts equal sequences on different actors', () => {
    const core = setup();
    const p = packet(core, 'punch', 'white', 20),
      k = {
        ...packet(core, 'kick', 'white', 20),
        input: { commandId: commandId('conflict'), sequence: 20 },
      };
    expect(() => input(core, [p, k])).toThrow();
    expect(actor(core).attack).toBeNull();
    input(core, [p, packet(core, 'kick', 'blue', 20)]);
    expect(actor(core).attack).not.toBeNull();
    expect(actor(core, 'blue').attack).not.toBeNull();
  });
  test.each(['high', 'mid', 'low'] as const)(
    'standing guard resolves %s by authoritative TOI witness with zero blocked HP',
    (level) => {
      const core = setup(config(level));
      input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
      const out = step(core, T, (r) =>
        result(r, [body(core, r, 'blue', 'white', T / 4)]),
      );
      expect(actor(core).hp).toBe(level === 'low' ? 400 : 500);
      expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
        level === 'low' ? 0 : 1,
      );
      expect(actor(core, 'blue').attack?.consumedImpacts).toHaveLength(1);
    },
  );
  test('fractional contact freezes source and defender on exactly one clock and preserves remainder', () => {
    const core = setup();
    input(core, [packet(core, 'punch')]);
    step(core, 5 * T);
    const out = step(core, T, (r) =>
      result(r, [body(core, r, 'white', 'blue', T / 4)]),
    );
    const slices = requireValue(actor(core).fightingClock).slices;
    expect(slices.find((s) => s.frozen)?.fromGameMs).toBeCloseTo(5.25 * T, 10);
    expect(actor(core).attack?.fighting?.elapsedTicks).toBe(5);
    expect(actor(core, 'blue').fighting?.stunTicksRemaining).toBe(18);
    const stopped = actor(core).fighting;
    const p = packet(core, 'punch');
    input(core, [p]);
    input(core, [p]);
    step(core, 5.25 * T);
    expect(actor(core).attack?.fighting?.elapsedTicks).toBe(5);
    expect(actor(core).fighting?.tick).toBe(stopped?.tick);
    expect(actor(core).heat.amount).toBe(1);
    expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(1);
    step(core, T);
    expect(actor(core).fighting).toMatchObject({ route: 'PP', stage: 2 });
    expect(actor(core).heat.amount).toBe(2);
  });
  test('rejects missing/foreign contact witnesses without partial mutation and allows corrected retry', () => {
    const core = setup();
    input(core, [packet(core, 'punch', 'blue')]);
    core.present(durationMs(T));
    const r = core.beginStep({ durationMs: durationMs(T) });
    const good = result(r, [body(core, r, 'blue', 'white')]);
    const before = core.read();
    const invalid: FightingSpatialStepResult = {
      ...good,
      fighting: { ...good.fighting, contacts: [] },
    };
    expect(() => core.completeStep(invalid)).toThrow();
    expect(core.read()).toEqual(before);
    expect(() => core.completeStep(good)).not.toThrow();
    expect(actor(core).hp).toBe(400);
  });
  test('replay preserves guard, reaction state, clock slices and events', () => {
    const options = config();
    const recorded = recordCore(setup(options));
    input(recorded.core, [
      packet(recorded.core, 'guard'),
      packet(recorded.core, 'punch', 'blue'),
    ]);
    step(recorded.core, T, (r) =>
      result(r, [body(recorded.core, r, 'blue', 'white', 0.25 * T)]),
    );
    const replayed = replayCore(setup(options), recorded.read());
    expect(replayed.snapshot).toEqual(recorded.core.read());
    expect(replayed.outputs).toEqual(recorded.outputs());
    expect(actor(recorded.core).fighting?.phase).toBe('blockstun');
  });
});

describe('contact posture/facing and atomic transport boundaries', () => {
  const cases = (['high', 'mid', 'low'] as const).flatMap((level) =>
    (
      ['standing-guard', 'crouching-guard', 'crouching', 'airborne'] as const
    ).flatMap((posture) =>
      [true, false].map((front) => ({ level, posture, front })),
    ),
  );
  test.each(cases)(
    '$level / $posture / front=$front',
    ({ level, posture, front }) => {
      const core = setup(config(level));
      if (posture === 'airborne')
        step(core, T, (r) => result(r, [], { white: { grounded: false } }));
      if (posture.startsWith('crouching'))
        input(core, [packet(core, 'crouch')]);
      if (posture.endsWith('guard') || posture === 'airborne')
        input(core, [packet(core, 'guard')]);
      input(core, [packet(core, 'punch', 'blue')]);
      const out = step(core, T, (r) => {
        const response = result(
          r,
          [body(core, r, 'blue', 'white', T / 3)],
          posture === 'airborne' ? { white: { grounded: false } } : {},
        );
        return {
          ...response,
          fighting: {
            ...response.fighting,
            contacts: response.fighting.contacts.map((w) => ({
              ...w,
              targetFacing: { x: 0, y: 0, z: front ? 1 : -1 },
            })),
          },
        };
      });
      const ignored = level === 'high' && posture.startsWith('crouching');
      const blocked =
        front &&
        ((posture === 'standing-guard' && level !== 'low') ||
          (posture === 'crouching-guard' && level === 'low'));
      expect(actor(core).hp).toBe(ignored || blocked ? 500 : 400);
      expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
        blocked ? 1 : 0,
      );
      expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(
        ignored || blocked ? 0 : 1,
      );
      expect(actor(core, 'blue').attack?.consumedImpacts).toHaveLength(
        ignored ? 0 : 1,
      );
    },
  );
  test.each([
    ['boundary', { x: 1, y: 0, z: 0 }, 500],
    ['zero', { x: 0, y: 0, z: 0 }, 400],
  ] as const)(
    'guard dot %s uses contact witness rather than final facing',
    (_, facing, hp) => {
      const core = setup();
      input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
      step(core, T, (r) => {
        const response = result(r, [body(core, r, 'blue', 'white')]);
        return {
          ...response,
          fighting: {
            ...response.fighting,
            contacts: response.fighting.contacts.map((w) => ({
              ...w,
              targetFacing: facing,
            })),
          },
        };
      });
      expect(actor(core).hp).toBe(hp);
    },
  );
  test.each([
    ['overflowing products', [1e200, 0], [0, 0], [1e200, 0], true],
    [
      'opposite finite positions',
      [Number.MAX_VALUE, 0],
      [-Number.MAX_VALUE, 0],
      [Number.MAX_VALUE, 0],
      true,
    ],
    [
      'overflowing lengths',
      [Number.MAX_VALUE, Number.MAX_VALUE],
      [0, 0],
      [Number.MAX_VALUE, Number.MAX_VALUE],
      true,
    ],
    [
      'opposite finite diagonal',
      [Number.MAX_VALUE, Number.MAX_VALUE],
      [-Number.MAX_VALUE, -Number.MAX_VALUE],
      [Number.MAX_VALUE, Number.MAX_VALUE],
      true,
    ],
    [
      'opposite finite back-facing',
      [Number.MAX_VALUE, 0],
      [-Number.MAX_VALUE, 0],
      [-Number.MAX_VALUE, 0],
      false,
    ],
    ['underflowing products', [1e-200, 0], [0, 0], [1e-200, 0], true],
    [
      'subnormal direction and facing',
      [Number.MIN_VALUE, 0],
      [0, 0],
      [Number.MIN_VALUE, 0],
      true,
    ],
    [
      'tiny displacement beside shared large coordinate',
      [Number.MAX_VALUE, Number.MIN_VALUE],
      [Number.MAX_VALUE, 0],
      [0, Number.MIN_VALUE],
      true,
    ],
    ['zero direction', [1e200, 1e200], [1e200, 1e200], [1e200, 0], false],
    ['zero horizontal facing', [1e200, 0], [0, 0], [0, 0], false],
    [
      'inclusive perpendicular boundary',
      [Number.MAX_VALUE, Number.MAX_VALUE],
      [-Number.MAX_VALUE, -Number.MAX_VALUE],
      [Number.MAX_VALUE, -Number.MAX_VALUE],
      true,
    ],
    ['just behind boundary', [-1e-100, 1e200], [0, 0], [1e200, 0], false],
  ] as const)(
    'finite guard directions resolve %s at contact time without numeric failure',
    (_, source, target, facing, blocked) => {
      const core = setup();
      input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
      core.present(durationMs(T));
      const request = core.beginStep({ durationMs: durationMs(T) });
      const response = result(request, [
        body(core, request, 'blue', 'white', T / 4),
      ]);
      const extreme: FightingSpatialStepResult = {
        ...response,
        fighting: {
          ...response.fighting,
          contacts: response.fighting.contacts.map((w) => ({
            ...w,
            sourcePosition: { x: source[0], y: 0, z: source[1] },
            targetPosition: { x: target[0], y: 0, z: target[1] },
            targetFacing: { x: facing[0], y: Number.MAX_VALUE, z: facing[1] },
          })),
        },
      };
      const out = core.completeStep(extreme);
      expect(actor(core).hp).toBe(blocked ? 500 : 400);
      expect(actor(core).fighting?.phase).toBe(
        blocked ? 'blockstun' : 'hitstun',
      );
      expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
        blocked ? 1 : 0,
      );
      expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(
        blocked ? 0 : 1,
      );
      expect(actor(core, 'blue').attack?.consumedImpacts).toHaveLength(1);
      const frozen = requireValue(
        actor(core).fightingClock?.slices.find((s) => s.frozen),
      );
      expect(frozen.fromGameMs).toBeCloseTo(T / 4, 10);
      expect(() => step(core)).not.toThrow();
      expect(actor(core).hp).toBe(blocked ? 500 : 400);
    },
  );
  test('foreign run/actor and duplicate packets cannot start or refresh reservations', () => {
    const core = setup();
    const p = packet(core, 'punch');
    input(core, [
      { ...p, runId: runId('foreign') },
      { ...p, actorId: actorId('foreign') },
    ]);
    expect(actor(core).attack).toBeNull();
    input(core, [p, p]);
    const k = packet(core, 'kick');
    input(core, [k]);
    step(core, 2 * T);
    input(core, [k]);
    expect(actor(core).fighting?.buffer?.ageTicks).toBe(2);
    expect(actor(core).heat.amount).toBe(1);
  });
  test.each(['missing', 'duplicate', 'time', 'actor', 'nonfinite'] as const)(
    'invalid %s witness is rejected before any mutation',
    (fault) => {
      const core = setup();
      input(core, [packet(core, 'punch', 'blue')]);
      core.present(durationMs(T));
      const r = core.beginStep({ durationMs: durationMs(T) });
      const good = result(r, [body(core, r, 'blue', 'white')]);
      const w = requireValue(good.fighting.contacts[0]);
      const bad =
        fault === 'missing'
          ? []
          : fault === 'duplicate'
            ? [w, w]
            : fault === 'time'
              ? [{ ...w, atGameMs: gameTimeMs(w.atGameMs + 1) }]
              : fault === 'actor'
                ? [{ ...w, sourceActorId: actor(core, 'green').actorId }]
                : [{ ...w, targetFacing: { x: Infinity, y: 0, z: 1 } }];
      const before = core.read(),
        response: FightingSpatialStepResult = {
          ...good,
          fighting: { ...good.fighting, contacts: bad },
        };
      expect(() => core.completeStep(response)).toThrow();
      expect(core.read()).toEqual(before);
      expect(
        core.completeStep(good).events.filter((e) => e.type === 'HpChanged'),
      ).toHaveLength(1);
    },
  );
});

describe('action-boundary locks, landing and simultaneous contacts', () => {
  test('fresh input at exact contact + stop + H starts; pre-release input never replays', () => {
    const core = setup();
    input(core, [packet(core, 'punch', 'blue')]);
    step(core, T, (r) => result(r, [body(core, r, 'blue', 'white', T / 4)]));
    input(core, [packet(core, 'punch')]);
    expect(actor(core).fighting?.buffer).toBeNull();
    step(core, 23.25 * T - 0.001);
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack).toBeNull();
    step(core, 0.001);
    expect(actor(core).fighting?.phase).toBe('neutral');
    expect(actor(core).attack).toBeNull();
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack?.fighting).toMatchObject({ moveId: 'p_short' });
  });
  test('guard cannot cancel an attack; block drops the reservation and never confirms', () => {
    const core = setup();
    input(core, [packet(core, 'punch'), packet(core, 'guard')]);
    expect(actor(core).fighting?.guardHeld).toBe(false);
    input(core, [packet(core, 'kick'), packet(core, 'guard', 'blue')]);
    step(core, 5 * T);
    step(core, T, (r) => result(r, [body(core, r, 'white', 'blue')]));
    expect(actor(core).fighting).toMatchObject({
      hitConfirmed: false,
      buffer: null,
      stage: 1,
    });
    step(core, 30 * T);
    expect(actor(core).attack).toBeNull();
    expect(
      core.drain().events.filter((e) => e.type === 'AttackAccepted'),
    ).toHaveLength(0);
  });
  test('blockstun keeps contact height then applies currently held crouch on the release boundary', () => {
    const core = setup();
    input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
    step(core, T, (r) => result(r, [body(core, r, 'blue', 'white', T / 4)]));
    input(core, [packet(core, 'crouch')]);
    expect(actor(core).fighting).toMatchObject({
      phase: 'blockstun',
      posture: 'crouching',
      guardHeight: 'standing',
    });
    expect(actor(core).crouching).toBe(false);
    step(core, 13.25 * T);
    expect(actor(core).fighting).toMatchObject({
      phase: 'neutral',
      guardHeight: 'crouching',
    });
    expect(actor(core).crouching).toBe(true);
  });
  test('crouching attack survives publication and cannot posture-cancel itself', () => {
    const core = setup();
    input(core, [packet(core, 'crouch'), packet(core, 'punch')]);
    expect(actor(core).attack?.fighting).toMatchObject({ moveId: 'c_body' });
    input(core, [
      packet(core, 'stand'),
      packet(core, 'jump'),
      packet(core, 'guard'),
    ]);
    core.present(durationMs(1));
    expect(actor(core).crouching).toBe(true);
    expect(actor(core).fighting?.posture).toBe('crouching');
  });
  test('normal landing locks three action ticks, then permits a new air attack on the next jump', () => {
    const core = setup();
    step(core, T, (r) => result(r, [], { white: { grounded: false } }));
    step(core, T, (r) => {
      const response = result(r);
      return {
        ...response,
        fighting: {
          ...response.fighting,
          landings: [
            {
              actorId: actor(core).actorId,
              atGameMs: gameTimeMs(r.snapshot.clocks.gameTimeMs - T / 2),
              position: { x: 0, y: 0, z: 0 },
              supportId: 'synthetic-ground',
              airborneActivationId: null,
            },
          ],
        },
      };
    });
    expect(actor(core).fighting).toMatchObject({
      posture: 'standing',
      phase: 'landing',
      landingTicksRemaining: 3,
    });
    input(core, [packet(core, 'punch')]);
    step(core, 2.5 * T);
    expect(actor(core).fighting?.phase).toBe('neutral');
    expect(actor(core).attack).toBeNull();
    step(core, T, (r) => result(r, [], { white: { grounded: false } }));
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack?.fighting).toMatchObject({ moveId: 'a_palm' });
  });
  test.each([-0.001, 0, 0.001])(
    'air landing truncates active, contact offset %s ms',
    (delta) => {
      const core = setup();
      step(core, T, (r) => result(r, [], { white: { grounded: false } }));
      input(core, [packet(core, 'punch')]);
      step(core, 8 * T, (r) => result(r, [], { white: { grounded: false } }));
      const out = step(core, T, (r) => {
        const response = result(r, [
          body(core, r, 'white', 'blue', T / 2 + delta),
        ]);
        return {
          ...response,
          fighting: {
            ...response.fighting,
            landings: [
              {
                actorId: actor(core).actorId,
                atGameMs: gameTimeMs(
                  requireValue(response.candidates[0]).at - delta,
                ),
                position: { x: 0, y: 0, z: 0 },
                supportId: 'synthetic-ground',
                airborneActivationId: requireValue(actor(core).attack)
                  .activationId,
              },
            ],
          },
        };
      });
      expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(
        delta < 0 ? 1 : 0,
      );
      expect(actor(core).fighting?.posture).toBe('standing');
      expect(actor(core).attack).toBeNull();
      expect(
        actor(core).fighting?.landingTicksRemaining,
      ).toBeGreaterThanOrEqual(16);
    },
  );
  test('same-time trade retains both body losses before interrupting either attack; later tails are rejected', () => {
    const core = setup();
    input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
    step(core, 5 * T);
    const out = step(core, T, (r) => {
      const first = body(core, r, 'white', 'blue', T / 4),
        second = body(core, r, 'blue', 'white', T / 4);
      const tail = {
        ...second,
        contactId: contactId(`tail:${++serial}`),
        at: gameTimeMs(second.at + T / 4),
      };
      return result(r, [tail, second, first]);
    });
    expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(2);
    expect(actor(core).hp).toBe(400);
    expect(actor(core, 'blue').hp).toBe(450);
    expect(actor(core).attack).toBeNull();
    expect(actor(core, 'blue').attack).toBeNull();
    expect(actor(core).fighting?.phase).toBe('hitstun');
  });
  test('pause/release clears held guard and buffer; a new run starts without air/guard/command residue', () => {
    const core = setup();
    input(core, [packet(core, 'punch'), packet(core, 'kick')]);
    core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
    expect(actor(core).fighting?.buffer).toBeNull();
    core.handle({ type: 'ResumeRequested', runId: run, reason: 'settings' });
    const clean = setup();
    input(clean, [packet(clean, 'guard')]);
    clean.handle({ type: 'InputsReleased', runId: run });
    expect(actor(clean).fighting).toMatchObject({
      guardHeld: false,
      airAttackUsed: false,
      buffer: null,
    });
  });
});

describe('continuous time, heat and unchanged world/lifecycle policy', () => {
  test.each([
    [5 * T - 1e-8, 0],
    [5 * T, 1],
    [7 * T - 1e-8, 1],
    [7 * T, 0],
  ])('active is exactly half-open at %s', (at, hits) => {
    const core = setup();
    input(core, [packet(core, 'punch')]);
    const out = step(core, 8 * T, (r) =>
      result(r, [body(core, r, 'white', 'blue', requireValue(at))]),
    );
    expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(
      requireValue(hits),
    );
  });
  test.each([
    [2, 'PK'],
    [1, 'P'],
  ] as const)(
    'reservation placed at %s ticks retains inclusive age six but expires at seven',
    (reservationAt, route) => {
      const core = setup();
      input(core, [packet(core, 'punch')]);
      step(core, reservationAt * T);
      input(core, [packet(core, 'kick')]);
      step(core, (5 - reservationAt) * T);
      step(core, T, (r) => result(r, [body(core, r, 'white', 'blue')]));
      step(core, 8 * T);
      expect(actor(core).fighting?.route).toBe(route);
      expect(actor(core).heat.amount).toBe(route === 'PK' ? 2 : 1);
    },
  );
  test('actual heat exclusion and motion/stun clocks are independent of accepted presentation backlog and render partitions', () => {
    const runTrace = (partitions: readonly number[]) => {
      const core = setup();
      input(core, [packet(core, 'punch', 'blue')]);
      step(core, T, (r) => result(r, [body(core, r, 'blue', 'white', T / 4)]));
      core.present(durationMs(partitions.reduce((a, b) => a + b, 0)));
      const projected = actor(core).heat;
      for (const ms of partitions) {
        const r = core.beginStep({ durationMs: durationMs(ms) });
        core.completeStep(result(r));
      }
      const a = actor(core),
        enemy = actor(core, 'blue');
      return {
        projected,
        f: a.fighting,
        heat: a.heat,
        enemyHeat: enemy.heat,
        motion: requireValue(requireValue(enemy.fightingClock).slices.at(-1))
          .toMotionMs,
      };
    };
    const one = runTrace([30 * T]),
      many = runTrace([0.25 * T, 5 * T, 7.5 * T, 17.25 * T]);
    expect(one.f).toEqual(many.f);
    expect(one.heat.amount).toBeCloseTo(many.heat.amount, 10);
    expect(one.enemyHeat).toEqual(many.enemyHeat);
    expect(one.motion).toBeCloseTo(many.motion, 10);
    expect(one.projected.amount).toBe(0);
  });
  test('duplicate consumed contact during stop neither damages twice nor extends stop', () => {
    const core = setup();
    input(core, [packet(core, 'punch')]);
    step(core, 5 * T);
    const source = reference(core);
    step(core, T, (r) => result(r, [body(core, r, 'white', 'blue', T / 4)]));
    const after = actor(core).fighting?.stopTicksRemaining;
    const out = step(core, T, (r) =>
      result(r, [{ ...body(core, r, 'white', 'blue', T / 4), source }]),
    );
    expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(0);
    expect(actor(core).fighting?.stopTicksRemaining).toBe(
      requireValue(after) - 1,
    );
    expect(actor(core, 'blue').hp).toBe(450);
  });
  test('same-time clash precedes bodies and cannot confirm a route or acquire stop', () => {
    const core = setup();
    input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
    step(core, 5 * T);
    const out = step(core, T, (r) => {
      const c = body(core, r, 'white', 'blue', T / 4);
      const clash: SpatialCandidate = {
        ...c,
        kind: 'clash',
        first: reference(core),
        second: reference(core, 'blue'),
      };
      return result(r, [
        c,
        { ...clash, contactId: contactId(`clash:${++serial}`) },
      ]);
    });
    expect(out.events.filter((e) => e.type === 'ClashResolved')).toHaveLength(
      1,
    );
    expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(0);
    expect(actor(core).fighting).toMatchObject({
      hitConfirmed: false,
      stopTicksRemaining: 0,
    });
  });
  test('four opponents retain HP stock/healing and drop combat state on KO/switch', () => {
    const options = config();
    const core = setup({
      ...options,
      fighting: {
        ...requireValue(options.fighting),
        policy: {
          ...requireValue(options.fighting).policy,
          hpPerNormalizedPoint: 100,
        },
      },
    });
    const colors: ActorColor[] = [];
    for (let n = 0; n < 4; n++) {
      const target = requireValue(
        core
          .read()
          .actors.find((a) => a.actorId === core.read().currentOpponentId),
      );
      colors.push(target.color);
      expect(target.maxHp).toBe(n === 3 ? 700 : 500);
      input(core, [packet(core, 'punch'), packet(core, 'kick')]);
      step(core, 5 * T);
      step(core, T, (r) =>
        result(r, [body(core, r, 'white', target.color, T / 4)]),
      );
      expect(actor(core).fighting?.buffer).toBeNull();
      expect(actor(core, target.color).fighting?.phase).toBe('defeated');
      if (n < 3) {
        step(core, 1625);
        expect(actor(core, target.color).fighting?.phase).toBe('defeated');
      }
    }
    expect(colors).toEqual(['blue', 'green', 'yellow', 'black']);
    expect(core.read().result?.outcome).toBe('clear');
    expect(actor(core).hp).toBe(500);
  });
  test('admission rejects missing profiles, incomplete entries and altered legacy stock', () => {
    const base = config();
    const invalid = [
      {
        ...base,
        fighting: { ...requireValue(base.fighting), legacyImpactProfiles: [] },
      },
      {
        ...base,
        fighting: {
          ...requireValue(base.fighting),
          entries: requireValue(base.fighting).entries.slice(1),
        },
      },
      {
        ...base,
        moves: {
          ...base.moves,
          black: {
            ...base.moves.black,
            kicks: base.moves.black.kicks.slice(1),
          },
        },
      },
    ];
    for (const options of invalid) expect(() => setup(options)).toThrow();
  });
});

describe('physical takeoff seam and transport/lifecycle edges', () => {
  test('accepted jump intent is not proof of takeoff: a physically refused jump stays ground-guarded', () => {
    const core = setup();
    input(core, [
      packet(core, 'guard'),
      packet(core, 'jump'),
      packet(core, 'punch', 'blue'),
    ]);
    const out = step(core, T, (r) =>
      result(r, [body(core, r, 'blue', 'white', T / 2)]),
    );
    expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
      1,
    );
    expect(actor(core).fighting?.posture).toBe('standing');
  });
  test('actual lost support at contact immediately disables ground guard without jump invulnerability', () => {
    const core = setup();
    input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
    const out = step(core, T, (r) => {
      const response = result(r, [body(core, r, 'blue', 'white', T / 2)], {
        white: { grounded: false },
      });
      return {
        ...response,
        fighting: {
          ...response.fighting,
          takeoffs: response.fighting.takeoffs.map((w) => ({
            ...w,
            atGameMs: requireValue(response.candidates[0]).at,
          })),
        },
      };
    });
    expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
      0,
    );
    expect(actor(core).hp).toBe(400);
    expect(actor(core).fighting).toMatchObject({
      phase: 'hitstun',
      posture: 'airborne',
    });
  });
  test('same-time zero-hop is takeoff then landing then body, with overlapping landing/hit locks', () => {
    const core = setup();
    input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
    const out = step(core, T, (r) => {
      const response = result(r, [body(core, r, 'blue', 'white', T / 2)]);
      const atGameMs = requireValue(response.candidates[0]).at;
      return {
        ...response,
        fighting: {
          ...response.fighting,
          takeoffs: [
            {
              actorId: actor(core).actorId,
              atGameMs,
              position: { x: 0, y: 0, z: 0 },
            },
          ],
          landings: [
            {
              actorId: actor(core).actorId,
              atGameMs,
              position: { x: 0, y: 0, z: 0 },
              supportId: 'synthetic-ground',
              airborneActivationId: null,
            },
          ],
        },
      };
    });
    expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
      0,
    );
    expect(actor(core).fighting).toMatchObject({
      posture: 'standing',
      phase: 'hitstun',
      landingTicksRemaining: 3,
      stopTicksRemaining: 6,
    });
  });
  test('airborne final snapshot without takeoff proof is rejected atomically', () => {
    const core = setup();
    core.present(durationMs(T));
    const r = core.beginStep({ durationMs: durationMs(T) });
    const good = result(r, [], { white: { grounded: false } });
    const bad: FightingSpatialStepResult = {
      ...good,
      fighting: { ...good.fighting, takeoffs: [] },
    };
    const before = core.read();
    expect(() => core.completeStep(bad)).toThrow();
    expect(core.read()).toEqual(before);
    core.completeStep(good);
    expect(actor(core).fighting?.posture).toBe('airborne');
  });
  test('same actor sequence conflict across batches is rejected; no inputs can mutate a begun request', () => {
    const core = setup();
    input(core, [packet(core, 'punch', 'white', 9000)]);
    const conflict = {
      ...packet(core, 'kick', 'white', 9000),
      input: { sequence: 9000, commandId: commandId('late-conflict') },
    };
    expect(() => input(core, [conflict])).toThrow();
    core.present(durationMs(T));
    const r = core.beginStep({ durationMs: durationMs(T) });
    expect(() => input(core, [packet(core, 'kick')])).toThrow();
    core.completeStep(result(r));
  });
  test('neutral attack faces the physical target instead of its previous facing', () => {
    const core = setup();
    step(core, T, (r) => {
      const response = result(r);
      return {
        ...response,
        snapshot: {
          ...response.snapshot,
          actors: response.snapshot.actors.map((a) => ({
            ...a,
            facing: { x: 0, y: 0, z: -1 },
          })),
        },
      };
    });
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack?.fighting?.facing).toEqual({ x: 0, y: 0, z: 1 });
  });
  test('pause does not erase the committed crouch contact stance of a crouching attack', () => {
    const core = setup();
    input(core, [packet(core, 'crouch'), packet(core, 'punch')]);
    core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
    expect(actor(core).crouching).toBe(true);
    expect(actor(core).fighting?.posture).toBe('crouching');
  });
});

describe('route and contact-time traces (synthetic Core evidence only)', () => {
  test.each(['PP', 'K'] as const)(
    '%s + P cannot spend heat, replace the attack or skip recovery after accepted body contact',
    (route) => {
      const core = setup();
      input(core, [packet(core, route[0] === 'P' ? 'punch' : 'kick')]);
      for (let stage = 0; stage < route.length; stage++) {
        const before = requireValue(actor(core).fighting);
        const spec = FIGHTING_MOVE_SPECS[requireValue(before.moveId)];
        step(core, spec.startupTicks * T);
        if (stage + 1 < route.length) input(core, [packet(core, 'punch')]);
        const out = step(core, T, (r) =>
          result(r, [body(core, r, 'white', 'blue', T / 4)]),
        );
        expect(
          out.events.filter((event) => event.type === 'HpChanged'),
        ).toHaveLength(1);
        step(core, (spec.hitstopTicks + 0.25) * T);
      }
      const before = requireValue(actor(core).fighting);
      const activation = requireValue(actor(core).attack).activationId;
      const heat = actor(core).heat.amount;
      expect(before.hitConfirmed).toBe(true);
      input(core, [packet(core, 'punch')]);
      expect(actor(core).fighting).toMatchObject({
        route,
        stage: route.length,
        moveId: route === 'PP' ? 'p_body' : 'k_front',
        moveAgeTicks: before.moveAgeTicks,
      });
      expect(actor(core).attack?.activationId).toBe(activation);
      expect(actor(core).heat.amount).toBe(heat);
      expect(
        core.drain().events.filter((event) => event.type === 'AttackAccepted'),
      ).toHaveLength(0);
      const remaining = route === 'PP' ? 16.75 : 21.75;
      step(core, (remaining - 0.01) * T);
      expect(actor(core).attack?.activationId).toBe(activation);
      step(core, 0.01 * T);
      expect(actor(core).attack).toBeNull();
      expect(actor(core).fighting).toMatchObject({
        phase: 'neutral',
        stage: 0,
        buffer: null,
      });
    },
  );
  test.each([
    ['P', 'P'],
    ['PP', 'PP'],
    ['PPP', 'PP'],
    ['PK', 'PK'],
    ['PPK', 'PPK'],
    ['K', 'K'],
    ['KK', 'KK'],
    ['KP', 'K'],
    ['KPP', 'K'],
  ])(
    'requested %s executes only active prefix %s from accepted body hits with one heat per started stage',
    (requested, route) => {
      const core = setup();
      const accepted: string[] = [];
      input(core, [packet(core, route[0] === 'P' ? 'punch' : 'kick')]);
      for (let stage = 0; stage < route.length; stage++) {
        const before = requireValue(actor(core).fighting);
        const spec = FIGHTING_MOVE_SPECS[requireValue(before.moveId)];
        expect(before.route).toBe(route.slice(0, stage + 1));
        expect(before.stage).toBe(stage + 1);
        step(core, spec.startupTicks * T);
        if (stage + 1 < route.length)
          input(core, [
            packet(core, route[stage + 1] === 'P' ? 'punch' : 'kick'),
          ]);
        const out = step(core, T, (r) =>
          result(r, [body(core, r, 'white', 'blue', T / 4)]),
        );
        const hp = out.events.find((e) => e.type === 'HpChanged');
        expect(hp?.type).toBe('HpChanged');
        if (hp?.type === 'HpChanged')
          expect(hp.actualHpLost).toBeCloseTo(
            spec.damageNormalized * 5 * requireValue([1, 0.8, 0.65][stage]),
            10,
          );
        accepted.push(requireValue(before.moveId));
        if (stage + 1 < route.length)
          step(core, (spec.hitstopTicks + 0.25) * T);
      }
      expect(actor(core).heat.amount).toBe(route.length);
      expect(accepted).toHaveLength(route.length);
      if (requested !== route) {
        input(
          core,
          [...requested.slice(route.length)].map((button) =>
            packet(core, button === 'P' ? 'punch' : 'kick'),
          ),
        );
        const spec =
          FIGHTING_MOVE_SPECS[requireValue(actor(core).fighting?.moveId)];
        step(core, (spec.hitstopTicks + 0.25) * T);
        expect(actor(core).fighting).toMatchObject({
          route,
          stage: route.length,
        });
        expect(actor(core).heat.amount).toBe(route.length);
      }
      input(core, [packet(core, 'punch')]);
      step(core, 60 * T);
      expect(actor(core).attack).toBeNull();
      expect(actor(core).fighting?.stage).toBe(0);
    },
  );
  test.each([-0.001, 0, 0.001])(
    'next physical contact relative to exact defender actionable boundary: %s ms',
    (delta) => {
      const base = config('low');
      const definitions = base.catalog.list().map((m) => ({
        ...m,
        impacts: [
          {
            ...requireValue(m.impacts[0]),
            endMs: durationMs(T),
            damageShare: 0.5,
          },
          {
            ...requireValue(m.impacts[0]),
            impactIndex: 1,
            startMs: durationMs(17 * T),
            endMs: durationMs(20 * T),
            damageShare: 0.5,
          },
        ],
      }));
      const options = {
        ...base,
        catalog: {
          list: () => definitions,
          get: (id: MotionDefinition['clipId']) =>
            definitions.find((m) => m.clipId === id),
        },
        fighting: {
          ...requireValue(base.fighting),
          legacyImpactProfiles: definitions.flatMap((m) =>
            m.impacts.map((i) => ({
              ...requireValue(
                requireValue(base.fighting).legacyImpactProfiles[0],
              ),
              clipId: m.clipId,
              impactIndex: i.impactIndex,
              level: i.impactIndex === 0 ? ('low' as const) : ('mid' as const),
            })),
          ),
        },
      };
      const core = setup(options);
      input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
      step(core, T, (r) => result(r, [body(core, r, 'blue', 'white')]));
      const out = step(core, 24 * T, (r) => {
        const c = body(core, r, 'blue', 'white', 23 * T + delta);
        return result(r, [
          {
            ...c,
            source: {
              ...c.source,
              impactId: requireValue(
                requireValue(actor(core, 'blue').attack).impactBindings[1],
              ).impactId,
            },
          },
        ]);
      });
      expect(out.events.filter((e) => e.type === 'GuardResolved')).toHaveLength(
        delta < 0 ? 0 : 1,
      );
      expect(actor(core).hp).toBe(delta < 0 ? 400 : 450); // legacy 100 total is distributed once, never multiplied by five.
    },
  );
  test('air attack is once per real flight and landing resets it only after concurrent recovery', () => {
    const core = setup();
    step(core, T, (r) => result(r, [], { white: { grounded: false } }));
    input(core, [packet(core, 'kick')]);
    expect(actor(core).attack?.fighting).toMatchObject({ moveId: 'a_kick' });
    step(core, 33 * T, (r) => result(r, [], { white: { grounded: false } }));
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack).toBeNull();
    expect(actor(core).fighting).toMatchObject({
      airAttackUsed: true,
      buffer: null,
    });
    step(core, T, (r) => {
      const response = result(r);
      return {
        ...response,
        fighting: {
          ...response.fighting,
          landings: [
            {
              actorId: actor(core).actorId,
              atGameMs: gameTimeMs(r.snapshot.clocks.gameTimeMs - T),
              position: { x: 0, y: 0, z: 0 },
              supportId: 'ground',
              airborneActivationId: null,
            },
          ],
        },
      };
    });
    expect(actor(core).fighting).toMatchObject({
      airAttackUsed: false,
      phase: 'landing',
      landingTicksRemaining: 7,
    });
    step(core, 7 * T);
    step(core, T, (r) => result(r, [], { white: { grounded: false } }));
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack?.fighting).toMatchObject({ moveId: 'a_palm' });
  });
  test('physical landing during airborne hitstop stands but cannot erase stun or landing lock', () => {
    const core = setup();
    step(core, T, (r) => result(r, [], { white: { grounded: false } }));
    input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
    step(core, T, (r) => {
      const response = result(r, [body(core, r, 'blue', 'white', T / 4)]);
      return {
        ...response,
        fighting: {
          ...response.fighting,
          landings: [
            {
              actorId: actor(core).actorId,
              atGameMs: gameTimeMs(r.snapshot.clocks.gameTimeMs - T / 2),
              position: { x: 0, y: 0, z: 0 },
              supportId: 'ground',
              airborneActivationId: requireValue(actor(core).attack)
                .activationId,
            },
          ],
        },
      };
    });
    expect(actor(core).fighting).toMatchObject({
      posture: 'standing',
      phase: 'hitstun',
      stopTicksRemaining: 6,
      stunTicksRemaining: 18,
      landingTicksRemaining: 8,
    });
    input(core, [packet(core, 'punch')]);
    step(core, 13.25 * T);
    expect(actor(core).fighting).toMatchObject({
      phase: 'hitstun',
      landingTicksRemaining: 0,
      stunTicksRemaining: 10,
    });
    expect(actor(core).attack).toBeNull();
  });
  test('heat mutation and read-only presentation projection exclude exactly the accepted stop interval', () => {
    const core = setup();
    input(core, [packet(core, 'punch')]);
    step(core, 21 * T);
    input(core, [packet(core, 'punch', 'blue')]);
    step(core, T, (r) => result(r, [body(core, r, 'blue', 'white', T / 4)]));
    const frozenHeat = actor(core).heat.amount;
    expect(frozenHeat).toBeCloseTo(1 - ((T / 4) * 7) / 3000, 10);
    core.present(durationMs(5.25 * T));
    expect(actor(core).heat.amount).toBe(frozenHeat);
    const r = core.beginStep({ durationMs: durationMs(5.25 * T) });
    core.completeStep(result(r));
    expect(actor(core).heat.amount).toBe(frozenHeat);
    step(core, T);
    expect(actor(core).heat.amount).toBeCloseTo(
      frozenHeat - (T * 7) / 3000,
      10,
    );
  });
  test('committed source/defender clocks cut at fractional TOI, freeze the new reaction epoch at zero, then resume', () => {
    const core = setup();
    input(core, [packet(core, 'punch')]);
    step(core, 5 * T);
    let planned: SpatialStepRequest | undefined;
    const out = step(core, T, (r) => {
      planned = r;
      return result(r, [body(core, r, 'white', 'blue', T / 4)]);
    });
    const source = actor(core),
      target = actor(core, 'blue');
    const event = requireValue(out.events.find((e) => e.type === 'HpChanged'));
    const targetClock = requireValue(target.fightingClock);
    const reaction = requireValue(
      targetClock.slices.find((s) => s.clipId === poseClips['hit-standing']),
    );
    expect(reaction.fromGameMs).toBe(event.at);
    expect(reaction.fromMotionMs).toBe(0);
    expect(reaction.toMotionMs).toBe(0);
    expect(reaction.frozen).toBe(true);
    expect(
      requireValue(requireValue(source.fightingClock).slices.at(-1)).toMotionMs,
    ).toBeCloseTo(5.25 * T, 10);
    expect(
      requireValue(
        requireValue(
          requireValue(requireValue(planned).snapshot.actors[0]).fightingClock,
        ).slices.at(-1),
      ).toMotionMs,
    ).toBeCloseTo(6 * T, 10);
    step(core, 6.25 * T);
    expect(
      requireValue(
        requireValue(actor(core, 'blue').fightingClock).slices.at(-1),
      ).toMotionMs,
    ).toBeCloseTo(T, 10);
    console.info(
      'T3_SYNTHETIC_CLOCK_TRACE',
      JSON.stringify({
        contactAt: event.at,
        stepFrom:
          requireValue(planned).snapshot.clocks.gameTimeMs -
          requireValue(planned).step.durationMs,
        plannedSource: requireValue(requireValue(planned).snapshot.actors[0])
          .fightingClock,
        acceptedSource: source.fightingClock,
        acceptedDefender: targetClock,
        stopEndsAt: event.at + 6 * T,
        firstDefenderActionableAtWithoutFurtherContact: event.at + 24 * T,
        resumedDefender: actor(core, 'blue').fightingClock,
        actualSpatialIntegrated: false,
      }),
    );
  });
});

describe('final Core authority regressions', () => {
  test('guard-held public permissions agree with rejected attacks and spend no heat', () => {
    const core = setup();
    input(core, [packet(core, 'guard')]);
    expect(actor(core).actions.punch.allowed).toBe(false);
    expect(actor(core).actions.kick.allowed).toBe(false);
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack).toBeNull();
    expect(actor(core).heat.amount).toBe(0);
    input(core, [packet(core, 'unguard'), packet(core, 'punch')]);
    expect(actor(core).attack).not.toBeNull();
  });
  test('the entire new-mode result, including a malformed non-body candidate, is validated before mutation', () => {
    const core = setup();
    input(core, [packet(core, 'punch')]);
    core.present(durationMs(6 * T));
    const r = core.beginStep({ durationMs: durationMs(6 * T) });
    const c = body(core, r, 'white', 'blue', 5 * T);
    const invalid: SpatialCandidate = {
      ...c,
      kind: 'clash',
      first: c.source,
      second: c.source,
      at: gameTimeMs(r.snapshot.clocks.gameTimeMs + 1),
    };
    const before = core.read();
    expect(() => core.completeStep(result(r, [c, invalid]))).toThrow();
    expect(core.read()).toEqual(before);
    expect(
      core
        .completeStep(result(r, [c]))
        .events.filter((e) => e.type === 'HpChanged'),
    ).toHaveLength(1);
  });
  test('simultaneous lethal bodies preserve loss precedence and both living clock entries, with no heal revival', () => {
    const options = config();
    const core = setup({
      ...options,
      fighting: {
        ...requireValue(options.fighting),
        policy: {
          ...requireValue(options.fighting).policy,
          hpPerNormalizedPoint: 100,
        },
      },
    });
    for (let i = 0; i < 4; i++) {
      input(core, [packet(core, 'punch', 'blue')]);
      step(core, T, (r) => result(r, [body(core, r, 'blue', 'white')]));
      step(core, 2600);
    }
    expect(actor(core).hp).toBe(100);
    input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
    step(core, 5 * T);
    const out = step(core, T, (r) =>
      result(r, [
        body(core, r, 'white', 'blue', T / 4),
        body(core, r, 'blue', 'white', T / 4),
      ]),
    );
    expect(out.events.filter((e) => e.type === 'ActorDefeated')).toHaveLength(
      2,
    );
    expect(out.events.filter((e) => e.type === 'Healed')).toHaveLength(0);
    expect(core.read().result?.outcome).toBe('defeat');
    expect(actor(core).hp).toBe(0);
    expect(actor(core, 'blue').hp).toBe(0);
    expect(actor(core).fighting?.phase).toBe('defeated');
    const living = requireValue(actor(core).fightingClock).slices;
    expect(living.some((slice) => slice.activationId !== null)).toBe(true);
    expect(living.at(-1)).toMatchObject({
      clipId: poseClips['hit-standing'],
      frozen: true,
      activationId: null,
    });
  });
});

describe('loading and explicit numeric admission', () => {
  test('loading/background/release commands cannot access unprepared combat runtime or replay stale edges', () => {
    const core = createCore({ runId: run, seed: 42 }, config());
    const old = packet(core, 'punch');
    expect(() =>
      input(core, [old, packet(core, 'guard'), packet(core, 'crouch')]),
    ).not.toThrow();
    expect(() =>
      core.handle({ type: 'InputsReleased', runId: run }),
    ).not.toThrow();
    expect(() =>
      core.handle({ type: 'Backgrounded', runId: run }),
    ).not.toThrow();
    core.handle({ type: 'AssetsReady', runId: run });
    core.handle({ type: 'StartRequested', runId: run });
    core.handle({ type: 'Foregrounded', runId: run });
    core.handle({
      type: 'ResumeRequested',
      runId: run,
      reason: 'interruption',
    });
    input(core, [old]);
    expect(actor(core).attack).toBeNull();
    expect(actor(core).fighting).toMatchObject({
      guardHeld: false,
      buffer: null,
    });
    input(core, [packet(core, 'punch')]);
    expect(actor(core).attack).not.toBeNull();
  });
  test('a failed load can be disposed without an initialized fighting actor', () => {
    const core = createCore({ runId: run, seed: 42 }, config());
    expect(() => core.fail('synthetic load failure')).not.toThrow();
    expect(core.read().phase).toBe('error');
    expect(() => core.dispose()).not.toThrow();
    expect(core.read().phase).toBe('stopped');
  });
  test.each([0, -1, Infinity, NaN, Number.MAX_VALUE])(
    'unusable normalized HP scale %s fails admission before combat',
    (hpPerNormalizedPoint) => {
      const base = config(),
        fighting = requireValue(base.fighting);
      expect(() =>
        setup({
          ...base,
          fighting: {
            ...fighting,
            policy: { ...fighting.policy, hpPerNormalizedPoint },
          },
        }),
      ).toThrow();
    },
  );
});

test('transport redelivery is semantic, not dependent on JSON object field order', () => {
  const core = setup();
  const first = packet(core, 'punch');
  const reordered: GameplayCommand = {
    input: { sequence: first.input.sequence, commandId: first.input.commandId },
    actorId: first.actorId,
    category: 'punch',
    type: 'AttackRequested',
    runId: first.runId,
  };
  expect(() => input(core, [first, reordered])).not.toThrow();
  expect(
    core.drain().events.filter((e) => e.type === 'AttackAccepted'),
  ).toHaveLength(1);
});

test('planned future pose epochs cannot alias an accepted contact reaction with a different clip', () => {
  const core = setup();
  input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
  let planned: SpatialStepRequest | undefined;
  step(core, 30 * T, (r) => {
    planned = r;
    return result(r, [body(core, r, 'blue', 'white', 10 * T)]);
  });
  const plannedClock = requireValue(
    requireValue(planned).snapshot.actors[0]?.fightingClock,
  );
  const accepted = requireValue(actor(core).fightingClock);
  const futureIdle = requireValue(
    plannedClock.slices.find((s) => s.clipId === poseClips.standing),
  );
  const reaction = requireValue(
    accepted.slices.find((s) => s.clipId === poseClips['hit-standing']),
  );
  expect(reaction.epochId).not.toBe(futureIdle.epochId);
  for (const a of accepted.slices)
    for (const p of plannedClock.slices)
      if (a.epochId === p.epochId)
        expect([a.clipId, a.activationId]).toEqual([p.clipId, p.activationId]);
});

test('ordinary planned and accepted phase changes keep the same physical clock data without reusing issued IDs', () => {
  const recorded = recordCore(setup());
  const core = recorded.core;
  input(core, [packet(core, 'punch')]);
  let planned: SpatialStepRequest | undefined;
  step(core, 30 * T, (r) => {
    planned = r;
    return result(r);
  });
  const p = requireValue(
    requireValue(planned).snapshot.actors[0]?.fightingClock,
  );
  const a = requireValue(actor(core).fightingClock);
  const physical = (clock: typeof a) =>
    clock.slices.map((s) => [
      s.clipId,
      s.activationId,
      s.fromGameMs,
      s.toGameMs,
      s.fromMotionMs,
      s.toMotionMs,
      s.frozen,
    ]);
  expect(physical(a)).toEqual(physical(p));
  const beforeProjection = a;
  core.present(durationMs(5));
  core.present(durationMs(10));
  expect(actor(core).fightingClock).toEqual(beforeProjection);
  expect(replayCore(setup(), recorded.read()).snapshot).toEqual(core.read());
});

test('dispose clears fighting reservations, guard and attack ownership and is idempotent', () => {
  const core = setup();
  input(core, [packet(core, 'punch'), packet(core, 'kick')]);
  input(core, [packet(core, 'guard', 'blue')]);
  core.dispose();
  core.dispose();
  expect(core.read().phase).toBe('stopped');
  expect(actor(core).attack).toBeNull();
  expect(actor(core).fighting?.buffer).toBeNull();
  expect(actor(core, 'blue').fighting?.guardHeld).toBe(false);
  expect(core.drain().events).toEqual([]);
});

test('a step-start KO commits a frozen reaction tail, never the unaccepted moving plan', () => {
  const options = config(),
    fighting = requireValue(options.fighting);
  const core = setup({
    ...options,
    fighting: {
      ...fighting,
      policy: { ...fighting.policy, hpPerNormalizedPoint: 100 },
    },
  });
  for (let i = 0; i < 4; i++) {
    input(core, [packet(core, 'punch', 'blue')]);
    step(core, T, (r) => result(r, [body(core, r, 'blue', 'white')]));
    step(core, 2600);
  }
  input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
  step(core, 5 * T);
  const at = core.read().clocks.gameTimeMs;
  step(core, T, (r) =>
    result(r, [body(core, r, 'white', 'blue'), body(core, r, 'blue', 'white')]),
  );
  expect(core.read().result?.finalizedAt).toBe(at);
  const clock = requireValue(actor(core).fightingClock);
  expect(clock.stepTick).toBe(core.read().clocks.tick);
  expect(
    clock.slices.every((s) => s.frozen && s.toMotionMs === s.fromMotionMs),
  ).toBe(true);
  expect(clock.slices[0]?.clipId).toBe(poseClips['hit-standing']);
});

test('planning may reserve identities but cannot consume edges, age actors, cool heat, emit events or finish the real attack', () => {
  const core = setup();
  input(core, [packet(core, 'punch'), packet(core, 'kick')]);
  core.drain();
  const before = actor(core);
  core.present(durationMs(30 * T));
  const request = core.beginStep({ durationMs: durationMs(30 * T) });
  const plannedActor = requireValue(request.snapshot.actors[0]);
  expect(plannedActor.fighting).toEqual(before.fighting);
  expect(plannedActor.attack).toEqual(before.attack);
  expect(plannedActor.heat).toEqual(before.heat);
  expect(core.drain().events).toEqual([]);
  core.completeStep(result(request));
  expect(actor(core).attack).toBeNull();
  expect(actor(core).fighting?.buffer).toBeNull();
});

test('fail clears committed fighting attack and guard/buffer ownership before disposal', () => {
  const core = setup();
  input(core, [
    packet(core, 'punch'),
    packet(core, 'kick'),
    packet(core, 'guard', 'blue'),
  ]);
  core.fail('synthetic runtime failure');
  expect(core.read().phase).toBe('error');
  expect(actor(core).attack).toBeNull();
  expect(actor(core).fighting?.buffer).toBeNull();
  expect(actor(core, 'blue').fighting?.guardHeld).toBe(false);
});

describe('explicit Core fighting transaction admission', () => {
  function strictOptions(): CoreOptions {
    const base = config();
    return {
      ...base,
      fighting: {
        ...requireValue(base.fighting),
        mode: 'battle-transaction-v1',
        transactionPolicy: {
          mode: 'battle-transaction-v1',
          maxFrontiers: 100,
          maxSameTimeFrontiers: 20,
        },
        ready: (): FightingReadyDescriptor => {
          throw new Error('not prepared');
        },
      },
    };
  }
  test('strict mode rejects a configured nonempty battle world before catalog callbacks', () => {
    const options = strictOptions();
    expect(() =>
      createCore(
        { runId: run, seed: 1 },
        {
          ...options,
          world: {
            vehicles: [],
            objects: [{ objectId: worldObjectId('forbidden'), durability: 10 }],
          },
        },
      ),
    ).toThrow(/world/i);
  });
  test('strict mode validates positive safe-integer work budgets before callbacks', () => {
    for (const maxFrontiers of [
      0,
      -1,
      1.5,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const options = strictOptions(),
        f = requireValue(options.fighting);
      if (f.mode !== 'battle-transaction-v1') throw new Error('fixture mode');
      expect(() =>
        createCore(
          { runId: run, seed: 1 },
          {
            ...options,
            fighting: {
              ...f,
              transactionPolicy: { ...f.transactionPolicy, maxFrontiers },
            },
          },
        ),
      ).toThrow();
    }
  });
  test('strict ready getter is lazy and cannot be called in the constructor', () => {
    expect(() =>
      createCore({ runId: run, seed: 1 }, strictOptions()),
    ).not.toThrow();
  });
});

function transactionSetup(
  customize?: (options: CoreOptions) => CoreOptions,
  runIdentity = run,
) {
  let core: CorePort;
  const base = config();
  const options: CoreOptions = {
    ...base,
    fighting: {
      ...requireValue(base.fighting),
      mode: 'battle-transaction-v1',
      transactionPolicy: {
        mode: 'battle-transaction-v1',
        maxFrontiers: 100,
        maxSameTimeFrontiers: 20,
      },
      ready: () => ({
        version: 1,
        bindingSetId: 'synthetic-only-binding',
        clipId: poseClips.standing,
        supportPlane: { supportId: 'synthetic-floor', planeY: 0 },
        surfaceToleranceM: 0,
        actors: core.read().actors.map((a, i) => ({
          actorId: a.actorId,
          position: { x: 0, y: 0, z: i * 2 },
          facingBasis: { x: 0, y: 0, z: i ? -1 : 1 },
        })),
      }),
    },
  };
  core = createCore(
    { runId: runIdentity, seed: 42 },
    customize ? customize(options) : options,
  );
  return core;
}
function startTransactionCore() {
  const core = transactionSetup();
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  return core;
}

describe('strict ready and non-step selected pose authority', () => {
  test('initial ready before first interval; Start while paused does not rebootstrap', () => {
    const core = transactionSetup();
    core.handle({ type: 'Backgrounded', runId: run });
    core.handle({ type: 'AssetsReady', runId: run });
    const ready = core.read();
    for (const a of ready.actors.filter((a) =>
      ready.residentActorIds?.includes(a.actorId),
    )) {
      expect(a.fightingClock?.slices).toEqual([]);
      expect(a.fightingClock?.endpoint).toMatchObject({
        atGameMs: 0,
        motionMs: 0,
        phase: 'neutral',
        posture: 'standing',
      });
      expect(a.fightingPose).toMatchObject({
        entryKind: 'initial-ready',
        acceptedRoot: { x: 0, z: 0 },
      });
    }
    expect(ready.actors[2]?.fightingPose).toBeUndefined();
    core.handle({ type: 'StartRequested', runId: run });
    expect(core.read().phase).toBe('paused');
    expect(actor(core).fightingPose).toEqual(ready.actors[0]?.fightingPose);
    expect(actor(core).fightingClock).toEqual(ready.actors[0]?.fightingClock);
  });
  test('direct input and release hold the accepted point/context while neutral guard clears', () => {
    const core = startTransactionCore(),
      before = actor(core);
    input(core, [packet(core, 'guard')]);
    expect(actor(core).fighting?.guardHeld).toBe(true);
    expect(actor(core).fightingPoseHold?.displayEpochId).toBe(
      before.fightingClock?.endpoint?.epochId,
    );
    core.handle({ type: 'InputsReleased', runId: run });
    expect(actor(core).fighting).toMatchObject({
      guardHeld: false,
      guardHeight: null,
      buffer: null,
    });
    expect(actor(core).fightingClock).toEqual(before.fightingClock);
    expect(actor(core).fightingPose).toEqual(before.fightingPose);
    expect(actor(core).fightingPoseHold?.reason).toBe('inputs-released');
  });
  test('ready callback sees loading and every reentrant mutator rejects before side effects', () => {
    let core: CorePort;
    core = transactionSetup((options) => {
      const f = requireValue(options.fighting);
      if (f.mode !== 'battle-transaction-v1') throw new Error('fixture mode');
      return {
        ...options,
        fighting: {
          ...f,
          ready: () => {
            const before = core.read();
            expect(before.phase).toBe('loading');
            for (const mutate of [
              () =>
                core.handle({
                  type: 'QualityChanged',
                  runId: runId('foreign'),
                  quality: 'standard',
                }),
              () => core.present(durationMs(0)),
              () => core.drain(),
              () => core.fail('reentry'),
              () => core.dispose(),
              () => core.beginStep({ durationMs: durationMs(T) }),
            ])
              expect(mutate).toThrow(/busy|resolv|prepar/i);
            expect(core.read()).toEqual(before);
            return f.ready();
          },
        },
      };
    });
    core.handle({ type: 'AssetsReady', runId: run });
    expect(core.read().phase).toBe('ready');
  });
  test('strict pending begin is invisible and forbids interleavings while rejecting DTO-only completion', () => {
    const core = startTransactionCore();
    core.present(durationMs(T));
    const before = core.read();
    const request = core.beginStep({ durationMs: durationMs(T) });
    expect(core.read()).toEqual(before);
    expect(request.snapshot.clocks.tick).toBe(before.clocks.tick + 1);
    for (const mutate of [
      () => core.present(durationMs(0)),
      () => core.drain(),
      () => core.handle({ type: 'InputsReleased', runId: run }),
      () => input(core, []),
    ])
      expect(mutate).toThrow();
    expect(() => core.completeStep(result(request))).toThrow(/transaction/i);
    expect(core.read()).toEqual(before);
    core.fail('cancel pending');
    expect(core.read().phase).toBe('error');
  });
});

/** Structural synthetic pose only: never actual robot/sole/hurt sampling evidence. */
function syntheticEntry(
  clip: import('../../src/contracts').ClipId,
  atMs: number,
): FightingRecipeEntry {
  return {
    recipeVersion: 'actual53-ik-surface-v1',
    clipId: clip,
    atMs,
    pose: Array.from({ length: 53 }, (_, i) => ({
      name: `synthetic-bone-${i}`,
      position: [0, 0, 0] as const,
      quaternion: [0, 0, 0, 1] as const,
      scale: [1, 1, 1] as const,
    })),
    support: (['L', 'R'] as const).map((side) => ({
      side,
      planted: true,
      local: [0, 0, 0] as const,
      worldRotation: [0, 0, 0, 1] as const,
    })),
  };
}
let transactionSerial = 0;
const syntheticInstalled = new WeakMap<
  CorePort,
  import('../../src/contracts').SpatialSnapshot
>();
function syntheticTransaction(
  core: CorePort,
  request: SpatialStepRequest,
  hooks: {
    project?: (
      query: FightingProjectInput,
      frontier: FightingSpatialFrontier,
    ) => FightingSpatialFrontier;
    finish?: (
      receipt: FightingSpatialCommitReceipt,
    ) => FightingSpatialCommitReceipt;
    abort?: () => void;
    raw?: boolean;
  } = {},
) {
  const header = {
    version: 1 as const,
    transactionId: `synthetic-tx-${++transactionSerial}`,
    runId: run,
    stepTick: request.snapshot.clocks.tick,
    fromGameMs: requireValue(
      request.snapshot.actors.find((a) =>
        request.snapshot.residentActorIds?.includes(a.actorId),
      )?.fightingClock?.slices[0],
    ).fromGameMs,
    toGameMs: request.snapshot.clocks.gameTimeMs,
  };
  const resident = requireValue(core.read().residentActorIds);
  const initialPrefix: FightingInitialPrefix = captureFightingInitialPrefix(
    {
      runId: run,
      bindingSetId: 'synthetic-only-binding',
      actors: resident.map((id, i) => {
        const a = requireValue(
            core.read().actors.find((a) => a.actorId === id),
          ),
          endpoint = requireValue(a.fightingClock?.endpoint),
          poseContext = requireValue(a.fightingPose);
        return {
          endpoint,
          poseContext,
          actor: syntheticInstalled
            .get(core)
            ?.actors.find((a) => a.actorId === id) ?? {
            actorId: id,
            position: { x: 0, y: 0, z: i * 2 },
            facing: poseContext.facingBasis,
            velocity: { x: 0, y: 0, z: 0 },
            grounded: true,
            locomotion: 'idle' as const,
          },
          pose: {
            source: {
              kind:
                poseContext.entryKind === 'initial-ready'
                  ? ('bootstrap' as const)
                  : ('installed' as const),
              commitId: poseContext.commitId,
              actorId: id,
              epochId: endpoint.epochId,
              clipId: endpoint.clipId,
              activationId: endpoint.activationId,
              atGameMs: endpoint.atGameMs,
              motionMs: endpoint.motionMs,
            },
            facingBasis: poseContext.facingBasis,
            acceptedRoot: poseContext.acceptedRoot,
            support: poseContext.support,
            sample: syntheticEntry(endpoint.clipId, endpoint.motionMs),
            entryKind: poseContext.entryKind,
            ...('incoming' in poseContext
              ? { incoming: poseContext.incoming }
              : {}),
            ...(poseContext.defeatEntry
              ? { defeatEntry: poseContext.defeatEntry }
              : {}),
          },
        };
      }),
    },
    header,
    resident,
  );
  const queries: FightingProjectInput[] = [],
    resets: FightingEncounterReset[] = [];
  let last: FightingSpatialFrontier | null = null;
  let state: 'open' | 'prepared' | 'aborted' = 'open';
  const value: FightingSpatialTransactionResult = {
    kind: 'fighting-spatial-transaction-v1',
    initialPrefix,
    snapshot: {
      runId: run,
      tick: header.stepTick,
      actors: initialPrefix.actors.map((p) => p.actor),
      vehicles: [],
    },
    candidates: [],
    transaction: {
      ...header,
      project(q) {
        if (state !== 'open') throw new Error('synthetic port is not open');
        queries.push(q);
        if (q.encounterReset) resets.push(q.encounterReset);
        const prefix = requireValue(q.snapshot.residentActorIds).map((id) => {
          const a = requireValue(
              q.snapshot.actors.find((a) => a.actorId === id),
            ),
            endpoint = requireValue(a.fightingClock?.endpoint),
            previous = q.acceptedPrefix.find((p) => p.actor.actorId === id);
          const spawn = q.encounterReset?.readyDescriptor.actors.find(
            (a) => a.actorId === id,
          );
          const physical = spawn
            ? {
                actorId: id,
                position: spawn.position,
                facing: spawn.facingBasis,
                velocity: { x: 0, y: 0, z: 0 },
                grounded: true,
                locomotion: 'idle' as const,
              }
            : requireValue(previous).actor;
          const transition = previous?.endpoint.epochId !== endpoint.epochId;
          const resetOrigin =
            !!spawn ||
            (!transition && previous?.pose.entryKind === 'encounter-reset');
          return {
            actor: physical,
            pose: {
              source: {
                kind: 'query' as const,
                transactionId: header.transactionId,
                queryRevision: q.revision,
                actorId: id,
                epochId: endpoint.epochId,
                clipId: endpoint.clipId,
                activationId: endpoint.activationId,
                atGameMs: q.horizonGameMs,
                motionMs: endpoint.motionMs,
              },
              facingBasis: physical.facing,
              acceptedRoot: transition
                ? { x: 0, z: 0 }
                : requireValue(previous).pose.acceptedRoot,
              support: spawn
                ? {
                    ...requireValue(q.encounterReset).readyDescriptor
                      .supportPlane,
                    groundClearanceM: 0,
                  }
                : requireValue(previous).pose.support,
              sample: syntheticEntry(endpoint.clipId, endpoint.motionMs),
              entryKind: resetOrigin
                ? ('encounter-reset' as const)
                : transition
                  ? ('epoch-transition' as const)
                  : ('continuous' as const),
              ...(!resetOrigin
                ? {
                    incoming: transition
                      ? requireValue(previous).pose.sample
                      : (previous?.pose.incoming ??
                        requireValue(previous).pose.sample),
                  }
                : {}),
              ...(a.defeated
                ? {
                    defeatEntry:
                      previous?.pose.defeatEntry ??
                      requireValue(previous).pose.sample,
                  }
                : {}),
            },
          };
        });
        const frontier: FightingSpatialFrontier = {
          projectionId: `${header.transactionId}:projection:${q.revision}`,
          revision: q.revision,
          atGameMs: q.horizonGameMs,
          kind: 'boundary',
          occurrenceIds: [],
          physicalSeamIds: [],
          acceptedPrefix: prefix,
          result: {
            snapshot: {
              runId: run,
              tick: header.stepTick,
              actors: prefix.map((p) => p.actor),
              vehicles: [],
            },
            candidates: [],
            fighting: {
              stepTick: header.stepTick,
              takeoffs: [],
              landings: [],
              contacts: [],
            },
          },
        };
        last = hooks.project ? hooks.project(q, frontier) : frontier;
        if (hooks.raw) return last;
        return captureFightingSpatialFrontier(last, {
          query: q,
          request,
          policy: {
            mode: 'battle-transaction-v1',
            maxFrontiers: 100,
            maxSameTimeFrontiers: 20,
          },
        });
      },
      finish(input) {
        if (state !== 'open') throw new Error('synthetic finish duplicate');
        state = 'prepared';
        const receiptId = `${header.transactionId}:receipt`,
          accepted = requireValue(last);
        const poseContexts: FightingPoseContext[] = accepted.acceptedPrefix.map(
          (p) => ({
            runId: run,
            actorId: p.actor.actorId,
            stepTick: header.stepTick,
            epochId: p.pose.source.epochId,
            commitId: receiptId,
            facingBasis: p.pose.facingBasis,
            acceptedRoot: p.pose.acceptedRoot,
            support: p.pose.support,
            ...(p.pose.entryKind === 'encounter-reset'
              ? { entryKind: 'encounter-reset' as const }
              : {
                  entryKind:
                    p.pose.entryKind === 'epoch-transition'
                      ? ('epoch-transition' as const)
                      : ('continuous' as const),
                  incoming: requireValue(p.pose.incoming),
                }),
            ...(p.pose.defeatEntry ? { defeatEntry: p.pose.defeatEntry } : {}),
          }),
        );
        const receipt: FightingSpatialCommitReceipt = {
          ...header,
          receiptId,
          acceptedProjectionId: input.acceptedProjectionId,
          outputRevision: input.output.snapshot.revision,
          snapshot: accepted.result.snapshot,
          endpoints: requireValue(input.output.snapshot.residentActorIds).map(
            (id) =>
              requireValue(
                input.output.snapshot.actors.find((a) => a.actorId === id)
                  ?.fightingClock?.endpoint,
              ),
          ),
          poseContexts,
          ...(resets.length
            ? { residency: { initialActorIds: resident, resets } }
            : {}),
        };
        return hooks.finish ? hooks.finish(receipt) : receipt;
      },
      abort() {
        state = 'aborted';
        hooks.abort?.();
      },
    },
  };
  return {
    value,
    queries,
    state: () => state,
    physical: () => requireValue(last).result.snapshot,
  };
}

describe('synthetic strict transaction isolation and receipt lifecycle', () => {
  test('accepted empty transaction uses endpoint clocks and receipt contexts, never proposal authority', () => {
    const core = startTransactionCore();
    core.present(durationMs(T));
    const request = core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(core, request);
    const output = core.completeStep(tx.value);
    expect(tx.state()).toBe('prepared');
    expect(tx.queries.length).toBeGreaterThanOrEqual(2);
    expect(output.snapshot.clocks.gameTimeMs).toBe(T);
    expect(actor(core).fightingPose?.commitId).toBe(
      `${tx.value.transaction.transactionId}:receipt`,
    );
    expect(actor(core).fightingClock?.endpoint?.atGameMs).toBe(T);
    expect(() => core.completeStep(tx.value)).toThrow();
  });
  test('late project throw is atomic and fresh retry services exactly the same pending begin', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'punch')]);
    core.present(durationMs(10 * T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(10 * T) });
    const broken = syntheticTransaction(core, request, {
      project: (q, f) => {
        if (q.revision === 2) throw new Error('late synthetic fault');
        return f;
      },
    });
    expect(() => core.completeStep(broken.value)).toThrow(
      'late synthetic fault',
    );
    expect(broken.state()).toBe('aborted');
    expect(core.read()).toEqual(before);
    const retry = syntheticTransaction(core, request);
    const output = core.completeStep(retry.value);
    expect(output.snapshot.clocks.tick).toBe(request.snapshot.clocks.tick);
    expect(
      output.events.filter((e) => e.type === 'AttackAccepted'),
    ).toHaveLength(1);
  });
  test('read during project stays precompletion and every mutator rejects even foreign/no-op requests', () => {
    const core = startTransactionCore();
    core.present(durationMs(T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(core, request, {
      project: (_q, f) => {
        expect(core.read()).toEqual(before);
        for (const change of [
          () =>
            core.handle({
              type: 'QualityChanged',
              runId: runId('foreign'),
              quality: 'standard',
            }),
          () => core.present(durationMs(0)),
          () => core.drain(),
          () => core.fail('bad'),
          () => core.dispose(),
          () => core.beginStep({ durationMs: durationMs(T) }),
          () => core.completeStep(result(request)),
          () => input(core, []),
        ])
          expect(change).toThrow(/busy|resolv/i);
        return f;
      },
    });
    core.completeStep(tx.value);
  });
  test('malformed finish aborts prepared scratch and cannot clear a held pose', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'guard')]);
    core.present(durationMs(T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(core, request, {
      finish: (r) => ({ ...r, outputRevision: r.outputRevision + 1 }),
    });
    expect(() => core.completeStep(tx.value)).toThrow();
    expect(tx.state()).toBe('aborted');
    expect(core.read()).toEqual(before);
    const retry = syntheticTransaction(core, request);
    core.completeStep(retry.value);
    expect(actor(core).fightingPoseHold).toBeUndefined();
  });
});

describe('pure transaction replay and recorder rejection', () => {
  function recorded() {
    const r = recordCore(transactionSetup());
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    return r;
  }
  test('capability envelopes never enter DTO cloning; transaction tape replays complete queries', () => {
    const r = recorded();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    expect(() => structuredClone(r.read())).not.toThrow();
    const replayed = replayCore(transactionSetup(), r.read());
    expect(replayed.outputs).toEqual(r.outputs());
    expect(replayed.snapshot).toEqual(r.core.read());
    const changed = structuredClone(r.read());
    const entry = changed.find((e) => e.kind === 'transaction');
    if (entry?.kind !== 'transaction')
      throw new Error('missing transaction tape');
    const interaction = entry.value.interactions.find(
      (i) => i.kind === 'project',
    );
    if (interaction?.kind !== 'project') throw new Error('missing query');
    Object.assign(interaction.input, {
      settledOccurrenceIds: ['forged-query'],
    });
    expect(() => replayCore(transactionSetup(), changed)).toThrow(/mismatch/i);
  });
  test('failed project and invalid prepared receipt plus abort replay before same-begin fresh retry', () => {
    const r = recorded();
    input(r.core, [packet(r.core, 'punch')]);
    r.core.present(durationMs(10 * T));
    const request = r.core.beginStep({ durationMs: durationMs(10 * T) });
    const one = syntheticTransaction(r.core, request, {
      project: (q, f) => {
        if (q.revision === 2) throw new Error('recorded-fault');
        return f;
      },
    });
    expect(() => r.core.completeStep(one.value)).toThrow('recorded-fault');
    const two = syntheticTransaction(r.core, request, {
      finish: (receipt) => ({
        ...receipt,
        outputRevision: receipt.outputRevision + 1,
      }),
    });
    expect(() => r.core.completeStep(two.value)).toThrow();
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    expect(r.read().filter((e) => e.kind === 'begin')).toHaveLength(1);
    expect(r.read().filter((e) => e.kind === 'transaction')).toHaveLength(3);
    expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
      r.outputs(),
    );
  });
  test('rejected recorder callback reentry adds no command/drain/fail/dispose tape entries', () => {
    const r = recorded();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) }),
      before = r.read().length;
    const tx = syntheticTransaction(r.core, request, {
      project: (_q, f) => {
        for (const mutate of [
          () => r.core.drain(),
          () => r.core.dispose(),
          () => r.core.fail('x'),
          () => r.core.handle({ type: 'InputsReleased', runId: run }),
          () => r.core.present(durationMs(0)),
        ])
          expect(mutate).toThrow(/record|busy/i);
        return f;
      },
    });
    r.core.completeStep(tx.value);
    expect(r.read()).toHaveLength(before + 1);
    expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
      r.outputs(),
    );
  });
  test('unrecordable return is distinct from a port throw and replay preserves the abort', () => {
    const r = recorded();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(r.core, request, {
      raw: true,
      project: (_q, f) => ({ ...f, nonDto: () => undefined }),
    });
    expect(() => r.core.completeStep(tx.value)).toThrow(/record/i);
    const entry = r.read().find((e) => e.kind === 'transaction');
    if (entry?.kind !== 'transaction') throw new Error('missing transaction');
    expect(entry.value.interactions[0]?.outcome.kind).toBe(
      'unrecordable-return',
    );
    expect(entry.value.interactions.at(-1)?.kind).toBe('abort');
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
      r.outputs(),
    );
  });
  test('replay AI provider explicitly rejects unused surplus decisions', () => {
    const provider = replayIntentProvider([[], []]);
    provider(transactionSetup().read(), null);
    expect(() => provider.assertConsumed()).toThrow(/surplus|unused/i);
    provider(transactionSetup().read(), null);
    expect(() => provider.assertConsumed()).not.toThrow();
  });
});

function retimeSynthetic(
  q: FightingProjectInput,
  f: FightingSpatialFrontier,
  at: number,
): FightingSpatialFrontier {
  const acceptedPrefix = f.acceptedPrefix.map((p) => {
    const clock = requireValue(
      q.snapshot.actors.find((a) => a.actorId === p.actor.actorId)
        ?.fightingClock,
    );
    const slice = clock.slices.find(
      (s) => at >= s.fromGameMs && at < s.toGameMs,
    );
    const motion = slice
      ? slice.fromMotionMs +
        ((slice.toMotionMs - slice.fromMotionMs) * (at - slice.fromGameMs)) /
          (slice.toGameMs - slice.fromGameMs)
      : requireValue(clock.endpoint).motionMs;
    return {
      ...p,
      pose: {
        ...p.pose,
        source: {
          ...p.pose.source,
          atGameMs: gameTimeMs(at),
          motionMs: durationMs(motion),
        },
        sample: syntheticEntry(p.pose.source.clipId, motion),
      },
    };
  });
  return { ...f, atGameMs: gameTimeMs(at), acceptedPrefix };
}
function syntheticBodies(
  q: FightingProjectInput,
  f: FightingSpatialFrontier,
  at: number,
  pairs: readonly (readonly [ActorColor, ActorColor])[],
): FightingSpatialFrontier {
  const timed = retimeSynthetic(q, f, at);
  const candidates = pairs.map(([source, target], i) => {
    const a = requireValue(q.snapshot.actors.find((a) => a.color === source)),
      b = requireValue(q.snapshot.actors.find((a) => a.color === target)),
      attack = requireValue(a.attack);
    return {
      kind: 'body-hit' as const,
      runId: run,
      contactId: contactId(
        `synthetic:${q.transactionId}:${q.revision}:${i}:${source}`,
      ),
      at: gameTimeMs(at),
      interval: { from: q.cursorGameMs, to: q.horizonGameMs },
      point: { x: 0, y: 1, z: 1 },
      evidence: 'overlap' as const,
      source: {
        actorId: a.actorId,
        activationId: attack.activationId,
        impactId: requireValue(attack.impactBindings[0]).impactId,
      },
      targetActorId: b.actorId,
    };
  });
  return {
    ...timed,
    kind: 'contacts',
    occurrenceIds: candidates.map((c) => `occurrence:${c.contactId}`),
    result: {
      ...timed.result,
      candidates,
      fighting: {
        ...timed.result.fighting,
        contacts: candidates.map((c) => {
          const source = requireValue(
              timed.result.snapshot.actors.find(
                (a) => a.actorId === c.source.actorId,
              ),
            ),
            target = requireValue(
              timed.result.snapshot.actors.find(
                (a) => a.actorId === c.targetActorId,
              ),
            );
          return {
            contactId: c.contactId,
            atGameMs: c.at,
            sourceActorId: source.actorId,
            targetActorId: target.actorId,
            sourcePosition: source.position,
            targetPosition: target.position,
            sourceFacing: source.facing,
            targetFacing: target.facing,
          };
        }),
      },
    },
  };
}
function transactionStep(
  core: CorePort,
  ms: number,
  hooks: Parameters<typeof syntheticTransaction>[2] = {},
) {
  core.present(durationMs(ms));
  const request = core.beginStep({ durationMs: durationMs(ms) }),
    tx = syntheticTransaction(core, request, hooks);
  const output = core.completeStep(tx.value);
  syntheticInstalled.set(core, tx.physical());
  return { output, tx, request };
}

describe('strict accepted combat and boundary regressions', () => {
  test('later valid revised contact is not rejected by the obsolete speculative tail blacklist', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'punch'), packet(core, 'punch')]);
    const hit = new Set<string>();
    const { output, tx } = transactionStep(core, 50 * T, {
      project: (q, f) => {
        const white = requireValue(
          q.snapshot.actors.find((a) => a.color === 'white'),
        );
        if (
          q.queryMode === 'interval' &&
          white.fighting?.phase === 'active' &&
          white.attack &&
          !hit.has(white.attack.activationId)
        ) {
          hit.add(white.attack.activationId);
          return syntheticBodies(
            q,
            f,
            q.cursorGameMs +
              Math.min(T / 4, (q.horizonGameMs - q.cursorGameMs) / 2),
            [['white', 'blue']],
          );
        }
        return f;
      },
    });
    expect(hit.size).toBe(2);
    expect(output.events.filter((e) => e.type === 'HpChanged')).toHaveLength(2);
    expect(
      tx.queries.some(
        (q) =>
          q.selectedPoses.some((p) => p.phase === 'active') && q.revision > 4,
      ),
    ).toBe(true);
    expect(actor(core, 'blue').hp).toBeLessThan(450);
  });
  test('complete tied body batch preserves a trade independently of candidate permutation', () => {
    const runTrade = (reverse: boolean) => {
      const core = startTransactionCore();
      input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
      let hit = false;
      const { output } = transactionStep(core, 30 * T, {
        project: (q, f) => {
          if (
            !hit &&
            q.queryMode === 'interval' &&
            q.snapshot.actors[0]?.fighting?.phase === 'active'
          ) {
            hit = true;
            return syntheticBodies(
              q,
              f,
              q.cursorGameMs + T / 4,
              reverse
                ? [
                    ['blue', 'white'],
                    ['white', 'blue'],
                  ]
                : [
                    ['white', 'blue'],
                    ['blue', 'white'],
                  ],
            );
          }
          return f;
        },
      });
      return {
        hp: output.snapshot.actors.map((a) => a.hp),
        damage: output.events
          .filter((e) => e.type === 'HpChanged')
          .map((e) => e.actualHpLost)
          .sort(),
      };
    };
    const forward = runTrade(false),
      reverse = runTrade(true);
    expect(forward).toEqual(reverse);
    expect(forward.hp[0]).toBe(400);
    expect(forward.hp[1]).toBeLessThan(500);
  });
  test('new accepted block forces a fresh epoch even for the identical guard clip and preserves its locked defense', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'guard'), packet(core, 'punch', 'blue')]);
    let hit = false;
    const { tx } = transactionStep(core, T, {
      project: (q, f) => {
        if (!hit && q.queryMode === 'interval') {
          hit = true;
          return syntheticBodies(q, f, T / 4, [
            ['blue', 'white'],
            ['blue', 'white'],
          ]);
        }
        return f;
      },
    });
    const guard = tx.queries.find((q) => q.queryMode === 'settle')
      ?.selectedPoses[0]?.epochId;
    const blocked = actor(core);
    expect(blocked.fighting?.phase).toBe('blockstun');
    expect(blocked.fightingClock?.endpoint?.epochId).not.toBe(guard);
    expect(blocked.fightingClock?.endpoint?.clipId).toBe(
      poseClips['guard-standing'],
    );
    core.handle({ type: 'InputsReleased', runId: run });
    expect(actor(core).fighting).toMatchObject({
      guardHeld: false,
      guardHeight: 'standing',
      phase: 'blockstun',
    });
    expect(actor(core).fightingClock).toEqual(blocked.fightingClock);
    expect(actor(core).fightingPose).toEqual(blocked.fightingPose);
    transactionStep(core, 20 * T);
    expect(actor(core).fighting).toMatchObject({
      guardHeld: false,
      guardHeight: null,
      phase: 'neutral',
    });
  });
  test('attack end at E selects an endpoint epoch without epsilon coverage and next step continues it', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'punch')]);
    const total =
      (FIGHTING_MOVE_SPECS.p_short.startupTicks +
        FIGHTING_MOVE_SPECS.p_short.activeTicks +
        FIGHTING_MOVE_SPECS.p_short.recoveryTicks) *
      T;
    transactionStep(core, total);
    const clock = requireValue(actor(core).fightingClock);
    expect(clock.slices.at(-1)?.epochId).not.toBe(clock.endpoint?.epochId);
    expect(clock.endpoint?.motionMs).toBe(0);
    expect(actor(core).attack).toBeNull();
    transactionStep(core, T);
    expect(actor(core).fightingClock?.slices[0]?.epochId).toBe(
      clock.endpoint?.epochId,
    );
    expect(actor(core).fightingClock?.slices[0]?.fromMotionMs).toBe(0);
  });
  test('global and same-time work budgets abort atomically rather than return a partial success', () => {
    for (const policy of [
      { maxFrontiers: 1, maxSameTimeFrontiers: 20 },
      { maxFrontiers: 100, maxSameTimeFrontiers: 1 },
    ]) {
      const core = transactionSetup((options) => {
        const f = requireValue(options.fighting);
        if (f.mode !== 'battle-transaction-v1') throw new Error('mode');
        return {
          ...options,
          fighting: {
            ...f,
            transactionPolicy: { ...f.transactionPolicy, ...policy },
          },
        };
      });
      core.handle({ type: 'AssetsReady', runId: run });
      core.handle({ type: 'StartRequested', runId: run });
      core.drain();
      input(core, [packet(core, 'punch', 'blue')]);
      core.present(durationMs(T));
      const before = core.read(),
        request = core.beginStep({ durationMs: durationMs(T) });
      let contacts = 0;
      const tx = syntheticTransaction(core, request, {
        project: (q, f) =>
          q.queryMode === 'settle' && contacts++ < 2
            ? syntheticBodies(q, f, q.cursorGameMs, [['blue', 'white']])
            : f,
      });
      expect(() => core.completeStep(tx.value)).toThrow(/budget/i);
      expect(core.read()).toEqual(before);
      expect(tx.state()).toBe('aborted');
    }
  });
  test('late project throw after accepted damage/heat/events leaves retry and private counters deterministic', () => {
    const execute = (fault: boolean) => {
      const core = startTransactionCore();
      input(core, [packet(core, 'punch', 'blue')]);
      core.present(durationMs(30 * T));
      const before = core.read(),
        request = core.beginStep({ durationMs: durationMs(30 * T) });
      let hit = false;
      const project = (q: FightingProjectInput, f: FightingSpatialFrontier) => {
        if (!hit && q.queryMode === 'interval') {
          hit = true;
          return syntheticBodies(q, f, q.cursorGameMs + T / 4, [
            ['blue', 'white'],
          ]);
        }
        if (fault && q.revision === 3) throw new Error('after damage');
        return f;
      };
      if (fault) {
        const broken = syntheticTransaction(core, request, { project });
        expect(() => core.completeStep(broken.value)).toThrow('after damage');
        expect(core.read()).toEqual(before);
        hit = false;
      }
      fault = false;
      const output = core.completeStep(
        syntheticTransaction(core, request, { project }).value,
      );
      return {
        hp: output.snapshot.actors.map((a) => a.hp),
        heat: output.snapshot.actors.map((a) => a.heat),
        events: output.events.map((e) => [e.type, e.sequence]),
      };
    };
    expect(execute(true)).toEqual(execute(false));
  });
});

function syntheticPhysical(
  q: FightingProjectInput,
  f: FightingSpatialFrontier,
  at: number,
  kinds: readonly ('takeoff' | 'landing')[],
  color: ActorColor = 'white',
): FightingSpatialFrontier {
  const timed = retimeSynthetic(q, f, at),
    id = requireValue(q.snapshot.actors.find((a) => a.color === color)).actorId;
  const prefix = timed.acceptedPrefix.map((p) =>
    p.actor.actorId !== id
      ? p
      : { ...p, actor: { ...p.actor, grounded: kinds.includes('landing') } },
  );
  const p = requireValue(prefix.find((p) => p.actor.actorId === id));
  return {
    ...timed,
    kind: 'physical',
    physicalSeamIds: kinds.map((k) => `${q.revision}:${k}:${id}`),
    acceptedPrefix: prefix,
    result: {
      ...timed.result,
      snapshot: {
        ...timed.result.snapshot,
        actors: prefix.map((p) => p.actor),
      },
      fighting: {
        ...timed.result.fighting,
        takeoffs: kinds.includes('takeoff')
          ? [
              {
                actorId: id,
                atGameMs: gameTimeMs(at),
                position: p.actor.position,
              },
            ]
          : [],
        landings: kinds.includes('landing')
          ? [
              {
                actorId: id,
                atGameMs: gameTimeMs(at),
                position: p.actor.position,
                supportId: p.pose.support.supportId,
                airborneActivationId: p.pose.source.activationId,
              },
            ]
          : [],
      },
    },
  };
}

describe('strict physical, encounter and lifecycle boundaries', () => {
  test('landing at E is endpoint-only, half-open, and does not restart on the next first slice', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'jump')]);
    let tookOff = false,
      landed = false;
    transactionStep(core, T, {
      project: (q, f) => {
        if (!tookOff) {
          tookOff = true;
          return syntheticPhysical(q, f, 0, ['takeoff']);
        }
        if (!landed && q.queryMode === 'interval' && q.horizonGameMs === T) {
          landed = true;
          return syntheticPhysical(q, f, T, ['landing']);
        }
        return f;
      },
    });
    const clock = requireValue(actor(core).fightingClock);
    expect(clock.endpoint).toMatchObject({
      atGameMs: T,
      motionMs: 0,
      phase: 'landing',
      posture: 'standing',
    });
    expect(clock.slices.at(-1)?.epochId).not.toBe(clock.endpoint?.epochId);
    transactionStep(core, T);
    expect(actor(core).fightingClock?.slices[0]?.epochId).toBe(
      clock.endpoint?.epochId,
    );
    expect(actor(core).fightingClock?.slices[0]?.fromMotionMs).toBe(0);
  });
  test('takeoff then landing then resampled body at same exact time adds no elapsed action tick', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'jump'), packet(core, 'punch', 'blue')]);
    let physical = false,
      contact = false;
    const { tx } = transactionStep(core, T, {
      project: (q, f) => {
        if (!physical) {
          physical = true;
          return syntheticPhysical(q, f, 0, ['landing', 'takeoff']);
        }
        if (!contact && q.cursorGameMs === 0) {
          contact = true;
          expect(q.selectedPoses[0]?.phase).toBe('landing');
          return syntheticBodies(q, f, 0, [['blue', 'white']]);
        }
        return f;
      },
    });
    expect(
      tx.queries
        .slice(0, 3)
        .every((q) => q.cursorGameMs === 0 && q.horizonGameMs === 0),
    ).toBe(true);
    expect(actor(core).fighting?.tick).toBe(0);
    expect(actor(core).hp).toBe(400);
  });
  test('receipt position, not speculative proposal, is the next AI physical authority', () => {
    const observed: (number | null)[] = [];
    const core = transactionSetup((o) => ({
      ...o,
      enemyAi: (_s, p) => {
        observed.push(p?.actors[0]?.position.x ?? null);
        return [];
      },
    }));
    core.handle({ type: 'AssetsReady', runId: run });
    core.handle({ type: 'StartRequested', runId: run });
    core.drain();
    const { tx } = transactionStep(core, T, {
      project: (q, f) => {
        if (q.queryMode !== 'interval') return f;
        const prefix = f.acceptedPrefix.map((p) => ({
          ...p,
          actor: { ...p.actor, position: { ...p.actor.position, x: 3 } },
          pose: { ...p.pose, acceptedRoot: { x: 3, z: 0 } },
        }));
        return {
          ...f,
          acceptedPrefix: prefix,
          result: {
            ...f.result,
            snapshot: {
              ...f.result.snapshot,
              actors: prefix.map((p) => p.actor),
            },
          },
        };
      },
    });
    expect(tx.value.snapshot.actors[0]?.position.x).toBe(0);
    transactionStep(core, T);
    expect(observed).toEqual([0, 3]);
  });
  test('late receipt accessor is rejected without executing it and abort failures still restore the pending state', () => {
    const core = startTransactionCore();
    core.present(durationMs(T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(T) });
    let reads = 0;
    const tx = syntheticTransaction(core, request, {
      finish: (receipt) =>
        Object.defineProperty({ ...receipt }, 'receiptId', {
          enumerable: true,
          get() {
            reads++;
            return 'forged';
          },
        }),
      abort: () => {
        throw new Error('abort failed');
      },
    });
    expect(() => core.completeStep(tx.value)).toThrow();
    expect(reads).toBe(0);
    expect(core.read()).toEqual(before);
    expect(tx.state()).toBe('aborted');
    core.completeStep(syntheticTransaction(core, request).value);
  });
  test('error retains accepted pose with an explicit hold; disposal clears reusable authority without a living epoch', () => {
    const core = startTransactionCore();
    transactionStep(core, T);
    const accepted = actor(core);
    core.fail('before next completion');
    expect(actor(core).fightingClock).toEqual(accepted.fightingClock);
    expect(actor(core).fightingPose).toEqual(accepted.fightingPose);
    expect(actor(core).fightingPoseHold?.reason).toBe('error');
    core.dispose();
    expect(actor(core).fightingPose).toBeUndefined();
    expect(actor(core).fightingClock).toBeUndefined();
    expect(actor(core).fightingPoseHold).toBeUndefined();
  });
  test('all four opponents use explicit unswept reset provenance and exact-end new residency', () => {
    const core = transactionSetup((o) => ({
      ...o,
      fighting: {
        ...requireValue(o.fighting),
        policy: {
          ...requireValue(o.fighting).policy,
          hpPerNormalizedPoint: 100,
        },
      },
    }));
    core.handle({ type: 'AssetsReady', runId: run });
    core.handle({ type: 'StartRequested', runId: run });
    core.drain();
    const opponentIds: string[] = [],
      resetIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const opponent = requireValue(core.read().currentOpponentId);
      opponentIds.push(opponent);
      input(core, [packet(core, 'punch')]);
      let hit = false;
      const { output, tx: combatTx } = transactionStep(core, 10 * T, {
        project: (q, f) => {
          if (
            !hit &&
            q.queryMode === 'interval' &&
            q.snapshot.actors[0]?.fighting?.phase === 'active'
          ) {
            hit = true;
            const color = requireValue(
              q.snapshot.actors.find((a) => a.actorId === opponent),
            ).color;
            return syntheticBodies(q, f, q.cursorGameMs + T / 4, [
              ['white', color],
            ]);
          }
          return f;
        },
      });
      if (i === 3) {
        expect(output.snapshot.result?.outcome).toBe('clear');
        break;
      }
      const defeat = output.events.find((e) => e.type === 'ActorDefeated');
      if (!defeat)
        throw new Error(
          JSON.stringify({
            iteration: i,
            hit,
            hp: output.snapshot.actors.map((a) => a.hp),
            events: output.events.map((e) => e.type),
            state: output.snapshot.actors[0]?.fighting,
            queries: combatTx.queries.map((q) => [
              q.cursorGameMs,
              q.horizonGameMs,
              q.queryMode,
              q.snapshot.actors[0]?.fighting?.phase,
              q.snapshot.actors[0]?.fighting?.moveAgeTicks,
            ]),
          }),
        );
      const remaining = defeat.at + 1625 - output.snapshot.clocks.gameTimeMs;
      const transition = transactionStep(core, remaining);
      const resets = transition.tx.queries.flatMap((q) =>
        q.encounterReset ? [q.encounterReset] : [],
      );
      expect(resets).toHaveLength(1);
      resetIds.push(requireValue(resets[0]).resetId);
      expect(actor(core).fightingPose?.entryKind).toBe('encounter-reset');
      expect(actor(core).fightingPose?.acceptedRoot).toEqual({ x: 0, z: 0 });
      expect(
        core.read().actors.find((a) => a.actorId === opponent)?.fightingPose,
      ).toBeUndefined();
    }
    expect(new Set(opponentIds).size).toBe(4);
    expect(new Set(resetIds).size).toBe(3);
    const clock = requireValue(actor(core).fightingClock);
    expect(clock.endpoint?.atGameMs).toBeGreaterThanOrEqual(
      core.read().clocks.gameTimeMs,
    );
    expect(clock.slices.at(-1)?.frozen).toBe(true);
  });
});

describe('strict rejection, ties and replay completeness', () => {
  test('forbidden proposal candidates and foreign/nonresident physical membership reject before any callback', () => {
    const core = startTransactionCore();
    core.present(durationMs(T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(core, request, {
      project: () => {
        throw new Error('must not project');
      },
    });
    const extra = requireValue(before.actors[2]);
    expect(() =>
      core.completeStep({
        ...tx.value,
        snapshot: {
          ...tx.value.snapshot,
          actors: [
            ...tx.value.snapshot.actors,
            {
              ...requireValue(tx.value.snapshot.actors[0]),
              actorId: extra.actorId,
            },
          ],
        },
      }),
    ).toThrow();
    const forbidden = {
      kind: 'destruction' as const,
      runId: run,
      contactId: contactId('forbidden-world'),
      at: gameTimeMs(0),
      interval: { from: gameTimeMs(0), to: gameTimeMs(T) },
      point: { x: 0, y: 0, z: 0 },
      evidence: 'overlap' as const,
      sourceActorId: requireValue(before.actors[0]).actorId,
      targetId: worldObjectId('forbidden'),
      launchId: null,
      contactSpeedMps: 0,
    };
    expect(() =>
      core.completeStep({ ...tx.value, candidates: [forbidden] }),
    ).toThrow();
    expect(tx.queries).toHaveLength(0);
    expect(core.read()).toEqual(before);
    core.completeStep(syntheticTransaction(core, request).value);
  });
  test('repeated no-progress projection IDs abort with no partial clock acceptance', () => {
    const core = startTransactionCore();
    core.present(durationMs(T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(T) });
    let first: string | null = null;
    const tx = syntheticTransaction(core, request, {
      project: (_q, f) => {
        first ??= f.projectionId;
        return { ...f, projectionId: first };
      },
    });
    expect(() => core.completeStep(tx.value)).toThrow(/frontier|projection/i);
    expect(tx.state()).toBe('aborted');
    expect(core.read()).toEqual(before);
  });
  test('ignored geometric occurrence settles without consuming impact; changed geometry can hit on re-entry', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'crouch'), packet(core, 'punch', 'blue')]);
    let stage = 0;
    const { output, tx } = transactionStep(core, T, {
      project: (q, f) => {
        if (stage === 0 && q.queryMode === 'interval') {
          stage++;
          return syntheticBodies(q, f, T / 4, [['blue', 'white']]);
        }
        if (stage === 1) {
          stage++;
          return syntheticPhysical(q, f, q.cursorGameMs, ['takeoff']);
        }
        if (stage === 2) {
          stage++;
          return syntheticBodies(q, f, q.cursorGameMs, [['blue', 'white']]);
        }
        return f;
      },
    });
    expect(output.events.filter((e) => e.type === 'HpChanged')).toHaveLength(1);
    expect(actor(core).hp).toBe(400);
    expect(tx.queries.at(-1)?.settledOccurrenceIds).toHaveLength(2);
  });
  test('complete clash batch consumes before tied bodies in either candidate order', () => {
    for (const reverse of [false, true]) {
      const core = startTransactionCore();
      input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
      let hit = false;
      const { output } = transactionStep(core, 10 * T, {
        project: (q, f) => {
          if (
            !hit &&
            q.queryMode === 'interval' &&
            q.snapshot.actors[0]?.fighting?.phase === 'active'
          ) {
            hit = true;
            const bodies = syntheticBodies(q, f, q.cursorGameMs + T / 4, [
              ['white', 'blue'],
              ['blue', 'white'],
            ]);
            const first = bodies.result.candidates[0],
              second = bodies.result.candidates[1];
            if (first?.kind !== 'body-hit' || second?.kind !== 'body-hit')
              throw new Error('fixture body');
            const clash = {
              kind: 'clash' as const,
              runId: run,
              contactId: contactId(`clash:${q.transactionId}`),
              at: first.at,
              interval: first.interval,
              point: first.point,
              evidence: 'overlap' as const,
              first: first.source,
              second: second.source,
            };
            const candidates = reverse
              ? [...bodies.result.candidates, clash].reverse()
              : [...bodies.result.candidates, clash];
            return {
              ...bodies,
              occurrenceIds: candidates.map((c) => `occurrence:${c.contactId}`),
              result: { ...bodies.result, candidates },
            };
          }
          return f;
        },
      });
      expect(
        output.events.filter((e) => e.type === 'ClashResolved'),
      ).toHaveLength(1);
      expect(output.events.filter((e) => e.type === 'HpChanged')).toHaveLength(
        0,
      );
      expect(actor(core).hp).toBe(500);
    }
  });
  test('stale original-plan landing activation rejects after a hit; corrected current-suffix witness retries same begin', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
    core.present(durationMs(10 * T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(10 * T) }),
      old = requireValue(actor(core).attack).activationId;
    const attempt = (stale: boolean) => {
      let stage = 0;
      return syntheticTransaction(core, request, {
        project: (q, f) => {
          if (stage === 0) {
            stage++;
            return syntheticPhysical(q, f, q.cursorGameMs, ['takeoff']);
          }
          if (stage === 1 && q.queryMode === 'interval') {
            stage++;
            return syntheticBodies(q, f, T / 4, [['blue', 'white']]);
          }
          if (stage === 2 && q.queryMode === 'interval') {
            stage++;
            const landing = syntheticPhysical(q, f, 2 * T, ['landing']);
            return stale
              ? {
                  ...landing,
                  result: {
                    ...landing.result,
                    fighting: {
                      ...landing.result.fighting,
                      landings: landing.result.fighting.landings.map((w) => ({
                        ...w,
                        airborneActivationId: old,
                      })),
                    },
                  },
                }
              : landing;
          }
          return f;
        },
      });
    };
    const broken = attempt(true);
    expect(() => core.completeStep(broken.value)).toThrow(/Landing|suffix/i);
    expect(core.read()).toEqual(before);
    core.completeStep(attempt(false).value);
    expect(actor(core).fighting?.posture).toBe('standing');
  });
  test('mutual KO retains complete trade and frozen original-E clocks despite terminal K', () => {
    const core = transactionSetup((o) => ({
      ...o,
      fighting: {
        ...requireValue(o.fighting),
        policy: {
          ...requireValue(o.fighting).policy,
          hpPerNormalizedPoint: 100,
        },
      },
    }));
    core.handle({ type: 'AssetsReady', runId: run });
    core.handle({ type: 'StartRequested', runId: run });
    core.drain();
    for (let i = 0; i < 4; i++) {
      input(core, [packet(core, 'punch', 'blue')]);
      let hit = false;
      transactionStep(core, 2200, {
        project: (q, f) => {
          if (!hit && q.queryMode === 'interval') {
            hit = true;
            return syntheticBodies(q, f, q.cursorGameMs + T / 4, [
              ['blue', 'white'],
            ]);
          }
          return f;
        },
      });
    }
    expect(actor(core).hp).toBe(100);
    input(core, [packet(core, 'punch'), packet(core, 'punch', 'blue')]);
    let hit = false;
    const { output, request } = transactionStep(core, 10 * T, {
      project: (q, f) => {
        if (
          !hit &&
          q.queryMode === 'interval' &&
          q.snapshot.actors[0]?.fighting?.phase === 'active'
        ) {
          hit = true;
          return syntheticBodies(q, f, q.cursorGameMs + T / 4, [
            ['white', 'blue'],
            ['blue', 'white'],
          ]);
        }
        return f;
      },
    });
    expect(output.snapshot.result?.outcome).toBe('defeat');
    expect(
      output.events.filter((e) => e.type === 'ActorDefeated'),
    ).toHaveLength(2);
    expect(output.events.filter((e) => e.type === 'HpChanged')).toHaveLength(2);
    for (const a of output.snapshot.actors.filter((a) =>
      output.snapshot.residentActorIds?.includes(a.actorId),
    )) {
      expect(a.fightingClock?.endpoint?.atGameMs).toBe(
        request.snapshot.clocks.gameTimeMs,
      );
      expect(a.fightingClock?.slices.at(-1)?.frozen).toBe(true);
      expect(a.fightingPose?.defeatEntry).toBeDefined();
    }
    expect(output.snapshot.clocks.gameTimeMs).toBeLessThan(
      request.snapshot.clocks.gameTimeMs,
    );
  });
  test('missing, extra, reordered and duplicate replay interactions are rejected', () => {
    const r = recordCore(transactionSetup());
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    transactionStep(r.core, T);
    const tape = r.read(),
      entry = requireValue(tape.find((e) => e.kind === 'transaction'));
    if (entry.kind !== 'transaction') throw new Error('transaction');
    const calls = entry.value.interactions,
      first = requireValue(calls[0]),
      second = requireValue(calls[1]);
    for (const interactions of [
      calls.slice(1),
      [first, first, ...calls.slice(1)],
      [second, first, ...calls.slice(2)],
      [
        ...calls,
        {
          kind: 'abort' as const,
          outcome: { kind: 'returned' as const, value: null },
        },
      ],
    ]) {
      const changed = tape.map((e) =>
        e === entry
          ? {
              kind: 'transaction' as const,
              value: { ...entry.value, interactions },
            }
          : e,
      );
      expect(() => replayCore(transactionSetup(), changed)).toThrow();
    }
  });
  test('AI runs once per begin across failed completion and tape replay consumes exactly the recorded commands', () => {
    const ai = recordIntentProvider((snapshot) => [
      {
        type: 'AttackRequested',
        runId: run,
        actorId: requireValue(snapshot.currentOpponentId),
        category: 'punch',
        input: { commandId: commandId('strict-ai-1'), sequence: 1 },
      },
    ]);
    const r = recordCore(
      transactionSetup((o) => ({ ...o, enemyAi: ai.decide })),
    );
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    const failed = syntheticTransaction(r.core, request, {
      project: (q, f) => {
        if (q.revision === 2) throw new Error('ai retry');
        return f;
      },
    });
    expect(() => r.core.completeStep(failed.value)).toThrow('ai retry');
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    expect(ai.read()).toHaveLength(1);
    const replayAi = replayIntentProvider(ai.read());
    expect(
      replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      ).outputs,
    ).toEqual(r.outputs());
    expect(() => replayAi.assertConsumed()).not.toThrow();
    expect(replayAi.readConsumed()).toBe(1);
  });
});

describe('strict held publications and exact selection seams', () => {
  test('a contact at a logical right boundary must be resampled in the new phase before body resolution', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'punch')]);
    core.present(durationMs(10 * T));
    const before = core.read(),
      request = core.beginStep({ durationMs: durationMs(10 * T) });
    let injected = false;
    const tx = syntheticTransaction(core, request, {
      project: (q, f) => {
        if (
          !injected &&
          q.queryMode === 'interval' &&
          q.snapshot.actors[0]?.fighting?.phase === 'startup'
        ) {
          injected = true;
          return syntheticBodies(q, f, q.horizonGameMs, [['white', 'blue']]);
        }
        return f;
      },
    });
    expect(() => core.completeStep(tx.value)).toThrow(
      /classification|resampl|boundary/i,
    );
    expect(core.read()).toEqual(before);
    let hit = false;
    core.completeStep(
      syntheticTransaction(core, request, {
        project: (q, f) => {
          if (
            !hit &&
            q.queryMode === 'interval' &&
            q.snapshot.actors[0]?.fighting?.phase === 'active'
          ) {
            hit = true;
            return syntheticBodies(q, f, q.cursorGameMs, [['white', 'blue']]);
          }
          return f;
        },
      }).value,
    );
    expect(actor(core, 'blue').hp).toBe(450);
  });
  test('legal buffered move can start exactly at E with zero motion and no endpoint body ownership', () => {
    const core = startTransactionCore();
    input(core, [packet(core, 'punch'), packet(core, 'punch')]);
    let hit = false;
    transactionStep(core, 12.25 * T, {
      project: (q, f) => {
        if (
          !hit &&
          q.queryMode === 'interval' &&
          q.snapshot.actors[0]?.fighting?.phase === 'active'
        ) {
          hit = true;
          return syntheticBodies(q, f, 5.25 * T, [['white', 'blue']]);
        }
        return f;
      },
    });
    const a = actor(core);
    expect(a.attack?.fighting).toMatchObject({
      kind: 'v3',
      stage: 2,
      moveId: 'p_body',
    });
    expect(a.fightingClock?.endpoint?.motionMs).toBe(0);
    expect(a.fightingClock?.slices.at(-1)?.epochId).not.toBe(
      a.fightingClock?.endpoint?.epochId,
    );
  });
  test.each(['guard', 'crouch', 'attack', 'blockstun', 'hitstun'] as const)(
    'pause/background/releases preserve %s accepted pose and release held state',
    (state) => {
      for (const release of [
        'PauseRequested',
        'Backgrounded',
        'InputsReleased',
      ] as const) {
        const core = startTransactionCore();
        if (state === 'guard' || state === 'blockstun')
          input(core, [packet(core, 'guard')]);
        if (state === 'crouch') input(core, [packet(core, 'crouch')]);
        if (state === 'attack')
          input(core, [packet(core, 'punch'), packet(core, 'punch')]);
        if (state === 'blockstun' || state === 'hitstun')
          input(core, [packet(core, 'punch', 'blue')]);
        let hit = false;
        transactionStep(core, T, {
          project: (q, f) => {
            if (
              (state === 'blockstun' || state === 'hitstun') &&
              !hit &&
              q.queryMode === 'interval'
            ) {
              hit = true;
              return syntheticBodies(q, f, T / 4, [['blue', 'white']]);
            }
            return f;
          },
        });
        const accepted = actor(core);
        core.handle(
          release === 'PauseRequested'
            ? { type: release, runId: run, reason: 'manual' }
            : { type: release, runId: run },
        );
        expect(actor(core).fightingClock).toEqual(accepted.fightingClock);
        expect(actor(core).fightingPose).toEqual(accepted.fightingPose);
        expect(actor(core).fighting).toMatchObject({
          guardHeld: false,
          buffer: null,
        });
        if (state === 'blockstun')
          expect(actor(core).fighting?.guardHeight).toBe('standing');
        else expect(actor(core).fighting?.guardHeight).toBeNull();
        core.handle({
          type: 'QualityChanged',
          runId: run,
          quality: 'standard',
        });
        core.present(durationMs(0));
        core.drain();
        expect(actor(core).fightingClock).toEqual(accepted.fightingClock);
        if (release === 'PauseRequested')
          core.handle({
            type: 'ResumeRequested',
            runId: run,
            reason: 'manual',
          });
        expect(actor(core).fightingPose).toEqual(accepted.fightingPose);
      }
    },
  );
  test('session ending and jump-induced crouch release hold the selected old crouch until receipt', () => {
    for (const jump of [false, true]) {
      const core = startTransactionCore();
      input(core, [packet(core, 'crouch')]);
      transactionStep(core, T);
      const accepted = actor(core);
      if (jump) input(core, [packet(core, 'jump')]);
      else
        core.handle({
          type: 'MovementSessionEnded',
          runId: run,
          sessionId: 'c:white',
        });
      expect(actor(core).fighting?.posture).toBe('standing');
      expect(actor(core).fightingClock).toEqual(accepted.fightingClock);
      expect(actor(core).fightingPose).toEqual(accepted.fightingPose);
      transactionStep(core, T);
      expect(actor(core).fightingPoseHold).toBeUndefined();
      expect(actor(core).fightingClock?.endpoint?.posture).toBe('standing');
    }
  });
  test('a new run owns fresh actor, epoch and bootstrap IDs with no reused authority', () => {
    const first = transactionSetup(undefined, runId('fresh-a')),
      second = transactionSetup(undefined, runId('fresh-b'));
    first.handle({ type: 'AssetsReady', runId: runId('fresh-a') });
    second.handle({ type: 'AssetsReady', runId: runId('fresh-b') });
    expect(actor(first).actorId).not.toBe(actor(second).actorId);
    expect(actor(first).fightingClock?.endpoint?.epochId).not.toBe(
      actor(second).fightingClock?.endpoint?.epochId,
    );
    expect(actor(first).fightingPose?.commitId).not.toBe(
      actor(second).fightingPose?.commitId,
    );
  });
});

describe('strict source provenance cannot be forged by a finite DTO', () => {
  test.each(['basis', 'incoming', 'defeat'] as const)(
    'rejects a forged %s in an otherwise valid first settlement',
    (forgery) => {
      const core = startTransactionCore();
      core.present(durationMs(T));
      const before = core.read();
      const request = core.beginStep({ durationMs: durationMs(T) });
      const tx = syntheticTransaction(core, request, {
        project: (_q, frontier) => ({
          ...frontier,
          acceptedPrefix: frontier.acceptedPrefix.map((p, index) =>
            index
              ? p
              : {
                  ...p,
                  pose: {
                    ...p.pose,
                    ...(forgery === 'basis'
                      ? { facingBasis: { x: 1, y: 0, z: 0 } }
                      : {}),
                    ...(forgery === 'incoming'
                      ? { incoming: syntheticEntry(poseClips.airborne, 3) }
                      : {}),
                    ...(forgery === 'defeat'
                      ? { defeatEntry: syntheticEntry(poseClips.airborne, 3) }
                      : {}),
                  },
                },
          ),
        }),
      });
      expect(() => core.completeStep(tx.value)).toThrow(
        /basis|incoming|defeat/i,
      );
      expect(core.read()).toEqual(before);
      expect(tx.state()).toBe('aborted');
      core.completeStep(syntheticTransaction(core, request).value);
    },
  );
});

test('recorder snapshots public capability methods without changing their receiver or alias semantics', () => {
  const r = recordCore(transactionSetup());
  r.core.handle({ type: 'AssetsReady', runId: run });
  r.core.handle({ type: 'StartRequested', runId: run });
  r.core.drain();
  r.core.present(durationMs(T));
  const request = r.core.beginStep({ durationMs: durationMs(T) });
  const tx = syntheticTransaction(r.core, request, {
    project: (_query, frontier) => {
      Object.assign(tx.value.transaction, {
        project() {
          throw new Error('substituted resource method');
        },
      });
      return frontier;
    },
  });
  expect(() => r.core.completeStep(tx.value)).not.toThrow();
  expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(r.outputs());
});

test('fighting admission rejects an omitted explicit evidence/transaction mode at runtime', () => {
  const options = config();
  Reflect.deleteProperty(requireValue(options.fighting), 'mode');
  expect(() => createCore({ runId: run, seed: 42 }, options)).toThrow(/mode/i);
});

test('failed prepared receipt IDs stay reserved and issued epoch IDs are never recycled on retry', () => {
  const core = startTransactionCore();
  input(core, [packet(core, 'punch')]);
  core.present(durationMs(T));
  const before = core.read(),
    request = core.beginStep({ durationMs: durationMs(T) });
  const fixedReceipt = (receipt: FightingSpatialCommitReceipt) => ({
    ...receipt,
    receiptId: 'reserved-prepared-receipt',
    poseContexts: receipt.poseContexts.map((p) => ({
      ...p,
      commitId: 'reserved-prepared-receipt',
    })),
  });
  const first = syntheticTransaction(core, request, {
    finish: (receipt) => ({
      ...fixedReceipt(receipt),
      outputRevision: receipt.outputRevision + 1,
    }),
  });
  expect(() => core.completeStep(first.value)).toThrow();
  const firstEpoch = first.queries[0]?.selectedPoses[0]?.epochId;
  const second = syntheticTransaction(core, request, { finish: fixedReceipt });
  expect(() => core.completeStep(second.value)).toThrow(/receipt ID/i);
  expect(second.queries[0]?.selectedPoses[0]?.epochId).not.toBe(firstEpoch);
  expect(core.read()).toEqual(before);
  const third = syntheticTransaction(core, request);
  core.completeStep(third.value);
  expect(third.queries[0]?.selectedPoses[0]?.epochId).not.toBe(
    second.queries[0]?.selectedPoses[0]?.epochId,
  );
});

describe('recorder ordinary operation outcomes and admission guards', () => {
  function recorded(customize?: (options: CoreOptions) => CoreOptions) {
    const r = recordCore(transactionSetup(customize));
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    return r;
  }
  test('pending present rejection is an explicit failure, never a successful replay command', () => {
    const r = recorded();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    const before = r.core.read(),
      entries = r.read().length;
    expect(() => r.core.present(durationMs(0))).toThrow(/pending/);
    expect(r.core.read()).toEqual(before);
    expect(r.read().slice(entries)).toEqual([
      {
        kind: 'failed',
        operation: { kind: 'present', value: 0 },
        diagnostic: {
          name: 'Error',
          message: 'Core has a pending fighting transaction',
        },
      },
    ]);
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    const replayed = replayCore(transactionSetup(), r.read());
    expect(replayed.outputs).toEqual(r.outputs());
    expect(replayed.snapshot).toEqual(r.core.read());
  });
  test('pending rejection after an aborted completion does not prevent explicit error publication replay', () => {
    const r = recorded();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(r.core, request, {
      project: () => {
        throw new Error('pending project fault');
      },
    });
    expect(() => r.core.completeStep(tx.value)).toThrow(
      'pending project fault',
    );
    expect(() => r.core.present(durationMs(0))).toThrow(/pending/);
    r.core.fail('cancel pending');
    const error = r.core.drain();
    expect(error.snapshot.phase).toBe('error');
    expect(error.events.some((e) => e.type === 'FoundationError')).toBe(true);
    expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
      r.outputs(),
    );
  });
  test.each(['AI', 'ready'] as const)(
    '%s callback reentry is rejected before recording any nested mutation, while reads remain allowed',
    (callback) => {
      let r: ReturnType<typeof recordCore>;
      let visits = 0;
      const check = () => {
        visits++;
        const before = r.read(),
          snapshot = r.core.read();
        for (const mutate of [
          () => r.core.fail('rejected callback fail'),
          () => r.core.dispose(),
          () => r.core.drain(),
          () => r.core.present(durationMs(0)),
          () => r.core.handle({ type: 'InputsReleased', runId: run }),
          () => input(r.core, []),
          () => r.core.beginStep({ durationMs: durationMs(T) }),
          () =>
            r.core.completeStep({
              snapshot: { runId: run, tick: tick(0), actors: [], vehicles: [] },
              candidates: [],
            }),
        ])
          expect(mutate).toThrow(/busy/i);
        expect(r.read()).toEqual(before);
        expect(r.core.read()).toEqual(snapshot);
      };
      r = recordCore(
        transactionSetup((o) => {
          const fighting = o.fighting;
          if (fighting?.mode !== 'battle-transaction-v1')
            throw new Error('fixture mode');
          return {
            ...o,
            enemyAi:
              callback === 'AI'
                ? () => {
                    check();
                    return [];
                  }
                : false,
            fighting: {
              ...fighting,
              ready: () => {
                if (callback === 'ready') check();
                return fighting.ready();
              },
            },
          };
        }),
      );
      r.core.handle({ type: 'AssetsReady', runId: run });
      r.core.handle({ type: 'StartRequested', runId: run });
      r.core.drain();
      r.core.present(durationMs(T));
      const request = r.core.beginStep({ durationMs: durationMs(T) });
      r.core.completeStep(syntheticTransaction(r.core, request).value);
      expect(visits).toBe(1);
      expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
        r.outputs(),
      );
    },
  );
  test('failed AI begin retains its thrown decision and replays the later successful begin exactly', () => {
    let calls = 0;
    const ai = recordIntentProvider(() => {
      if (calls++ === 0) throw new TypeError('AI admission fault');
      return [];
    });
    const r = recorded((o) => ({ ...o, enemyAi: ai.decide }));
    r.core.present(durationMs(T));
    const before = r.core.read();
    expect(() => r.core.beginStep({ durationMs: durationMs(T) })).toThrow(
      'AI admission fault',
    );
    expect(r.core.read()).toEqual(before);
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    expect(ai.read()).toEqual([
      {
        kind: 'threw',
        diagnostic: { name: 'TypeError', message: 'AI admission fault' },
      },
      [],
    ]);
    expect(r.read().filter((e) => e.kind === 'begin')).toHaveLength(1);
    expect(() => structuredClone([r.read(), ai.read()])).not.toThrow();
    const replayAi = replayIntentProvider(ai.read());
    const replayed = replayCore(
      transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
      r.read(),
    );
    expect(replayed.outputs).toEqual(r.outputs());
    expect(replayed.snapshot).toEqual(r.core.read());
    expect(replayAi.readConsumed()).toBe(2);
    expect(() => replayAi.assertConsumed()).not.toThrow();
    // A live callback cannot be reconstructed from absent external decision evidence.
    expect(() => replayCore(transactionSetup(), r.read())).toThrow(
      /ordinary.*failure.*mismatch/i,
    );
  });
  test('returned AI decisions survive rejected batches; Core rollback does not delete external decisions or consume rejected command IDs', () => {
    let calls = 0;
    const ai = recordIntentProvider((snapshot) => {
      const id = requireValue(snapshot.currentOpponentId);
      const command: GameplayCommand = {
        type: 'AttackRequested',
        runId: run,
        actorId: id,
        category: 'punch',
        input: { commandId: commandId('retained-ai'), sequence: 1 },
      };
      return calls++ === 0
        ? [command, { ...command, category: 'kick' }]
        : [command];
    });
    const r = recorded((o) => ({ ...o, enemyAi: ai.decide }));
    r.core.present(durationMs(T));
    const before = r.core.read();
    expect(() => r.core.beginStep({ durationMs: durationMs(T) })).toThrow(
      /Conflicting command identity/,
    );
    expect(r.core.read()).toEqual(before);
    expect(ai.read()).toHaveLength(1);
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    const out = r.core.completeStep(
      syntheticTransaction(r.core, request).value,
    );
    expect(out.events.filter((e) => e.type === 'AttackAccepted')).toHaveLength(
      1,
    );
    expect(ai.read()).toHaveLength(2);
    // Rejected pre-AI operations must not consume an external decision.
    const count = ai.read().length;
    expect(() => r.core.beginStep({ durationMs: durationMs(0) })).toThrow(
      /positive/,
    );
    expect(ai.read()).toHaveLength(count);
    const replayAi = replayIntentProvider(ai.read());
    expect(
      replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      ).outputs,
    ).toEqual(r.outputs());
    expect(() => replayAi.assertConsumed()).not.toThrow();
  });
  test('failed ready preparation is replayed rather than dropping its reserved bootstrap epochs', () => {
    const customize = () => {
      let calls = 0;
      return (o: CoreOptions): CoreOptions => {
        const fighting = o.fighting;
        if (fighting?.mode !== 'battle-transaction-v1')
          throw new Error('fixture mode');
        return {
          ...o,
          fighting: {
            ...fighting,
            ready: () => {
              if (calls++ === 0) throw new Error('ready admission fault');
              return fighting.ready();
            },
          },
        };
      };
    };
    const r = recordCore(transactionSetup(customize()));
    const before = r.core.read();
    expect(() => r.core.handle({ type: 'AssetsReady', runId: run })).toThrow(
      'ready admission fault',
    );
    expect(r.core.read()).toEqual(before);
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    expect(actor(r.core).fightingPose?.epochId).not.toBe(
      actor(startTransactionCore()).fightingPose?.epochId,
    );
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    const replayed = replayCore(transactionSetup(customize()), r.read());
    expect(replayed.outputs).toEqual(r.outputs());
    expect(replayed.snapshot).toEqual(r.core.read());
  });
  test.each(['fail', 'dispose'] as const)(
    'explicit %s after aborted completion remains accepted and replayable',
    (operation) => {
      const r = recorded();
      r.core.present(durationMs(T));
      const request = r.core.beginStep({ durationMs: durationMs(T) });
      const tx = syntheticTransaction(r.core, request, {
        project: () => {
          throw new Error('explicit cleanup');
        },
      });
      expect(() => r.core.completeStep(tx.value)).toThrow('explicit cleanup');
      if (operation === 'fail') {
        r.core.fail('cancel');
        r.core.drain();
      } else r.core.dispose();
      const replayed = replayCore(transactionSetup(), r.read());
      expect(replayed.outputs).toEqual(r.outputs());
      expect(replayed.snapshot).toEqual(r.core.read());
    },
  );
  test('unrecordable finish followed by explicit error cleanup still replays', () => {
    const r = recorded();
    r.core.present(durationMs(T));
    const request = r.core.beginStep({ durationMs: durationMs(T) });
    const tx = syntheticTransaction(r.core, request, {
      raw: true,
      finish: (receipt) => ({ ...receipt, bad: () => undefined }),
    });
    expect(() => r.core.completeStep(tx.value)).toThrow(/non-recordable/);
    r.core.fail('cancel unrecordable finish');
    r.core.drain();
    expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
      r.outputs(),
    );
  });
});

describe('recorder capture and outcome guard lifetime', () => {
  test('captured ordinary inputs define the call once; getter reentry cannot insert a lifecycle command', () => {
    const r = recordCore(transactionSetup());
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    r.core.present(durationMs(T));
    let reads = 0;
    const step = {
      get durationMs() {
        expect(() => r.core.fail('capture reentry')).toThrow(/busy/i);
        return durationMs(++reads === 1 ? T : 2 * T);
      },
    };
    const request = r.core.beginStep(step);
    expect(reads).toBe(1);
    expect(request.step.durationMs).toBe(T);
    r.core.completeStep(syntheticTransaction(r.core, request).value);
    expect(replayCore(transactionSetup(), r.read()).outputs).toEqual(
      r.outputs(),
    );
  });
  test('a failed input capture adds no operation and releases the recorder guard', () => {
    const r = recordCore(transactionSetup());
    const before = r.read();
    expect(() =>
      r.core.handle({
        type: 'AssetsReady',
        get runId(): typeof run {
          expect(() => r.core.dispose()).toThrow(/busy/i);
          throw new Error('input capture fault');
        },
      }),
    ).toThrow('input capture fault');
    expect(r.read()).toEqual(before);
    r.core.handle({ type: 'AssetsReady', runId: run });
    expect(replayCore(transactionSetup(), r.read()).snapshot).toEqual(
      r.core.read(),
    );
  });
  test('diagnostic extraction stays guarded, records only name/message and validates failure mismatches', () => {
    let r: ReturnType<typeof recordCore>;
    const error = new Error('diagnostic fault');
    Object.defineProperty(error, 'name', {
      get() {
        expect(() => r.core.fail('diagnostic reentry')).toThrow(/busy/i);
        return 'AdmissionError';
      },
    });
    Object.assign(error, { privatePayload: () => 'not tape data' });
    const ai = recordIntentProvider(() => {
      throw error;
    });
    r = recordCore(transactionSetup((o) => ({ ...o, enemyAi: ai.decide })));
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.present(durationMs(T));
    let failure: unknown;
    try {
      r.core.beginStep({ durationMs: durationMs(T) });
    } catch (caught) {
      failure = caught;
    }
    expect(failure === error).toBe(true);
    expect(ai.read()).toEqual([
      {
        kind: 'threw',
        diagnostic: { name: 'AdmissionError', message: 'diagnostic fault' },
      },
    ]);
    r.core.fail('outside cleanup');
    r.core.drain();
    const replayAi = replayIntentProvider(ai.read());
    expect(
      replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      ).outputs,
    ).toEqual(r.outputs());
    expect(() => replayAi.assertConsumed()).not.toThrow();
    const changed = structuredClone(r.read());
    const rejected = changed.find((e) => e.kind === 'failed');
    if (rejected?.kind !== 'failed')
      throw new Error('expected failed operation');
    Object.assign(rejected.diagnostic, { message: 'forged failure' });
    expect(() =>
      replayCore(
        transactionSetup((o) => ({
          ...o,
          enemyAi: replayIntentProvider(ai.read()),
        })),
        changed,
      ),
    ).toThrow(/ordinary.*failure.*mismatch/i);
  });
});

describe('propagated recorder failure observation', () => {
  function recorded(ai: Exclude<CoreOptions['enemyAi'], false | undefined>) {
    const r = recordCore(transactionSetup((o) => ({ ...o, enemyAi: ai })));
    r.core.handle({ type: 'AssetsReady', runId: run });
    r.core.handle({ type: 'StartRequested', runId: run });
    r.core.drain();
    r.core.present(durationMs(T));
    return r;
  }
  function failBegin(r: ReturnType<typeof recordCore>, error: Error) {
    let caught: unknown;
    try {
      r.core.beginStep({ durationMs: durationMs(T) });
    } catch (failure) {
      caught = failure;
    }
    // Do not inspect/format the Error: doing so would read its live accessors.
    expect(caught === error).toBe(true);
  }
  function failedDiagnostics(r: ReturnType<typeof recordCore>) {
    return r
      .read()
      .flatMap((entry) => (entry.kind === 'failed' ? [entry.diagnostic] : []));
  }
  test.each(['name', 'message'] as const)(
    'changing Error.%s is observed once per propagated failure, not once per recorder',
    (field) => {
      let reads = 0,
        calls = 0;
      const error = new Error('stable message');
      Object.defineProperty(error, field, {
        get() {
          return `Observed${++reads}`;
        },
      });
      const ai = recordIntentProvider(() => {
        if (calls++ < 2) throw error;
        return [];
      });
      const r = recorded(ai.decide),
        before = r.core.read();
      failBegin(r, error);
      expect(reads).toBe(1);
      expect(r.core.read()).toEqual(before);
      failBegin(r, error);
      expect(reads).toBe(2);
      const expected =
        field === 'name'
          ? [
              { name: 'Observed1', message: 'stable message' },
              { name: 'Observed2', message: 'stable message' },
            ]
          : [
              { name: 'Error', message: 'Observed1' },
              { name: 'Error', message: 'Observed2' },
            ];
      expect(failedDiagnostics(r)).toEqual(expected);
      expect(ai.read()).toEqual(
        expected.map((diagnostic) => ({ kind: 'threw', diagnostic })),
      );
      const request = r.core.beginStep({ durationMs: durationMs(T) });
      r.core.completeStep(syntheticTransaction(r.core, request).value);
      const replayAi = replayIntentProvider(ai.read());
      const replayed = replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      );
      expect(replayed.outputs).toEqual(r.outputs());
      expect(replayed.snapshot).toEqual(r.core.read());
      expect(replayAi.readConsumed()).toBe(3);
      replayAi.assertConsumed();
      expect(reads).toBe(2);
      expect(() => structuredClone([r.read(), ai.read()])).not.toThrow();
    },
  );
  test('changing name and message retain one guarded observation and original Error identity through nested AI recorders', () => {
    let names = 0,
      messages = 0;
    let r: ReturnType<typeof recordCore>;
    const error = new Error();
    Object.defineProperties(error, {
      name: {
        get() {
          expect(() => r.core.fail('name reentry')).toThrow(/busy/i);
          return `Name${++names}`;
        },
      },
      message: {
        get() {
          expect(() => r.core.dispose()).toThrow(/busy/i);
          return `Message${++messages}`;
        },
      },
    });
    const inner = recordIntentProvider(() => {
      throw error;
    });
    const outer = recordIntentProvider(inner.decide);
    r = recorded(outer.decide);
    failBegin(r, error);
    expect([names, messages]).toEqual([1, 1]);
    const outcome = {
      kind: 'threw',
      diagnostic: { name: 'Name1', message: 'Message1' },
    };
    expect(inner.read()).toEqual([outcome]);
    expect(outer.read()).toEqual([outcome]);
    expect(failedDiagnostics(r)).toEqual([outcome.diagnostic]);
    r.core.fail('outside cleanup');
    r.core.drain();
    const replayAi = replayIntentProvider(outer.read());
    expect(
      replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      ).outputs,
    ).toEqual(r.outputs());
    replayAi.assertConsumed();
  });
  test('reusing one Error in separate recorders and standalone AI invocations never reuses another occurrence diagnostic', () => {
    let names = 0;
    const error = new Error('reused');
    Object.defineProperty(error, 'name', {
      get() {
        return `Occurrence${++names}`;
      },
    });
    const standalone = recordIntentProvider(() => {
      throw error;
    });
    for (let i = 0; i < 2; i++) {
      let caught: unknown;
      try {
        standalone.decide(transactionSetup().read(), null);
      } catch (failure) {
        caught = failure;
      }
      expect(caught === error).toBe(true);
    }
    expect(standalone.read()).toEqual([
      { kind: 'threw', diagnostic: { name: 'Occurrence1', message: 'reused' } },
      { kind: 'threw', diagnostic: { name: 'Occurrence2', message: 'reused' } },
    ]);
    for (const name of ['Occurrence3', 'Occurrence4']) {
      const ai = recordIntentProvider(() => {
        throw error;
      });
      const r = recorded(ai.decide);
      failBegin(r, error);
      expect(failedDiagnostics(r)).toEqual([{ name, message: 'reused' }]);
      expect(ai.read()).toEqual([
        { kind: 'threw', diagnostic: { name, message: 'reused' } },
      ]);
      r.core.dispose();
      const replayAi = replayIntentProvider(ai.read());
      expect(
        replayCore(
          transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
          r.read(),
        ).snapshot,
      ).toEqual(r.core.read());
      replayAi.assertConsumed();
    }
    expect(names).toBe(4);
  });
  test('a swallowed child failure cannot override a replacement error recorded by its parent', () => {
    const childError = new TypeError('child'),
      replacement = new RangeError('replacement');
    const inner = recordIntentProvider(() => {
      throw childError;
    });
    const outer = recordIntentProvider((snapshot, spatial) => {
      try {
        inner.decide(snapshot, spatial);
      } catch {}
      throw replacement;
    });
    const r = recorded(outer.decide);
    failBegin(r, replacement);
    expect(inner.read()).toEqual([
      { kind: 'threw', diagnostic: { name: 'TypeError', message: 'child' } },
    ]);
    expect(outer.read()).toEqual([
      {
        kind: 'threw',
        diagnostic: { name: 'RangeError', message: 'replacement' },
      },
    ]);
    expect(failedDiagnostics(r)).toEqual([
      { name: 'RangeError', message: 'replacement' },
    ]);
    r.core.fail('cleanup');
    r.core.drain();
    const replayAi = replayIntentProvider(outer.read());
    expect(
      replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      ).outputs,
    ).toEqual(r.outputs());
    replayAi.assertConsumed();
  });
  test('a successful observed invocation clears an earlier swallowed failure before the same Error is raised again', () => {
    let names = 0,
      calls = 0;
    const error = new Error('re-raised');
    Object.defineProperty(error, 'name', {
      get() {
        return `Raise${++names}`;
      },
    });
    const inner = recordIntentProvider(() => {
      if (calls++ === 0) throw error;
      return [];
    });
    const outer = recordIntentProvider((snapshot, spatial) => {
      try {
        inner.decide(snapshot, spatial);
      } catch {}
      inner.decide(snapshot, spatial);
      throw error;
    });
    const r = recorded(outer.decide);
    failBegin(r, error);
    expect(names).toBe(2);
    expect(inner.read()).toEqual([
      { kind: 'threw', diagnostic: { name: 'Raise1', message: 're-raised' } },
      [],
    ]);
    expect(outer.read()).toEqual([
      { kind: 'threw', diagnostic: { name: 'Raise2', message: 're-raised' } },
    ]);
    expect(failedDiagnostics(r)).toEqual([
      { name: 'Raise2', message: 're-raised' },
    ]);
    r.core.dispose();
    const replayAi = replayIntentProvider(outer.read());
    expect(
      replayCore(
        transactionSetup((o) => ({ ...o, enemyAi: replayAi })),
        r.read(),
      ).snapshot,
    ).toEqual(r.core.read());
    replayAi.assertConsumed();
  });
});
