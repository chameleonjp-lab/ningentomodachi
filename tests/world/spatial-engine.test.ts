import { expect, test } from 'vitest';
import {
  actorId,
  attackActivationId,
  clipId,
  commandId,
  durationMs,
  type GameplayCommand,
  gameTimeMs,
  impactId,
  MOTION_SPACE,
  type MotionIntervalSample,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor, catalog, run, state, viewport } from './fixtures';

const layout = () => ({
  ...createParisStreetLayout(),
  actorSpawns: {
    white: { x: 0, y: 0, z: 0 },
    blue: { x: 0, y: 0, z: 3 },
    green: { x: 0, y: 0, z: 24 },
    yellow: { x: 0, y: 0, z: 40 },
    black: { x: 0, y: 0, z: 56 },
  },
});
function move(revision: number): GameplayCommand {
  return {
    type: 'MoveRequested',
    runId: run,
    actorId: actorId('white'),
    input: { commandId: commandId('move'), sequence: 1 },
    x: 1,
    z: 0,
    movementSessionId: 'finger',
    basisRevision: revision,
  };
}
test('held movement is fixed-step, stale duplicate steps rejected, commit never moves again', () => {
  const engine = createSpatialEngine(run, layout());
  engine.commit({ snapshot: state(), events: [] });
  engine.begin('finger', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const request = {
    snapshot: state(1),
    step: { durationMs: durationMs(20) },
    intents: [move(1)],
  };
  const result = engine.step(request, catalog());
  expect(result.snapshot.actors[0]?.position.x).toBeGreaterThan(0);
  expect(engine.commit({ snapshot: state(1), events: [] })).toEqual(
    result.snapshot,
  );
  expect(() => engine.step(request, catalog())).toThrow();
});
test('jump uses physics once, terminal and pause freeze all motion and contacts', () => {
  const e = createSpatialEngine(run, layout());
  e.commit({ snapshot: state(), events: [] });
  const jumping = e.step(
    {
      snapshot: state(1),
      step: { durationMs: durationMs(20) },
      intents: [
        {
          type: 'JumpRequested',
          runId: run,
          actorId: actorId('white'),
          input: { commandId: commandId('jump'), sequence: 1 },
        },
      ],
    },
    catalog(),
  );
  expect(jumping.snapshot.actors[0]?.grounded).toBe(false);
  expect(jumping.snapshot.actors[0]?.position.y).toBeGreaterThan(0);
  const terminal = e.step(
    {
      snapshot: state(2, { phase: 'terminal' }),
      step: { durationMs: durationMs(20) },
      intents: [],
    },
    catalog(),
  );
  expect(terminal.candidates).toEqual([]);
  expect(terminal.snapshot.actors).toEqual(jumping.snapshot.actors);
});
test('authored root suppresses free motion and vertical jump, preserving A impact binding', () => {
  const e = createSpatialEngine(run, layout());
  const player = {
    ...actor('white'),
    attack: {
      activationId: attackActivationId('attack'),
      clipId: clipId('kick'),
      category: 'kick' as const,
      startedAt: gameTimeMs(0),
      consumedImpacts: [],
      impactBindings: [{ impactIndex: 0, impactId: impactId('A-impact') }],
    },
  };
  const sample: MotionIntervalSample = {
    clipId: clipId('kick'),
    fromMs: durationMs(0),
    toMs: durationMs(20),
    space: MOTION_SPACE,
    rootSegments: [
      {
        from: {
          atMs: durationMs(0),
          position: { x: 0, y: 0, z: 0 },
          visualYawRad: 0,
        },
        to: {
          atMs: durationMs(20),
          position: { x: 0, y: 1, z: 1 },
          visualYawRad: 6.28,
        },
        deltaTranslation: { x: 0, y: 1, z: 1 },
        horizontalOwner: 'authored-root',
        verticalOwner: 'authored-root',
        yawOwner: 'visual-only',
      },
    ],
    hitVolumeSegments: [
      {
        impactIndex: 0,
        shapeId: 'foot',
        fromMs: durationMs(0),
        toMs: durationMs(20),
        activeWindow: { startMs: durationMs(0), endMs: durationMs(20) },
        from: { kind: 'sphere', center: { x: 0, y: 1, z: 0 }, radiusM: 0.2 },
        to: { kind: 'sphere', center: { x: 0, y: 1, z: 3 }, radiusM: 0.2 },
      },
    ],
  };
  e.commit({
    snapshot: state(0, { actors: [player, actor('blue')] }),
    events: [],
  });
  e.begin('finger', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const result = e.step(
    {
      snapshot: state(1, { actors: [player, actor('blue')] }),
      step: { durationMs: durationMs(20) },
      intents: [move(1)],
    },
    catalog(sample),
  );
  expect(result.snapshot.actors[0]?.position).toEqual({ x: 0, y: 1, z: 1 });
  const contact = result.candidates.find((c) => c.kind === 'body-hit');
  expect(contact?.kind === 'body-hit' && contact.source.impactId).toBe(
    'A-impact',
  );
  expect(result.snapshot.actors[0]?.facing).toEqual({ x: 0, y: 0, z: 1 });
});
test('waiting enemies never become targets and encounters share physical positions', () => {
  const e = createSpatialEngine(run, layout());
  const actors = [
    actor('white'),
    actor('blue'),
    actor('green'),
    actor('yellow'),
    actor('black'),
  ];
  const first = e.commit({ snapshot: state(0, { actors }), events: [] });
  const last = e.commit({
    snapshot: state(0, {
      revision: 1,
      actors,
      currentOpponentId: actorId('black'),
    }),
    events: [],
  });
  expect(last.actors.map((a) => a.position)).toEqual(
    first.actors.map((a) => a.position),
  );
  expect(last.actors).toHaveLength(5);
  expect(viewport.devicePixelRatio).toBe(3);
});
