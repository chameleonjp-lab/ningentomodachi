import { expect, test } from 'vitest';
import {
  actorId,
  domainEventId,
  runId,
  type Projection,
} from '../../src/contracts';
import type { GameController } from '../../src/app/createGame';
function readRunningFixture(game: GameController) {
  const snapshot = game.read();
  if (!snapshot) throw new Error('Expected an active fixture run');
  return snapshot;
}
import { createFixturePorts } from '../core/fixtures/ports';
async function gameFactory() {
  const path = '../../src/app/createGame.ts';
  const module = await import(path).catch(() => undefined);
  expect(module?.createGame, 'P0 game factory must exist').toBeTypeOf(
    'function',
  );
  return module?.createGame as typeof import('../../src/app/createGame').createGame;
}
test('fixtures connect startup -> command -> fixed tick -> committed output -> stop -> restart', async () => {
  const fixtures = createFixturePorts();
  const game = (await gameFactory())(fixtures.factories, {
    sessionId: 'integration',
    seed: 123,
    stepMs: 20,
  });
  await game.start();
  const firstRun = readRunningFixture(game).runId;
  fixtures.emit({ type: 'StartRequested', runId: firstRun });
  fixtures.trace.length = 0;
  game.advance(20);
  expect(readRunningFixture(game).clocks.tick).toBe(1);
  expect(fixtures.trace).toEqual([
    'spatial.step:1',
    'animation.render',
    'spatial.render',
    'ui.render',
  ]);
  expect(fixtures.outputs.at(-1)?.snapshot.phase).toBe('running');
  game.stop();
  game.stop();
  expect(fixtures.listeners.size).toBe(0);
  expect(
    fixtures.trace.filter((item) => item === 'catalog.dispose'),
  ).toHaveLength(1);
  await game.start();
  expect(readRunningFixture(game).runId).not.toBe(firstRun);
  expect(readRunningFixture(game).clocks.tick).toBe(0);
  fixtures.emit({ type: 'StartRequested', runId: firstRun });
  expect(readRunningFixture(game).phase).toBe('ready');
  game.dispose();
  await expect(game.start()).rejects.toThrow('disposed');
});
test('30/60/120 presentation frames produce the same fixed tick and seed without dropping backlog', async () => {
  const createGame = await gameFactory();
  const results = [];
  for (const fps of [30, 60, 120]) {
    const game = createGame(createFixturePorts().factories, {
      sessionId: 'fps',
      seed: 7,
      stepMs: 10,
      maxStepsPerFrame: 3,
    });
    await game.start();
    game.dispatch({
      type: 'StartRequested',
      runId: readRunningFixture(game).runId,
    });
    for (let frame = 0; frame < fps; frame++) game.advance(1000 / fps);
    game.advance(0);
    game.advance(0);
    game.advance(0);
    game.advance(0);
    results.push({
      tick: readRunningFixture(game).clocks.tick,
      time: readRunningFixture(game).clocks.gameTimeMs,
      seed: readRunningFixture(game).seed,
    });
    game.dispose();
  }
  expect(results).toEqual(
    Array.from({ length: 3 }, () => ({ tick: 100, time: 1000, seed: 7 })),
  );
});
test('stopping an in-flight catalog load ignores its late completion', async () => {
  const fixtures = createFixturePorts();
  let finish!: () => void;
  const catalog = fixtures.factories.catalog;
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      }),
    },
    { sessionId: 'cancel', seed: 1 },
  );
  const starting = game.start();
  game.stop();
  finish();
  await starting;
  expect(game.read()).toBeNull();
  expect(fixtures.listeners.size).toBe(0);
  game.dispose();
});
test('initialization failure releases every already-created port', async () => {
  const fixtures = createFixturePorts();
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      ui: () => {
        throw new Error('UI fixture failed');
      },
    },
    { sessionId: 'failure', seed: 1 },
  );
  await expect(game.start()).rejects.toThrow('UI fixture failed');
  expect(fixtures.trace).toContain('catalog.dispose');
  expect(fixtures.trace).toContain('animation.dispose');
  expect(fixtures.trace).toContain('spatial.dispose');
  expect(game.read()).toBeNull();
});

test('a failed synchronous initialization can be retried without reusing its rejected promise', async () => {
  const fixtures = createFixturePorts();
  let attempts = 0;
  const ui = fixtures.factories.ui;
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      ui: (context) => {
        if (++attempts === 1) throw new Error('first attempt');
        return ui(context);
      },
    },
    { sessionId: 'retry', seed: 1 },
  );
  await expect(game.start()).rejects.toThrow('first attempt');
  await game.start();
  expect(game.read()?.phase).toBe('ready');
  game.dispose();
});

test('disposal continues after a port throws and does not dispose a run twice', async () => {
  const fixtures = createFixturePorts();
  const animation = fixtures.factories.animation;
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      animation: (context) => ({
        ...animation(context),
        dispose: () => {
          fixtures.trace.push('animation.dispose');
          throw new Error('dispose failure');
        },
      }),
    },
    { sessionId: 'cleanup', seed: 1 },
  );
  await game.start();
  expect(() => game.stop()).toThrow('failed to dispose');
  expect(fixtures.trace).toContain('catalog.dispose');
  expect(fixtures.trace).toContain('input.unsubscribe');
  expect(game.read()).toBeNull();
  game.stop();
  expect(
    fixtures.trace.filter((item) => item === 'animation.dispose'),
  ).toHaveLength(1);
});

test('a spatial step failure enters an error state and releases input instead of continuing time', async () => {
  const fixtures = createFixturePorts();
  const spatial = fixtures.factories.spatial;
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      spatial: (context) => ({
        ...spatial(context),
        step: () => {
          throw new Error('sweep failed');
        },
      }),
    },
    { sessionId: 'step-failure', seed: 1, stepMs: 10 },
  );
  await game.start();
  game.dispatch({
    type: 'StartRequested',
    runId: readRunningFixture(game).runId,
  });
  expect(() => game.advance(10)).toThrow('sweep failed');
  expect(game.read()?.phase).toBe('error');
  expect(fixtures.outputs.at(-1)?.events).toContainEqual(
    expect.objectContaining({
      type: 'FoundationError',
      message: 'sweep failed',
    }),
  );
  const tick = readRunningFixture(game).clocks.tick;
  game.advance(1000);
  expect(readRunningFixture(game).clocks.tick).toBe(tick);
  game.dispose();
});

test('committed output carries C projection data to UI without inventing hit points', async () => {
  const fixtures = createFixturePorts();
  const spatial = fixtures.factories.spatial;
  let received: unknown;
  const projections: readonly Projection[] = [
    {
      runId: runId('projection:run:1'),
      eventId: domainEventId('projection:event'),
      actorId: actorId('white'),
      visibility: 'unprojectable',
      cssPoint: null,
      viewportRevision: 1,
    },
  ];
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      spatial: (context) => ({
        ...spatial(context),
        project: () => projections,
      }),
      ui: () => ({
        render: (_output, projection) => {
          received = projection;
        },
        dispose: () => {},
      }),
    },
    { sessionId: 'projection', seed: 1 },
  );
  await game.start();
  game.advance(0);
  expect(received).toEqual(projections);
  game.dispose();
});

test('initialization and cleanup failures preserve both errors', async () => {
  const fixtures = createFixturePorts();
  const catalog = fixtures.factories.catalog;
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: async () => {
          throw new Error('load failure');
        },
        dispose: () => {
          throw new Error('cleanup failure');
        },
      }),
    },
    { sessionId: 'aggregate', seed: 1 },
  );
  const failure = await game.start().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).message).toBe(
    'Initialization and cleanup failed',
  );
  expect((failure as AggregateError).errors[0]).toMatchObject({
    message: 'load failure',
  });
});

test('a fire-and-forget retry exposes its startup error instead of silently swallowing it', async () => {
  const fixtures = createFixturePorts();
  let attempts = 0;
  const ui = fixtures.factories.ui;
  const errors: unknown[] = [];
  const game = (await gameFactory())(
    {
      ...fixtures.factories,
      ui: (context) => {
        if (++attempts === 2) throw new Error('retry failed');
        return ui(context);
      },
    },
    {
      sessionId: 'retry-error',
      seed: 1,
      onError: (error) => errors.push(error),
    },
  );
  await game.start();
  game.dispatch({
    type: 'RetryRequested',
    runId: readRunningFixture(game).runId,
  });
  await expect
    .poll(() => game.lastError?.())
    .toMatchObject({ message: 'retry failed' });
  await expect.poll(() => errors.length).toBe(1);
  game.dispose();
});
