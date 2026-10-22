import { PerspectiveCamera, Vector3 as ThreeVector3 } from 'three';
import { expect, test } from 'vitest';
import {
  createCameraRig,
  initialCamera,
  projectPoint,
  type CameraFrame,
} from '../../src/camera/camera-rig';
import { actorId, worldObjectId, type SpatialActor } from '../../src/contracts';
import { add, dot, length, mul, sub, unit } from '../../src/world/math';
import { toBox } from '../../src/world/character-motor';
import { sweepBox } from '../../src/world/swept-shapes';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { viewport } from '../world/fixtures';
const pose = (x: number, z: number): SpatialActor => ({
  actorId: actorId('white'),
  position: { x, y: 0, z },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle',
});
function ndc(frame: CameraFrame, point = frame.target) {
  const c = new PerspectiveCamera(frame.fovDegrees, 0.5, 0.05, 250);
  c.position.set(frame.position.x, frame.position.y, frame.position.z);
  c.lookAt(frame.target.x, frame.target.y, frame.target.z);
  c.updateMatrixWorld();
  return new ThreeVector3(point.x, point.y, point.z).project(c);
}
test('actual camera side stays continuous across the entire legal lateral and longitudinal ranges', () => {
  const layout = createParisStreetLayout();
  for (const duel of [false, true])
    for (const axis of ['x', 'z'] as const) {
      const rig = createCameraRig(layout);
      let last: CameraFrame | undefined;
      const low = layout.bounds.min[axis] + 0.35,
        high = layout.bounds.max[axis] - 0.35 - (duel && axis === 'z' ? 6 : 0);
      for (const sign of [1, -1])
        for (let i = 0; i <= 240; i++) {
          const t = sign === 1 ? i / 240 : 1 - i / 240,
            value = low + (high - low) * t;
          const a = axis === 'x' ? pose(value, 10) : pose(0, value),
            b = duel ? pose(a.position.x, a.position.z + 6) : undefined;
          const f = rig.update(a, b, viewport, 16);
          if (last) expect(dot(f.right, last.right)).toBeGreaterThan(0);
          expect(
            Math.hypot(f.position.x - f.target.x, f.position.z - f.target.z),
          ).toBeGreaterThan(0.01);
          const p = ndc(f),
            right = ndc(f, add(f.target, f.right));
          expect(right.x).toBeGreaterThan(p.x);
          last = f;
        }
    }
});
test('nearby tall walls retain bounded camera distance and actual far-frustum inclusion', () => {
  for (const gap of [0.351, 0.36, 0.5, 1, 2])
    for (const height of [8, 40, 300]) {
      const wall = {
        objectId: worldObjectId(`wall-${gap}-${height}`),
        position: { x: 0, y: height / 2, z: -gap - 0.1 },
        halfExtents: { x: 4, y: height / 2, z: 0.1 },
      };
      const frame = createCameraRig({
        ...createParisStreetLayout(),
        objects: [wall],
      }).update(pose(0, 0), undefined, viewport, 16);
      expect(length(sub(frame.position, frame.target))).toBeLessThan(200);
      const point = ndc(frame);
      expect(point.z).toBeLessThanOrEqual(1);
      expect(point.z).toBeGreaterThanOrEqual(-1);
      expect(projectPoint(frame.target, frame, viewport).visibility).toBe(
        'visible',
      );
      expect(
        sweepBox(
          { kind: 'sphere', center: frame.target, radiusM: 0.2 },
          { kind: 'sphere', center: frame.position, radiusM: 0.2 },
          toBox(wall.position, wall.halfExtents),
        ),
      ).toBeNull();
      for (const y of [0, 1, 2]) {
        const p = ndc(frame, { x: 0, y, z: 0 });
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
      }
    }
});
test('HUD projection never declares near-clipped or far-clipped points visible', () => {
  const forward = unit(sub(initialCamera.target, initialCamera.position));
  for (const distance of [0.01, 0.04, 0.06, 249, 251, 1000]) {
    const point = add(initialCamera.position, mul(forward, distance));
    const actual = ndc(initialCamera, point),
      inside = actual.z >= -1 && actual.z <= 1;
    expect(
      projectPoint(point, initialCamera, viewport).visibility === 'visible',
    ).toBe(inside);
  }
});
test('impossible enclosed focus returns a bounded constrained fallback, not an exception or false visibility', () => {
  const frame = createCameraRig({
    ...createParisStreetLayout(),
    objects: [
      {
        objectId: worldObjectId('solid'),
        position: { x: 0, y: 1, z: 0 },
        halfExtents: { x: 2, y: 2, z: 2 },
      },
    ],
  }).update(pose(0, 0), undefined, viewport, 16);
  expect(length(sub(frame.position, frame.target))).toBeLessThan(200);
  expect(projectPoint(frame.target, frame, viewport).visibility).not.toBe(
    'visible',
  );
});
