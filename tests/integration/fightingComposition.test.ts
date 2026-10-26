import { expect, test } from 'vitest';
import * as contracts from '../../src/contracts';
import {
  actorId,
  clipId,
  commandId,
  contactId,
  durationMs,
  gameTimeMs,
  tick,
  FIGHTING_ENTRIES,
  FIGHTING_MOVE_SPECS,
  FIGHTING_GROUND_ROUTES,
  type ActorColor,
  type CorePort,
  type FightingCombatantState,
  type FightingSpatialStepResult,
  type GameplayCommand,
  type HitLevel,
  type MotionDefinition,
  type SpatialCandidate,
  type SpatialStepRequest,
} from '../../src/contracts';
import { createCore, type CoreOptions } from '../../src/core/createCore';
import { requireValue } from '../../src/core/invariant';
import {
  advanceFightingTick,
  createFightingCombatant,
  fightingHeatCost,
  receiveFightingInputs,
} from '../../src/core/fightingState';
import { resolveFightingMove } from '../../src/core/fightingRules';
import { FIGHTING_COMBO_GUIDE } from '../../src/ui/comboGuide';
import { fixtureCatalog, reference, run } from '../core/fixtures/scenarios';

// Composition/authority evidence only. All catalog, positions and contact witnesses
// below are SYNTHETIC core-evidence-only; none is a qualified C/D geometry fixture.
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

test('activeACompositionDoesNotExposeInactiveMaterials', () => {
  const routes = {
    P: 'p_short',
    PP: 'p_body',
    PK: 'k_low',
    PPK: 'k_turn',
    K: 'k_front',
    KK: 'k_turn',
  };
  expect(contracts.FIGHTING_ACTIVE_MOVE_IDS).toEqual([
    'p_short',
    'p_body',
    'k_front',
    'k_low',
    'k_turn',
    'c_body',
    'a_palm',
    'a_kick',
  ]);
  expect(contracts.FIGHTING_ACTIVE_GROUND_ROUTES).toEqual(routes);
  expect(contracts.FIGHTING_ACTIVE_ENTRIES).toHaveLength(9);
  expect(contracts.FIGHTING_ACTIVE_CANCEL_EDGES).toEqual([
    { from: 'P', to: 'PP', maxDelayTicks: 8 },
    { from: 'P', to: 'PK', maxDelayTicks: 3 },
    { from: 'PP', to: 'PPK', maxDelayTicks: 3 },
    { from: 'K', to: 'KK', maxDelayTicks: 5 },
  ]);
  expect(
    FIGHTING_COMBO_GUIDE.ground.map((row) => [row.input, row.moveId]),
  ).toEqual(Object.entries(routes));
  expect(Object.keys(FIGHTING_MOVE_SPECS)).toHaveLength(10);
  expect(FIGHTING_ENTRIES).toHaveLength(11);
  expect(Object.keys(FIGHTING_GROUND_ROUTES)).toHaveLength(9);
  expect(contracts.FIGHTING_CANCEL_EDGES).toHaveLength(7);
  expect(FIGHTING_GROUND_ROUTES).toMatchObject({
    PPP: 'p_finish',
    KP: 'p_entry',
    KPP: 'p_finish',
  });
  const backing = requireValue(config().fighting);
  expect(backing.entries).toHaveLength(11);
  expect(backing.catalog.list()).toHaveLength(11);
  for (const entry of contracts.FIGHTING_ACTIVE_ENTRIES) {
    const matches = backing.entries.filter(
      (bound) =>
        bound.posture === entry.posture && bound.moveId === entry.moveId,
    );
    expect(matches).toHaveLength(1);
    expect(backing.catalog.get(requireValue(matches[0]).clipId)).toBeDefined();
  }
  // The original 12 punch + 19 kick inventory is not rebaked or replaced by A.
  expect(fixtureCatalog().catalog.list()).toHaveLength(31);
});

test('A composition does not opt the default legacy Core into fighting', () => {
  const core = setup({ ...fixtureCatalog(), enemyAi: false });
  input(core, [packet(core, 'punch')]);
  expect(actor(core).attack).not.toBeNull();
  expect(actor(core).attack?.fighting).toBeUndefined();
  expect(actor(core).fighting).toBeUndefined();
});

test.each([
  ['P', ['p_short']],
  ['PP', ['p_short', 'p_body']],
  ['PK', ['p_short', 'k_low']],
  ['PPK', ['p_short', 'p_body', 'k_turn']],
  ['K', ['k_front']],
  ['KK', ['k_front', 'k_turn']],
] as const)(
  '%s follows the guide through accepted synthetic Core contacts, not physical combo qualification',
  (route, moves) => {
    const core = setup();
    input(core, [packet(core, route[0] === 'P' ? 'punch' : 'kick')]);
    const seen: string[] = [];
    for (let stage = 0; stage < route.length; stage++) {
      const state = requireValue(actor(core).fighting);
      expect(state.route).toBe(route.slice(0, stage + 1));
      expect(state.moveId).toBe(moves[stage]);
      const spec = FIGHTING_MOVE_SPECS[requireValue(state.moveId)];
      seen.push(requireValue(state.moveId));
      step(core, spec.startupTicks * T);
      if (stage + 1 < route.length)
        input(core, [
          packet(core, route[stage + 1] === 'P' ? 'punch' : 'kick'),
        ]);
      const out = step(core, T, (request) =>
        result(request, [body(core, request, 'white', 'blue', T / 4)]),
      );
      const hp = out.events.find((event) => event.type === 'HpChanged');
      expect(hp?.type).toBe('HpChanged');
      if (hp?.type === 'HpChanged')
        expect(hp.actualHpLost).toBeCloseTo(
          spec.damageNormalized * 5 * requireValue([1, 0.8, 0.65][stage]),
          10,
        );
      if (stage + 1 < route.length) step(core, (spec.hitstopTicks + 0.25) * T);
    }
    expect(seen).toEqual(moves);
    expect(actor(core).heat.amount).toBe(route.length);
  },
);

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

test.each(['PP', 'K', 'KP'] as const)(
  'historical %s + P remains representable but cannot confer an active replacement',
  (route) => {
    const moveId = FIGHTING_GROUND_ROUTES[route];
    const spec = FIGHTING_MOVE_SPECS[moveId];
    const prior: FightingCombatantState = {
      ...createFightingCombatant(),
      route,
      moveId,
      stage: route.length as 1 | 2,
      phase: 'active',
      moveAgeTicks: spec.startupTicks + 1,
      hitConfirmed: true,
      contactAgeTicks: spec.startupTicks,
    };
    const captured = contracts.captureFightingCombatantState(prior);
    expect(captured.route).toBe(route);
    expect(resolveFightingMove('standing', route, 'P')).toBeNull();
    const attempted = receiveFightingInputs(
      captured,
      [
        {
          runId: run,
          actorId: actorId('historical'),
          commandId: commandId('historical-P'),
          sequence: 1,
          button: 'P',
        },
      ],
      false,
    );
    expect(fightingHeatCost(captured, attempted)).toBe(0);
    const { buffer: _buffer, ...motion } = attempted;
    const { buffer: _oldBuffer, ...priorMotion } = captured;
    expect(motion).toEqual(priorMotion);
    let baseline = captured,
      next = attempted;
    for (let wall = 0; baseline.phase !== 'neutral' && wall < 100; wall++) {
      const before = next;
      baseline = advanceFightingTick(baseline, [], false);
      next = advanceFightingTick(next, [], false);
      expect(fightingHeatCost(before, next)).toBe(0);
      const { buffer: _nextBuffer, ...actualMotion } = next;
      const { buffer: _baseBuffer, ...baselineMotion } = baseline;
      expect(actualMotion).toEqual(baselineMotion);
    }
    expect(next).toMatchObject({
      phase: 'neutral',
      moveId: null,
      buffer: null,
    });
  },
);

test.each(['punch', 'kick'] as const)(
  'empty contact output cannot turn the %s move label into HP or a hit-only continuation',
  (button) => {
    const core = setup();
    const hp = actor(core, 'blue').hp;
    input(core, [packet(core, button)]);
    const first = requireValue(actor(core).attack).activationId;
    step(core, (button === 'punch' ? 5 : 10) * T);
    input(core, [packet(core, 'kick')]);
    const out = step(core, T);
    expect(out.events.filter((event) => event.type === 'HpChanged')).toEqual(
      [],
    );
    expect(actor(core, 'blue').hp).toBe(hp);
    expect(actor(core).attack?.activationId).toBe(first);
    expect(actor(core).fighting?.hitConfirmed).toBe(false);
    expect(actor(core).heat.amount).toBe(1);
  },
);

test.each([
  ['crouching', 'punch', 'c_body'],
  ['crouching', 'kick', 'k_low'],
  ['airborne', 'punch', 'a_palm'],
  ['airborne', 'kick', 'a_kick'],
] as const)(
  '%s %s keeps its original posture-qualified entry %s',
  (posture, button, moveId) => {
    const core = setup();
    if (posture === 'crouching') input(core, [packet(core, 'crouch')]);
    else
      step(core, T, (request) =>
        result(request, [], { white: { grounded: false } }),
      );
    input(core, [packet(core, button)]);
    expect(actor(core).fighting).toMatchObject({ posture, moveId, stage: 1 });
    expect(actor(core).heat.amount).toBe(1);
  },
);
