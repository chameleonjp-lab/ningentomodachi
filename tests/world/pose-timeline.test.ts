import { expect, test } from 'vitest';
import {
  actorId,
  clipId,
  durationMs,
  gameTimeMs,
  attackActivationId,
  domainEventId,
  batchId,
  presentationTimeMs,
  poseClipTime,
  type ActorState,
  type PoseCatalogBindings,
} from '../../src/contracts';
import { createPoseTimeline } from '../../src/world/pose-timeline';
import { actor, run, state } from './fixtures';
function bindings(): PoseCatalogBindings {
  return {
    version: 1,
    bindingSetId: 'trusted-set',
    clips: ['idle', 'walk', 'run', 'jump', 'attack'].map((name) => ({
      clipId: clipId(name),
      durationMs: durationMs(100),
      sourceBindingId: `source:${name}`,
    })),
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
}
test('loading epochs are pending, binding is atomic and preserves epochs', () => {
  const timeline = createPoseTimeline(run);
  const loading = state(0, { phase: 'loading' });
  timeline.prepareCommit({ snapshot: loading, events: [] }, gameTimeMs(0))();
  expect(timeline.read(actorId('white'))).toBeUndefined();
  const bad = bindings();
  expect(() =>
    timeline.bindPreparedCatalog({ ...bad, clips: bad.clips.slice(1) }),
  ).toThrow();
  expect(timeline.read(actorId('white'))).toBeUndefined();
  const good = bindings();
  timeline.bindPreparedCatalog(good);
  expect(timeline.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'idle', startedAt: 0 },
  });
  timeline.bindPreparedCatalog(good);
  expect(() => timeline.bindPreparedCatalog(bindings())).toThrow();
  expect(Object.isFrozen(timeline.read(actorId('white')))).toBe(true);
});
test('nonloading authority requires binding and disposed timelines reject', () => {
  const timeline = createPoseTimeline(run);
  expect(() =>
    timeline.prepareCommit({ snapshot: state(), events: [] }, gameTimeMs(0)),
  ).toThrow();
  timeline.dispose();
  expect(() => timeline.bindPreparedCatalog(bindings())).toThrow();
});

test('step holds prior mode until end, unchanged mode keeps epoch, exact attack end resumes held mode', () => {
  const timeline = createPoseTimeline(run);
  timeline.bindPreparedCatalog(bindings());
  timeline.prepareCommit({ snapshot: state(), events: [] }, gameTimeMs(0))();
  const move = new Map([[actorId('white'), 'run' as const]]);
  timeline.prepareStep(
    { snapshot: state(1), step: { durationMs: durationMs(20) }, intents: [] },
    move,
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { mode: 'run', startedAt: 20 },
  });
  timeline.prepareCommit({ snapshot: state(1), events: [] }, gameTimeMs(20))();
  timeline.prepareStep(
    { snapshot: state(2), step: { durationMs: durationMs(20) }, intents: [] },
    move,
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { startedAt: 20 },
  });
});

function attacking(at = 20, activation = 'a'): ActorState {
  return {
    ...actor('white'),
    attack: {
      activationId: attackActivationId(activation),
      clipId: clipId('attack'),
      category: 'kick',
      startedAt: gameTimeMs(at),
      consumedImpacts: [],
      impactBindings: [],
    },
  };
}
function death(at: number) {
  return {
    type: 'ActorDefeated' as const,
    actorId: actorId('white'),
    runId: run,
    eventId: domainEventId('death'),
    sequence: 1,
    at: gameTimeMs(at),
    batchId: batchId('batch'),
  };
}
function fallen(): ActorState {
  return {
    ...actor('white'),
    defeated: true,
    hp: 0,
    defeatPresentation: {
      category: 'kick',
      startedAt: presentationTimeMs(99),
      slowDurationMs: durationMs(2000),
      playbackRate: 0.25,
    },
  };
}
function ready() {
  const timeline = createPoseTimeline(run);
  timeline.bindPreparedCatalog(bindings());
  timeline.prepareCommit({ snapshot: state(), events: [] }, gameTimeMs(0))();
  return timeline;
}
test('exact attack end has prior attack left limit at simultaneous death, with durable entry', () => {
  const timeline = ready();
  timeline.prepareCommit(
    { snapshot: state(1, { actors: [attacking()] }), events: [] },
    gameTimeMs(20),
  )();
  timeline.prepareStep(
    {
      snapshot: state(7, { actors: [attacking()] }),
      step: { durationMs: durationMs(120) },
      intents: [],
    },
    new Map([[actorId('white'), 'run']]),
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { mode: 'run', startedAt: 140 },
  });
  const output = {
    snapshot: state(7, { actors: [fallen()] }),
    events: [death(120)],
  };
  timeline.prepareCommit(output, gameTimeMs(140))();
  const entry = timeline.read(actorId('white'))!;
  expect(entry).toMatchObject({
    kind: 'defeat',
    entry: { mode: 'attack', startedAt: 20 },
    entryAt: 120,
    defeatStartedAt: 99,
  });
  if (entry.kind === 'defeat')
    expect(poseClipTime(entry.entry, entry.entryAt, 'left')).toBe(100);
  timeline.prepareCommit({ ...output, events: [] }, gameTimeMs(140))();
  expect(timeline.read(actorId('white'))).toEqual(entry);
});
test('death at locomotion transition uses previous mode and loop left endpoint', () => {
  const timeline = ready();
  timeline.prepareStep(
    { snapshot: state(5), step: { durationMs: durationMs(100) }, intents: [] },
    new Map([[actorId('white'), 'run']]),
  )();
  timeline.prepareCommit(
    { snapshot: state(5, { actors: [fallen()] }), events: [death(100)] },
    gameTimeMs(100),
  )();
  const pose = timeline.read(actorId('white'))!;
  expect(pose).toMatchObject({
    kind: 'defeat',
    entry: { mode: 'idle', startedAt: 0 },
  });
  if (pose.kind === 'defeat')
    expect(poseClipTime(pose.entry, pose.entryAt, 'left')).toBe(100);
});
test('missing death event and activation-own-left sample reject without mutation', () => {
  const timeline = ready();
  const before = timeline.read(actorId('white'));
  expect(() =>
    timeline.prepareCommit(
      { snapshot: state(1, { actors: [fallen()] }), events: [] },
      gameTimeMs(20),
    ),
  ).toThrow();
  expect(() =>
    timeline.prepareCommit(
      { snapshot: state(0, { actors: [fallen()] }), events: [death(0)] },
      gameTimeMs(0),
    ),
  ).toThrow();
  expect(timeline.read(actorId('white'))).toEqual(before);
});
test('survivor cancellation uses event timestamp and held mode, unexplained disappearance rejects', () => {
  const timeline = ready();
  timeline.prepareCommit(
    {
      snapshot: state(1, { actors: [attacking(), actor('blue')] }),
      events: [],
    },
    gameTimeMs(20),
  )();
  const before = timeline.read(actorId('white'));
  expect(() =>
    timeline.prepareCommit({ snapshot: state(2), events: [] }, gameTimeMs(40)),
  ).toThrow();
  expect(timeline.read(actorId('white'))).toEqual(before);
  timeline.prepareCommit(
    {
      snapshot: state(2, {
        actors: [
          actor('white'),
          { ...fallen(), actorId: actorId('blue'), color: 'blue' },
        ],
      }),
      events: [{ ...death(30), actorId: actorId('blue') }],
    },
    gameTimeMs(40),
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { mode: 'idle', startedAt: 30 },
  });
});

test('fractional attack activation and repeated clip restart without rounding', () => {
  const timeline = ready();
  timeline.prepareCommit(
    { snapshot: state(1, { actors: [attacking(0.125)] }), events: [] },
    gameTimeMs(20),
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { startedAt: 0.125, activationId: 'a' },
  });
  timeline.prepareCommit(
    { snapshot: state(6, { actors: [actor('white')] }), events: [] },
    gameTimeMs(120),
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { mode: 'idle', startedAt: 100.125 },
  });
  timeline.prepareCommit(
    { snapshot: state(7, { actors: [attacking(120.125, 'b')] }), events: [] },
    gameTimeMs(140),
  )();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { mode: 'attack', startedAt: 120.125, activationId: 'b' },
  });
});
test('jump and landing switch only at end and same mode does not reset', () => {
  const timeline = ready();
  for (const [n, mode, epoch] of [
    [1, 'jump', 20],
    [2, 'jump', 20],
    [3, 'idle', 60],
  ] as const) {
    const request = {
      snapshot: state(n),
      step: { durationMs: durationMs(20) },
      intents: [],
    };
    const apply = timeline.prepareStep(
      request,
      new Map([[actorId('white'), mode]]),
    );
    expect(timeline.read(actorId('white'))).not.toMatchObject({
      living: { startedAt: n * 20, mode },
    });
    apply();
    expect(timeline.read(actorId('white'))).toMatchObject({
      living: { startedAt: epoch, mode },
    });
    timeline.prepareCommit(
      { snapshot: state(n), events: [] },
      gameTimeMs(n * 20),
    )();
  }
});
test('conflicting death events and unknown death target cannot cancel a survivor', () => {
  const timeline = ready();
  const before = timeline.read(actorId('white'));
  expect(() =>
    timeline.prepareCommit(
      {
        snapshot: state(2, { actors: [fallen()] }),
        events: [death(20), { ...death(30), sequence: 2 }],
      },
      gameTimeMs(40),
    ),
  ).toThrow();
  expect(() =>
    timeline.prepareCommit(
      {
        snapshot: state(2),
        events: [{ ...death(20), actorId: actorId('unknown') }],
      },
      gameTimeMs(40),
    ),
  ).toThrow();
  expect(timeline.read(actorId('white'))).toEqual(before);
});
test('first seen step resident event validates its original epoch in following commit', () => {
  const timeline = ready();
  timeline.prepareStep(
    {
      snapshot: state(1, { actors: [actor('white'), actor('green')] }),
      step: { durationMs: durationMs(20) },
      intents: [],
    },
    new Map(),
  )();
  const change = {
    type: 'OpponentChanged' as const,
    previousActorId: actorId('blue'),
    currentActorId: actorId('green'),
    runId: run,
    eventId: domainEventId('switch'),
    sequence: 1,
    at: gameTimeMs(20),
  };
  expect(() =>
    timeline.prepareCommit(
      {
        snapshot: state(1, { actors: [actor('white'), actor('green')] }),
        events: [change],
      },
      gameTimeMs(20),
    ),
  ).toThrow();
  timeline.prepareCommit(
    {
      snapshot: state(1, { actors: [actor('white'), actor('green')] }),
      events: [{ ...change, at: gameTimeMs(0) }],
    },
    gameTimeMs(20),
  )();
  expect(timeline.read(actorId('green'))).toMatchObject({
    living: { startedAt: 0 },
  });
});

for (const active of [false, true])
  test(`terminal rewind removes future motor-end stamp for ${active ? 'attacking' : 'nonattacking'} survivor`, () => {
    const timeline = ready();
    const survivor = active ? attacking(0) : actor('white');
    if (active)
      timeline.prepareCommit(
        {
          snapshot: state(0, { actors: [survivor, actor('blue')] }),
          events: [],
        },
        gameTimeMs(0),
      )();
    timeline.prepareStep(
      {
        snapshot: state(1, { actors: [survivor, actor('blue')] }),
        step: { durationMs: durationMs(20) },
        intents: [],
      },
      new Map([[actorId('white'), 'run']]),
    )();
    const snapshot = {
      ...state(1, {
        phase: 'terminal',
        actors: [
          actor('white'),
          { ...fallen(), actorId: actorId('blue'), color: 'blue' as const },
        ],
      }),
      clocks: { ...state(1).clocks, gameTimeMs: gameTimeMs(10) },
    };
    const output = {
      snapshot,
      events: [{ ...death(10), actorId: actorId('blue') }],
    };
    const provisional = timeline.read(actorId('white'));
    expect(() =>
      timeline.prepareCommit({ ...output, events: [] }, gameTimeMs(10)),
    ).toThrow();
    expect(timeline.read(actorId('white'))).toEqual(provisional);
    timeline.prepareCommit(output, gameTimeMs(10))();
    const pose = timeline.read(actorId('white'));
    expect(pose).toMatchObject({
      kind: 'living',
      living: { mode: 'idle', startedAt: active ? 10 : 0 },
    });
    timeline.prepareCommit({ ...output, events: [] }, gameTimeMs(10))();
    expect(timeline.read(actorId('white'))).toEqual(pose);
  });
test('exact admitted endpoint keeps motor-end right selection', () => {
  const timeline = ready();
  timeline.prepareStep(
    { snapshot: state(1), step: { durationMs: durationMs(20) }, intents: [] },
    new Map([[actorId('white'), 'run']]),
  )();
  const output = {
    snapshot: state(1, {
      phase: 'terminal',
      actors: [
        actor('white'),
        { ...fallen(), actorId: actorId('blue'), color: 'blue' as const },
      ],
    }),
    events: [{ ...death(20), actorId: actorId('blue') }],
  };
  timeline.prepareCommit(output, gameTimeMs(20))();
  expect(timeline.read(actorId('white'))).toMatchObject({
    living: { mode: 'run', startedAt: 20 },
  });
});

for (const active of [false, true])
  for (const at of [10, 20])
    for (const terminal of [false, true])
      test(`repeated authoritative commit stable: attack=${active}, death=${at}, terminal=${terminal}`, () => {
        const timeline = ready();
        const survivor = active ? attacking(0) : actor('white');
        if (active)
          timeline.prepareCommit(
            {
              snapshot: state(0, { actors: [survivor, actor('blue')] }),
              events: [],
            },
            gameTimeMs(0),
          )();
        timeline.prepareStep(
          {
            snapshot: state(1, { actors: [survivor, actor('blue')] }),
            step: { durationMs: durationMs(20) },
            intents: [],
          },
          new Map([[actorId('white'), 'run']]),
        )();
        const now = terminal ? at : 20;
        const snapshot = {
          ...state(1, {
            phase: terminal ? ('terminal' as const) : ('running' as const),
            actors: [
              actor('white'),
              { ...fallen(), actorId: actorId('blue'), color: 'blue' as const },
            ],
          }),
          clocks: { ...state(1).clocks, gameTimeMs: gameTimeMs(now) },
        };
        const output = {
          snapshot,
          events: [{ ...death(at), actorId: actorId('blue') }],
        };
        timeline.prepareCommit(output, gameTimeMs(now))();
        const first = timeline.read(actorId('white'));
        expect(first).toMatchObject({
          kind: 'living',
          living: {
            mode: now === 20 ? 'run' : 'idle',
            startedAt: now === 20 ? 20 : active ? at : 0,
          },
        });
        timeline.prepareCommit(output, gameTimeMs(now))();
        expect(timeline.read(actorId('white'))).toEqual(first);
        timeline.prepareCommit({ ...output, events: [] }, gameTimeMs(now))();
        expect(timeline.read(actorId('white'))).toEqual(first);
      });
