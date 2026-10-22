import { expect, test } from 'vitest';
import type { GameController } from '../../src/app/createGame';

function readRunningFixture(game: GameController) {
  const snapshot = game.read();
  if (!snapshot) throw new Error('Expected an active fixture run');
  return snapshot;
}

import type {
  BrowserHost,
  BrowserLifecycleEvent,
} from '../../src/app/bootstrap';
import { createGame } from '../../src/app/createGame';
import { createFixturePorts } from '../core/fixtures/ports';

function hostFixture() {
  let callback: ((nowMs: number) => void) | undefined;
  let lifecycle: ((event: BrowserLifecycleEvent) => void) | undefined;
  let canceled = 0;
  const host: BrowserHost = {
    requestFrame: (listener) => {
      callback = listener;
      return 1;
    },
    cancelFrame: () => {
      callback = undefined;
      canceled++;
    },
    subscribe: (listener) => {
      lifecycle = listener;
      return () => {
        lifecycle = undefined;
      };
    },
  };
  return {
    host,
    frame: (now: number) => {
      const current = callback;
      callback = undefined;
      current?.(now);
    },
    event: (event: BrowserLifecycleEvent) => lifecycle?.(event),
    isSubscribed: () => lifecycle !== undefined,
    canceled: () => canceled,
  };
}
async function bootstrapFactory() {
  const path = '../../src/app/bootstrap.ts';
  const module = await import(path).catch(() => undefined);
  expect(module?.bootstrap, 'P0 browser bootstrap must exist').toBeTypeOf(
    'function',
  );
  return module?.bootstrap as typeof import('../../src/app/bootstrap').bootstrap;
}
test('browser restoration resets the timestamp and cannot fast-forward hidden time', async () => {
  const fixtures = createFixturePorts();
  const host = hostFixture();
  const game = createGame(fixtures.factories, {
    sessionId: 'browser',
    seed: 1,
    stepMs: 10,
  });
  const binding = (await bootstrapFactory())(game, host.host);
  await binding.ready;
  game.dispatch({
    type: 'StartRequested',
    runId: readRunningFixture(game).runId,
  });
  host.frame(0);
  host.frame(20);
  expect(readRunningFixture(game).clocks.tick).toBe(2);
  host.event('hidden');
  host.frame(100000);
  host.event('visible');
  expect(readRunningFixture(game).phase).toBe('paused');
  game.dispatch({
    type: 'ResumeRequested',
    runId: readRunningFixture(game).runId,
    reason: 'interruption',
  });
  host.frame(100010);
  host.frame(100020);
  expect(readRunningFixture(game).clocks.tick).toBe(3);
  binding.dispose();
  binding.dispose();
  expect(host.isSubscribed()).toBe(false);
  expect(host.canceled()).toBe(1);
  expect(fixtures.listeners.size).toBe(0);
});
test('disposing bootstrap before readiness never schedules a late frame', async () => {
  const fixtures = createFixturePorts();
  const host = hostFixture();
  let ready!: () => void;
  const catalog = fixtures.factories.catalog;
  const game = createGame(
    {
      ...fixtures.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: () =>
          new Promise<void>((resolve) => {
            ready = resolve;
          }),
      }),
    },
    { sessionId: 'dispose-browser', seed: 1 },
  );
  const binding = (await bootstrapFactory())(game, host.host);
  binding.dispose();
  ready();
  await binding.ready;
  host.frame(50);
  expect(game.read()).toBeNull();
  expect(host.isSubscribed()).toBe(false);
});

test('bootstrap startup failure retains shell recovery and reports the actual error', async () => {
  let attempts = 0;
  const fixtures = createFixturePorts();
  const host = hostFixture();
  const catalog = fixtures.factories.catalog;
  const game = createGame(
    {
      ...fixtures.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: async () => {
          if (++attempts === 1) throw new Error('catalog unavailable');
        },
      }),
    },
    { sessionId: 'bootstrap-error', seed: 1 },
  );
  const errors: unknown[] = [];
  const binding = (await bootstrapFactory())(game, host.host, (error) =>
    errors.push(error),
  );
  await expect(binding.ready).rejects.toThrow('catalog unavailable');
  expect(host.isSubscribed()).toBe(true);
  await game.restart();
  game.dispatch({
    type: 'StartRequested',
    runId: readRunningFixture(game).runId,
  });
  host.frame(1000);
  host.frame(1020);
  expect(game.read()?.clocks.tick).toBeGreaterThan(0);
  expect(errors).toHaveLength(1);
  binding.dispose();
});

test('browser host restores page visibility after BFCache pageshow', async () => {
  const { createBrowserHost } = await import('../../src/app/bootstrap');
  const browserWindow = new EventTarget();
  const browserDocument = Object.assign(new EventTarget(), { hidden: false });
  const events: BrowserLifecycleEvent[] = [];
  const host = createBrowserHost(
    browserWindow as unknown as Window,
    browserDocument as unknown as Document,
  );
  const unsubscribe = host.subscribe((event) => events.push(event));
  browserWindow.dispatchEvent(new Event('pagehide'));
  browserWindow.dispatchEvent(new Event('pageshow'));
  expect(events).toEqual(['visible', 'hidden', 'visible']);
  unsubscribe();
  browserWindow.dispatchEvent(new Event('pagehide'));
  expect(events).toHaveLength(3);
});

test('a transient frame failure retains the pump and restart advances a fresh run', async () => {
  const fixtures = createFixturePorts();
  const host = hostFixture();
  const spatial = fixtures.factories.spatial;
  let failOnce = true;
  const game = createGame(
    {
      ...fixtures.factories,
      spatial: (context) => ({
        ...spatial(context),
        step: (request, catalog) => {
          if (failOnce) {
            failOnce = false;
            throw new Error('transient sweep error');
          }
          return spatial(context).step(request, catalog);
        },
      }),
    },
    { sessionId: 'recover-frame', seed: 1, stepMs: 10 },
  );
  const errors: unknown[] = [];
  const binding = (await bootstrapFactory())(game, host.host, (error) =>
    errors.push(error),
  );
  await binding.ready;
  game.dispatch({
    type: 'StartRequested',
    runId: readRunningFixture(game).runId,
  });
  host.frame(0);
  host.frame(10);
  expect(game.read()?.phase).toBe('error');
  host.frame(500); // Safe error pump does not re-run the failed simulation or report again.
  await game.restart();
  game.dispatch({
    type: 'StartRequested',
    runId: readRunningFixture(game).runId,
  });
  host.frame(1000);
  host.frame(1010);
  expect(game.read()?.clocks.tick).toBe(1);
  expect(errors).toHaveLength(1);
  binding.dispose();
});

test('bootstrap supports a title-first host and one shared viewport source', async () => {
  const fixtures = createFixturePorts();
  const host = hostFixture();
  const metrics = {
    widthCssPx: 800,
    heightCssPx: 600,
    offsetLeftCssPx: 12,
    offsetTopCssPx: 24,
    devicePixelRatio: 2,
    safeAreaCssPx: { top: 10, right: 0, bottom: 0, left: 0 },
  };
  let resize: ((value: typeof metrics) => void) | undefined;
  const game = createGame(fixtures.factories, {
    sessionId: 'viewport-host',
    seed: 1,
  });
  const binding = (await bootstrapFactory())(
    game,
    {
      ...host.host,
      viewport: {
        read: () => metrics,
        subscribe: (listener) => {
          resize = listener;
          return () => {
            resize = undefined;
          };
        },
      },
    },
    () => {},
    { autoPrepare: false },
  );
  await binding.ready;
  expect(game.hostState().phase).toBe('title');
  expect(game.viewport.read()).toMatchObject(metrics);
  resize?.({ ...metrics, offsetLeftCssPx: 30 });
  expect(game.viewport.read()).toMatchObject({
    revision: 2,
    offsetLeftCssPx: 30,
  });
  game.request({ type: 'PrepareRequested', requestId: 'title-prepare' });
  await expect.poll(() => game.hostState().phase).toBe('ready');
  game.request({ type: 'StartRequested', requestId: 'title-start' });
  host.frame(1000);
  host.frame(4000);
  expect(game.read()?.phase).toBe('running');
  host.frame(4020);
  host.frame(4040);
  expect(game.read()?.clocks.tick).toBe(1);
  binding.dispose();
  expect(resize).toBeUndefined();
});

test('startup countdown is pumped before loading completes and hidden retry remains frozen', async () => {
  const fixtures = createFixturePorts();
  const host = hostFixture();
  let release: (() => void) | undefined;
  const catalog = fixtures.factories.catalog;
  const game = createGame(
    {
      ...fixtures.factories,
      catalog: (context) => ({
        ...catalog(context),
        prepare: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }),
    },
    { sessionId: 'startup-browser', seed: 1 },
  );
  const binding = (await bootstrapFactory())(game, host.host, () => {}, {
    autoPrepare: false,
  });
  game.request({ type: 'PrepareRequested', requestId: 'prepare-countdown' });
  host.frame(0);
  host.frame(1000);
  expect(game.hostState().startup?.countdown).toBe(2);
  host.event('hidden');
  game.request({ type: 'RetryRequested', requestId: 'retry-hidden' });
  host.frame(50000);
  expect(game.hostState().startup?.countdown).toBe(3);
  expect(game.hostState().startup?.pauseReasons).toContain('background');
  host.event('visible');
  host.frame(60000);
  host.frame(61000);
  expect(game.hostState().startup?.countdown).toBe(3);
  const generation = game.hostState().startup?.generation ?? -1;
  game.request({
    type: 'StartupResumeRequested',
    requestId: 'explicit-resume',
    startupGeneration: generation,
    reason: 'interruption',
  });
  host.frame(62000);
  host.frame(63000);
  expect(game.hostState().startup?.countdown).toBe(2);
  await expect.poll(() => release).toBeTypeOf('function');
  release?.();
  await expect
    .poll(() => game.hostState().startup?.requiredAssetsReady)
    .toBe(true);
  host.frame(64000);
  expect(game.hostState().startup?.countdown).toBe(1);
  host.frame(65000);
  expect(game.read()?.phase).toBe('running');
  expect(game.read()?.clocks.gameTimeMs).toBe(0);
  binding.dispose();
});
