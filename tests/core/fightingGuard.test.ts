import { describe, expect, test } from 'vitest';
import {
  actorId,
  runId,
  clipId,
  commandId,
  contactId,
  durationMs,
  gameTimeMs,
  tick,
  FIGHTING_ENTRIES,
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
import { recordCore, replayCore } from '../../src/core/replay';
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
  test.each(['P', 'PP', 'PPP', 'PK', 'PPK', 'K', 'KK', 'KP', 'KPP'])(
    'executes %s from actual accepted body hits with one heat per started stage',
    (route) => {
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
