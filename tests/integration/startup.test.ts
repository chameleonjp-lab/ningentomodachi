import { expect, test } from 'vitest';
import { createGame } from '../../src/app/createGame';
import { createFixturePorts } from '../core/fixtures/ports';

function harness() {
  const fixture = createFixturePorts();
  const releases: Array<() => void> = [];
  const original = fixture.factories.catalog;
  const game = createGame(
    {
      ...fixture.factories,
      catalog: (context) => ({
        ...original(context),
        prepare: () => new Promise<void>((resolve) => releases.push(resolve)),
      }),
    },
    { sessionId: 'startup', seed: 1 },
  );
  return { game, releases };
}

test('explicit preparation shows countdown while required loading runs and starts once only after both', async () => {
  const { game, releases } = harness();
  game.request({ type: 'PrepareRequested', requestId: 'start' });
  expect(game.hostState().startup).toMatchObject({
    countdown: 3,
    requiredAssetsReady: false,
  });
  await expect.poll(() => releases.length).toBe(1);
  game.advance(1000);
  expect(game.hostState().startup?.countdown).toBe(2);
  game.advance(2000);
  expect(game.hostState().startup).toMatchObject({
    countdown: 0,
    requiredAssetsReady: false,
  });
  expect(game.read()?.phase).toBe('loading');
  releases[0]?.();
  await expect.poll(() => game.read()?.phase).toBe('running');
  expect(game.hostState().startup).toBeNull();
  expect(game.read()?.clocks.gameTimeMs).toBe(0);
  game.request({ type: 'PrepareRequested', requestId: 'start' });
  expect(releases).toHaveLength(1);
  game.dispose();
});

test('ready assets do not bypass countdown and programmatic preparation never autostarts', async () => {
  const { game, releases } = harness();
  const prepared = game.start();
  releases[0]?.();
  await prepared;
  expect(game.read()?.phase).toBe('ready');
  expect(game.hostState().startup).toBeNull();
  game.advance(10000);
  expect(game.read()?.phase).toBe('ready');
  game.request({ type: 'StartRequested', requestId: 'play' });
  expect(game.hostState().startup).toMatchObject({
    countdown: 3,
    requiredAssetsReady: true,
  });
  game.advance(2999);
  expect(game.read()?.phase).toBe('ready');
  game.advance(1);
  expect(game.read()?.phase).toBe('running');
  expect(game.read()?.clocks.gameTimeMs).toBe(0);
  game.dispose();
});

test('pause reasons freeze startup independently and stale retry callbacks cannot release the successor', async () => {
  const { game, releases } = harness();
  game.request({ type: 'PrepareRequested', requestId: 'first' });
  const first = game.hostState().startup?.generation ?? -1;
  game.request({
    type: 'StartupPauseRequested',
    requestId: 'hidden',
    startupGeneration: first,
    reason: 'background',
  });
  game.request({
    type: 'StartupPauseRequested',
    requestId: 'settings',
    startupGeneration: first,
    reason: 'settings',
  });
  game.advance(10000);
  expect(game.hostState().startup?.countdown).toBe(3);
  game.request({
    type: 'StartupResumeRequested',
    requestId: 'visible',
    startupGeneration: first,
    reason: 'background',
  });
  game.advance(10000);
  expect(game.hostState().startup?.pauseReasons).toEqual(['settings']);
  game.request({ type: 'RetryRequested', requestId: 'retry' });
  const second = game.hostState().startup?.generation ?? -1;
  expect(second).toBeGreaterThan(first);
  game.request({
    type: 'StartupPauseRequested',
    requestId: 'new-pause',
    startupGeneration: second,
    reason: 'manual',
  });
  game.request({
    type: 'StartupResumeRequested',
    requestId: 'stale',
    startupGeneration: first,
    reason: 'manual',
  });
  game.advance(10000);
  expect(game.hostState().startup?.pauseReasons).toEqual(['manual']);
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  game.dispose();
});

test('cancel and retry invalidate old required-load completion and dispose the old run', async () => {
  const { game, releases } = harness();
  game.request({ type: 'PrepareRequested', requestId: 'old' });
  await expect.poll(() => releases.length).toBe(1);
  const oldRun = game.read()?.runId;
  game.advance(3000);
  game.request({ type: 'RetryRequested', requestId: 'replacement' });
  await expect.poll(() => releases.length).toBe(2);
  const newRun = game.read()?.runId;
  expect(newRun).not.toBe(oldRun);
  releases[0]?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(game.read()?.runId).toBe(newRun);
  expect(game.hostState().startup).toMatchObject({
    countdown: 3,
    requiredAssetsReady: false,
  });
  releases[1]?.();
  await expect
    .poll(() => game.hostState().startup?.requiredAssetsReady)
    .toBe(true);
  expect(game.read()?.phase).toBe('ready');
  game.request({ type: 'CancelLoadingRequested', requestId: 'cancel' });
  game.advance(10000);
  expect(game.hostState().startup).toBeNull();
  expect(game.read()).toBeNull();
  game.dispose();
});

test('loading UI is published before preparation and cancellation prevents deferred work', async () => {
  const fixture = createFixturePorts();
  let resume: (() => void) | undefined;
  let created = 0;
  const catalog = fixture.factories.catalog;
  const game = createGame(
    {
      ...fixture.factories,
      catalog: (context) => {
        created++;
        return catalog(context);
      },
    },
    {
      sessionId: 'deferred',
      seed: 1,
      yieldBeforePreparation: () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    },
  );
  game.request({ type: 'PrepareRequested', requestId: 'defer' });
  expect(game.hostState()).toMatchObject({
    phase: 'loading',
    startup: { countdown: 3, requiredAssetsReady: false },
  });
  expect(game.read()).toBeNull();
  expect(created).toBe(0);
  game.advance(1000);
  expect(game.hostState()).toMatchObject({
    phase: 'loading',
    startup: { countdown: 2 },
  });
  game.request({ type: 'CancelLoadingRequested', requestId: 'cancel-defer' });
  resume?.();
  await Promise.resolve();
  expect(created).toBe(0);
  expect(game.hostState().phase).toBe('title');
  game.dispose();
});

test('explicit startup inherits a prepared run interruption and clears only explicitly resumed reasons', async () => {
  const fixture = createFixturePorts();
  const game = createGame(fixture.factories, {
    sessionId: 'prepared-hidden',
    seed: 1,
  });
  await game.start();
  const runId = game.read()?.runId;
  if (!runId) throw new Error('Missing prepared run');
  game.dispatch({ type: 'Backgrounded', runId });
  game.request({ type: 'StartRequested', requestId: 'explicit-start' });
  const generation = game.hostState().startup?.generation ?? -1;
  expect(game.hostState().startup?.pauseReasons).toEqual([
    'background',
    'interruption',
  ]);
  game.request({
    type: 'StartupResumeRequested',
    requestId: 'foreground',
    startupGeneration: generation,
    reason: 'background',
  });
  game.advance(3000);
  expect(game.hostState().startup?.countdown).toBe(3);
  game.request({
    type: 'StartupResumeRequested',
    requestId: 'resume',
    startupGeneration: generation,
    reason: 'interruption',
  });
  game.advance(3000);
  expect(game.read()?.phase).toBe('running');
  expect(game.read()?.pauseReasons).toEqual([]);
  game.dispose();
});

test('auto-start rendering failure remains visible and disposes the failed generation for retry', async () => {
  const fixture = createFixturePorts();
  const animation = fixture.factories.animation;
  const errors: unknown[] = [];
  let attempts = 0;
  const game = createGame(
    {
      ...fixture.factories,
      animation: (context) => {
        const original = animation(context);
        const fail = ++attempts === 1;
        return {
          ...original,
          render: (frame) => {
            if (fail && frame.snapshot.phase === 'running')
              throw new Error('start render failed');
            original.render(frame);
          },
        };
      },
    },
    {
      sessionId: 'startup-render-error',
      seed: 1,
      onError: (error) => errors.push(error),
    },
  );
  game.request({ type: 'PrepareRequested', requestId: 'failing-start' });
  game.advance(3000);
  await expect.poll(() => game.hostState().phase).toBe('error');
  expect(game.hostState().error).toBe('start render failed');
  expect(game.read()).toBeNull();
  expect(errors).toHaveLength(1);
  game.request({ type: 'RetryRequested', requestId: 'retry-render' });
  await expect
    .poll(() => game.hostState().startup?.requiredAssetsReady)
    .toBe(true);
  game.advance(3000);
  expect(game.read()?.phase).toBe('running');
  game.dispose();
});
