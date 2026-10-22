import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import {
  commandId,
  durationMs,
  tick,
  type MotionDefinition,
} from '../../src/contracts';
import { createCore } from '../../src/core/createCore';
import {
  advanceCore,
  attack,
  envelope,
  fixtureCatalog,
  hitOpponent,
  reference,
  run,
  setup,
  step,
} from './fixtures/scenarios';
function mixed() {
  const fixture = fixtureCatalog();
  const definitions = fixture.catalog.list().map((m) => ({
    ...m,
    effectiveRangeM: m.category === 'punch' ? 0.8 : 180 / 70 - 1,
  }));
  const core = createCore(
    { runId: run, seed: 42 },
    {
      moves: fixture.moves,
      catalog: {
        list: () => definitions,
        get: (id) => definitions.find((m) => m.clipId === id),
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.drain();
  return core;
}
test('100 versus70 clash deals exactly30 only to weak side; heat never refunded', () => {
  const core = mixed();
  attack(core);
  attack(core, 'blue', 'kick');
  const first = reference(core),
    second = reference(core, 'blue');
  const output = step(core, (at) => [
    { ...envelope(at), kind: 'clash', first, second },
  ]);
  const hp = output.events.filter((e) => e.type === 'HpChanged');
  expect(hp).toHaveLength(1);
  expect(hp[0]).toMatchObject({
    actorId: second.actorId,
    beforeHp: 500,
    afterHp: 470,
    actualHpLost: 30,
    cause: { kind: 'clash' },
  });
  expect(requireValue(core.read().actors[0]).heat.amount).toBe(1);
  expect(requireValue(core.read().actors[1]).heat.amount).toBe(1);
});
test('one impact cannot be reused in another clash or a later body contact', () => {
  const core = mixed();
  attack(core);
  attack(core, 'blue', 'kick');
  const first = reference(core),
    second = reference(core, 'blue');
  step(core, (at) => [
    { ...envelope(at, 'a'), kind: 'clash', first, second },
    { ...envelope(at, 'b'), kind: 'clash', second, first },
    {
      ...envelope(at, 'c'),
      kind: 'body-hit',
      source: first,
      targetActorId: second.actorId,
    },
  ]);
  expect(requireValue(core.read().actors[1]).hp).toBe(470);
  step(core, (at) => [
    {
      ...envelope(at, 'late'),
      kind: 'body-hit',
      source: first,
      targetActorId: second.actorId,
    },
  ]);
  expect(requireValue(core.read().actors[1]).hp).toBe(470);
});
test('rejected attack never advances random selection, activation ID or heat', () => {
  const a = setup(),
    b = setup();
  attack(a);
  attack(b);
  const initial = requireValue(a.read().actors[0]).attack;
  attack(a);
  expect(requireValue(a.read().actors[0]).attack).toEqual(initial);
  expect(requireValue(a.read().actors[0]).heat.amount).toBe(1);
  step(a);
  step(b);
  attack(a);
  attack(b);
  expect(requireValue(a.read().actors[0]).attack).toEqual(
    requireValue(b.read().actors[0]).attack,
  );
});
test('seventh complete attack starts full lock; eighth rejected until exactly3000 and pause excluded', () => {
  const core = setup();
  for (let n = 0; n < 7; n++) {
    attack(core);
    expect(requireValue(core.read().actors[0]).heat.amount).toBe(n + 1);
    step(core);
  }
  expect(requireValue(core.read().actors[0]).heat.lockedUntil).toBe(3000);
  attack(core);
  expect(requireValue(core.read().actors[0]).attack).toBeNull();
  advanceCore(core, 2999);
  expect(requireValue(core.read().actors[0]).actions.punch).toMatchObject({
    allowed: false,
    reason: 'cooling-lock',
  });
  core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
  core.present(durationMs(10000));
  expect(core.read().clocks.activeRealTimeMs).toBe(2999);
  core.handle({ type: 'ResumeRequested', runId: run, reason: 'settings' });
  advanceCore(core, 1);
  attack(core);
  expect(requireValue(core.read().actors[0]).attack).not.toBeNull();
  expect(requireValue(core.read().actors[0]).heat.amount).toBe(1);
});
test('waiting actors cannot attack; black has700, all19 kicks and no punches', () => {
  const core = setup();
  attack(core, 'black', 'kick');
  expect(
    requireValue(core.read().actors.find((a) => a.color === 'black')).attack,
  ).toBeNull();
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 5; i++) hitOpponent(core);
    advanceCore(core, 1500);
  }
  expect(
    requireValue(core.read().actors.find((a) => a.color === 'black')).hp,
  ).toBe(700);
  attack(core, 'black', 'punch');
  expect(
    requireValue(core.read().actors.find((a) => a.color === 'black')).attack,
  ).toBeNull();
  attack(core, 'black', 'kick');
  expect(
    requireValue(core.read().actors.find((a) => a.color === 'black')).attack
      ?.category,
  ).toBe('kick');
});
test('damage and heal are distinct same-batch events, actual loss clamps and durable death record survives drain', () => {
  const core = setup();
  for (let i = 0; i < 4; i++) hitOpponent(core);
  advanceCore(core, 500);
  attack(core);
  attack(core, 'blue');
  const a = reference(core),
    b = reference(core, 'blue');
  const out = step(core, (at) => [
    {
      ...envelope(at, 'a'),
      kind: 'body-hit',
      source: a,
      targetActorId: b.actorId,
    },
    {
      ...envelope(at, 'b'),
      kind: 'body-hit',
      source: b,
      targetActorId: a.actorId,
    },
  ]);
  const whiteEvents = out.events.filter(
    (e) => 'actorId' in e && e.actorId === a.actorId,
  );
  expect(whiteEvents.filter((e) => e.type === 'HpChanged')).toHaveLength(1);
  expect(whiteEvents.filter((e) => e.type === 'Healed')).toHaveLength(1);
  expect(requireValue(core.read().actors[0]).hp).toBe(500);
  expect(requireValue(core.read().actors[1]).defeatPresentation).toMatchObject({
    category: 'punch',
    slowDurationMs: 1500,
    playbackRate: 0.25,
  });
  core.drain();
  core.present(durationMs(2000));
  expect(requireValue(core.read().actors[1]).defeatPresentation?.category).toBe(
    'punch',
  );
});
test('snapshot history is frozen, stale runs and wrong spatial tick cannot mutate authority', () => {
  const core = setup(),
    before = core.read();
  attack(core);
  expect(requireValue(before.actors[0]).attack).toBeNull();
  expect(
    Object.isFrozen(
      requireValue(requireValue(core.read().actors[0]).attack).impactBindings,
    ),
  ).toBe(true);
  core.beginStep({ durationMs: durationMs(10) });
  expect(() =>
    core.completeStep({
      snapshot: { runId: run, tick: tick(999), actors: [], vehicles: [] },
      candidates: [],
    }),
  ).toThrow();
});
test('configured arbitration preserves transport order but attack wins over jump with no buffering', () => {
  const core = setup(),
    actorId = requireValue(core.read().actors[0]).actorId;
  core.handleInputBatch({
    runId: run,
    tick: tick(1),
    commands: [
      {
        type: 'JumpRequested',
        runId: run,
        actorId,
        input: { commandId: commandId('jump'), sequence: 1 },
      },
      {
        type: 'AttackRequested',
        runId: run,
        actorId,
        category: 'punch',
        input: { commandId: commandId('attack'), sequence: 2 },
      },
    ],
  });
  const request = core.beginStep({ durationMs: durationMs(10) });
  expect(request.intents).toEqual([]);
  expect(requireValue(request.snapshot.actors[0]).attack).not.toBeNull();
  core.completeStep({
    snapshot: { runId: run, tick: tick(1), actors: [], vehicles: [] },
    candidates: [],
  });
  expect(core.beginStep({ durationMs: durationMs(10) }).intents).toEqual([]);
});
test('all4 final mutual defeat keeps4 kills but never clear-time or resurrection', () => {
  const fixture = fixtureCatalog();
  const definitions: MotionDefinition[] = fixture.catalog
    .list()
    .map((m) => ({ ...m, effectiveRangeM: m.category === 'kick' ? 1.5 : 0.8 }));
  const core = createCore(
    { runId: run, seed: 42 },
    {
      moves: fixture.moves,
      catalog: {
        list: () => definitions,
        get: (id) => definitions.find((m) => m.clipId === id),
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 5; i++) hitOpponent(core);
    advanceCore(core, 1500);
  }
  for (let n = 0; n < 7; n++) {
    advanceCore(core, 500);
    attack(core);
    attack(core, 'black', 'kick');
    const a = reference(core),
      b = reference(core, 'black');
    step(core, (at) => [
      {
        ...envelope(at, `a${n}`),
        kind: 'body-hit',
        source: a,
        targetActorId: b.actorId,
      },
      {
        ...envelope(at, `b${n}`),
        kind: 'body-hit',
        source: b,
        targetActorId: a.actorId,
      },
    ]);
  }
  expect(core.read().result).toMatchObject({
    outcome: 'defeat',
    score: { defeatedEnemies: 4, clearTime: null, remainingHp: 0 },
  });
});
test('combo uses shares rather than multiplying move damage', () => {
  const fixture = fixtureCatalog();
  const definitions = fixture.catalog.list().map((m) => ({
    ...m,
    durationMs: durationMs(20),
    rootCurve: [
      requireValue(m.rootCurve[0]),
      { ...requireValue(m.rootCurve[1]), atMs: durationMs(20) },
    ],
    impacts: [
      {
        ...requireValue(m.impacts[0]),
        endMs: durationMs(10),
        damageShare: 0.5,
      },
      {
        ...requireValue(m.impacts[0]),
        impactIndex: 1,
        startMs: durationMs(10),
        endMs: durationMs(20),
        damageShare: 0.5,
      },
    ],
  }));
  const core = createCore(
    { runId: run, seed: 1 },
    {
      moves: fixture.moves,
      catalog: {
        list: () => definitions,
        get: (id) => definitions.find((m) => m.clipId === id),
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  attack(core);
  const state = requireValue(requireValue(core.read().actors[0]).attack);
  const targetActorId = requireValue(core.read().currentOpponentId);
  for (let i = 0; i < 2; i++) {
    const source = {
      ...reference(core),
      impactId: requireValue(state.impactBindings[i]).impactId,
    };
    step(core, (at) => [
      { ...envelope(at, `combo${i}`), kind: 'body-hit', source, targetActorId },
    ]);
  }
  expect(requireValue(core.read().actors[1]).hp).toBe(400);
  expect(requireValue(core.read().actors[0]).heat.amount).toBe(1);
});
test('no participant contact means simultaneous attack alone does not cause clash', () => {
  const core = setup();
  attack(core);
  attack(core, 'blue');
  const out = step(core);
  expect(
    out.events.some(
      (e) => e.type === 'ClashResolved' || e.type === 'HpChanged',
    ),
  ).toBe(false);
  expect(requireValue(core.read().actors[0]).hp).toBe(500);
});
test('malformed duplicate catalog IDs rejected instead of silently replacing metadata', () => {
  const fixture = fixtureCatalog();
  expect(() =>
    createCore(
      { runId: run, seed: 1 },
      {
        ...fixture,
        catalog: {
          ...fixture.catalog,
          list: () => [
            ...fixture.catalog.list(),
            requireValue(fixture.catalog.list()[0]),
          ],
        },
        enemyAi: false,
      },
    ).handle({ type: 'AssetsReady', runId: run }),
  ).toThrow();
});
test('catalog validates only at internal readiness after asynchronous pack preparation', () => {
  const fixture = fixtureCatalog();
  let ready = false;
  const core = createCore(
    { runId: run, seed: 1 },
    {
      moves: fixture.moves,
      catalog: {
        get: (id) => (ready ? fixture.catalog.get(id) : undefined),
        list: () => {
          if (!ready) throw new Error('not prepared');
          return fixture.catalog.list();
        },
      },
      enemyAi: false,
    },
  );
  expect(core.read().phase).toBe('loading');
  core.handle({ type: 'StartRequested', runId: run });
  expect(core.read().phase).toBe('loading');
  ready = true;
  core.handle({ type: 'AssetsReady', runId: run });
  expect(core.read().phase).toBe('ready');
});

test.each(['white', 'blue', 'green', 'yellow', 'black'] as const)(
  '%s uses the same seven-start and three-real-second heat policy',
  (color) => {
    const core = setup();
    if (color !== 'white') {
      while (
        requireValue(
          core
            .read()
            .actors.find((a) => a.actorId === core.read().currentOpponentId),
        ).color !== color
      ) {
        for (let i = 0; i < 5; i++) hitOpponent(core);
        advanceCore(core, 1500);
      }
    }
    const actor = () =>
      requireValue(core.read().actors.find((a) => a.color === color));
    for (let i = 1; i <= 7; i++) {
      attack(core, color, 'kick');
      expect(actor().heat.amount).toBe(i);
      expect(actor().attack).not.toBeNull();
      advanceCore(core, 10);
    }
    expect(actor().attack).toBeNull();
    expect(actor().heat.lockedUntil).toBe(
      core.read().clocks.activeRealTimeMs + 3000,
    );
    expect(actor().actions.kick).toMatchObject({
      allowed: false,
      reason: 'cooling-lock',
    });
    advanceCore(core, 3000);
    expect(actor().heat.amount).toBe(0);
    expect(actor().heat.lockedUntil).toBeNull();
    expect(actor().actions.kick.allowed).toBe(true);
  },
);
