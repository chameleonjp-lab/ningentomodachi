import { expect, test } from 'vitest';
import {
  type ActorState,
  actorId,
  attackActivationId,
  batchId,
  clipId,
  domainEventId,
  durationMs,
  gameTimeMs,
  type PoseCatalogBindings,
  poseClipTime,
  presentationTimeMs,
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
  if (entry.kind === 'defeat' && !('kind' in entry.entry))
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
  if (pose.kind === 'defeat' && !('kind' in pose.entry))
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

const recoveryPolicy = {
  version: 1,
  protocol: 'kungfu-recovery-epoch-diagnostic-v1',
  durationMs: durationMs(150),
  fixedLiftSign: 1,
} as const;
function recoveryReady() {
  const t = createPoseTimeline(run, recoveryPolicy),
    b = bindings();
  const names: Record<string, string> = {
    idle: 'Idle',
    attack: 'KungFuStraight',
  };
  t.bindPreparedCatalog({
    ...b,
    clips: b.clips.map((c) => ({
      ...c,
      clipId: clipId(names[c.clipId] ?? c.clipId),
    })),
    locomotion: { ...b.locomotion, idle: clipId('Idle') },
  });
  t.prepareCommit({ snapshot: state(), events: [] }, gameTimeMs(0))();
  const original = attacking(20);
  const a = {
    ...original,
    attack: { ...original.attack!, clipId: clipId('KungFuStraight') },
  };
  t.prepareCommit(
    { snapshot: state(1, { actors: [a, actor('blue')] }), events: [] },
    gameTimeMs(20),
  )();
  return { t, a };
}
function recoveredStep(
  t: ReturnType<typeof createPoseTimeline>,
  a: ActorState,
  to = 140,
  mode: 'idle' | 'walk' | 'run' | 'jump' = 'idle',
) {
  const snapshot = state(to / 20, { actors: [a, actor('blue')] });
  return t.prepareStep(
    { snapshot, step: { durationMs: durationMs(to - 20) }, intents: [] },
    new Map([[actorId('white'), mode]]),
  );
}
test('diagnostic natural completion is C-owned exact epoch and preparation has no effects', () => {
  const { t, a } = recoveryReady(),
    install = recoveredStep(t, a);
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'attack' },
  });
  install();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'recovery',
    epoch: {
      startMs: 120,
      endMs: 270,
      destination: { startedAt: 120 },
      outgoing: { activationId: 'a' },
    },
  });
  expect(t.recoveryCapability).toEqual(recoveryPolicy);
});
test('recovery survives skipped draws then completes without restarting Idle', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a)();
  t.prepareCommit(
    {
      snapshot: state(7, { actors: [actor('white'), actor('blue')] }),
      events: [],
    },
    gameTimeMs(140),
  )();
  t.prepareStep(
    { snapshot: state(20), step: { durationMs: durationMs(260) }, intents: [] },
    new Map(),
  )();
  t.prepareCommit({ snapshot: state(20), events: [] }, gameTimeMs(400))();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'idle', startedAt: 120 },
  });
});
test.each(['walk', 'run', 'jump'] as const)(
  'recovery interruption to %s is immediate canonical with original boundary',
  (mode) => {
    const { t, a } = recoveryReady();
    recoveredStep(t, a, 140, mode)();
    expect(t.read(actorId('white'))).toMatchObject({
      kind: 'living',
      living: { mode, startedAt: 140 },
    });
  },
);
test('inside-step finalization removes future recovery and restores exact attack authority', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a, 200)();
  t.prepareCommit(
    { snapshot: state(5, { actors: [a, actor('blue')] }), events: [] },
    gameTimeMs(100),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'attack', startedAt: 20 },
  });
});
test.each([120, 160, 270])(
  'death at recovery boundary/interior %s retains exact left entry',
  (at) => {
    const { t, a } = recoveryReady();
    recoveredStep(t, a, 300)();
    const snapshot = {
      ...state(15, { actors: [fallen(), actor('blue')] }),
      clocks: { ...state(15).clocks, gameTimeMs: gameTimeMs(at) },
    };
    t.prepareCommit({ snapshot, events: [death(at)] }, gameTimeMs(at))();
    const d = t.read(actorId('white'));
    expect(d).toMatchObject({
      kind: 'defeat',
      entryAt: at,
      defeatStartedAt: 99,
    });
    if (d?.kind !== 'defeat') throw Error('Missing defeat');
    if (at === 120)
      expect(d.entry).toMatchObject({ mode: 'attack', startedAt: 20 });
    else
      expect(d.entry).toMatchObject({
        kind: 'recovery',
        startMs: 120,
        endMs: 270,
      });
    t.prepareCommit({ snapshot, events: [] }, gameTimeMs(at))();
    expect(t.read(actorId('white'))).toEqual(d);
  },
);
test('new attack immediately interrupts recovery without changing its activation clock', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a)();
  const next = {
    ...a,
    attack: {
      ...a.attack!,
      activationId: attackActivationId('second'),
      startedAt: gameTimeMs(160),
    },
  };
  t.prepareCommit(
    { snapshot: state(8, { actors: [next, actor('blue')] }), events: [] },
    gameTimeMs(160),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'attack', startedAt: 160, activationId: 'second' },
  });
});
test('encounter cancellation interrupts recovery to canonical rather than manufacturing new recovery', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a)();
  const blue = {
    ...fallen(),
    actorId: actorId('blue'),
    color: 'blue' as const,
  };
  t.prepareCommit(
    {
      snapshot: state(8, { actors: [actor('white'), blue] }),
      events: [{ ...death(160), actorId: actorId('blue') }],
    },
    gameTimeMs(160),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'idle', startedAt: 160 },
  });
});
test('stale prepared closure cannot resurrect an earlier recipe state', () => {
  const { t, a } = recoveryReady(),
    old = recoveredStep(t, a),
    fresh = recoveredStep(t, a, 160);
  fresh();
  expect(() => old()).toThrow('Stale');
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'recovery',
    epoch: { startMs: 120 },
  });
});
test('retired actor cannot reacquire a recipe and disposed reads reject', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a)();
  t.prepareCommit(
    { snapshot: state(8, { actors: [actor('blue')] }), events: [] },
    gameTimeMs(160),
  )();
  expect(() =>
    t.prepareCommit({ snapshot: state(9), events: [] }, gameTimeMs(180)),
  ).toThrow();
  t.dispose();
  expect(() => t.read(actorId('white'))).toThrow('disposed');
});

test('cancelled tentative preparation and failed validation cannot create a recovery epoch', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a);
  expect(() =>
    t.prepareCommit(
      {
        snapshot: state(8, { actors: [a, actor('blue')] }),
        events: [{ ...death(170), actorId: actorId('missing') }],
      },
      gameTimeMs(160),
    ),
  ).toThrow();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'attack' },
  });
});
test('repeated activations retain only the current admitted recovery identity', () => {
  const { t, a } = recoveryReady();
  for (let i = 0; i < 12; i++) {
    const start = 20 + i * 120;
    const next = {
      ...a,
      attack: {
        ...a.attack!,
        activationId: attackActivationId(`series:${i}`),
        startedAt: gameTimeMs(start),
      },
    };
    t.prepareCommit(
      {
        snapshot: state(start / 20, { actors: [next, actor('blue')] }),
        events: [],
      },
      gameTimeMs(start),
    )();
    const end = start + 100;
    t.prepareStep(
      {
        snapshot: state(end / 20, { actors: [next, actor('blue')] }),
        step: { durationMs: durationMs(100) },
        intents: [],
      },
      new Map(),
    )();
    t.prepareCommit(
      { snapshot: state(end / 20), events: [] },
      gameTimeMs(end),
    )();
    expect(t.read(actorId('white'))).toMatchObject({
      kind: 'recovery',
      epoch: { startMs: end, outgoing: { activationId: `series:${i}` } },
    });
  }
});

test('inside-step finalization during recovery removes future locomotion but retains active recipe', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a, 200, 'walk')();
  t.prepareCommit({ snapshot: state(8), events: [] }, gameTimeMs(160))();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'recovery',
    epoch: { startMs: 120, endMs: 270 },
  });
});
test('death exactly at canonical interruption preserves preceding recovery left limit', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a, 140, 'walk')();
  t.prepareCommit(
    {
      snapshot: state(7, { actors: [fallen(), actor('blue')] }),
      events: [death(140)],
    },
    gameTimeMs(140),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'defeat',
    entry: { kind: 'recovery', startMs: 120 },
    entryAt: 140,
  });
});
test('encounter cancellation before natural endpoint never manufactures recovery', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a, 140)();
  const blue = {
    ...fallen(),
    actorId: actorId('blue'),
    color: 'blue' as const,
  };
  const snapshot = {
    ...state(7, { actors: [actor('white'), blue] }),
    clocks: { ...state(7).clocks, gameTimeMs: gameTimeMs(100) },
  };
  t.prepareCommit(
    { snapshot, events: [{ ...death(100), actorId: actorId('blue') }] },
    gameTimeMs(100),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'idle', startedAt: 100 },
  });
});

test.each([119, 120, 121, 160])(
  'review regression: authoritative cancellation at %s never re-matches recovery on right',
  (at) => {
    const { t, a } = recoveryReady();
    recoveredStep(t, a, 200)();
    const blue = {
      ...fallen(),
      actorId: actorId('blue'),
      color: 'blue' as const,
    };
    const snapshot = {
      ...state(10, { actors: [actor('white'), blue] }),
      clocks: { ...state(10).clocks, gameTimeMs: gameTimeMs(at) },
    };
    t.prepareCommit(
      { snapshot, events: [{ ...death(at), actorId: actorId('blue') }] },
      gameTimeMs(at),
    )();
    expect(t.read(actorId('white'))).toMatchObject({
      kind: 'living',
      living: { mode: 'idle', startedAt: at },
    });
    // A same-boundary authoritative death still requires the historical LEFT pose.
    const dead = { ...snapshot, actors: [fallen(), blue] };
    t.prepareCommit({ snapshot: dead, events: [death(at)] }, gameTimeMs(at))();
    const entry = t.read(actorId('white'));
    expect(entry).toMatchObject({ kind: 'defeat', entryAt: at });
    if (at <= 120)
      expect(entry).toMatchObject({ entry: { mode: 'attack', startedAt: 20 } });
    else
      expect(entry).toMatchObject({
        entry: { kind: 'recovery', startMs: 120 },
      });
  },
);

test('cancelled right selection retains composite left entry through next provisional step rollback', () => {
  const { t, a } = recoveryReady();
  recoveredStep(t, a, 200)();
  const blue = {
    ...fallen(),
    actorId: actorId('blue'),
    color: 'blue' as const,
  };
  const live = state(8, { actors: [actor('white'), blue] });
  t.prepareCommit(
    { snapshot: live, events: [{ ...death(160), actorId: actorId('blue') }] },
    gameTimeMs(160),
  )();
  t.prepareStep(
    {
      snapshot: state(10, { actors: live.actors }),
      step: { durationMs: durationMs(40) },
      intents: [],
    },
    new Map([[actorId('white'), 'walk']]),
  )();
  t.prepareCommit(
    { snapshot: { ...live, actors: [fallen(), blue] }, events: [death(160)] },
    gameTimeMs(160),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'defeat',
    entryAt: 160,
    entry: { kind: 'recovery', startMs: 120, endMs: 270 },
  });
});

import {
  STARTUP_SOURCES,
  type StartupTimelinePolicy,
  resolvePoseEpoch,
} from '../../src/contracts';
const startup: StartupTimelinePolicy = {
  version: 1,
  protocol: 'side-kick-startup-matrix-v1',
  durationMs: durationMs(100),
  fixedLiftSign: 1,
};
const startupBasis = new Map([
  [
    actorId('white'),
    {
      authority: 'activation-stance-v1' as const,
      oldYaw: 0,
      admittedYaw: Math.PI / 2,
    },
  ],
]);
function startupReady() {
  const t = createPoseTimeline(run, undefined, startup);
  const b = bindings();
  t.bindPreparedCatalog({
    ...b,
    clips: [
      ...b.clips.filter((x) => x.clipId !== 'idle'),
      {
        clipId: clipId('Idle'),
        durationMs: durationMs(100),
        sourceBindingId: 'idle-source',
      },
      STARTUP_SOURCES.SideKick.binding,
      STARTUP_SOURCES.SideThrustKick.binding,
    ],
    locomotion: { ...b.locomotion, idle: clipId('Idle') },
  });
  t.prepareCommit({ snapshot: state(), events: [] }, gameTimeMs(0))();
  return t;
}
function startupActor(at = 20, activation = 's') {
  const a = attacking(at, activation);
  return { ...a, attack: { ...a.attack!, clipId: clipId('SideKick') } };
}
function startupStep(
  t: ReturnType<typeof startupReady>,
  to: number,
  a = startupActor(),
  held: 'idle' | 'walk' = 'idle',
) {
  const snap = {
    ...state(1, { actors: [a, actor('blue')] }),
    clocks: { ...state(1).clocks, gameTimeMs: gameTimeMs(to) },
  };
  t.prepareStep(
    { snapshot: snap, step: { durationMs: durationMs(to - 20) }, intents: [] },
    new Map([[a.actorId, held]]),
    startupBasis,
  )();
  return snap;
}
test('startup timeline selects exact activation prior left stamp and expires on original source clock', () => {
  const t = startupReady();
  const s = startupStep(t, 40);
  const read = t.read(actorId('white'));
  expect(read).toMatchObject({
    kind: 'startup',
    epoch: {
      startMs: 20,
      endMs: 120,
      outgoing: { startedAt: 0 },
      destination: { startedAt: 20 },
    },
  });
  t.prepareCommit({ snapshot: s, events: [] }, gameTimeMs(40))();
  startupStep(t, 120);
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { startedAt: 20, mode: 'attack' },
  });
  expect(
    read?.kind === 'startup' &&
      resolvePoseEpoch(read.epoch, gameTimeMs(60), 'right'),
  ).toMatchObject({ sourceClipTime: 40 });
});
test('startup prepare is uncommitted until install and stale install rejects', () => {
  const t = startupReady(),
    s = state(2, { actors: [startupActor(), actor('blue')] });
  const install = t.prepareStep(
    { snapshot: s, step: { durationMs: durationMs(20) }, intents: [] },
    new Map(),
    startupBasis,
  );
  expect(t.read(actorId('white'))?.kind).toBe('living');
  install();
  expect(t.read(actorId('white'))?.kind).toBe('startup');
  expect(install).toThrow('Stale');
});
test('startup unqualified moving or missing-basis selections are explicit canonical, not smooth fallback', () => {
  for (const moving of [false, true]) {
    const t = startupReady();
    if (moving)
      t.prepareStep(
        {
          snapshot: state(1),
          step: { durationMs: durationMs(20) },
          intents: [],
        },
        new Map([[actorId('white'), 'walk']]),
      )();
    t.prepareStep(
      {
        snapshot: state(2, { actors: [startupActor(30), actor('blue')] }),
        step: { durationMs: durationMs(20) },
        intents: [],
      },
      new Map(),
      moving ? startupBasis : undefined,
    )();
    expect(t.read(actorId('white'))).toMatchObject({
      kind: 'living',
      startupQualification: 'unqualified-outgoing-or-basis',
    });
  }
});
test('startup inside-step finalization rolls back future attack and composite selection', () => {
  const t = startupReady();
  startupStep(t, 40, startupActor(30));
  const s = {
    ...state(),
    clocks: { ...state().clocks, gameTimeMs: gameTimeMs(25) },
  };
  t.prepareCommit({ snapshot: s, events: [] }, gameTimeMs(25))();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'idle' },
  });
});
test('startup strict-left death retains layer recipe at start/interior/end', () => {
  for (const at of [20, 50, 120]) {
    const t = startupReady();
    startupStep(t, 140);
    const a = {
      ...actor('white'),
      defeated: true,
      hp: 0,
      defeatPresentation: {
        startedAt: presentationTimeMs(900),
        category: 'kick' as const,
        slowDurationMs: durationMs(1500),
        playbackRate: 0.25 as const,
      },
    };
    const s = {
      ...state(7, { actors: [a, actor('blue')] }),
      clocks: { ...state(7).clocks, gameTimeMs: gameTimeMs(at) },
    };
    t.prepareCommit({ snapshot: s, events: [death(at)] }, gameTimeMs(at))();
    expect(t.read(actorId('white'))).toMatchObject({
      kind: 'defeat',
      entry: {
        kind: 'startup',
        deathLayerPolicy: 'freeze-entry-through-local-death-v1',
      },
      entryAt: at,
      defeatStartedAt: 900,
    });
  }
});
test('startup cancellation replaces right selection without erasing strict-left entry', () => {
  const t = startupReady();
  startupStep(t, 100);
  const blue = {
    ...actor('blue'),
    defeated: true,
    hp: 0,
    defeatPresentation: {
      startedAt: presentationTimeMs(50),
      category: 'kick' as const,
      slowDurationMs: durationMs(1500),
      playbackRate: 0.25 as const,
    },
  };
  const s = {
    ...state(3, { actors: [actor('white'), blue] }),
    clocks: { ...state(3).clocks, gameTimeMs: gameTimeMs(50) },
  };
  t.prepareCommit(
    { snapshot: s, events: [{ ...death(50), actorId: blue.actorId }] },
    gameTimeMs(50),
  )();
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    living: { mode: 'idle', startedAt: 50 },
  });
});
test('startup resident retirement rejects resurrection and disposal rejects all reads', () => {
  const t = startupReady();
  const s = startupStep(t, 40);
  t.prepareCommit(
    { snapshot: { ...s, residentActorIds: [actorId('blue')] }, events: [] },
    gameTimeMs(40),
  )();
  expect(t.read(actorId('white'))).toBeUndefined();
  expect(() =>
    t.prepareCommit({ snapshot: s, events: [] }, gameTimeMs(40)),
  ).toThrow();
  t.dispose();
  expect(() => t.read(actorId('white'))).toThrow();
});
test('startup cancellation at exact start and endpoint never rematches a right-side recipe', () => {
  for (const at of [20, 120]) {
    const t = startupReady();
    startupStep(t, 140);
    const blue = {
      ...actor('blue'),
      defeated: true,
      hp: 0,
      defeatPresentation: {
        startedAt: presentationTimeMs(at),
        category: 'kick' as const,
        slowDurationMs: durationMs(1500),
        playbackRate: 0.25 as const,
      },
    };
    const s = {
      ...state(7, { actors: [actor('white'), blue] }),
      clocks: { ...state(7).clocks, gameTimeMs: gameTimeMs(at) },
    };
    t.prepareCommit(
      { snapshot: s, events: [{ ...death(at), actorId: blue.actorId }] },
      gameTimeMs(at),
    )();
    expect(t.read(actorId('white'))).toMatchObject({
      kind: 'living',
      living: { mode: 'idle', startedAt: at },
    });
  }
});
test('startup fresh attack during composite is immediately canonical and explicitly unqualified', () => {
  const t = startupReady();
  startupStep(t, 40);
  startupStep(t, 60, startupActor(50, 'second'));
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    startupQualification: 'unqualified-outgoing-or-basis',
    living: { startedAt: 50, activationId: 'second' },
  });
});
test('startup skipped observations preserve active epoch and immutable replay after end', () => {
  const t = startupReady();
  startupStep(t, 40);
  const saved = t.read(actorId('white'));
  startupStep(t, 110);
  expect(t.read(actorId('white'))).toEqual(saved);
  startupStep(t, 160);
  expect(t.read(actorId('white'))?.kind).toBe('living');
  expect(
    saved?.kind === 'startup' &&
      resolvePoseEpoch(saved.epoch, gameTimeMs(40), 'right'),
  ).toMatchObject({ weight: 0.2, sourceClipTime: 20 });
});
test('startup SideThrust selects its exact original duration and pre-active source clock', () => {
  const t = startupReady(),
    a = startupActor();
  const thrust = {
    ...a,
    attack: { ...a.attack!, clipId: clipId('SideThrustKick') },
  };
  startupStep(t, 80, thrust);
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'startup',
    epoch: {
      firstActiveAt: 775.5555701255798,
      destination: { binding: { durationMs: 1577.7777433395386 } },
    },
  });
});
test('startup activation at resident origin is explicitly unqualified without invented left history', () => {
  const t = startupReady();
  startupStep(t, 20, startupActor(0));
  expect(t.read(actorId('white'))).toMatchObject({
    kind: 'living',
    startupQualification: 'unqualified-outgoing-or-basis',
  });
});
