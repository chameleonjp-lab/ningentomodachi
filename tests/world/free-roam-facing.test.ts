import { expect, test } from 'vitest';
import {
  actorId,
  attackActivationId,
  clipId,
  commandId,
  durationMs,
  gameTimeMs,
  MOTION_SPACE,
  type GameplayCommand,
  type MotionIntervalSample,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state } from './fixtures';

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
function setup(player = actor('white'), combat = false) {
  const engine = createSpatialEngine(run, {
    ...createParisStreetLayout(),
    objects: [],
    vehicles: [],
  });
  const snapshot = (n: number) =>
    state(n, {
      actors: [player, actor('blue')],
      currentOpponentId: combat ? actorId('blue') : null,
    });
  engine.commit({ snapshot: snapshot(0), events: [] });
  const basis = engine.begin('free-roam', v(1), v(0, 0, 1));
  function step(
    n: number,
    x: number,
    z: number,
    jump = false,
    sample?: MotionIntervalSample,
  ) {
    const intents: GameplayCommand[] = [
      {
        type: 'MoveRequested',
        runId: run,
        actorId: player.actorId,
        input: { commandId: commandId(`move-${n}`), sequence: n },
        x,
        z,
        movementSessionId: basis.sessionId,
        basisRevision: basis.revision,
      },
    ];
    if (jump)
      intents.push({
        type: 'JumpRequested',
        runId: run,
        actorId: player.actorId,
        input: { commandId: commandId(`jump-${n}`), sequence: n },
      });
    const pose = engine
      .step(
        {
          snapshot: snapshot(n),
          step: { durationMs: durationMs(20) },
          intents,
        },
        catalog(sample),
      )
      .snapshot.actors.find((a) => a.actorId === player.actorId);
    if (!pose) throw new Error('Missing player pose');
    return pose;
  }
  return { step };
}

test.each([-1, 1])(
  'free-roam lateral travel turns toward x=%s without snapping',
  (x) => {
    const pose = setup().step(1, x, 0);
    expect(pose.position).toEqual(v(x * 0.08));
    expect(pose.facing.x).toBeCloseTo(x * Math.sin(0.16), 10);
    expect(pose.facing.z).toBeCloseTo(Math.cos(0.16), 10);
  },
);

test('sustained reverse free-roam travel eventually faces the travel direction', () => {
  const { step } = setup();
  let pose = step(1, 0, -1);
  for (let n = 2; n <= 25; n++) pose = step(n, 0, -1);
  expect(pose.facing.x).toBeCloseTo(0, 10);
  expect(pose.facing.z).toBeCloseTo(-1, 10);
});

test('zero movement preserves free-roam facing', () => {
  expect(setup().step(1, 0, 0).facing).toEqual(v(0, 0, 1));
});

test('disallowed movement does not turn a stationary free-roam actor', () => {
  const player = actor('white');
  const pose = setup({
    ...player,
    actions: { ...player.actions, move: { allowed: false, reason: 'busy' } },
  }).step(1, 1, 0);
  expect(pose.position).toEqual(v());
  expect(pose.facing).toEqual(v(0, 0, 1));
});

test('active opponent facing continues to override lateral travel', () => {
  expect(setup(actor('white'), true).step(1, 1, 0).facing).toEqual(v(0, 0, 1));
});

test('airborne free-roam travel preserves the existing facing', () => {
  const { step } = setup();
  const takeoff = step(1, 0, 0, true);
  expect(takeoff.grounded).toBe(false);
  expect(step(2, 1, 0).facing).toEqual(takeoff.facing);
});

test('same-tick takeoff preserves facing even with lateral movement', () => {
  const pose = setup().step(1, 1, 0, true);
  expect(pose.grounded).toBe(false);
  expect(pose.facing).toEqual(v(0, 0, 1));
});

test('an active attack retains its admitted facing without an opponent', () => {
  const clip = clipId('free-roam-attack');
  const player = {
    ...actor('white'),
    attack: {
      activationId: attackActivationId('free-roam-attack'),
      clipId: clip,
      category: 'kick' as const,
      startedAt: gameTimeMs(0),
      consumedImpacts: [],
      impactBindings: [],
    },
  };
  const sample: MotionIntervalSample = {
    clipId: clip,
    fromMs: durationMs(0),
    toMs: durationMs(20),
    space: MOTION_SPACE,
    rootSegments: [],
    hitVolumeSegments: [],
  };
  expect(setup(player).step(1, 1, 0, false, sample).facing).toEqual(v(0, 0, 1));
});
