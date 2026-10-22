import { requireValue } from '../../src/core/invariant';
import { expect, test } from 'vitest';
import { actorId, runId, tick } from '../../src/contracts';
import { createEnemyAi } from '../../src/core/enemyAi';
import { setup } from './fixtures/scenarios';
test('AI acquires actual C basis session before movement, respects permissions and releases sessions', () => {
  const core = setup();
  const acquired: string[] = [];
  const ended: string[] = [];
  const ai = createEnemyAi({
    begin(id) {
      acquired.push(id);
      return {
        runId: runId('fixture-run'),
        sessionId: id,
        revision: 7,
        right: { x: 1, y: 0, z: 0 },
        depth: { x: 0, y: 0, z: 1 },
      };
    },
    end(id) {
      ended.push(id);
    },
  });
  const state = core.read(),
    enemy = requireValue(state.currentOpponentId),
    white = requireValue(state.actors[0]).actorId;
  const spatial = {
    runId: state.runId,
    tick: tick(0),
    vehicles: [],
    actors: [
      {
        actorId: white,
        position: { x: 0, y: 0, z: 0 },
        facing: { x: 0, y: 0, z: 1 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        locomotion: 'idle' as const,
      },
      {
        actorId: enemy,
        position: { x: 0, y: 0, z: 10 },
        facing: { x: 0, y: 0, z: -1 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        locomotion: 'idle' as const,
      },
    ],
  };
  const far = ai.decide(state, spatial);
  expect(acquired).toHaveLength(1);
  expect(far[0]).toMatchObject({
    type: 'MoveRequested',
    actorId: enemy,
    basisRevision: 7,
    z: -1,
  });
  expect(ai.decide(state, spatial)[0]).toMatchObject({ basisRevision: 7 });
  expect(acquired).toHaveLength(1);
  const near = {
    ...spatial,
    actors: spatial.actors.map((a) =>
      a.actorId === enemy ? { ...a, position: { x: 0, y: 0, z: 1 } } : a,
    ),
  };
  expect(ai.decide(state, near)[0]).toMatchObject({
    type: 'AttackRequested',
    actorId: enemy,
    category: 'kick',
  });
  expect(ai.decide(state, near)[0]).toMatchObject({ category: 'punch' });
  expect(
    ai.decide(
      {
        ...state,
        actors: state.actors.map((a) =>
          a.actorId === enemy ? { ...a, color: 'black' as const } : a,
        ),
      },
      near,
    )[0],
  ).toMatchObject({ category: 'kick' });
  expect(ended).toHaveLength(1);
  expect(ai.decide({ ...state, phase: 'paused' }, near)).toEqual([]);
  expect(ai.decide(state, { ...near, runId: runId('old') })).toEqual([]);
  expect(
    ai.decide({ ...state, currentOpponentId: actorId('unknown') }, near),
  ).toEqual([]);
});
