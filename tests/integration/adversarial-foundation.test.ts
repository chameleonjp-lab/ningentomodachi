import { expect, test } from 'vitest';
import { bootstrap, type BrowserHost } from '../../src/app/bootstrap';
import { createGame } from '../../src/app/createGame';
import {
  actorId,
  batchId,
  contactId,
  domainEventId,
  gameTimeMs,
  worldObjectId,
  runId,
  type CommittedFrame,
} from '../../src/contracts';
import { createFixturePorts } from '../core/fixtures/ports';
import { createScriptedCore } from '../core/fixtures/scriptedCore';
function browserFixture() {
  let callback: ((now: number) => void) | undefined;
  const host: BrowserHost = {
    requestFrame: (listener) => {
      callback = listener;
      return 1;
    },
    cancelFrame: () => {
      callback = undefined;
    },
    subscribe: () => () => {},
  };
  return {
    host,
    frame: (now: number) => {
      const listener = callback;
      callback = undefined;
      listener?.(now);
    },
  };
}
test('pause+resume between callbacks discards the crossing interval but ordinary backlog remains', async () => {
  const fixture = createFixturePorts();
  const browser = browserFixture();
  const game = createGame(fixture.factories, {
    sessionId: 'continuity',
    seed: 1,
    stepMs: 10,
    maxStepsPerFrame: 1000,
  });
  const binding = bootstrap(game, browser.host);
  await binding.ready;
  const run = game.read();
  if (!run) throw new Error('Missing run');
  game.dispatch({ type: 'StartRequested', runId: run.runId });
  browser.frame(0);
  browser.frame(10);
  expect(game.read()?.clocks.tick).toBe(1);
  game.dispatch({
    type: 'PauseRequested',
    runId: run.runId,
    reason: 'settings',
  });
  game.dispatch({
    type: 'ResumeRequested',
    runId: run.runId,
    reason: 'settings',
  });
  browser.frame(1010);
  expect(game.read()?.clocks.tick).toBe(1);
  expect(game.read()?.clocks.presentationTimeMs).toBe(10);
  browser.frame(2010);
  expect(game.read()?.clocks.tick).toBe(101);
  binding.dispose();
});
test('Start excludes the ready idle interval even without an intermediate RAF', async () => {
  const browser = browserFixture();
  const game = createGame(createFixturePorts().factories, {
    sessionId: 'ready-clock',
    seed: 1,
    stepMs: 10,
  });
  const binding = bootstrap(game, browser.host);
  await binding.ready;
  browser.frame(0);
  game.request({ type: 'StartRequested', requestId: 'start' });
  browser.frame(1000);
  expect(game.read()?.clocks.tick).toBe(0);
  expect(game.read()?.clocks.activeRealTimeMs).toBe(0);
  browser.frame(1010);
  expect(game.read()?.clocks.tick).toBe(1);
  binding.dispose();
});
test('active real elapsed is independent of sub-tick and capped fixed-step backlog', async () => {
  const game = createGame(createFixturePorts().factories, {
    sessionId: 'real-clock',
    seed: 1,
    stepMs: 10,
    maxStepsPerFrame: 1,
  });
  await game.start();
  const run = game.read();
  if (!run) throw new Error('Missing run');
  game.advance(500);
  expect(game.read()?.clocks.activeRealTimeMs).toBe(0);
  game.request({ type: 'StartRequested', requestId: 'start' });
  game.advance(5);
  expect(game.read()?.clocks.activeRealTimeMs).toBe(5);
  game.advance(1000);
  expect(game.read()?.clocks).toMatchObject({
    tick: 1,
    gameTimeMs: 10,
    activeRealTimeMs: 1005,
  });
  game.advance(0);
  expect(game.read()?.clocks).toMatchObject({
    tick: 2,
    gameTimeMs: 20,
    activeRealTimeMs: 1005,
  });
  game.dispatch({
    type: 'PauseRequested',
    runId: run.runId,
    reason: 'settings',
  });
  game.advance(1000);
  game.dispatch({ type: 'Backgrounded', runId: run.runId });
  game.advance(1000);
  expect(game.read()?.clocks.activeRealTimeMs).toBe(1005);
  game.dispose();
});
for (const failing of ['cancel', 'lifecycle', 'viewport'] as const)
  test(`bootstrap cleanup attempts all resources when ${failing} fails`, async () => {
    const calls: string[] = [];
    const browser = browserFixture();
    const game = createGame(createFixturePorts().factories, {
      sessionId: `cleanup-${failing}`,
      seed: 1,
    });
    const attempt = (name: string) => {
      calls.push(name);
      if (name === failing) throw new Error(`${name} failed`);
    };
    const host: BrowserHost = {
      ...browser.host,
      cancelFrame: () => attempt('cancel'),
      subscribe: () => () => attempt('lifecycle'),
      viewport: {
        read: () => ({
          widthCssPx: 1,
          heightCssPx: 1,
          offsetLeftCssPx: 0,
          offsetTopCssPx: 0,
          devicePixelRatio: 1,
          safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
        }),
        subscribe: () => () => attempt('viewport'),
      },
    };
    const binding = bootstrap(game, host);
    await binding.ready;
    expect(() => binding.dispose()).toThrow();
    expect(calls).toEqual(['cancel', 'lifecycle', 'viewport']);
    expect(game.hostState().phase).toBe('disposed');
    binding.dispose();
    expect(calls).toHaveLength(3);
  });
test('public input and host cannot assert AssetsReady while the current catalog is pending', async () => {
  const fixture = createFixturePorts();
  const catalog = fixture.factories.catalog;
  let finish: (() => void) | undefined;
  const game = createGame(
    {
      ...fixture.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      }),
    },
    { sessionId: 'provenance', seed: 1, stepMs: 10 },
  );
  const pending = game.start();
  const run = game.read();
  if (!run) throw new Error('Missing run');
  // Serialized adapter traffic deliberately probes the runtime boundary, not just TypeScript.
  const forged = JSON.stringify({ type: 'AssetsReady', runId: run.runId });
  fixture.emit(JSON.parse(forged));
  fixture.emit({ type: 'StartRequested', runId: run.runId });
  game.advance(10);
  expect(game.read()?.phase).toBe('loading');
  expect(game.read()?.clocks.tick).toBe(0);
  game.request({
    type: 'CommandRequested',
    requestId: 'forged-ready',
    command: JSON.parse(forged),
  });
  game.request({ type: 'StartRequested', requestId: 'early-start' });
  game.advance(10);
  expect(game.read()?.phase).toBe('loading');
  finish?.();
  await pending;
  expect(game.read()?.phase).toBe('ready');
  game.request({ type: 'StartRequested', requestId: 'valid-start' });
  game.advance(10);
  expect(game.read()?.clocks.tick).toBe(1);
  game.dispose();
});
test('committed populated DTOs detach/freeze nested producer state before publication', async () => {
  const fixture = createFixturePorts();
  const spatial = fixture.factories.spatial;
  let scripted: ReturnType<typeof createScriptedCore> | undefined;
  const frames: CommittedFrame[] = [];
  const position = { x: 1, y: 0, z: 2 };
  const hit = { x: 3, y: 1, z: 4 };
  const world = {
    vehicles: [],
    objects: [
      {
        objectId: worldObjectId('street'),
        durability: 10,
        maxDurability: 10,
        destroyed: false,
      },
    ],
  };
  const game = createGame(
    {
      ...fixture.factories,
      core: (context) => {
        scripted = createScriptedCore(context);
        return scripted.core;
      },
      spatial: (context) => ({
        ...spatial(context),
        commit: (output) => ({
          runId: context.runId,
          tick: output.snapshot.clocks.tick,
          actors: [
            {
              actorId: actorId('white'),
              position,
              facing: { x: 0, y: 0, z: 1 },
              velocity: { x: 0, y: 0, z: 0 },
              grounded: true,
              locomotion: 'idle',
            },
          ],
          vehicles: [],
        }),
      }),
      ui: () => ({ render: (frame) => frames.push(frame), dispose: () => {} }),
    },
    { sessionId: 'immutable', seed: 1 },
  );
  await game.start();
  const run = game.read();
  if (!run || !scripted) throw new Error('Missing run');
  scripted.script({ world }, [
    {
      type: 'ClashResolved',
      eventId: domainEventId('clash'),
      runId: run.runId,
      sequence: 10,
      at: gameTimeMs(0),
      firstActorId: actorId('white'),
      secondActorId: actorId('blue'),
      difference: 0,
      batchId: batchId('batch'),
      contact: { contactId: contactId('contact'), point: hit, impacts: [] },
    },
  ]);
  game.advance(0);
  const frame = frames.at(-1);
  const host = game.hostState();
  if (!frame) throw new Error('Missing frame');
  const object = world.objects[0];
  if (!object) throw new Error('Missing object');
  object.durability = 0;
  position.x = 99;
  hit.x = 88;
  expect(frame.snapshot.world.objects[0]?.durability).toBe(10);
  expect(host.game?.world.objects[0]?.durability).toBe(10);
  expect(frame.spatial.actors[0]?.position.x).toBe(1);
  const event = frame.events.find((entry) => entry.type === 'ClashResolved');
  expect(event?.contact.point.x).toBe(3);
  expect(Object.isFrozen(frame.snapshot.world.objects[0])).toBe(true);
  expect(Object.isFrozen(frame.spatial.actors[0]?.position)).toBe(true);
  expect(Object.isFrozen(event?.contact.point)).toBe(true);
  game.dispose();
});
test('B animation gets a public C-owned render host rather than a private scene side channel', async () => {
  const fixture = createFixturePorts();
  const animation = fixture.factories.animation;
  const game = createGame(
    {
      ...fixture.factories,
      animation: (context) => {
        expect('renderHost' in context).toBe(true);
        return animation(context);
      },
    },
    { sessionId: 'composition', seed: 1 },
  );
  await game.start();
  game.dispose();
});

test('public generic model host binds B pose to C anchor/one draw and detaches before host disposal', async () => {
  const { createFixtureRenderHost } = await import(
    '../core/fixtures/renderHost'
  );
  const fixture = createFixturePorts();
  const spatial = fixture.factories.spatial;
  const trace: string[] = [];
  const node = { label: 'B-skeleton', poseRevision: -1, disposed: false };
  let renderer: ReturnType<typeof createFixtureRenderHost> | undefined;
  let detach: (() => void) | undefined;
  let mounts = 0;
  let observedX = 0;
  let observedPose = -1;
  const game = createGame(
    {
      ...fixture.factories,
      spatial: (context) => {
        const base = spatial(context);
        const host = createFixtureRenderHost(context);
        renderer = host;
        return {
          ...base,
          renderHost: host.port,
          commit: (output) => {
            trace.push('C.commit');
            const result = base.commit(output, context.viewport.read());
            const actors = [
              {
                actorId: actorId('white'),
                position: { x: 2, y: 0, z: 3 },
                facing: { x: 0, y: 0, z: 1 },
                velocity: { x: 0, y: 0, z: 0 },
                grounded: true,
                locomotion: 'idle' as const,
              },
            ];
            host.commit(actors);
            return { ...result, actors };
          },
          render: (frame) => {
            trace.push('C.draw');
            expect(host.attachments.size).toBe(1);
            const attachment = host.attachments.get(actorId('white'));
            observedX = attachment?.position?.x ?? -1;
            observedPose = attachment?.node.poseRevision ?? -1;
            expect(observedPose).toBe(frame.snapshot.revision);
          },
          dispose: () => {
            trace.push('C.dispose');
            expect(host.attachments.size).toBe(0);
            expect(node.disposed).toBe(true);
            host.dispose();
            base.dispose();
          },
        };
      },
      animation: (context) => {
        expect(() =>
          context.renderHost.mountActor({
            runId: runId('wrong-run'),
            actorId: actorId('white'),
            node,
          }),
        ).toThrow();
        detach = context.renderHost.mountActor({
          runId: context.runId,
          actorId: actorId('white'),
          node,
        });
        mounts++;
        expect(() =>
          context.renderHost.mountActor({
            runId: context.runId,
            actorId: actorId('white'),
            node,
          }),
        ).toThrow('duplicate');
        return {
          render: (frame) => {
            trace.push('B.pose');
            node.poseRevision = frame.snapshot.revision;
          },
          dispose: () => {
            trace.push('B.dispose');
            detach?.();
            detach?.();
            node.disposed = true;
          },
        };
      },
    },
    { sessionId: 'render-binding', seed: 1, stepMs: 10 },
  );
  await game.start();
  game.request({ type: 'StartRequested', requestId: 'start' });
  trace.length = 0;
  game.advance(10);
  expect(trace).toEqual(['C.commit', 'B.pose', 'C.draw']);
  expect(observedX).toBe(2);
  expect(observedPose).toBeGreaterThan(0);
  expect(mounts).toBe(1);
  game.dispose();
  expect(trace.slice(-2)).toEqual(['B.dispose', 'C.dispose']);
  expect(renderer?.attachments.size).toBe(0);
  const run = renderer?.port.runId;
  if (!renderer || !run) throw new Error('Missing host');
  const closed = renderer;
  expect(() =>
    closed.port.mountActor({ runId: run, actorId: actorId('white'), node }),
  ).toThrow();
});

test('accepted sweep backlog survives pause/resume without charging paused or zero-elapsed real time', async () => {
  const browser = browserFixture();
  const game = createGame(createFixturePorts().factories, {
    sessionId: 'retained-pause-backlog',
    seed: 1,
    stepMs: 10,
    maxStepsPerFrame: 1,
  });
  const binding = bootstrap(game, browser.host);
  await binding.ready;
  const run = game.read();
  if (!run) throw new Error('Missing run');
  game.request({ type: 'StartRequested', requestId: 'start' });
  browser.frame(0);
  browser.frame(100);
  expect(game.read()?.clocks).toMatchObject({
    tick: 1,
    gameTimeMs: 10,
    activeRealTimeMs: 100,
  });
  game.dispatch({
    type: 'PauseRequested',
    runId: run.runId,
    reason: 'settings',
  });
  browser.frame(1100);
  browser.frame(2100);
  expect(game.read()?.clocks).toMatchObject({
    tick: 1,
    gameTimeMs: 10,
    activeRealTimeMs: 100,
  });
  game.dispatch({
    type: 'ResumeRequested',
    runId: run.runId,
    reason: 'settings',
  });
  browser.frame(3100);
  expect(game.read()?.clocks.tick).toBe(1);
  for (let index = 0; index < 9; index++) game.advance(0);
  expect(game.read()?.clocks).toMatchObject({
    tick: 10,
    gameTimeMs: 100,
    activeRealTimeMs: 100,
  });
  browser.frame(3110);
  expect(game.read()?.clocks).toMatchObject({
    tick: 11,
    gameTimeMs: 110,
    activeRealTimeMs: 110,
  });
  binding.dispose();
});

test('failed unsubscription cannot reactivate disposed host state through a late viewport callback', async () => {
  const browser = browserFixture();
  const game = createGame(createFixturePorts().factories, {
    sessionId: 'late-disposed-viewport',
    seed: 1,
  });
  const metrics = {
    widthCssPx: 1,
    heightCssPx: 1,
    offsetLeftCssPx: 0,
    offsetTopCssPx: 0,
    devicePixelRatio: 1,
    safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  let resize: ((value: typeof metrics) => void) | undefined;
  const binding = bootstrap(game, {
    ...browser.host,
    viewport: {
      read: () => metrics,
      subscribe: (listener) => {
        resize = listener;
        return () => {
          throw new Error('viewport cleanup failed');
        };
      },
    },
  });
  await binding.ready;
  expect(() => binding.dispose()).toThrow();
  const revision = game.hostState().revision;
  resize?.({ ...metrics, widthCssPx: 2 });
  expect(game.hostState().phase).toBe('disposed');
  expect(game.hostState().revision).toBe(revision);
});

test('all independent cleanup errors are preserved, including game cleanup', async () => {
  const browser = browserFixture();
  const original = createGame(createFixturePorts().factories, {
    sessionId: 'multiple-cleanup-errors',
    seed: 1,
  });
  const game = {
    ...original,
    dispose: () => {
      original.dispose();
      throw new Error('game');
    },
  };
  const metrics = {
    widthCssPx: 1,
    heightCssPx: 1,
    offsetLeftCssPx: 0,
    offsetTopCssPx: 0,
    devicePixelRatio: 1,
    safeAreaCssPx: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const binding = bootstrap(game, {
    ...browser.host,
    cancelFrame: () => {
      throw new Error('cancel');
    },
    subscribe: () => () => {
      throw new Error('lifecycle');
    },
    viewport: {
      read: () => metrics,
      subscribe: () => () => {
        throw new Error('viewport');
      },
    },
  });
  await binding.ready;
  let failure: unknown;
  try {
    binding.dispose();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError))
    throw new Error('Missing aggregate');
  expect(
    failure.errors.map((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    ),
  ).toEqual(['cancel', 'lifecycle', 'viewport', 'game']);
  expect(original.hostState().phase).toBe('disposed');
  binding.dispose();
});

test('terminal display deadline also excludes a pause/resume hidden between RAF callbacks', async () => {
  const fixture = createFixturePorts();
  let scripted: ReturnType<typeof createScriptedCore> | undefined;
  const browser = browserFixture();
  const game = createGame(
    {
      ...fixture.factories,
      core: (context) => {
        scripted = createScriptedCore(context);
        return scripted.core;
      },
    },
    { sessionId: 'terminal-continuity', seed: 1, stepMs: 10 },
  );
  const binding = bootstrap(game, browser.host);
  await binding.ready;
  const run = game.read();
  if (!run || !scripted) throw new Error('Missing run');
  game.request({ type: 'StartRequested', requestId: 'start' });
  const { presentationTimeMs } = await import('../../src/contracts');
  scripted.script({
    phase: 'terminal',
    presentation: {
      kind: 'defeat-slow',
      actorId: null,
      startedAt: presentationTimeMs(0),
      endsAt: presentationTimeMs(2000),
    },
    result: {
      outcome: 'defeat',
      finalizedAt: gameTimeMs(0),
      score: {
        defeatedEnemies: 0,
        remainingHp: 0,
        survivalTime: gameTimeMs(0),
        clearTime: null,
        destructionPenalty: 0,
        streetDestructionRate: 0,
        vehicleDestructionRate: 0,
        total: 0,
      },
    },
  });
  browser.frame(0);
  browser.frame(500);
  expect(game.read()?.clocks.presentationTimeMs).toBe(500);
  game.dispatch({
    type: 'PauseRequested',
    runId: run.runId,
    reason: 'settings',
  });
  game.dispatch({
    type: 'ResumeRequested',
    runId: run.runId,
    reason: 'settings',
  });
  browser.frame(10500);
  expect(game.read()?.clocks.presentationTimeMs).toBe(500);
  expect(game.read()?.presentation.kind).toBe('defeat-slow');
  browser.frame(11000);
  expect(game.read()?.clocks.presentationTimeMs).toBe(1000);
  browser.frame(12000);
  expect(game.read()?.presentation.kind).toBe('results');
  expect(game.read()?.clocks).toMatchObject({
    tick: 0,
    gameTimeMs: 0,
    activeRealTimeMs: 0,
  });
  binding.dispose();
});
