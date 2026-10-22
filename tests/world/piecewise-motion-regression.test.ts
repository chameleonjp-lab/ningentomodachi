import { expect, test } from 'vitest';
import {
  clipId,
  durationMs,
  MOTION_SPACE,
  type MotionIntervalSample,
  type SpatialActor,
  type Vector3,
} from '../../src/contracts';
import { stepCharacter, toBox } from '../../src/world/character-motor';
import { positionAt } from '../../src/world/contact-candidates';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { actor } from './fixtures';

const state = actor('white');
const pose: SpatialActor = {
  actorId: state.actorId,
  position: { x: 0, y: 0, z: 0 },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle',
};
function sample(delta: Vector3): MotionIntervalSample {
  return {
    clipId: clipId('root'),
    fromMs: durationMs(0),
    toMs: durationMs(20),
    space: MOTION_SPACE,
    hitVolumeSegments: [],
    rootSegments: [
      {
        from: {
          atMs: durationMs(0),
          position: { x: 0, y: 0, z: 0 },
          visualYawRad: 0,
        },
        to: { atMs: durationMs(20), position: delta, visualYawRad: 0 },
        deltaTranslation: delta,
        horizontalOwner: 'authored-root',
        verticalOwner: 'authored-root',
        yawOwner: 'visual-only',
      },
    ],
  };
}
const layout = { ...createParisStreetLayout(), objects: [], vehicles: [] };
test('wall contact preserves authored speed before TOI and stationary remainder afterwards', () => {
  const result = stepCharacter(
    pose,
    state,
    0,
    20,
    { x: 0, y: 0, z: 0 },
    false,
    sample({ x: 0, y: 0, z: 10 }),
    0,
    layout,
    [toBox({ x: 0, y: 2, z: 2 }, { x: 10, y: 2, z: 0.01 })],
  );
  expect(positionAt(result.path, 2).z).toBeCloseTo(1, 6);
  expect(positionAt(result.path, 3).z).toBeCloseTo(1.5, 6);
  expect(positionAt(result.path, 10).z).toBeCloseTo(1.64, 6);
  expect(positionAt(result.path, 19).z).toBeCloseTo(1.64, 6);
  expect(result.path.some((p) => Math.abs(p.at - 3.28) < 1e-5)).toBe(true);
});
test('diagonal wall slide follows its collision bend instead of an endpoint chord', () => {
  const result = stepCharacter(
    pose,
    state,
    0,
    20,
    { x: 0, y: 0, z: 0 },
    false,
    sample({ x: 4, y: 0, z: 10 }),
    0,
    layout,
    [toBox({ x: 0, y: 2, z: 2 }, { x: 10, y: 2, z: 0.01 })],
  );
  expect(positionAt(result.path, 2).x).toBeCloseTo(0.4, 6);
  expect(positionAt(result.path, 2).z).toBeCloseTo(1, 6);
  expect(positionAt(result.path, 10).x).toBeCloseTo(2, 6);
  expect(positionAt(result.path, 10).z).toBeCloseTo(1.64, 6);
  expect(result.actor.position.x).toBeCloseTo(4, 6);
});
test('play-space boundaries contribute timed collision keys instead of final-only clamps', () => {
  const result = stepCharacter(
    pose,
    state,
    0,
    20,
    { x: 0, y: 0, z: 0 },
    false,
    sample({ x: 20, y: 0, z: 0 }),
    0,
    layout,
    [],
  );
  expect(positionAt(result.path, 2).x).toBeCloseTo(2, 6);
  expect(positionAt(result.path, 10).x).toBeCloseTo(
    layout.bounds.max.x - 0.35,
    6,
  );
  expect(result.path.some((p) => p.at > 0 && p.at < 20)).toBe(true);
});
