import { expect, test } from 'vitest';
import { actorSummary, resultLines, hudActors } from '../../src/ui/viewModel';
import { actor, snapshot, player, opponent } from './fixtures/core';
import {
  activeRealTimeMs,
  gameTimeMs,
  presentationTimeMs,
  actorId,
} from '../../src/contracts';
test('authoritative permissions win over heat thresholds and remaining lock uses active clock', () => {
  const allowed = actorSummary(
    { ...actor(), heat: { amount: 6.5, capacity: 7, lockedUntil: null } },
    snapshot().clocks,
  );
  expect(allowed.actions.punch.allowed).toBe(true);
  expect(allowed.heatText).toContain('6.5');
  const permission = { allowed: false, reason: 'cooling-lock' } as const;
  const locked = actorSummary(
    {
      ...actor(),
      heat: { amount: 0, capacity: 7, lockedUntil: activeRealTimeMs(3000) },
      actions: { ...actor().actions, punch: permission, kick: permission },
    },
    snapshot().clocks,
  );
  expect(locked.actions.punch.allowed).toBe(false);
  expect(locked.cooldownSeconds).toBe(3);
});
test('defeat results preserve score and separate destruction metrics; null clear time is unmet not zero', () => {
  const lines = resultLines({
    outcome: 'defeat',
    finalizedAt: gameTimeMs(180000),
    score: {
      defeatedEnemies: 2,
      remainingHp: 0,
      survivalTime: gameTimeMs(180000),
      clearTime: null,
      destructionPenalty: 600,
      streetDestructionRate: 0.1,
      vehicleDestructionRate: 0.3,
      total: 1760,
    },
  });
  expect(lines).toContainEqual(['総合点', '1,760']);
  expect(lines).toContainEqual(['全敵撃破時間', '未達']);
  expect(lines).toContainEqual(['街の損壊率', '10.0%']);
  expect(lines).toContainEqual(['車の損壊率', '30.0%']);
  expect(lines).toContainEqual(['撃破数', '2 / 4']);
});
test('contribution rows display A values including signed destruction and rounding adjustment', () => {
  const lines = resultLines({
    outcome: 'defeat',
    finalizedAt: gameTimeMs(0),
    score: {
      defeatedEnemies: 1,
      remainingHp: 0,
      survivalTime: gameTimeMs(1),
      clearTime: null,
      destructionPenalty: 12,
      streetDestructionRate: 0,
      vehicleDestructionRate: 0,
      total: 17,
      contributions: {
        survival: 1.25,
        defeats: 28,
        remainingHp: 0,
        clear: 0,
        speed: 0,
        destruction: -12,
        adjustment: -0.25,
      },
    },
  });
  expect(lines).toContainEqual(['生存点', '1.25']);
  expect(lines).toContainEqual(['撃破点', '28']);
  expect(lines).toContainEqual(['損壊点', '-12']);
  expect(lines).toContainEqual(['丸め・下限調整', '-0.25']);
  expect(lines).toContainEqual(['総合点', '17']);
});
test('player attribution displays supplied rate without combining street and car metrics', () => {
  const lines = resultLines({
    outcome: 'defeat',
    finalizedAt: gameTimeMs(0),
    score: {
      defeatedEnemies: 0,
      remainingHp: 0,
      survivalTime: gameTimeMs(0),
      clearTime: null,
      streetDestructionRate: 0.1,
      vehicleDestructionRate: 0.8,
      playerCausedDestructionRate: 0.125,
      destructionPenalty: 1350,
      total: 0,
    },
  });
  expect(lines).toContainEqual(['プレイヤー起因の損壊率', '12.5%']);
});

test.each(['opponent-defeat', 'clear-slow'] as const)(
  'HUD retains %s victim only before A deadline and never over a replacement',
  (kind) => {
    const defeated = { ...actor(opponent, 0, 700), defeated: true };
    const state = snapshot({
      actors: [actor(), defeated],
      currentOpponentId: null,
      presentation: {
        kind,
        actorId: opponent,
        startedAt: presentationTimeMs(0),
        endsAt: presentationTimeMs(1500),
      },
      clocks: {
        ...snapshot().clocks,
        presentationTimeMs: presentationTimeMs(1499),
      },
    });
    expect(hudActors(state).map((a) => a.actorId)).toEqual([player, opponent]);
    // No transition frame is required: expired durable stage cannot retain/replay a victim.
    for (const time of [1500, 9000])
      expect(
        hudActors({
          ...state,
          currentOpponentId: opponent,
          clocks: {
            ...state.clocks,
            presentationTimeMs: presentationTimeMs(time),
          },
        }).map((a) => a.actorId),
      ).toEqual([player]);
    const next = { ...actor(actorId('green')), color: 'green' as const };
    expect(
      hudActors({
        ...state,
        currentOpponentId: next.actorId,
        actors: [...state.actors, next],
      }).map((a) => a.actorId),
    ).toEqual([player, next.actorId]);
    expect(
      hudActors({ ...state, presentation: { kind: 'results' } }).map(
        (a) => a.actorId,
      ),
    ).toEqual([player]);
    expect(state.currentOpponentId).toBeNull();
    expect(defeated.hp).toBe(0);
  },
);

test('simultaneous lethal participant retention uses player defeat identity and exact authoritative deadline', () => {
  const state = snapshot({
    actors: [
      { ...actor(player, 0), defeated: true },
      { ...actor(opponent, 0, 700), defeated: true },
    ],
    presentation: {
      kind: 'defeat-slow',
      actorId: player,
      startedAt: presentationTimeMs(0),
      endsAt: presentationTimeMs(2000),
    },
  });
  expect(hudActors(state).map((a) => a.actorId)).toEqual([player, opponent]);
  for (const now of [2000, 9000])
    expect(
      hudActors({
        ...state,
        clocks: {
          ...state.clocks,
          presentationTimeMs: presentationTimeMs(now),
        },
      }).map((a) => a.actorId),
    ).toEqual([player]);
  expect(
    hudActors({
      ...state,
      presentation: {
        kind: 'fade',
        actorId: player,
        startedAt: presentationTimeMs(2000),
        endsAt: presentationTimeMs(2400),
      },
    }).map((a) => a.actorId),
  ).toEqual([player]);
  const next = { ...actor(actorId('green')), color: 'green' as const };
  expect(
    hudActors({
      ...state,
      currentOpponentId: next.actorId,
      actors: [...state.actors, next],
    }).map((a) => a.actorId),
  ).toEqual([player, next.actorId]);
  expect(
    hudActors({
      ...state,
      presentation: {
        kind: 'defeat-slow',
        actorId: opponent,
        startedAt: presentationTimeMs(0),
        endsAt: presentationTimeMs(2000),
      },
    }).map((a) => a.actorId),
  ).toEqual([player]);
});
