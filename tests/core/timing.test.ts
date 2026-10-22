import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { durationMs } from '../../src/contracts';
import { createCore } from '../../src/core/createCore';
import {
  attack,
  envelope,
  fixtureCatalog,
  run,
  step,
} from './fixtures/scenarios';
function simulate(frames: readonly number[], attackTicks: readonly number[]) {
  const fixture = fixtureCatalog();
  const list = fixture.catalog.list().map((m) => ({
    ...m,
    durationMs: durationMs(50),
    rootCurve: [
      requireValue(m.rootCurve[0]),
      { ...requireValue(m.rootCurve[1]), atMs: durationMs(50) },
    ],
  }));
  const core = createCore(
    { runId: run, seed: 42 },
    {
      moves: fixture.moves,
      catalog: {
        list: () => list,
        get: (id) => list.find((m) => m.clipId === id),
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  let backlog = 0;
  for (const frame of frames) {
    core.present(durationMs(frame));
    backlog += frame;
    while (backlog + 1e-7 >= 10) {
      if (attackTicks.includes(core.read().clocks.tick)) attack(core);
      step(core);
      backlog -= 10;
    }
  }
  return core.read();
}
function frames(fps: number, total: number) {
  const result: number[] = [];
  let t = 0;
  while (t < total - 1e-9) {
    const dt = Math.min(1000 / fps, total - t);
    result.push(dt);
    t += dt;
  }
  return result;
}
test('accepted real mapping fixes exact seventh attack end and3000ms lock across render partitions', () => {
  const ticks = [0, 5, 10, 15, 20, 25, 30];
  const cases = [
    frames(30, 700),
    frames(60, 700),
    frames(120, 700),
    [700],
    [125, 275, 300],
  ];
  const results = cases.map((f) => simulate(f, ticks));
  for (const s of results) {
    expect(requireValue(s.actors[0]).heat.lockedUntil).toBe(3350);
    expect(requireValue(s.actors[0]).heat.amount).toBeCloseTo(
      7 - (350 * 7) / 3000,
      10,
    );
    expect(s.clocks.gameTimeMs).toBe(700);
  }
  expect(results.map((s) => requireValue(s.actors[0]).heat)).toEqual(
    results.map(() => requireValue(requireValue(results[0]).actors[0]).heat),
  );
});
test('natural cooling is render independent and exact lock expiry remains3350', () => {
  for (const fps of [30, 60, 120]) {
    const partial = simulate(frames(fps, 200), [0]);
    expect(requireValue(partial.actors[0]).heat.amount).toBeCloseTo(
      1 - (150 * 7) / 3000,
      10,
    );
    const locked = simulate(frames(fps, 3349), [0, 5, 10, 15, 20, 25, 30]);
    expect(requireValue(locked.actors[0]).actions.punch).toMatchObject({
      allowed: false,
      reason: 'cooling-lock',
    });
    const free = simulate(frames(fps, 3350), [0, 5, 10, 15, 20, 25, 30]);
    expect(requireValue(free.actors[0]).heat.amount).toBe(0);
    expect(requireValue(free.actors[0]).heat.lockedUntil).toBeNull();
  }
});
test('opponent slow interval and next encounter are independent of 30/60/120 Hz or a 2000 ms accepted backlog', () => {
  const results = [
    frames(30, 2000),
    frames(60, 2000),
    frames(120, 2000),
    [2000],
    [250, 1750],
  ].map((parts) => {
    const core = createCore(
      { runId: run, seed: 42 },
      { ...fixtureCatalog(), enemyAi: false },
    );
    core.handle({ type: 'AssetsReady', runId: run });
    core.handle({ type: 'StartRequested', runId: run });
    let backlog = 0;
    for (const frame of parts) {
      core.present(durationMs(frame));
      backlog += frame;
      while (backlog + 1e-7 >= 10) {
        if ([0, 5, 10, 15, 20].includes(core.read().clocks.tick)) attack(core);
        const a = requireValue(core.read().actors[0]),
          targetActorId = core.read().currentOpponentId;
        const active = a.attack;
        step(core, (at) =>
          active && targetActorId
            ? [
                {
                  ...envelope(at, `hit:${at}`),
                  kind: 'body-hit',
                  source: {
                    actorId: a.actorId,
                    activationId: active.activationId,
                    impactId: requireValue(active.impactBindings[0]).impactId,
                  },
                  targetActorId,
                },
              ]
            : [],
        );
        if (
          requireValue(core.read().actors[1]).defeated &&
          core.read().currentOpponentId === null
        ) {
          expect(requireValue(core.read().actors[0]).actions.kick.allowed).toBe(
            false,
          );
        }
        backlog -= 10;
      }
    }
    const s = core.read();
    return {
      game: s.clocks.gameTimeMs,
      opponent: s.currentOpponentId,
      death: requireValue(s.actors[1]).defeatPresentation,
      heat: requireValue(s.actors[0]).heat,
    };
  });
  for (const result of results) expect(result).toEqual(results[0]);
  expect(requireValue(results[0]).opponent).toContain('green');
  expect(requireValue(results[0]).death?.startedAt).toBe(200);
});
test('accepted backlog survives pause without cooling twice or adding paused wall time', () => {
  const fixture = fixtureCatalog();
  const list = fixture.catalog.list().map((m) => ({
    ...m,
    durationMs: durationMs(50),
    rootCurve: [
      requireValue(m.rootCurve[0]),
      { ...requireValue(m.rootCurve[1]), atMs: durationMs(50) },
    ],
  }));
  const core = createCore(
    { runId: run, seed: 42 },
    {
      moves: fixture.moves,
      catalog: {
        list: () => list,
        get: (id) => list.find((m) => m.clipId === id),
      },
      enemyAi: false,
    },
  );
  core.handle({ type: 'AssetsReady', runId: run });
  core.handle({ type: 'StartRequested', runId: run });
  core.present(durationMs(700));
  const execute = () => {
    if ([0, 5, 10, 15, 20, 25, 30].includes(core.read().clocks.tick))
      attack(core);
    step(core);
  };
  execute();
  execute();
  core.handle({ type: 'PauseRequested', runId: run, reason: 'settings' });
  const paused = core.read();
  core.present(durationMs(5000));
  expect(core.read().clocks).toEqual(paused.clocks);
  core.handle({ type: 'ResumeRequested', runId: run, reason: 'settings' });
  for (let i = 2; i < 70; i++) execute();
  expect(core.read().clocks.activeRealTimeMs).toBe(700);
  expect(requireValue(core.read().actors[0]).heat).toEqual(
    requireValue(simulate([700], [0, 5, 10, 15, 20, 25, 30]).actors[0]).heat,
  );
});
