import { PerspectiveCamera, Vector3 } from 'three';
import { expect, test } from 'vitest';
import {
  createCameraRig,
  CAMERA_NEAR,
  CAMERA_FAR,
  projectPoint,
  type CameraFrame,
} from '../../src/camera/camera-rig';
import {
  actorId,
  worldObjectId,
  type SpatialActor,
  type Vector3 as Point,
  type ViewportSnapshot,
} from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { viewport } from '../world/fixtures';
import { length, sub } from '../../src/world/math';
import { toBox } from '../../src/world/character-motor';
import { sweepBox } from '../../src/world/swept-shapes';
const actor = (p: Point): SpatialActor => ({
  actorId: actorId('white'),
  position: p,
  facing: { x: 0, y: 0, z: 1 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  locomotion: 'idle',
});
const corners = (min: Point, max: Point) =>
  [min.x, max.x].flatMap((x) =>
    [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z }))),
  );
// Exact exported full-mesh world bounds, ChineseCartwheelKick-kick-white-0.json,
// accepted-support-1410. This fixture is geometry evidence, not an attack catalog.
const actual = corners(
  { x: 0.33099136628267345, y: 0.08467911691942076, z: -0.1679999977350235 },
  { x: 2.4219268576435597, y: 2.038887009264245, z: 0.3491221261000037 },
);
const focus = { x: 0.6924596297947567, y: 3.1434746717495266, z: 0 };
function contained(
  frame: CameraFrame,
  points: readonly Point[],
  vp = viewport,
) {
  const camera = new PerspectiveCamera(
    frame.fovDegrees,
    vp.widthCssPx / vp.heightCssPx,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  camera.position.set(frame.position.x, frame.position.y, frame.position.z);
  camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
  camera.updateMatrixWorld();
  const ux = Math.max(
    0.35,
    1 - (vp.safeAreaCssPx.left + vp.safeAreaCssPx.right + 40) / vp.widthCssPx,
  );
  const uy = Math.max(
    0.35,
    1 - (vp.safeAreaCssPx.top + vp.safeAreaCssPx.bottom + 140) / vp.heightCssPx,
  );
  for (const p of points) {
    const n = new Vector3(p.x, p.y, p.z).project(camera);
    expect(Math.abs(n.x)).toBeLessThanOrEqual(ux + 1e-8);
    expect(Math.abs(n.y)).toBeLessThanOrEqual(uy + 1e-8);
    expect(Math.abs(n.z)).toBeLessThanOrEqual(1);
  }
}
test('exact exported death bounds avoid scalar focus-lag overshoot while preserving damped focus', () => {
  const layout = { ...createParisStreetLayout(), objects: [], vehicles: [] },
    rig = createCameraRig(layout);
  // Reconstruct the exported damped focus through the public update API. The
  // prior range is smaller than the failing scalar fit, so no hidden state is needed.
  rig.update(actor({ ...focus, y: focus.y - 1 }), undefined, viewport, 0);
  const f = rig.update(
    actor({ x: 1.314551733260614, y: 2.3951904811285467, z: 0 }),
    undefined,
    viewport,
    0,
    actual,
  );
  expect(f.target).toEqual(focus);
  contained(f, actual);
  // Independently feasible8m eye at this same focus obeys rear bound and margins.
  const feasible = {
    ...f,
    position: { x: focus.x, y: focus.y + Math.sqrt(64 - 36), z: -6 },
  };
  contained(feasible, actual);
  expect(length(sub(f.position, f.target))).toBeLessThan(10);
  expect(f.position.y).toBeLessThan(12);
  console.info('Actual exported-bound camera fit', {
    distanceM: length(sub(f.position, f.target)),
    eyeY: f.position.y,
    focus: f.target,
  });
});
test('portrait/landscape, reversed frame order and side-on motion retain all displayed corners', () => {
  for (const vp of [
    viewport,
    { ...viewport, widthCssPx: 800, heightCssPx: 400 },
  ] satisfies ViewportSnapshot[]) {
    const rig = createCameraRig({ ...createParisStreetLayout(), objects: [] });
    const a = actor({ x: 0, y: 0, z: 0 }),
      b = { ...actor({ x: 0, y: 0, z: 5 }), actorId: actorId('blue') };
    for (const shift of [0, 2, 5, 1, 0]) {
      const points = [
        ...actual.map((p) => ({ ...p, y: p.y + shift })),
        ...corners({ x: -0.35, y: 0, z: 4.65 }, { x: 0.35, y: 1.85, z: 5.35 }),
      ];
      const f = rig.update(a, b, vp, 16, points);
      contained(f, points, vp);
      expect(length(sub(f.position, f.target))).toBeGreaterThanOrEqual(7);
      expect(length(sub(f.position, f.target))).toBeLessThanOrEqual(180);
    }
  }
});
test('refined fit still sweeps camera obstruction and reports impossible geometry honestly', () => {
  const wall = {
    objectId: worldObjectId('fit-wall'),
    position: { x: 0, y: 20, z: -1 },
    halfExtents: { x: 4, y: 20, z: 0.1 },
  };
  const layout = { ...createParisStreetLayout(), objects: [wall] };
  const a = actor({ x: 0, y: 0, z: 0 }),
    points = corners(
      { x: -0.35, y: 0, z: -0.35 },
      { x: 0.35, y: 1.85, z: 0.35 },
    );
  const f = createCameraRig(layout).update(a, undefined, viewport, 16, points);
  contained(f, points);
  expect(
    sweepBox(
      { kind: 'sphere', center: f.target, radiusM: 0.2 },
      { kind: 'sphere', center: f.position, radiusM: 0.2 },
      toBox(wall.position, wall.halfExtents),
    ),
  ).toBeNull();
  const embedded = {
    ...wall,
    position: { x: 0, y: 1, z: 0 },
    halfExtents: { x: 20, y: 20, z: 20 },
  };
  const bad = createCameraRig({ ...layout, objects: [embedded] }).update(
    a,
    undefined,
    viewport,
    16,
    points,
  );
  expect(bad.constrained).toBe(true);
  expect(length(sub(bad.position, bad.target))).toBeLessThanOrEqual(180);
  expect(projectPoint(bad.target, bad, viewport).visibility).toBe(
    'unprojectable',
  );
  const huge = createCameraRig({ ...layout, objects: [] }).update(
    a,
    undefined,
    viewport,
    16,
    corners({ x: -1000, y: -1000, z: -1000 }, { x: 1000, y: 1000, z: 1000 }),
  );
  expect(huge.constrained).toBe(true);
  expect(length(sub(huge.position, huge.target))).toBeLessThanOrEqual(180);
});

test('millimetre obstacle stays opaque through repeated near-wall fitting', () => {
  const wall = {
    objectId: worldObjectId('thin-camera-wall'),
    position: { x: 0, y: 3, z: -0.5 },
    halfExtents: { x: 4, y: 3, z: 0.0005 },
  };
  const rig = createCameraRig({
    ...createParisStreetLayout(),
    objects: [wall],
  });
  for (const z of [0, 0.01, 0.03, 0.01, 0]) {
    const a = actor({ x: 0, y: 0, z });
    const points = corners(
      { x: -0.35, y: 0, z: z - 0.35 },
      { x: 0.35, y: 1.85, z: z + 0.35 },
    );
    const f = rig.update(a, undefined, viewport, 16, points);
    contained(f, points);
    expect(
      sweepBox(
        { kind: 'sphere', center: f.target, radiusM: 0.2 },
        { kind: 'sphere', center: f.position, radiusM: 0.2 },
        toBox(wall.position, wall.halfExtents),
      ),
    ).toBeNull();
  }
});
