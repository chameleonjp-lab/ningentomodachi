import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { durationMs, gameTimeMs, runId, impactId } from '../../src/contracts';
import {
  advanceCore,
  attack,
  envelope,
  hitOpponent,
  reference,
  setup,
  step,
} from './fixtures/scenarios';
test('sequential four enemies, authoritative IDs, recovery cap and terminal score freeze', () => {
  const core = setup();
  const colors = [];
  for (let n = 0; n < 4; n++) {
    colors.push(
      requireValue(
        core
          .read()
          .actors.find((a) => a.actorId === core.read().currentOpponentId),
      ).color,
    );
    for (let i = 0; i < (n === 3 ? 7 : 5); i++) hitOpponent(core);
    if (n < 3) {
      expect(core.read().currentOpponentId).toBeNull();
      core.present(durationMs(1499));
      expect(core.read().currentOpponentId).toBeNull();
      advanceCore(core, 1);
      expect(core.read().presentation.kind).toBe('opponent-defeat-finish');
      expect(core.read().currentOpponentId).toBeNull();
      advanceCore(core, 125);
    }
  }
  expect(colors).toEqual(['blue', 'green', 'yellow', 'black']);
  expect(core.read().result?.outcome).toBe('clear');
  expect(core.read().result?.score.defeatedEnemies).toBe(4);
  expect(core.read().actors[0]?.hp).toBe(500);
  const before = core.read();
  core.present(durationMs(10000));
  expect(core.read().result).toEqual(before.result);
  expect(core.read().clocks.gameTimeMs).toBe(before.clocks.gameTimeMs);
  expect(core.read().actors.map((a) => a.heat)).toEqual(
    before.actors.map((a) => a.heat),
  );
  expect(core.read().presentation.kind).toBe('results');
});
test('clash consumes both impacts before same-time body damage; duplicate order independent', () => {
  const run = (reverse: boolean) => {
    const core = setup();
    attack(core);
    attack(core, 'blue');
    const first = reference(core),
      second = reference(core, 'blue');
    const out = step(core, (at) => {
      const candidates = [
        {
          ...envelope(at, 'z'),
          kind: 'body-hit' as const,
          source: first,
          targetActorId: second.actorId,
        },
        { ...envelope(at, 'a'), kind: 'clash' as const, first, second },
        {
          ...envelope(at, 'b'),
          kind: 'body-hit' as const,
          source: second,
          targetActorId: first.actorId,
        },
      ];
      return reverse ? candidates.reverse() : candidates;
    });
    expect(out.events.filter((e) => e.type === 'HpChanged')).toHaveLength(0);
    expect(out.events.filter((e) => e.type === 'ClashResolved')).toHaveLength(
      1,
    );
    return out.snapshot;
  };
  expect(run(true)).toEqual(run(false));
});
test('unknown, stale, inactive and end-boundary contacts cannot alter HP', () => {
  const core = setup();
  attack(core);
  const source = reference(core),
    targetActorId = requireValue(core.read().currentOpponentId);
  step(core, (at) => [
    {
      ...envelope(at),
      runId: runId('old'),
      kind: 'body-hit',
      source,
      targetActorId,
    },
    {
      ...envelope(at, 'bad'),
      kind: 'body-hit',
      source: { ...source, impactId: impactId('forged') },
      targetActorId,
    },
    {
      ...envelope(at, 'end'),
      at: gameTimeMs(at + 10),
      kind: 'body-hit',
      source,
      targetActorId,
    },
  ]);
  expect(
    requireValue(core.read().actors.find((a) => a.actorId === targetActorId))
      .hp,
  ).toBe(500);
});
test('same-time mutual lethal defeats both and never revives white', () => {
  const core = setup();
  for (let n = 0; n < 5; n++) {
    advanceCore(core, 500);
    attack(core);
    attack(core, 'blue');
    const a = reference(core),
      b = reference(core, 'blue');
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
  expect(core.read().result?.outcome).toBe('defeat');
  expect(core.read().result?.score.defeatedEnemies).toBe(1);
  expect(core.read().actors[0]?.hp).toBe(0);
  expect(core.read().presentation.kind).toBe('defeat-slow');
  core.present(durationMs(1999));
  expect(core.read().presentation.kind).toBe('defeat-slow');
  advanceCore(core, 1);
  expect(core.read().presentation.kind).toBe('fade');
  core.present(durationMs(400));
  expect(core.read().presentation.kind).toBe('results');
});
