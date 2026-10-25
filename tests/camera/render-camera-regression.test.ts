import { PerspectiveCamera, Vector3 as ThreeVector3 } from 'three';
import { expect, test } from 'vitest';
import {
  type CameraFrame,
  createCameraRig,
  projectPoint,
} from '../../src/camera/camera-rig';
import { actorId, type SpatialActor, type Vector3 } from '../../src/contracts';
import { add, dot, sub } from '../../src/world/math';
import {
  createParisBattleLayout,
  createParisStreetLayout,
} from '../../src/world/street-layout';
import { viewport } from '../world/fixtures';

const pose = (x = 0, z = 0): SpatialActor => ({
  actorId: actorId('white'),
  position: { x, y: 0, z },
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle',
});
function actual(point: Vector3, frame: CameraFrame) {
  const camera = new PerspectiveCamera(
    frame.fovDegrees,
    viewport.widthCssPx / viewport.heightCssPx,
    0.05,
    250,
  );
  camera.position.set(frame.position.x, frame.position.y, frame.position.z);
  camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
  camera.updateMatrixWorld();
  const ndc = new ThreeVector3(point.x, point.y, point.z).project(camera);
  return {
    x: ((ndc.x + 1) * viewport.widthCssPx) / 2,
    y: ((1 - ndc.y) * viewport.heightCssPx) / 2,
  };
}
test('CSS hit projection equals actual draw camera for asymmetric points in both modes', () => {
  for (const opponent of [undefined, pose(1, 8)]) {
    const frame = createCameraRig(createParisStreetLayout()).update(
      pose(),
      opponent,
      viewport,
      20,
    );
    for (const point of [
      { x: 1, y: 2, z: 0 },
      { x: -2, y: 0.7, z: 3 },
      { x: 0.3, y: 4, z: 1 },
    ]) {
      const expected = actual(point, frame),
        got = projectPoint(point, frame, viewport).cssPoint;
      expect(got?.x).toBeCloseTo(expected.x, 8);
      expect(got?.y).toBeCloseTo(expected.y, 8);
    }
  }
});
test('every transitional camera publishes actual screen-right and away-positive horizontal bases', () => {
  const rig = createCameraRig(createParisStreetLayout());
  const cases = [undefined, pose(0, 8), pose(-2, 5), undefined];
  for (const opponent of cases)
    for (let i = 0; i < 8; i++) {
      const frame = rig.update(pose(), opponent, viewport, 16);
      const origin = actual(frame.target, frame),
        right = actual(add(frame.target, frame.right), frame);
      expect(right.x).toBeGreaterThan(origin.x);
      expect(right.y).toBeCloseTo(origin.y, 8);
      expect(
        dot(frame.depth, sub(frame.target, frame.position)),
      ).toBeGreaterThan(0);
      expect(dot(frame.right, frame.depth)).toBeCloseTo(0, 8);
    }
});

test('stage fixed view side stays signed through crossing and HUD projection matches Three at every DPR', () => {
  const layout = createParisBattleLayout(),
    rig = createCameraRig(layout);
  let firstDepth: Vector3 | undefined;
  for (const z of [1.4, -1.39, -1.4, -1.41, -2.8]) {
    for (const devicePixelRatio of [1, 2, 3]) {
      const vp = { ...viewport, devicePixelRatio };
      const frame = rig.update(pose(0, -1.4), pose(0, z), vp, 16);
      firstDepth ??= frame.depth;
      expect(dot(frame.depth, firstDepth)).toBeCloseTo(1, 10);
      expect(frame.depth.x).toBeGreaterThan(0);
      const point = { x: 0.25, y: 2.1, z: -1 };
      const expected = actual(point, frame),
        got = projectPoint(point, frame, vp).cssPoint;
      expect(got?.x).toBeCloseTo(expected.x, 8);
      expect(got?.y).toBeCloseTo(expected.y, 8);
      expect(actual(add(frame.target, frame.right), frame).x).toBeGreaterThan(
        actual(frame.target, frame).x,
      );
    }
  }
});
