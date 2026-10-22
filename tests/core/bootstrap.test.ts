import { expect, test } from 'vitest';
import { durationMs, runId, tick } from '../../src/contracts';
async function coreFactory() {
  const path = '../../src/core/foundation.ts';
  const module = await import(path).catch(() => undefined);
  expect(
    module?.createFoundationCore,
    'P0 lifecycle core must exist',
  ).toBeTypeOf('function');
  return module?.createFoundationCore as typeof import('../../src/core/foundation').createFoundationCore;
}
test('core starts only after readiness and freezes snapshots', async () => {
  const core = (await coreFactory())({ runId: runId('test'), seed: 42 });
  core.handle({ type: 'StartRequested', runId: runId('test') });
  expect(core.read().phase).toBe('loading');
  core.handle({ type: 'AssetsReady', runId: runId('test') });
  expect(core.read().phase).toBe('ready');
  core.handle({ type: 'StartRequested', runId: runId('test') });
  const first = core.read();
  expect(first.phase).toBe('running');
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.clocks)).toBe(true);
  core.present(durationMs(20));
  core.beginStep({ durationMs: durationMs(20) });
  core.completeStep({
    snapshot: { runId: runId('test'), tick: tick(1), actors: [], vehicles: [] },
    candidates: [],
  });
  expect(first.clocks.tick).toBe(0);
  expect(core.read().clocks).toMatchObject({
    tick: 1,
    gameTimeMs: 20,
    activeRealTimeMs: 20,
  });
});
test('multiple pause reasons do not resume one another and background requires explicit resume', async () => {
  const core = (await coreFactory())({ runId: runId('test'), seed: 42 });
  for (const type of ['AssetsReady', 'StartRequested'] as const)
    core.handle({ type, runId: runId('test') });
  core.handle({
    type: 'PauseRequested',
    runId: runId('test'),
    reason: 'settings',
  });
  core.handle({ type: 'Backgrounded', runId: runId('test') });
  core.handle({
    type: 'ResumeRequested',
    runId: runId('test'),
    reason: 'settings',
  });
  core.handle({ type: 'Foregrounded', runId: runId('test') });
  expect(core.read().phase).toBe('paused');
  core.present(durationMs(100));
  expect(core.read().clocks.activeRealTimeMs).toBe(0);
  core.handle({
    type: 'ResumeRequested',
    runId: runId('test'),
    reason: 'interruption',
  });
  expect(core.read().phase).toBe('running');
});
test('stale run commands cannot change current state', async () => {
  const core = (await coreFactory())({ runId: runId('test'), seed: 42 });
  core.handle({ type: 'AssetsReady', runId: runId('old') });
  expect(core.read().phase).toBe('loading');
  expect(core.drain().events).toEqual([]);
});

test('backgrounding during load remains paused when the player requests start', async () => {
  const core = (await coreFactory())({ runId: runId('test'), seed: 1 });
  core.handle({ type: 'Backgrounded', runId: runId('test') });
  core.handle({ type: 'AssetsReady', runId: runId('test') });
  core.handle({ type: 'StartRequested', runId: runId('test') });
  expect(core.read().phase).toBe('paused');
  expect(core.read().pauseReasons).toContain('background');
});

test('presentation time freezes for settings/background pause and snapshot revision is independent of tick', async () => {
  const core = (await coreFactory())({ runId: runId('revisions'), seed: 1 });
  expect(core.read().revision, 'snapshots need an explicit revision').toBe(0);
  core.handle({ type: 'AssetsReady', runId: runId('revisions') });
  const readyRevision = core.read().revision;
  core.handle({ type: 'StartRequested', runId: runId('revisions') });
  core.present(durationMs(10));
  core.handle({
    type: 'PauseRequested',
    runId: runId('revisions'),
    reason: 'settings',
  });
  const paused = core.read();
  core.present(durationMs(5000));
  expect(core.read().clocks.presentationTimeMs).toBe(
    paused.clocks.presentationTimeMs,
  );
  expect(core.read().revision).toBeGreaterThan(readyRevision);
  expect(core.read().clocks.tick).toBe(0);
  const events = core.drain().events;
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
});
