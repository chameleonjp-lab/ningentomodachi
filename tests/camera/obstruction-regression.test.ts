import { expect, test } from 'vitest';
import {
  type CameraFrame,
  createCameraRig,
  projectPoint,
} from '../../src/camera/camera-rig';
import { actorId, type SpatialActor, worldObjectId } from '../../src/contracts';
import { toBox } from '../../src/world/character-motor';
import { dot } from '../../src/world/math';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { type Box, sweepBox } from '../../src/world/swept-shapes';
import { viewport } from '../world/fixtures';

const pose = (x = 0, z = 0): SpatialActor => ({
  actorId: actorId('white'),
  position: { x, y: 0, z },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle',
});
function blocked(frame: CameraFrame, box: Box) {
  return sweepBox(
    { kind: 'sphere', center: frame.target, radiusM: 0.1 },
    { kind: 'sphere', center: frame.position, radiusM: 0.1 },
    box,
  );
}
test('focus-to-eye sphere sweep clears a tall wall while keeping actor framed', () => {
  const wall = {
    objectId: worldObjectId('wall'),
    position: { x: 0, y: 4, z: -2 },
    halfExtents: { x: 4, y: 4, z: 0.1 },
  };
  const rig = createCameraRig({
    ...createParisStreetLayout(),
    objects: [wall],
  });
  const frame = rig.update(pose(), undefined, viewport, 16);
  expect(blocked(frame, toBox(wall.position, wall.halfExtents))).toBeNull();
  expect(projectPoint({ x: 0, y: 1, z: 0 }, frame, viewport).visibility).toBe(
    'visible',
  );
});
test('damped exploration-to-duel and back stay clear of all opaque boxes without flipping right', () => {
  const walls = [
    {
      objectId: worldObjectId('back-wall'),
      position: { x: 0, y: 3, z: -2 },
      halfExtents: { x: 4, y: 3, z: 0.1 },
    },
    {
      objectId: worldObjectId('side-wall'),
      position: { x: 3, y: 2, z: 3 },
      halfExtents: { x: 0.1, y: 2, z: 3 },
    },
  ];
  const rig = createCameraRig({ ...createParisStreetLayout(), objects: walls });
  let previous: CameraFrame | undefined;
  for (const opponent of [undefined, pose(0, 6), undefined])
    for (let i = 0; i < 30; i++) {
      const frame = rig.update(pose(), opponent, viewport, 16);
      for (const wall of walls)
        expect(
          blocked(frame, toBox(wall.position, wall.halfExtents)),
        ).toBeNull();
      if (previous) expect(dot(previous.right, frame.right)).toBeGreaterThan(0);
      expect(
        projectPoint({ x: 0, y: 1, z: 0 }, frame, viewport).visibility,
      ).toBe('visible');
      if (opponent)
        expect(
          projectPoint({ x: 0, y: 1, z: 6 }, frame, viewport).visibility,
        ).toBe('visible');
      previous = frame;
    }
});
