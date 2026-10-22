import { expect, test } from 'vitest';
import {
  durationMs,
  gameTimeMs,
  worldObjectId,
  type SpatialCandidate,
} from '../../src/contracts';
import { createCore } from '../../src/core/createCore';
import { requireValue } from '../../src/core/invariant';
import {
  attack,
  reference,
  fixtureCatalog,
  run,
  envelope,
} from './fixtures/scenarios';
function setup(punchDuration = 10) {
  const fixture = fixtureCatalog();
  const list = fixture.catalog.list().map((m) => {
    const duration = m.category === 'punch' ? punchDuration : 20;
    return {
      ...m,
      durationMs: durationMs(duration),
      impacts: m.impacts.map((i) => ({
        ...i,
        startMs: durationMs(0),
        endMs: durationMs(duration),
      })),
      rootCurve: [
        { ...requireValue(m.rootCurve[0]), atMs: durationMs(0) },
        { ...requireValue(m.rootCurve.at(-1)), atMs: durationMs(duration) },
      ],
    };
  });
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
  return core;
}
function step(
  core: ReturnType<typeof setup>,
  ms: number,
  candidates: readonly SpatialCandidate[] = [],
) {
  core.present(durationMs(ms));
  const request = core.beginStep({ durationMs: durationMs(ms) });
  return core.completeStep({
    snapshot: {
      runId: run,
      tick: request.snapshot.clocks.tick,
      actors: [],
      vehicles: [],
    },
    candidates,
  });
}
for (const valid of [false, true])
  for (const reverse of [false, true])
    test(`attack end precedes ${valid ? 'valid' : 'rejected'} later contact, reversed=${reverse}`, () => {
      const core = setup();
      attack(core);
      const white = reference(core);
      let late = white;
      if (valid) {
        attack(core, 'blue', 'kick');
        late = reference(core, 'blue');
      }
      const blue = requireValue(core.read().currentOpponentId);
      const candidates: SpatialCandidate[] = [
        {
          ...envelope(gameTimeMs(5), 'early'),
          kind: 'body-hit',
          source: white,
          targetActorId: blue,
        },
        {
          ...envelope(gameTimeMs(15), 'late'),
          kind: 'body-hit',
          source: late,
          targetActorId: valid ? white.actorId : blue,
        },
      ];
      step(core, 16, reverse ? [...candidates].reverse() : candidates);
      const player = requireValue(core.read().actors[0]);
      expect(player.hp).toBe(valid ? 400 : 500);
      expect(requireValue(core.read().actors[1]).hp).toBe(400);
      expect(player.attack).toBeNull();
      expect(player.heat.amount).toBeCloseTo(1 - (6 * 7) / 3000, 12);
    });
test('seventh attack ends at its actual time before a rejected late contact, with exact lock deadline', () => {
  const core = setup();
  for (let i = 0; i < 6; i++) {
    attack(core);
    step(core, 10);
  }
  attack(core);
  const source = reference(core);
  step(core, 16, [
    {
      ...envelope(gameTimeMs(75), 'late'),
      kind: 'body-hit',
      source,
      targetActorId: requireValue(core.read().currentOpponentId),
    },
  ]);
  const heat = requireValue(core.read().actors[0]).heat;
  expect(heat.lockedUntil).toBe(3070);
  expect(heat.amount).toBeCloseTo(7 - (6 * 7) / 3000, 12);
  step(core, 2994);
  expect(requireValue(core.read().actors[0]).heat.lockedUntil).toBeNull();
  expect(requireValue(core.read().actors[0]).heat.amount).toBe(0);
});
for (const separate of [false, true])
  for (const reverse of [false, true])
    test(`unknown destruction target does not consume impact, separate=${separate}, reversed=${reverse}`, () => {
      const core = setup(20);
      attack(core);
      const source = reference(core);
      const invalid: SpatialCandidate = {
        ...envelope(gameTimeMs(1), 'unknown'),
        kind: 'destruction',
        source,
        sourceActorId: source.actorId,
        targetId: worldObjectId('nonexistent'),
        launchId: null,
        contactSpeedMps: 1,
      };
      const body: SpatialCandidate = {
        ...envelope(gameTimeMs(11), 'body'),
        kind: 'body-hit',
        source,
        targetActorId: requireValue(core.read().currentOpponentId),
      };
      if (separate) {
        step(core, 10, [invalid]);
        step(core, 10, [body]);
      } else step(core, 16, reverse ? [body, invalid] : [invalid, body]);
      expect(requireValue(core.read().actors[1]).hp).toBe(400);
      expect(core.read().world.objects).toEqual([]);
    });
